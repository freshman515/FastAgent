import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTerminalSessionType, type CanvasCard, type NoteImage, type SessionType } from '@shared/types'
import { createSessionWithPrompt } from '@/lib/createSession'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { getDefaultCanvasCardSize, isCanvasCardHidden, useCanvasStore, resolveCanvasLayoutKey } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useEditorsStore } from '@/stores/editors'
import { useUIStore } from '@/stores/ui'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { cn } from '@/lib/utils'
import { createConnectedNoteTabForSession } from '@/lib/connectedNoteTabs'
import { focusCanvasSessionTarget } from '@/lib/focusSessionTarget'
import { createNoteSyncId } from '@/lib/noteSync'
import { CanvasGrid } from './CanvasGrid'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasContextMenu, type CanvasContextMenuState, type CanvasFrameCreateRequest } from './CanvasContextMenu'
import { CanvasMarquee } from './CanvasMarquee'
import { CanvasGuideLines } from './CanvasGuideLines'
import { CanvasMinimap } from './CanvasMinimap'
import { CanvasRelations } from './CanvasRelations'
import { CanvasSearch } from './CanvasSearch'
import { CanvasSpaceSwitcher } from './CanvasSpaceSwitcher'
import { CanvasSelectionBounds } from './CanvasSelectionBounds'
import { CanvasMaximizedSwitcher } from './CanvasMaximizedSwitcher'
import { useCanvasCommandMode } from './CanvasCommandMode'
import { buildNewSessionOptions, type NewSessionOption } from '@/components/session/NewSessionMenu'
import { SessionIconView } from '@/components/session/SessionIconView'
import { FrameCard } from './cards/FrameCard'
import { NoteCard } from './cards/NoteCard'
import { SessionCard } from './cards/SessionCard'
import { EditorCard } from './cards/EditorCard'
import { DirectoryCard } from './cards/DirectoryCard'
import { useCanvasViewport, screenToWorld } from './hooks/useCanvasViewport'
import { useMarqueeSelect } from './hooks/useMarqueeSelect'
import { useCanvasKeyboard } from './hooks/useCanvasKeyboard'
import { addCanvasCardToSpace } from './canvasSpaceMembership'
import { getSmartNewCardPlacement } from './canvasSmartPlacement'
import { createConnectedNoteForCard } from './canvasConnectedNote'

function sameNoteImages(a: NoteImage[] | undefined, b: NoteImage[] | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  return left.every((image, index) => (
    image.id === right[index].id
    && image.dataUrl === right[index].dataUrl
    && image.displayIndex === right[index].displayIndex
  ))
}

/**
 * Top-level canvas view. Rendered by `MainPanel` when
 * `AppSettings.workspaceLayout === 'canvas'`. Coexists with the BSP panes
 * tree — switching modes doesn't destroy either side's state.
 */
