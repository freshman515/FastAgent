import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CanvasCard } from '@shared/types'
import { isCanvasCardHidden, useCanvasStore, resolveCanvasLayoutKey } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { cn } from '@/lib/utils'
import { CanvasGrid } from './CanvasGrid'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasContextMenu, type CanvasContextMenuState } from './CanvasContextMenu'
import { CanvasMarquee } from './CanvasMarquee'
import { CanvasGuideLines } from './CanvasGuideLines'
import { CanvasMinimap } from './CanvasMinimap'
import { CanvasRelations } from './CanvasRelations'
import { CanvasSearch } from './CanvasSearch'
import { CanvasSessionList } from './CanvasSessionList'
import { CanvasSelectionBounds } from './CanvasSelectionBounds'
import { CanvasMaximizedSwitcher } from './CanvasMaximizedSwitcher'
import { FrameCard } from './cards/FrameCard'
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
function cleanupOrphanedCanvasCards(): void {
  const sessionState = useSessionsStore.getState()
  if (!sessionState._loaded) return

  const validSessionIds = new Set(sessionState.sessions.map((session) => session.id))
  const canvas = useCanvasStore.getState()
  const staleRefIds = new Set<string>()

  for (const layout of Object.values(canvas.layouts)) {
    for (const card of layout.cards) {
      if (
        (card.kind === 'session' || card.kind === 'terminal')
        && card.refId
        && !validSessionIds.has(card.refId)
      ) {
        staleRefIds.add(card.refId)
      }
    }
  }

  for (const refId of staleRefIds) {
    canvas.detachSessionEverywhere(refId)
  }
}

export function CanvasWorkspace(): JSX.Element {
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchScopeFrameId, setSearchScopeFrameId] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const attachViewportRef = useCallback((el: HTMLDivElement | null) => {
    viewportRef.current = el
    setViewportEl(el)
  }, [])

  const openSearch = useCallback((frameId?: string | null) => {
    setSearchScopeFrameId(frameId ?? null)
    setSearchOpen(true)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchScopeFrameId(null)
  }, [])

  const workspaceMode = usePanesStore((state) => state.workspaceMode)
  const currentProjectKey = usePanesStore((state) => state.currentProjectId)
  const paneSessions = usePanesStore((state) => state.paneSessions)
  const activePaneId = usePanesStore((state) => state.activePaneId)
  const activeTabId = usePanesStore((state) => state.paneActiveSession[state.activePaneId] ?? null)
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const sessionsLoaded = useSessionsStore((state) => state._loaded)
  const sessionIdsKey = useSessionsStore((state) => state.sessions.map((session) => session.id).join('\x1f'))

  // 1) Keep canvas layout key aligned with the current panes scope.
  useEffect(() => {
    const key = resolveCanvasLayoutKey(workspaceMode, currentProjectKey)
    useCanvasStore.getState().setActiveLayout(key)
  }, [workspaceMode, currentProjectKey])

  useEffect(() => {
    if (!sessionsLoaded) return
    cleanupOrphanedCanvasCards()
  }, [cards, sessionIdsKey, sessionsLoaded])

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
    cleanupOrphanedCanvasCards()
    const previousIds = new Set(useSessionsStore.getState().sessions.map((s) => s.id))
    const unsubscribe = useSessionsStore.subscribe((state) => {
      const currentIds = new Set(state.sessions.map((s) => s.id))
      for (const id of previousIds) {
        if (!currentIds.has(id)) useCanvasStore.getState().detachSessionEverywhere(id)
      }
      cleanupOrphanedCanvasCards()
      previousIds.clear()
      for (const id of currentIds) previousIds.add(id)
    })
    return unsubscribe
  }, [])

  useCanvasViewport(viewportEl)
  useMarqueeSelect(viewportEl)
  useCanvasKeyboard(viewportEl)

  useEffect(() => {
    if (!viewportEl) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      if (event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        openSearch(null)
        return
      }
      const active = document.activeElement
      if (
        active
        && (
          active.tagName === 'INPUT'
          || active.tagName === 'TEXTAREA'
          || (active as HTMLElement).isContentEditable
          || active.closest('.xterm')
        )
      ) {
        return
      }
      event.preventDefault()
      openSearch(null)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [openSearch, viewportEl])

  const gridEnabled = useUIStore((state) => state.settings.canvasGridEnabled)
  const showMinimap = useUIStore((state) => state.settings.canvasShowMinimap)
  const layoutLocked = useUIStore((state) => state.settings.canvasLayoutLocked)
  const maximizedCardId = useCanvasStore((state) => state.maximizedCardId)
  const clearSelection = useCanvasStore((state) => state.clearSelection)

  // ── Context menu state ───────────────────────────────────────────
  const [menu, setMenu] = useState<CanvasContextMenuState | null>(null)
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null)
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
    const selectionBoundsEl = target.closest<HTMLElement>('[data-canvas-selection-bounds]')
    event.preventDefault()
    if (!viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const viewport = useCanvasStore.getState().getViewport()
    const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewport)

    if (selectionBoundsEl) {
      const [cardId] = useCanvasStore.getState().selectedCardIds
      if (cardId) {
        setMenu({ screenX: event.clientX, screenY: event.clientY, target: 'card', cardId })
      }
    } else if (cardEl) {
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
    <div className={cn('relative isolate h-full w-full overflow-hidden bg-[var(--color-bg-primary)]', layoutLocked && 'canvas-layout-locked')}>
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
        <CanvasRelations />
        <CanvasProjectedCardLayer cards={cards} viewportEl={viewportEl} />
        <CanvasGuideLines />
        <CanvasMarquee />
        <CanvasSelectionBounds />
      </div>

      <CanvasSessionList />
      <CanvasToolbar viewportRef={viewportRef} onOpenSearch={() => openSearch(null)} />
      <CanvasSearch open={searchOpen} scopeFrameId={searchScopeFrameId} onClose={closeSearch} />
      <CanvasMaximizedSwitcher />
      {showMinimap && !maximizedCardId && <CanvasMinimap viewportRef={viewportRef} />}

      {cards.length === 0 && <CanvasEmptyState viewportRef={viewportRef} />}

      {menu && (
        <CanvasContextMenu
          state={menu}
          onClose={closeMenu}
          onRenameFrame={(cardId) => setRenamingFrameId(cardId)}
          onSearchFrame={(cardId) => openSearch(cardId)}
        />
      )}
      {renamingFrameId && (
        <CanvasFrameRenameDialog
          frameId={renamingFrameId}
          onClose={() => setRenamingFrameId(null)}
        />
      )}
    </div>
  )
}

