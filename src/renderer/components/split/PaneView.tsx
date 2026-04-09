import { Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { usePanesStore, registerPaneElement, type SplitPosition } from '@/stores/panes'
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

export function PaneView({ paneId, projectId }: PaneViewProps): JSX.Element {
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const setActivePaneId = usePanesStore((s) => s.setActivePaneId)
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

  const [showNewMenu, setShowNewMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [dropHighlight, setDropHighlight] = useState(false)
  const [edgeDrop, setEdgeDrop] = useState<SplitPosition | 'center' | null>(null)
  const termAreaRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

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

  // Register pane DOM element for rect-based navigation
  useEffect(() => {
    registerPaneElement(paneId, paneRootRef.current)
    return () => registerPaneElement(paneId, null)
  }, [paneId])

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
          if (e.target === e.currentTarget) {
            const defaultType = useUIStore.getState().settings.defaultSessionType
            const id = useSessionsStore.getState().addSession(projectId, defaultType)
            usePanesStore.getState().addSessionToPane(paneId, id)
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('session-tab-id')) {
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
          if (sessionId && sourcePaneId && sourcePaneId !== paneId) {
            usePanesStore.getState().moveSession(sourcePaneId, paneId, sessionId)
          }
        }}
      >
        <div className="flex items-end gap-0 overflow-x-auto px-1 scrollbar-none" style={{ position: 'relative', zIndex: 1 }}>
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
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
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
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
                'text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/20 hover:text-[var(--color-error)]',
                'transition-colors duration-100',
              )}
              title="Close Pane (merge tabs)"
            >
              <X size={12} />
            </button>
          )}
        </div>

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
          if (!e.dataTransfer.types.includes('session-tab-id')) return
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