function cleanupOrphanedCanvasCards(): void {
  const sessionState = useSessionsStore.getState()
  const validSessionIds = new Set(sessionState.sessions.map((session) => session.id))
  const validEditorIds = new Set(useEditorsStore.getState().tabs.map((tab) => tab.id))
  const canvas = useCanvasStore.getState()
  const staleRefIds = new Set<string>()

  for (const layout of Object.values(canvas.layouts)) {
    for (const card of layout.cards) {
      if (
        sessionState._loaded
        && (card.kind === 'session' || card.kind === 'terminal')
        && card.refId
        && !validSessionIds.has(card.refId)
      ) {
        staleRefIds.add(card.refId)
      }
      if (
        card.kind === 'editor'
        && card.refId
        && !validEditorIds.has(card.refId)
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
  const activeSpaceId = useCanvasUiStore((state) => state.activeSpaceId)
  const setActiveSpaceId = useCanvasUiStore((state) => state.setActiveSpaceId)
  const pendingSessionFocusId = useCanvasUiStore((state) => state.pendingSessionFocusId)
  const sessionsLoaded = useSessionsStore((state) => state._loaded)
  const sessionIdsKey = useSessionsStore((state) => state.sessions.map((session) => session.id).join('\x1f'))
  const classicNoteSyncKey = useSessionsStore((state) =>
    state.sessions
      .filter((session) => session.type === 'note')
      .map((session) => `${session.id}\x1f${session.connectedSessionId ?? ''}\x1f${session.noteSyncId ?? ''}\x1f${session.noteBody ?? ''}\x1f${session.noteImages?.map((image) => `${image.id}:${image.displayIndex ?? ''}:${image.dataUrl.length}`).join(',') ?? ''}`)
      .join('\x1e'),
  )
  const editorIdsKey = useEditorsStore((state) => state.tabs.map((tab) => tab.id).join('\x1f'))
  const visibleCards = useMemo(() => {
    if (!activeSpaceId) return cards
    const activeSpace = cards.find((card) => card.id === activeSpaceId && card.kind === 'frame')
    if (!activeSpace) return cards
    const visibleIds = new Set([activeSpace.id, ...(activeSpace.frameMemberIds ?? [])])
    return cards.filter((card) => visibleIds.has(card.id))
  }, [activeSpaceId, cards])

  // 1) Keep canvas layout key aligned with the current panes scope.
  useEffect(() => {
    const key = resolveCanvasLayoutKey(workspaceMode, currentProjectKey)
    useCanvasStore.getState().setActiveLayout(key)
  }, [workspaceMode, currentProjectKey])

  useEffect(() => {
    if (!pendingSessionFocusId) return

    const run = (): void => {
      if (focusCanvasSessionTarget(pendingSessionFocusId)) {
        useCanvasUiStore.getState().clearPendingSessionFocus(pendingSessionFocusId)
      }
    }

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(run)
    })
    return () => cancelAnimationFrame(frame)
  }, [cards, currentProjectKey, pendingSessionFocusId, workspaceMode])

  useEffect(() => {
    if (!sessionsLoaded) return
    cleanupOrphanedCanvasCards()
  }, [cards, editorIdsKey, sessionIdsKey, sessionsLoaded])

  // 2) Ongoing sync — whenever the panes tree gains a session or editor tab
  //    that doesn't yet have a canvas card (either because the user just
  //    opened one from the sidebar, or because the layout was empty when they
  //    switched to canvas mode), auto-attach a card for it. Existing cards are never
  //    touched, so this is idempotent across re-runs.
  //
  //    When the user opens a single tab (the common sidebar-click path),
  //    we also focus the freshly created card — matches the muscle memory
  //    of "clicking a session makes it the thing you're looking at".
  const isInitialSyncRef = useRef(true)
  const canvasSelectionSyncRef = useRef(false)
  useEffect(() => {
    const canvas = useCanvasStore.getState()
    const tabIdsInPanes = Object.values(paneSessions).flat()
    const sessionsStore = useSessionsStore.getState()
    const skipActiveTabFocus = canvasSelectionSyncRef.current
    canvasSelectionSyncRef.current = false
    const activeTabIsCanvasAttachable = Boolean(
      activeTabId
      && (
        activeTabId.startsWith('editor-')
        || sessionsStore.sessions.find((session) => session.id === activeTabId)?.type !== 'note'
      ),
    )
    const shouldFocusActiveTab = Boolean(activeTabId && activeTabIsCanvasAttachable && tabIdsInPanes.includes(activeTabId) && !skipActiveTabFocus)
    if (tabIdsInPanes.length === 0) {
      isInitialSyncRef.current = false
      return
    }
    const existingRefs = new Set(canvas.getCards().map((c) => c.refId).filter(Boolean) as string[])
    const newIds = tabIdsInPanes.filter((id) => {
      if (existingRefs.has(id)) return false
      if (id.startsWith('editor-')) return true
      return sessionsStore.sessions.find((session) => session.id === id)?.type !== 'note'
    })
    if (newIds.length === 0) {
      if (shouldFocusActiveTab && activeTabId) {
        requestAnimationFrame(() => focusCanvasCardForRef(activeTabId))
      }
      isInitialSyncRef.current = false
      return
    }
    const created = canvas.autoPopulateFromSessions(newIds, (id) => {
      if (id.startsWith('editor-')) return 'editor'
      const session = sessionsStore.sessions.find((s) => s.id === id)
      return session && isTerminalSessionType(session.type) ? 'terminal' : 'session'
    })

    if (shouldFocusActiveTab && activeTabId) {
      requestAnimationFrame(() => focusCanvasCardForRef(activeTabId))
      isInitialSyncRef.current = false
      return
    }

    // Skip focus on the very first sync after mount — the user just switched
    // to canvas mode and bulk-importing N cards shouldn't hijack the view.
    // Also skip for multi-add (e.g. detached window reattach).
    if (!isInitialSyncRef.current && created.length === 1) {
      // Defer one frame so the card's DOM element exists and getBoundingClientRect
      // on the viewport is stable.
      requestAnimationFrame(() => canvas.focusOnCard(created[0], { allowReturn: false }))
    }
    isInitialSyncRef.current = false
  }, [activeTabId, paneSessions])

  // Keep connected note cards and classic note tabs paired by a shared sync id.
  // This also backfills notes created before sync existed.
  useEffect(() => {
    if (!sessionsLoaded) return

    const canvas = useCanvasStore.getState()
    const layout = canvas.getLayout()
    const sessionsStore = useSessionsStore.getState()
    const sessionById = new Map(sessionsStore.sessions.map((session) => [session.id, session]))
    const cardById = new Map(layout.cards.map((card) => [card.id, card]))

    for (const noteCard of layout.cards) {
      if (noteCard.kind !== 'note') continue
      const relation = layout.relations.find((item) => item.fromCardId === noteCard.id || item.toCardId === noteCard.id)
      if (!relation) continue
      const targetCardId = relation.fromCardId === noteCard.id ? relation.toCardId : relation.fromCardId
      const targetCard = cardById.get(targetCardId)
      if (!targetCard || (targetCard.kind !== 'session' && targetCard.kind !== 'terminal') || !targetCard.refId) continue
      const targetSession = sessionById.get(targetCard.refId)
      if (!targetSession) continue

      const noteSyncId = noteCard.noteSyncId ?? createNoteSyncId()
      if (!noteCard.noteSyncId) {
        canvas.updateCard(noteCard.id, { noteSyncId })
      }
      if (!sessionsStore.sessions.some((session) => session.type === 'note' && session.noteSyncId === noteSyncId)) {
        createConnectedNoteTabForSession(targetSession, undefined, {
          activate: false,
          initialBody: noteCard.noteBody ?? '',
          initialImages: noteCard.noteImages ?? [],
          noteSyncId,
        })
      }
    }

    for (const noteSession of sessionsStore.sessions) {
      if (noteSession.type !== 'note' || !noteSession.connectedSessionId) continue
      const noteSyncId = noteSession.noteSyncId ?? createNoteSyncId()
      if (!noteSession.noteSyncId) {
        sessionsStore.updateSession(noteSession.id, { noteSyncId })
        continue
      }
      const existingNoteCard = layout.cards.find((card) => card.kind === 'note' && card.noteSyncId === noteSyncId)
      if (existingNoteCard) {
        if ((existingNoteCard.noteBody ?? '') !== (noteSession.noteBody ?? '') || !sameNoteImages(existingNoteCard.noteImages, noteSession.noteImages)) {
          canvas.updateCard(existingNoteCard.id, { noteBody: noteSession.noteBody ?? '', noteImages: noteSession.noteImages ?? [] })
        }
        continue
      }
      const targetCard = layout.cards.find((card) =>
        (card.kind === 'session' || card.kind === 'terminal') && card.refId === noteSession.connectedSessionId,
      )
      if (targetCard) {
        createConnectedNoteForCard(targetCard, {
          createClassicTab: false,
          focus: false,
          noteBody: noteSession.noteBody ?? '',
          noteImages: noteSession.noteImages ?? [],
          noteSyncId,
        })
      }
    }
  }, [cards, classicNoteSyncKey, sessionsLoaded])

  // 3) When a canvas card is focused/selected, keep classic tabs in sync so
  //    switching back to classic mode lands on the same tab.
  useEffect(() => {
    const selectedCardId = selectedCardIds[0]
    if (!selectedCardId) return

    const card = useCanvasStore.getState().getCard(selectedCardId)
    const panes = usePanesStore.getState()
    if (!card?.refId) return
    if (card.kind === 'editor') {
      const editorExists = useEditorsStore.getState().tabs.some((tab) => tab.id === card.refId)
      if (!editorExists) return
      const paneId = panes.findPaneForSession(card.refId)
      canvasSelectionSyncRef.current = true
      if (paneId) {
        panes.setActivePaneId(paneId)
        panes.setPaneActiveSession(paneId, card.refId)
      } else {
        panes.addSessionToPane(activePaneId, card.refId)
      }
      return
    }

    const sessionExists = useSessionsStore.getState().sessions.some((session) => session.id === card.refId)
    if (!sessionExists) return

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

  const gridEnabled = useUIStore((state) => state.settings.canvasGridEnabled)
  const showMinimap = useUIStore((state) => state.settings.canvasShowMinimap)
  const layoutLocked = useUIStore((state) => state.settings.canvasLayoutLocked)
  const maximizedCardId = useCanvasStore((state) => state.maximizedCardId)
  const clearSelection = useCanvasStore((state) => state.clearSelection)

  // ── Context menu state ───────────────────────────────────────────
  const [menu, setMenu] = useState<CanvasContextMenuState | null>(null)
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null)
  const [pendingFrameCreate, setPendingFrameCreate] = useState<CanvasFrameCreateRequest | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const getViewportCenter = useCallback((): { x: number; y: number } | null => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return null
    const { scale, offsetX, offsetY } = useCanvasStore.getState().getViewport()
    return {
      x: (rect.width / 2 - offsetX) / scale,
      y: (rect.height / 2 - offsetY) / scale,
    }
  }, [])

  const requestCreateFrame = useCallback((request?: Partial<CanvasFrameCreateRequest>) => {
    setPendingFrameCreate({
      ids: [...(request?.ids ?? useCanvasStore.getState().selectedCardIds)],
      fallback: request?.fallback ?? getViewportCenter() ?? undefined,
      collapse: request?.collapse,
    })
  }, [getViewportCenter])

  const createFrameWithTitle = useCallback((request: CanvasFrameCreateRequest, title: string) => {
    const frameId = useCanvasStore.getState().addFrameAroundCards(request.ids, request.fallback)
    if (!frameId) return
    const nextTitle = title.trim() || '空间'
    useCanvasStore.getState().updateCard(frameId, { frameTitle: nextTitle })
    useCanvasUiStore.getState().setActiveSpaceId(frameId)
    if (request.collapse) useCanvasStore.getState().toggleFrameCollapsed(frameId)
  }, [])

  const canvasCommandMode = useCanvasCommandMode({
    viewportRef,
    searchOpen,
    onRenameFrame: (cardId) => setRenamingFrameId(cardId),
    onCreateFrame: () => requestCreateFrame(),
  })

  useCanvasViewport(viewportEl)
  useMarqueeSelect(viewportEl)
  useCanvasKeyboard(viewportEl, { suspended: canvasCommandMode.active })

  useEffect(() => {
    if (!activeSpaceId) return
    const activeSpaceExists = cards.some((card) => card.id === activeSpaceId && card.kind === 'frame')
    if (!activeSpaceExists) setActiveSpaceId(null)
  }, [activeSpaceId, cards, setActiveSpaceId])

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

  const onViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.button !== 0) return
    clearSelection()
    closeMenu()
  }

  const onViewportDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    const container = document.querySelector('[data-canvas-viewport]') as HTMLDivElement | null
    const rect = container?.getBoundingClientRect()
    if (rect) useCanvasStore.getState().fitAll(rect.width, rect.height)
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
        aria-label={`Canvas workspace, ${visibleCards.length} cards`}
        onPointerDown={onViewportPointerDown}
        onDoubleClick={onViewportDoubleClick}
        onContextMenu={onContextMenu}
      >
        <div data-canvas-pan-layer className="pointer-events-none absolute inset-0">
          {gridEnabled && <CanvasGrid />}
          <CanvasRelations cards={visibleCards} />
          <CanvasProjectedCardLayer cards={visibleCards} viewportEl={viewportEl} />
          <CanvasGuideLines />
          <CanvasMarquee />
          <CanvasSelectionBounds />
        </div>
      </div>

      <div className="canvas-top-controls">
        <CanvasSpaceSwitcher />
      </div>
      <CanvasToolbar
        viewportRef={viewportRef}
        onOpenSearch={() => openSearch(null)}
        onOpenCommandMode={canvasCommandMode.enter}
        onCreateFrame={() => requestCreateFrame()}
      />
      <CanvasSearch open={searchOpen} scopeFrameId={searchScopeFrameId} onClose={closeSearch} />
      <CanvasMaximizedSwitcher />
      {showMinimap && !maximizedCardId && <CanvasMinimap viewportRef={viewportRef} />}
      {canvasCommandMode.layer}

      {cards.length === 0 && <CanvasEmptyState viewportRef={viewportRef} />}

      {menu && (
        <CanvasContextMenu
          state={menu}
          onClose={closeMenu}
          onRenameFrame={(cardId) => setRenamingFrameId(cardId)}
          onSearchFrame={(cardId) => openSearch(cardId)}
          onCreateFrame={requestCreateFrame}
        />
      )}
      {pendingFrameCreate && (
        <CanvasFrameCreateDialog
          request={pendingFrameCreate}
          onClose={() => setPendingFrameCreate(null)}
          onCreate={(title) => {
            createFrameWithTitle(pendingFrameCreate, title)
            setPendingFrameCreate(null)
          }}
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

function CanvasFrameCreateDialog({
  request,
  onClose,
  onCreate,
}: {
  request: CanvasFrameCreateRequest
  onClose: () => void
  onCreate: (title: string) => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const selectedCount = request.ids.length

  useEffect(() => {
    setValue('')
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [request])

  const commit = (): void => {
    onCreate(value)
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
          'fixed left-1/2 top-1/2 z-[9501] w-[380px] -translate-x-1/2 -translate-y-1/2',
          'overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)]',
          'bg-[var(--color-bg-secondary)] p-5 shadow-2xl shadow-black/45',
          'animate-[fade-in_0.12s_ease-out]',
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-frame-create-title"
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
        <h3 id="canvas-frame-create-title" className="text-[var(--ui-font-md)] font-semibold text-[var(--color-text-primary)]">
          新建空间
        </h3>
        <p className="mt-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
          {selectedCount > 0 ? `将 ${selectedCount} 张选中卡片放入空间。` : '创建一个空空间。'}
        </p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[var(--ui-font-2xs)] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
            空间名称
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            placeholder="空间"
            className={cn(
              'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]',
              'bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
              'outline-none transition-colors placeholder:text-[var(--color-text-tertiary)]',
              'focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20',
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
            创建
          </button>
        </div>
      </form>
    </>,
    document.body,
  )
}

function CanvasFrameRenameDialog({ frameId, onClose }: { frameId: string; onClose: () => void }): JSX.Element | null {
  const frame = useCanvasStore((state) => state.getCard(frameId))
  const inputRef = useRef<HTMLInputElement>(null)
  const currentName = frame?.kind === 'frame' ? frame.frameTitle?.trim() || '空间' : '空间'
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
          重命名空间
        </h3>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[var(--ui-font-2xs)] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
            空间名称
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            className={cn(
              'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]',
              'bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
              'outline-none transition-colors',
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
  if (card.kind === 'note') return <NoteCard card={card} coordinateMode="screen-transform" />
  if (card.kind === 'directory') return <DirectoryCard card={card} coordinateMode="screen-transform" />
  if (card.kind === 'editor') return <EditorCard card={card} coordinateMode="screen-transform" />
  if (card.kind === 'session' || card.kind === 'terminal') {
    return <CulledSessionCard card={card} viewportEl={viewportEl} />
  }
  return null
}

function focusCanvasCardForRef(refId: string): void {
  const canvas = useCanvasStore.getState()
  const card = canvas.getCards().find((candidate) => candidate.refId === refId)
  if (!card) return
  canvas.focusOnCard(card.id, { allowReturn: false })
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

function createSessionAtViewportCenter(viewportRef: React.RefObject<HTMLDivElement | null>, option: NewSessionOption): void {
  const projectId = useProjectsStore.getState().selectedProjectId
  if (!projectId) {
    useUIStore.getState().addToast({
      title: '未选择项目',
      body: '先选择一个项目，再从画布创建会话。',
      type: 'warning',
      duration: 2200,
    })
    return
  }

  const worktreeId = getDefaultWorktreeIdForProject(projectId)
  const cardKind = (option.type && isTerminalSessionType(option.type)) || option.customSessionDefinitionId ? 'terminal' : 'session'
  const cardSize = getDefaultCanvasCardSize(cardKind)

  createSessionWithPrompt({
    projectId,
    type: option.type as SessionType | undefined,
    customSessionDefinitionId: option.customSessionDefinitionId,
    worktreeId,
  }, (sessionId) => {
    const paneStore = usePanesStore.getState()
    paneStore.addSessionToPane(paneStore.activePaneId, sessionId)
    useSessionsStore.getState().setActive(sessionId)

    const placement = getSmartNewCardPlacement(viewportRef, cardSize)
    if (!placement) return
    const cardId = useCanvasStore.getState().attachSession(sessionId, cardKind, {
      x: placement.position.x,
      y: placement.position.y,
    }, placement.placeOptions)
    addCanvasCardToSpace(cardId, placement.activeSpaceId)
    requestAnimationFrame(() => useCanvasStore.getState().focusOnCard(cardId, { allowReturn: false }))
  })
}

function CanvasEmptyState({ viewportRef }: { viewportRef: React.RefObject<HTMLDivElement | null> }): JSX.Element {
  const [newSessionOpen, setNewSessionOpen] = useState(false)

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
          onClick={() => setNewSessionOpen(true)}
          className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-1.5 text-[var(--ui-font-sm)] text-white transition-opacity hover:opacity-90"
        >
          新建会话
        </button>
      </div>
      {newSessionOpen && (
        <CanvasNewSessionDialog
          viewportRef={viewportRef}
          onClose={() => setNewSessionOpen(false)}
        />
      )}
    </div>
  )
}

function CanvasNewSessionDialog({
  viewportRef,
  onClose,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
}): JSX.Element {
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const customSessionDefinitions = useUIStore((state) => state.settings.customSessionDefinitions)
  const hiddenNewSessionOptionIds = useUIStore((state) => state.settings.hiddenNewSessionOptionIds)
  const newSessionOptionOrder = useUIStore((state) => state.settings.newSessionOptionOrder)
  const options = buildNewSessionOptions(customSessionDefinitions, hiddenNewSessionOptionIds, newSessionOptionOrder)

  const selectOption = (option: NewSessionOption): void => {
    createSessionAtViewportCenter(viewportRef, option)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9500] flex items-start justify-center bg-black/30 px-4 pt-20 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">新建会话</div>
          <div className="text-[10px] text-[var(--color-text-tertiary)]">Esc 关闭</div>
        </div>
        <div
          className="max-h-[420px] overflow-y-auto p-1.5"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        >
          {!selectedProjectId ? (
            <div className="px-3 py-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              请先选择一个项目
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              没有可用的会话类型
            </div>
          ) : options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => selectOption(option)}
              className={cn(
                'flex h-10 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left transition-colors',
                'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              <SessionIconView
                icon={option.customSessionDefinitionId ? option.icon : undefined}
                fallbackSrc={option.customSessionDefinitionId ? undefined : option.icon}
                className="h-5 w-5 shrink-0"
                imageClassName="h-4 w-4 object-contain"
              />
              <span className="min-w-0 flex-1 truncate text-[var(--ui-font-sm)] font-medium">
                {option.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
