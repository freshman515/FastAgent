import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStore, resolveCanvasLayoutKey } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import type { CanvasCard } from '@shared/types'
import { CanvasGrid } from './CanvasGrid'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasContextMenu, type CanvasContextMenuState } from './CanvasContextMenu'
import { CanvasMarquee } from './CanvasMarquee'
import { CanvasGuideLines } from './CanvasGuideLines'
import { CanvasMinimap } from './CanvasMinimap'
import { NoteCard } from './cards/NoteCard'
import { SessionCard } from './cards/SessionCard'
import { useCanvasViewport, screenToWorld } from './hooks/useCanvasViewport'
import { useMarqueeSelect } from './hooks/useMarqueeSelect'
import { useCanvasKeyboard } from './hooks/useCanvasKeyboard'

/**
 * Top-level canvas view. Rendered by `MainPanel` when
 * `AppSettings.workspaceLayout === 'canvas'`. Coexists with the BSP panes
 * tree — switching modes doesn't destroy either side's state.
 */
export function CanvasWorkspace(): JSX.Element {
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const attachViewportRef = useCallback((el: HTMLDivElement | null) => {
    viewportRef.current = el
    setViewportEl(el)
  }, [])

  const workspaceMode = usePanesStore((state) => state.workspaceMode)
  const currentProjectKey = usePanesStore((state) => state.currentProjectId)
  const paneSessions = usePanesStore((state) => state.paneSessions)
  const activePaneId = usePanesStore((state) => state.activePaneId)
  const activeTabId = usePanesStore((state) => state.paneActiveSession[state.activePaneId] ?? null)
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)

  // 1) Keep canvas layout key aligned with the current panes scope.
  useEffect(() => {
    const key = resolveCanvasLayoutKey(workspaceMode, currentProjectKey)
    useCanvasStore.getState().setActiveLayout(key)
  }, [workspaceMode, currentProjectKey])

  // 2) Ongoing sync — whenever the panes tree gains a session that doesn't
  //    yet have a canvas card (either because the user just opened one from
  //    the sidebar, or because the layout was empty when they switched to
  //    canvas mode), auto-attach a card for it. Existing cards are never
  //    touched, so this is idempotent across re-runs.
  //
  //    When the user opens a single session (the common sidebar-click path),
  //    we also focus the freshly created card — matches the muscle memory
  //    of "clicking a session makes it the thing you're looking at".
  const isInitialSyncRef = useRef(true)
  const canvasSelectionSyncRef = useRef(false)
  useEffect(() => {
    const canvas = useCanvasStore.getState()
    const sessionIdsInPanes = Object.values(paneSessions).flat().filter((id) => !id.startsWith('editor-'))
    const skipActiveTabFocus = canvasSelectionSyncRef.current
    canvasSelectionSyncRef.current = false
    const shouldFocusActiveTab = Boolean(activeTabId && sessionIdsInPanes.includes(activeTabId) && !skipActiveTabFocus)
    if (sessionIdsInPanes.length === 0) {
      isInitialSyncRef.current = false
      return
    }
    const existingRefs = new Set(canvas.getCards().map((c) => c.refId).filter(Boolean) as string[])
    const newIds = sessionIdsInPanes.filter((id) => !existingRefs.has(id))
    if (newIds.length === 0) {
      if (shouldFocusActiveTab && activeTabId) {
        requestAnimationFrame(() => focusCanvasCardForSession(activeTabId))
      }
      isInitialSyncRef.current = false
      return
    }
    const sessionsStore = useSessionsStore.getState()
    const created = canvas.autoPopulateFromSessions(newIds, (id) => {
      const session = sessionsStore.sessions.find((s) => s.id === id)
      return session?.type === 'terminal' ? 'terminal' : 'session'
    })

    if (shouldFocusActiveTab && activeTabId) {
      requestAnimationFrame(() => focusCanvasCardForSession(activeTabId))
      isInitialSyncRef.current = false
      return
    }

    // Skip focus on the very first sync after mount — the user just switched
    // to canvas mode and bulk-importing N cards shouldn't hijack the view.
    // Also skip for multi-add (e.g. detached window reattach).
    if (!isInitialSyncRef.current && created.length === 1) {
      // Defer one frame so the card's DOM element exists and getBoundingClientRect
      // on the viewport is stable.
      requestAnimationFrame(() => canvas.focusOnCard(created[0]))
    }
    isInitialSyncRef.current = false
  }, [activeTabId, paneSessions])

  // 3) When a canvas card is focused/selected, keep classic tabs in sync so
  //    switching back to classic mode lands on the same session.
  useEffect(() => {
    const selectedCardId = selectedCardIds[0]
    if (!selectedCardId) return

    const card = useCanvasStore.getState().getCard(selectedCardId)
    if (!card?.refId || card.refId.startsWith('editor-')) return
    const sessionExists = useSessionsStore.getState().sessions.some((session) => session.id === card.refId)
    if (!sessionExists) return

    const panes = usePanesStore.getState()
    const paneId = panes.findPaneForSession(card.refId)
    canvasSelectionSyncRef.current = true
    if (paneId) {
      panes.setActivePaneId(paneId)
      panes.setPaneActiveSession(paneId, card.refId)
    } else {
      panes.addSessionToPane(activePaneId, card.refId)
    }
    useSessionsStore.getState().setActive(card.refId)
  }, [activePaneId, selectedCardIds])

  // 4) Reverse-sync: when sessions are removed elsewhere, clean up their
  //    canvas cards so we don't render orphans.
  useEffect(() => {
    const previousIds = new Set(useSessionsStore.getState().sessions.map((s) => s.id))
    const unsubscribe = useSessionsStore.subscribe((state) => {
      const currentIds = new Set(state.sessions.map((s) => s.id))
      for (const id of previousIds) {
        if (!currentIds.has(id)) useCanvasStore.getState().detachSessionEverywhere(id)
      }
      previousIds.clear()
      for (const id of currentIds) previousIds.add(id)
    })
    return unsubscribe
  }, [])

  useCanvasViewport(viewportEl)
  useMarqueeSelect(viewportEl)
  useCanvasKeyboard(viewportEl)

  const cards = useCanvasStore((state) => state.getLayout().cards)
  const gridEnabled = useUIStore((state) => state.settings.canvasGridEnabled)
  const showMinimap = useUIStore((state) => state.settings.canvasShowMinimap)
  const clearSelection = useCanvasStore((state) => state.clearSelection)

  // ── Context menu state ───────────────────────────────────────────
  const [menu, setMenu] = useState<CanvasContextMenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const onViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.button !== 0) return
    clearSelection()
    closeMenu()
  }

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    // Only trigger on canvas empty space.
    const target = event.target as HTMLElement
    const cardEl = target.closest<HTMLElement>('[data-card-id]')
    event.preventDefault()
    if (!viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const viewport = useCanvasStore.getState().getViewport()
    const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewport)

    if (cardEl) {
      const id = cardEl.dataset.cardId!
      const selection = useCanvasStore.getState().selectedCardIds
      if (!selection.includes(id)) useCanvasStore.getState().setSelection([id])
      setMenu({ screenX: event.clientX, screenY: event.clientY, target: 'card', cardId: id })
    } else {
      setMenu({ screenX: event.clientX, screenY: event.clientY, target: 'canvas', worldX: world.x, worldY: world.y })
    }
  }

  // M5 — detached windows don't own the canvas.
  if (window.api.detach.isDetached) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
        分离窗口不支持画布模式。请在主窗口使用。
      </div>
    )
  }

  return (
    <div className="relative isolate h-full w-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Viewport (screen-space) — captures wheel/pan gestures */}
      <div
        ref={attachViewportRef}
        data-canvas-viewport
        className="absolute inset-0 touch-none"
        role="region"
        aria-label={`Canvas workspace, ${cards.length} cards`}
        onPointerDown={onViewportPointerDown}
        onContextMenu={onContextMenu}
      >
        {gridEnabled && <CanvasGrid />}
        <CanvasProjectedCardLayer cards={cards} viewportEl={viewportEl} />
        <CanvasGuideLines />
        <CanvasMarquee />
      </div>

      <CanvasToolbar viewportRef={viewportRef} />
      {showMinimap && <CanvasMinimap viewportRef={viewportRef} />}

      {cards.length === 0 && <CanvasEmptyState viewportRef={viewportRef} />}

      {menu && <CanvasContextMenu state={menu} onClose={closeMenu} />}
    </div>
  )
}

