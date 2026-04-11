import { GitBranch, Minus, Plus, Square, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { usePanesStore, registerPaneElement, type PaneNode, type SplitPosition } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { SessionTab } from '@/components/session/SessionTab'
import { NewSessionMenu } from '@/components/session/NewSessionMenu'
import { TerminalView } from '@/components/session/TerminalView'
import { EmptyState } from '@/components/session/EmptyState'

interface PaneViewProps {
  paneId: string
  projectId: string
}

interface WindowDragState {
  startMouseX: number
  startMouseY: number
  startWindowX: number
  startWindowY: number
  pendingX: number
  pendingY: number
  frameId: number | null
  handleMouseMove: (event: MouseEvent) => void
  handleMouseUp: () => void
}

const isDetached = window.api.detach.isDetached

function isTabDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('session-tab-id') || e.dataTransfer.types.includes('session-tab-drag-token')
}

function getTopRightLeafId(node: PaneNode): string {
  if (node.type === 'leaf') return node.id
  return node.direction === 'horizontal'
    ? getTopRightLeafId(node.second)
    : getTopRightLeafId(node.first)
}

export function PaneView({ paneId, projectId }: PaneViewProps): JSX.Element {
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const setActivePaneId = usePanesStore((s) => s.setActivePaneId)
  const root = usePanesStore((s) => s.root)
  const paneSessions = usePanesStore((s) => s.paneSessions[paneId] ?? [])
  const paneActiveSessionId = usePanesStore((s) => s.paneActiveSession[paneId] ?? null)
  const allSessions = useSessionsStore((s) => s.sessions)

  const isActivePane = activePaneId === paneId
  const rootType = usePanesStore((s) => s.root.type)
  const isMultiPane = rootType === 'split'

  // Get full session objects for this pane, in pane order
  const sessions = useMemo(() => {
    return paneSessions
      .map((id) => allSessions.find((s) => s.id === id))
      .filter(Boolean) as typeof allSessions
  }, [paneSessions, allSessions])

  // Pinned first
  const sortedSessions = useMemo(() => {
    return [...sessions.filter((s) => s.pinned), ...sessions.filter((s) => !s.pinned)]
  }, [sessions])
  const showDetachedWindowControls = isDetached && paneId === getTopRightLeafId(root)

  const [showNewMenu, setShowNewMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [dropHighlight, setDropHighlight] = useState(false)
  const [edgeDrop, setEdgeDrop] = useState<SplitPosition | 'center' | null>(null)
  const termAreaRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const windowDragRef = useRef<WindowDragState | null>(null)
  const currentWindowId = isDetached ? window.api.detach.getWindowId() : 'main'

  const handlePlusClick = (): void => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left })
    }
    setShowNewMenu(!showNewMenu)
  }

  const paneRootRef = useRef<HTMLDivElement>(null)

  const handleFocus = useCallback(() => {
    if (!isActivePane) setActivePaneId(paneId)
  }, [isActivePane, paneId, setActivePaneId])

  const stopWindowDrag = useCallback(() => {
    const drag = windowDragRef.current
    if (!drag) return
    if (drag.frameId !== null) {
      cancelAnimationFrame(drag.frameId)
    }
    window.removeEventListener('mousemove', drag.handleMouseMove)
    window.removeEventListener('mouseup', drag.handleMouseUp)
    document.body.style.cursor = ''
    windowDragRef.current = null
  }, [])

  const handleWindowDragMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isDetached || e.button !== 0) return

    e.preventDefault()
    e.stopPropagation()
    stopWindowDrag()

    const dragState: WindowDragState = {
      startMouseX: e.screenX,
      startMouseY: e.screenY,
      startWindowX: window.screenX,
      startWindowY: window.screenY,
      pendingX: window.screenX,
      pendingY: window.screenY,
      frameId: null,
      handleMouseMove: () => {},
      handleMouseUp: () => {},
    }

    dragState.handleMouseMove = (moveEvent: MouseEvent) => {
      if (moveEvent.buttons === 0) {
        stopWindowDrag()
        return
      }

      dragState.pendingX = dragState.startWindowX + (moveEvent.screenX - dragState.startMouseX)
      dragState.pendingY = dragState.startWindowY + (moveEvent.screenY - dragState.startMouseY)

      if (dragState.frameId !== null) return
      dragState.frameId = requestAnimationFrame(() => {
        dragState.frameId = null
        void window.api.detach.setPosition(dragState.pendingX, dragState.pendingY)
      })
    }

    dragState.handleMouseUp = () => {
      stopWindowDrag()
    }

    windowDragRef.current = dragState
    document.body.style.cursor = ''
    window.addEventListener('mousemove', dragState.handleMouseMove)
    window.addEventListener('mouseup', dragState.handleMouseUp)
  }, [stopWindowDrag])

  const handleWindowDragDoubleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isDetached) return
    e.preventDefault()
    e.stopPropagation()
    stopWindowDrag()
    void window.api.detach.maximize()
  }, [stopWindowDrag])

  const handleTopBarBlankMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    handleWindowDragMouseDown(e)
  }, [handleWindowDragMouseDown])

  const handleTopBarBlankDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    handleWindowDragDoubleClick(e)
  }, [handleWindowDragDoubleClick])

  const attachDraggedSession = useCallback((dragToken: string, zone?: SplitPosition | 'center' | null) => {
    const payload = window.api.detach.claimTabDrag(dragToken, currentWindowId)
    if (!payload) return false

    useSessionsStore.getState().upsertSessions([payload.session])
    const store = usePanesStore.getState()

    if (zone && zone !== 'center') {
      store.addSessionToPane(paneId, payload.session.id)
      store.splitPane(paneId, zone, payload.session.id)
    } else {
      store.addSessionToPane(paneId, payload.session.id)
    }

    store.setActivePaneId(paneId)
    store.setPaneActiveSession(paneId, payload.session.id)
    useSessionsStore.getState().setActive(payload.session.id)
    return true
  }, [currentWindowId, paneId])

  // Register pane DOM element for rect-based navigation
  useEffect(() => {
    registerPaneElement(paneId, paneRootRef.current)
    return () => registerPaneElement(paneId, null)
  }, [paneId])

  useEffect(() => {
    return () => stopWindowDrag()
  }, [stopWindowDrag])

  return (
    <div
      ref={paneRootRef}
      className={cn(
        'flex h-full flex-col',
        isActivePane && isMultiPane && 'border border-[var(--color-accent)]/40',
        !isActivePane && isMultiPane && 'border border-transparent',
      )}
      onMouseDown={handleFocus}
    >
      {/* Tab bar */}
      <div
        className={cn(
          'tab-bar relative flex shrink-0 items-end bg-[var(--color-bg-secondary)]',
          dropHighlight && 'ring-2 ring-inset ring-[var(--color-accent)]',
        )}
        style={{ height: 33 }}
        onWheel={(e) => {
          if (sortedSessions.length === 0) return
          const activeIdx = sortedSessions.findIndex((s) => s.id === paneActiveSessionId)
          const dir = e.deltaY > 0 ? 1 : -1
          const next = (activeIdx + dir + sortedSessions.length) % sortedSessions.length
          usePanesStore.getState().setPaneActiveSession(paneId, sortedSessions[next].id)
        }}
        onDoubleClick={(e) => {
          if (isDetached || e.target !== e.currentTarget) return
          const defaultType = useUIStore.getState().settings.defaultSessionType
          const worktreeId = getDefaultWorktreeIdForProject(projectId)
          const id = useSessionsStore.getState().addSession(projectId, defaultType, worktreeId)
          usePanesStore.getState().addSessionToPane(paneId, id)
        }}
        onDragOver={(e) => {
          if (isTabDrag(e)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropHighlight(true)
          }
        }}
        onDragLeave={() => setDropHighlight(false)}
        onDrop={(e) => {
          setDropHighlight(false)
          const sessionId = e.dataTransfer.getData('session-tab-id')
          const sourcePaneId = e.dataTransfer.getData('source-pane-id')
          const sourceWindowId = e.dataTransfer.getData('source-window-id') || 'main'
          const dragToken = e.dataTransfer.getData('session-tab-drag-token')
            || window.api.detach.getActiveTabDrag()
          if (dragToken && sourceWindowId !== currentWindowId) {
            attachDraggedSession(dragToken)
            return
          }
          // Cross-window fallback: getData may return empty, use IPC token
          if (!sessionId && dragToken) {
            attachDraggedSession(dragToken)
            return
          }
          if (sessionId && sourcePaneId && sourcePaneId !== paneId) {
            usePanesStore.getState().moveSession(sourcePaneId, paneId, sessionId)
          }
        }}
      >
        {/* Scrollable tabs + buttons area */}
        <div
          className="flex min-w-0 flex-1 items-end gap-0 overflow-x-auto px-1 scrollbar-none"
          style={{ position: 'relative', zIndex: 1 }}
          onMouseDown={handleTopBarBlankMouseDown}
          onDoubleClick={handleTopBarBlankDoubleClick}
        >
          {/* Project + branch badge in detached window */}
          {isDetached && (() => {
            const title = window.api.detach.getTitle()
            const [projName, branchName] = title.includes('|') ? title.split('|', 2) : [title, '']
            return (
              <span
                className="no-drag flex shrink-0 items-center gap-1.5 self-center mr-2 pl-2 pr-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text-secondary)]"
                onMouseDown={handleWindowDragMouseDown}
                onDoubleClick={handleWindowDragDoubleClick}
              >
                {projName}
                {branchName && (
                  <>
                    <GitBranch size={11} className="text-[var(--color-text-tertiary)]" />
                    <span className="font-normal text-[var(--color-text-tertiary)]">{branchName}</span>
                  </>
                )}
              </span>
            )
          })()}
          {sortedSessions.map((session) => (
            <SessionTab
              key={session.id}
              session={session}
              isActive={session.id === paneActiveSessionId}
              paneId={paneId}
              isDragging={false}
              dropSide={null}
              onDragStart={() => {}}
              onDragOver={() => {}}
              onDragLeave={() => {}}
              onDrop={() => {}}
              onDragEnd={() => {}}
            />
          ))}

          <button
            ref={btnRef}
            onClick={handlePlusClick}
            className={cn(
              'no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
              'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              'transition-colors duration-100',
            )}
            title="New Session"
          >
            <Plus size={14} />
          </button>

          {/* Close pane button — only when multiple panes exist */}
          {usePanesStore.getState().root.type === 'split' && (
            <button
              onClick={() => usePanesStore.getState().mergePane(paneId)}
              className={cn(
                'no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
                'text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/20 hover:text-[var(--color-error)]',
                'transition-colors duration-100',
              )}
              title="Close Pane (merge tabs)"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Detached window controls — pushed to far right */}
        {showDetachedWindowControls && (
          <>
            <div className="no-drag ml-auto flex shrink-0 items-center self-stretch">
              <button onClick={() => window.api.detach.minimize()} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors">
                <Minus size={14} />
              </button>
              <button onClick={() => window.api.detach.maximize()} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors">
                <Square size={11} />
              </button>
              <button onClick={() => window.api.detach.close()} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-error)] hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
          </>
        )}

        {showNewMenu && (
          <NewSessionMenu
            projectId={projectId}
            paneId={paneId}
            onClose={() => setShowNewMenu(false)}
            position={menuPos}
          />
        )}
      </div>

      {/* Terminal area */}
      <div
        ref={termAreaRef}
        className="relative flex-1 overflow-hidden bg-[var(--color-bg-primary)]"
        onDragOver={(e) => {
          if (!isTabDrag(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'

          // Detect edge zone (25% from each edge)
          const rect = termAreaRef.current?.getBoundingClientRect()
          if (!rect) return
          const x = (e.clientX - rect.left) / rect.width
          const y = (e.clientY - rect.top) / rect.height
          const edge = 0.25
          if (x < edge) setEdgeDrop('left')
          else if (x > 1 - edge) setEdgeDrop('right')
          else if (y < edge) setEdgeDrop('up')
          else if (y > 1 - edge) setEdgeDrop('down')
          else setEdgeDrop('center')
        }}
        onDragLeave={() => setEdgeDrop(null)}
        onDrop={(e) => {
          const zone = edgeDrop
          setEdgeDrop(null)
          const sessionId = e.dataTransfer.getData('session-tab-id')
          const sourcePaneId = e.dataTransfer.getData('source-pane-id')
          const sourceWindowId = e.dataTransfer.getData('source-window-id') || 'main'
          const dragToken = e.dataTransfer.getData('session-tab-drag-token')
            || window.api.detach.getActiveTabDrag()
          // Cross-window drop
          if (dragToken && (sourceWindowId !== currentWindowId || !sessionId)) {
            attachDraggedSession(dragToken, zone)
            return
          }
          if (!sessionId || !sourcePaneId) return
          const store = usePanesStore.getState()

          if (zone && zone !== 'center') {
            // Edge drop → split this pane
            if (sourcePaneId === paneId) {
              // Same pane: just split (session moves from this pane to new split)
              store.splitPane(paneId, zone, sessionId)
            } else {
              // Cross-pane: first add session to this pane, remove from source, then split
              store.addSessionToPane(paneId, sessionId)
              store.removeSessionFromPane(sourcePaneId, sessionId)
              store.splitPane(paneId, zone, sessionId)
            }
          } else if (sourcePaneId !== paneId) {
            // Center drop: merge into this pane
            store.moveSession(sourcePaneId, paneId, sessionId)
          }
        }}
      >
        {sessions.map((session) => {
          const isActive = session.id === paneActiveSessionId
          return (
            <div
              key={session.id}
              className="absolute inset-0"
              style={{
                visibility: isActive ? 'visible' : 'hidden',
                zIndex: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              <TerminalView session={session} isActive={isActive && isActivePane} />
            </div>
          )
        })}

        {sessions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState
              title="Empty pane"
              description="Create a session or drag a tab here."
            />
          </div>
        )}

        {/* Edge drop preview overlay */}
        {edgeDrop && edgeDrop !== 'center' && (
          <div
            className="absolute bg-[var(--color-accent)]/15 border-2 border-[var(--color-accent)]/40 pointer-events-none"
            style={{
              zIndex: 50,
              ...(edgeDrop === 'left' ? { left: 0, top: 0, width: '50%', height: '100%' } :
                edgeDrop === 'right' ? { right: 0, top: 0, width: '50%', height: '100%' } :
                edgeDrop === 'up' ? { left: 0, top: 0, width: '100%', height: '50%' } :
                { left: 0, bottom: 0, width: '100%', height: '50%' }),
            }}
          />
        )}
        {edgeDrop === 'center' && (
          <div
            className="absolute inset-2 rounded-[var(--radius-md)] bg-[var(--color-accent)]/10 border-2 border-dashed border-[var(--color-accent)]/30 pointer-events-none"
            style={{ zIndex: 50 }}
          />
        )}
      </div>
    </div>
  )
}