function CanvasFrameRenameDialog({ frameId, onClose }: { frameId: string; onClose: () => void }): JSX.Element | null {
  const frame = useCanvasStore((state) => state.getCard(frameId))
  const inputRef = useRef<HTMLInputElement>(null)
  const currentName = frame?.kind === 'frame' ? frame.frameTitle?.trim() || '分组' : '分组'
  const [value, setValue] = useState(currentName)

  useEffect(() => {
    setValue(currentName)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [currentName, frameId])

  if (!frame || frame.kind !== 'frame') return null

  const commit = (): void => {
    const nextName = value.trim()
    if (nextName && nextName !== currentName) {
      useCanvasStore.getState().updateCard(frameId, { frameTitle: nextName })
    }
    onClose()
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9500] bg-black/45 backdrop-blur-[2px]"
        onPointerDown={onClose}
        onContextMenu={(event) => event.preventDefault()}
      />
      <form
        className={cn(
          'fixed left-1/2 top-1/2 z-[9501] w-[360px] -translate-x-1/2 -translate-y-1/2',
          'overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)]',
          'bg-[var(--color-bg-secondary)] p-5 shadow-2xl shadow-black/45',
          'animate-[fade-in_0.12s_ease-out]',
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-frame-rename-title"
        onSubmit={(event) => {
          event.preventDefault()
          commit()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <h3 id="canvas-frame-rename-title" className="text-[var(--ui-font-md)] font-semibold text-[var(--color-text-primary)]">
          重命名分组
        </h3>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[var(--ui-font-2xs)] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
            分组名称
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            className={cn(
              'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]',
              'bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
              'outline-none transition-colors focus:border-[var(--color-accent)]/70',
            )}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-1.5',
              'text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors',
              'hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            取消
          </button>
          <button
            type="submit"
            className={cn(
              'rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-1.5',
              'text-[var(--ui-font-sm)] font-medium text-white transition-colors',
              'hover:bg-[var(--color-accent-hover)]',
            )}
          >
            保存
          </button>
        </div>
      </form>
    </>,
    document.body,
  )
}

function CanvasProjectedCardLayer({ cards, viewportEl }: { cards: CanvasCard[]; viewportEl: HTMLDivElement | null }): JSX.Element {
  const hasMaximizedCard = useCanvasStore((state) => Boolean(state.maximizedCardId))
  return (
    <div className={cn('pointer-events-none absolute inset-0', hasMaximizedCard ? 'z-[60]' : 'z-[2]')}>
      {cards.map((card) => <CanvasCardRenderer key={card.id} card={card} viewportEl={viewportEl} />)}
    </div>
  )
}

function CanvasCardRenderer({ card, viewportEl }: { card: CanvasCard; viewportEl: HTMLDivElement | null }): JSX.Element | null {
  if (isCanvasCardHidden(card) && useCanvasStore.getState().maximizedCardId !== card.id) return null
  if (card.kind === 'frame') return <FrameCard card={card} coordinateMode="screen-transform" />
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
  const isMaximized = useCanvasStore((state) => state.maximizedCardId === card.id)

  if (isMaximized || totalCards <= 50 || !viewportEl || !viewport) return <SessionCard card={card} coordinateMode="screen" />

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