function CanvasProjectedCardLayer({ cards, viewportEl }: { cards: CanvasCard[]; viewportEl: HTMLDivElement | null }): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0">
      {cards.map((card) => <CanvasCardRenderer key={card.id} card={card} viewportEl={viewportEl} />)}
    </div>
  )
}

function CanvasCardRenderer({ card, viewportEl }: { card: CanvasCard; viewportEl: HTMLDivElement | null }): JSX.Element | null {
  if (card.kind === 'note') return <NoteCard card={card} coordinateMode="screen" />
  if (card.kind === 'session' || card.kind === 'terminal') {
    return <CulledSessionCard card={card} viewportEl={viewportEl} />
  }
  return null
}

function focusCanvasCardForSession(sessionId: string): void {
  const canvas = useCanvasStore.getState()
  const card = canvas.getCards().find((candidate) => candidate.refId === sessionId)
  if (!card) return
  canvas.focusOnCard(card.id)
}

/**
 * Viewport culling for heavy (xterm-backed) session cards. When the canvas
 * holds many cards and a card sits far outside the visible area, we skip
 * mounting the full TerminalView. The underlying PTY keeps running; the replay
 * snapshot brings the terminal back instantly when the card scrolls into view.
 *
 * Culling only kicks in past 50 cards — below that, always mount everything
 * so the user sees a smooth experience.
 */
