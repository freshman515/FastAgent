import type { Session } from '@shared/types'
import { cn } from '@/lib/utils'
import { getSessionIcon } from '@/lib/sessionIcon'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useSessionGroupsStore } from '@/stores/sessionGroups'

export const DRAG_MIME_SESSION_ID = 'recent-session-id'
export const DRAG_MIME_SESSION_SOURCE_GROUP = 'recent-session-source-group'
export const UNGROUPED_MARKER = '__ungrouped__'

interface RecentSessionItemProps {
  session: Session
  sourceGroupId: string | null
  dropBefore?: boolean
  dropAfter?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
}

function activateSession(sessionId: string): void {
  const session = useSessionsStore.getState().sessions.find((s) => s.id === sessionId)
  if (!session) return

  const panes = usePanesStore.getState()
  if (panes.workspaceMode !== 'sessions') {
    panes.setWorkspaceMode('sessions')
  }

  const refreshed = usePanesStore.getState()
  const existingPane = refreshed.findPaneForSession(sessionId)
  if (existingPane) {
    refreshed.setPaneActiveSession(existingPane, sessionId)
    refreshed.setActivePaneId(existingPane)
  } else {
    refreshed.addSessionToPane(refreshed.activePaneId, sessionId)
  }
  useSessionsStore.getState().setActive(sessionId)
}

export function RecentSessionItem({
  session, sourceGroupId, dropBefore = false, dropAfter = false,
  onDragStart, onDragEnd,
}: RecentSessionItemProps): JSX.Element {
  const projectName = useProjectsStore(
    (s) => s.projects.find((p) => p.id === session.projectId)?.name ?? '未命名项目',
  )
  const activeSessionId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const workspaceMode = usePanesStore((s) => s.workspaceMode)
  const isDark = useIsDarkTheme()
  const iconSrc = getSessionIcon(session.type, isDark)
  // Only show active highlight while the sessions workspace is actually showing.
  const isActive = workspaceMode === 'sessions' && activeSessionId === session.id
  const removeSessionFromAllGroups = useSessionGroupsStore((s) => s.removeSessionFromAllGroups)

  const sourceMarker = sourceGroupId ?? UNGROUPED_MARKER
  const running = session.status === 'running'
  const accent = session.color ?? 'var(--color-accent)'

  return (
    <div className="relative">
      {dropBefore && (
        <div className="pointer-events-none absolute -top-px inset-x-2 h-0.5 rounded-full bg-[var(--color-accent)] z-10" />
      )}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME_SESSION_ID, session.id)
          e.dataTransfer.setData(DRAG_MIME_SESSION_SOURCE_GROUP, sourceMarker)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart?.()
        }}
        onDragEnd={() => onDragEnd?.()}
        onClick={() => activateSession(session.id)}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          if (sourceGroupId) {
            removeSessionFromAllGroups(session.id)
          }
        }}
        className={cn(
          'group relative flex h-12 cursor-pointer items-center gap-2.5 px-3 mx-1 rounded-[var(--radius-sm)]',
          'transition-all duration-200 will-change-transform',
          isActive
            ? 'bg-[var(--color-accent)]/10 text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--color-accent)]/20 shadow-[inset_0_0_12px_var(--color-accent-muted)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]/40 hover:text-[var(--color-text-primary)]',
        )}
        title={sourceGroupId ? '点击激活 · 右键移出分组' : '点击激活 · 拖到分组归类'}
      >
        {/* Active / color accent bar */}
        {isActive && (
          <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent)]" />
        )}

        {/* Type icon */}
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
          <img
            src={iconSrc}
            alt=""
            className={cn(
              'h-5 w-5 shrink-0 transition-all duration-200',
              isActive ? 'scale-110' : 'group-hover:scale-110',
            )}
            draggable={false}
          />
          {running && (
            <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--color-bg-secondary)] bg-[var(--color-success)] shadow-[0_0_4px_var(--color-success)]" />
          )}
        </div>

        {/* Project / session name — both readable at sm, distinguished by weight/color */}
        <div className="flex min-w-0 flex-1 flex-col gap-0 leading-tight">
          <span
            className={cn(
              'truncate text-[10px] font-medium tracking-tight transition-colors duration-200',
              isActive
                ? 'text-[var(--color-accent)]/80'
                : 'text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)]',
            )}
          >
            {projectName}
          </span>
          <span
            className={cn(
              'truncate text-[12px] transition-colors duration-200',
              isActive
                ? 'font-bold text-[var(--color-text-primary)]'
                : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]',
            )}
          >
            {session.name}
          </span>
        </div>

        {/* Optional label */}
        {session.label && (
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold leading-tight tracking-wide shadow-sm"
            style={{
              backgroundColor: (session.color ?? 'var(--color-text-tertiary)') + '18',
              color: session.color ?? 'var(--color-text-secondary)',
              border: `1px solid ${session.color ?? 'var(--color-text-tertiary)'}22`,
            }}
          >
            {session.label}
          </span>
        )}
      </div>
      {dropAfter && (
        <div className="pointer-events-none absolute -bottom-px inset-x-2 h-0.5 rounded-full bg-[var(--color-accent)] z-10" />
      )}
    </div>
  )
}
