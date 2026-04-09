import { ArrowRightLeft, Folder, MoreHorizontal, Trash2, ExternalLink } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useMemo, useState } from 'react'
import type { Project, SessionType } from '@shared/types'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useGroupsStore } from '@/stores/groups'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import claudeIcon from '@/assets/icons/Claude.png'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIcon from '@/assets/icons/terminal_white.png'

const NEW_SESSION_OPTIONS: Array<{ type: SessionType; label: string; icon: string }> = [
  { type: 'claude-code', label: 'Claude Code', icon: claudeIcon },
  { type: 'codex', label: 'Codex', icon: opencodeIcon },
  { type: 'opencode', label: 'OpenCode', icon: opencodeIcon },
  { type: 'terminal', label: 'Terminal', icon: terminalIcon },
]

interface ProjectItemProps {
  project: Project
}

export function ProjectItem({ project }: ProjectItemProps): JSX.Element {
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectProject = useProjectsStore((s) => s.selectProject)
  const removeProject = useProjectsStore((s) => s.removeProject)
  const removeProjectFromGroup = useGroupsStore((s) => s.removeProjectFromGroup)
  const allSessions = useSessionsStore((s) => s.sessions)
  const outputStates = useSessionsStore((s) => s.outputStates)

  const sessions = useMemo(
    () => allSessions.filter((s) => s.projectId === project.id),
    [allSessions, project.id],
  )

  const [showMenu, setShowMenu] = useState<{ x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const addSession = useSessionsStore((s) => s.addSession)
  const setActive = useSessionsStore((s) => s.setActive)
  const allGroups = useGroupsStore((s) => s.groups)
  const addProjectToGroup = useGroupsStore((s) => s.addProjectToGroup)
  const removeProjectFromGroupFn = useGroupsStore((s) => s.removeProjectFromGroup)
  const moveProject = useProjectsStore((s) => s.moveProject)
  const reorderProjectInGroup = useGroupsStore((s) => s.reorderProjectInGroup)
  const moveProjectToGroupAt = useGroupsStore((s) => s.moveProjectToGroupAt)
  const [projDragOver, setProjDragOver] = useState(false)
  const otherGroups = useMemo(() => allGroups.filter((g) => g.id !== project.groupId), [allGroups, project.groupId])

  const isSelected = selectedProjectId === project.id
  const hasUnread = sessions.some((s) => outputStates[s.id] === 'unread')
  const hasOutputting = sessions.some((s) => outputStates[s.id] === 'outputting')

  const handleSelect = useCallback(() => {
    selectProject(project.id)
    // Switch active session to one belonging to this project
    const { sessions: allSess, setActive } = useSessionsStore.getState()
    const projSessions = allSess.filter((s) => s.projectId === project.id)
    if (projSessions.length > 0) {
      setActive(projSessions[0].id)
    } else {
      // No sessions for this project — clear active so empty state shows
      setActive(null)
    }
  }, [project.id, selectProject])

  const handleRemove = useCallback(() => {
    removeProjectFromGroup(project.groupId, project.id)
    removeProject(project.id)
    setShowMenu(false)
  }, [project.id, project.groupId, removeProject, removeProjectFromGroup])

  return (
    <div className="relative">
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('project-id', project.id)
          e.dataTransfer.setData('source-group', project.groupId)
          e.dataTransfer.effectAllowed = 'move'
        }}
        className={cn(
          'group flex h-7 cursor-pointer items-center gap-1.5 pl-7 pr-2',
          'transition-colors duration-75',
          isSelected
            ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
          projDragOver && 'border-t border-[var(--color-accent)]',
        )}
        onClick={handleSelect}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('project-id')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setProjDragOver(true)
          }
        }}
        onDragLeave={() => setProjDragOver(false)}
        onDrop={(e) => {
          e.stopPropagation()
          setProjDragOver(false)
          const draggedProjId = e.dataTransfer.getData('project-id')
          const sourceGroup = e.dataTransfer.getData('source-group')
          if (!draggedProjId || draggedProjId === project.id) return
          if (sourceGroup === project.groupId) {
            // Same group: reorder
            reorderProjectInGroup(project.groupId, draggedProjId, project.id)
          } else {
            // Cross group: move and insert at this position
            moveProjectToGroupAt(draggedProjId, sourceGroup, project.groupId, project.id)
            moveProject(draggedProjId, project.groupId)
          }
        }}
      >
        <Folder size={13} className="shrink-0" />
        <span className="flex-1 truncate text-[var(--ui-font-sm)]">{project.name}</span>

        {/* Status indicators */}
        {hasOutputting && (
          <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />
        )}
        {hasUnread && !hasOutputting && (
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />
        )}

        {/* Menu */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            setShowMenu(showMenu ? null : { x: rect.right, y: rect.bottom + 4 })
          }}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)]',
            'text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100',
            'hover:bg-[var(--color-bg-surface)] transition-all duration-75',
          )}
        >
          <MoreHorizontal size={12} />
        </button>
      </div>

      {showMenu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setShowMenu(null)} />
          <div
            style={{ top: showMenu.y, left: showMenu.x, zIndex: 9999 }}
            className={cn(
              'fixed min-w-[160px] rounded-[var(--radius-md)] py-1',
              'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
              'shadow-lg shadow-black/30',
            )}
          >
            <div className="border-b border-[var(--color-border)] px-3 py-1.5">
              <p className="truncate text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{project.path}</p>
            </div>
            <button
              onClick={() => { setShowMenu(null); window.api.shell.openPath(project.path) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              <ExternalLink size={12} /> Open in Explorer
            </button>
            <button
              onClick={() => { setShowMenu(null); handleRemove() }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* Right-click context menu: new session */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className={cn(
              'fixed z-50 w-44 rounded-[var(--radius-md)] py-1',
              'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
              'shadow-lg shadow-black/30',
            )}
          >
            <div className="px-3 py-1 border-b border-[var(--color-border)]">
              <p className="text-[var(--ui-font-2xs)] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                New Session
              </p>
            </div>
            {NEW_SESSION_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                onClick={() => {
                  selectProject(project.id)
                  const id = addSession(project.id, opt.type)
                  usePanesStore.getState().addSessionToPane(usePanesStore.getState().activePaneId, id)
                  setActive(id)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
              >
                <img src={opt.icon} alt="" className="h-3.5 w-3.5" />
                {opt.label}
              </button>
            ))}
            {otherGroups.length > 0 && (
              <>
                <div className="px-3 py-1 border-t border-[var(--color-border)]">
                  <div className="flex items-center gap-1.5">
                    <ArrowRightLeft size={10} className="text-[var(--color-text-tertiary)]" />
                    <span className="text-[var(--ui-font-2xs)] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                      Move to
                    </span>
                  </div>
                </div>
                {otherGroups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      removeProjectFromGroupFn(project.groupId, project.id)
                      addProjectToGroup(g.id, project.id)
                      moveProject(project.id, g.id)
                      setContextMenu(null)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                  >
                    <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                    {g.name}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