function CulledSessionCard({ card, viewportEl }: { card: CanvasCard; viewportEl: HTMLDivElement | null }): JSX.Element | null {
  const totalCards = useCanvasStore((state) => state.getLayout().cards.length)
  const viewport = useCanvasStore((state) => totalCards > 50 ? state.getLayout().viewport : null)

  if (totalCards <= 50 || !viewportEl || !viewport) return <SessionCard card={card} coordinateMode="screen" />

  const rect = viewportEl.getBoundingClientRect()
  const padding = 200
  const leftWorld = (-viewport.offsetX - padding) / viewport.scale
  const topWorld = (-viewport.offsetY - padding) / viewport.scale
  const rightWorld = (rect.width - viewport.offsetX + padding) / viewport.scale
  const bottomWorld = (rect.height - viewport.offsetY + padding) / viewport.scale

  const visible = !(
    card.x + card.width < leftWorld
    || card.x > rightWorld
    || card.y + card.height < topWorld
    || card.y > bottomWorld
  )
  if (visible) return <SessionCard card={card} coordinateMode="screen" />

  return null
}

function CanvasEmptyState({ viewportRef }: { viewportRef: React.RefObject<HTMLDivElement | null> }): JSX.Element {
  const addCard = useCanvasStore((state) => state.addCard)
  const addNote = (): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const { scale, offsetX, offsetY } = useCanvasStore.getState().getLayout().viewport
    const cx = (rect.width / 2 - offsetX) / scale - 120
    const cy = (rect.height / 2 - offsetY) / scale - 80
    addCard({ kind: 'note', x: cx, y: cy, noteBody: '双击编辑内容，标题栏拖动', noteColor: 'yellow' })
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/90 px-6 py-5 text-center shadow-xl backdrop-blur">
        <div className="text-[var(--ui-font-md)] font-semibold text-[var(--color-text-primary)]">
          无限画布
        </div>
        <p className="mt-2 max-w-[360px] text-[var(--ui-font-sm)] leading-6 text-[var(--color-text-secondary)]">
          滚轮缩放、空格 + 拖拽平移、Shift + 滚轮横向平移。从侧边栏打开会话会自动加到画布。
        </p>
        <button
          type="button"
          onClick={addNote}
          className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-1.5 text-[var(--ui-font-sm)] text-white transition-opacity hover:opacity-90"
        >
          放一张便签试试
        </button>
      </div>
    </div>
  )
}
