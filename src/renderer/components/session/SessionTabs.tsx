import { PanelLeftOpen, Plus } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { Session } from '@shared/types'
import { cn } from '@/lib/utils'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { SessionTab } from './SessionTab'
import { NewSessionMenu } from './NewSessionMenu'

interface SessionTabsProps {
  sessions: Session[]
  activeSessionId: string | null
  projectId: string
}

interface DropTarget {
  id: string
  side: 'left' | 'right'
}

export function SessionTabs({ sessions, activeSessionId, projectId }: SessionTabsProps): JSX.Element {
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const reorderSessions = useSessionsStore((s) => s.reorderSessions)
  const sidebarCollapsed = useUIStore((s) => s.dockPanelCollapsed.left)
  const toggleSidebar = useUIStore((s) => s.toggleDockPanel)

  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((id: string, e: React.DragEvent) => {
    if (!draggingId || draggingId === id) {
      setDropTarget(null)
      return
    }
    // Determine left/right half of the tab element
    const rect = e.currentTarget.getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const side = e.clientX < midX ? 'left' : 'right'
    setDropTarget({ id, side })
  }, [draggingId])

  const handleDragLeave = useCallback(() => {
    setDropTarget(null)
  }, [])

  const handleDrop = useCallback((targetId: string) => {
    if (!draggingId || draggingId === targetId) return

    const fromIdx = sessions.findIndex((s) => s.id === draggingId)
    const toIdx = sessions.findIndex((s) => s.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return

    // Calculate actual insert position based on drop side
    let insertIdx = toIdx
    if (dropTarget?.side === 'right') {
      insertIdx = toIdx + (fromIdx < toIdx ? 0 : 1)
    } else {
      insertIdx = toIdx + (fromIdx < toIdx ? -1 : 0)
    }

    if (fromIdx !== insertIdx) {
      reorderSessions(draggingId, sessions[insertIdx]?.id ?? targetId)
    }

    setDraggingId(null)
    setDropTarget(null)
  }, [draggingId, dropTarget, sessions, reorderSessions])

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    setDropTarget(null)
  }, [])

  const handlePlusClick = (): void => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left })
    }
    setShowNewMenu(!showNewMenu)
  }

  return (
    <div
      className="tab-bar relative flex shrink-0 items-end bg-[var(--color-bg-secondary)]"
      style={{ height: 39 }}
      onWheel={(e) => {
        if (sessions.length === 0) return
        const store = useSessionsStore.getState()
        const activeIdx = sessions.findIndex((s) => s.id === store.activeSessionId)
        const dir = e.deltaY > 0 ? 1 : -1
        const next = (activeIdx + dir + sessions.length) % sessions.length
        store.setActive(sessions[next].id)
      }}
      onDoubleClick={(e) => {
        // Double-click on empty area → create default session type
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.tab-bar') === e.currentTarget) {
          const defaultType = useUIStore.getState().settings.defaultSessionType
          const addSession = useSessionsStore.getState().addSession
          const setActiveSession = useSessionsStore.getState().setActive
          const worktreeId = getDefaultWorktreeIdForProject(projectId)
          const id = addSession(projectId, defaultType, worktreeId)
          setActiveSession(id)
        }
      }}
    >
      <div className="flex items-end gap-0 overflow-x-auto px-1 scrollbar-none" style={{ position: 'relative', zIndex: 1 }}>
        {/* Expand sidebar button (shown when collapsed) */}
        {sidebarCollapsed && (
          <button
            onClick={() => toggleSidebar('left')}
            className={cn(
              'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] mr-1',
              'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              'transition-colors duration-100',
            )}
            title="展开侧栏"
          >
            <PanelLeftOpen size={14} />
          </button>
        )}
        {sessions.map((session, index) => (
          <SessionTab
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            isDragging={draggingId === session.id}
            showDivider={index < sessions.length - 1}
            dropSide={dropTarget?.id === session.id ? dropTarget.side : null}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        ))}

        <button
          ref={btnRef}
          onClick={handlePlusClick}
          className={cn(
            'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ml-2 mr-1',
            'text-[var(--color-text-tertiary)] border border-[var(--color-border)]',
            'hover:bg-[var(--color-accent)]/15 hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]',
            'transition-all duration-150',
          )}
          title="新建会话"
        >
          <Plus size={14} strokeWidth={2.5} />
        </button>
      </div>

      {showNewMenu && (
        <NewSessionMenu
          projectId={projectId}
          onClose={() => setShowNewMenu(false)}
          position={menuPos}
        />
      )}
    </div>
  )
}
