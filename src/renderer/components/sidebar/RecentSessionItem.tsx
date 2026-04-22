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
          'group relative flex h-11 cursor-pointer items-center gap-2.5 pl-3 pr-2 mx-1.5 rounded-[var(--radius-md)]',
          'transition-colors duration-100 will-change-transform',
          isActive
            ? 'bg-[var(--color-accent-muted)]'
            : 'hover:bg-[var(--color-bg-tertiary)]/55',
        )}
        title={sourceGroupId ? '点击激活 · 右键移出分组' : '点击激活 · 拖到分组归类'}
      >
        {/* Active / color accent bar */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full transition-opacity duration-100',
            isActive || session.color ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
          )}
          style={{ backgroundColor: isActive ? 'var(--color-accent)' : accent }}
        />

        {/* Type icon */}
        <img
          src={iconSrc}
          alt=""
          className={cn(
            'h-5 w-5 shrink-0 transition-transform duration-100',
            isActive && 'scale-[1.05]',
          )}
          draggable={false}
        />

        {/* Project / session name — both readable at sm, distinguished by weight/color */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[1.2]">
          <span
            className={cn(
              'truncate text-[var(--ui-font-sm)]',
              isActive
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)]',
            )}
          >
            {projectName}
          </span>
          <span
            className={cn(
              'truncate text-[var(--ui-font-sm)] font-medium',
              isActive
                ? 'font-semibold text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]',
            )}
          >
            {session.name}
          </span>
        </div>

        {/* Optional label */}
        {session.label && (
          <span
            className="shrink-0 rounded px-1 py-px text-[8px] font-semibold leading-tight tracking-wide"
            style={{
              backgroundColor: (session.color ?? 'var(--color-text-tertiary)') + '22',
              color: session.color ?? 'var(--color-text-secondary)',
            }}
          >
            {session.label}
          </span>
        )}

        {/* Status dot + running halo */}
        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
          <span
            className={cn(
              'h-2 w-2 rounded-full transition-colors',
              running
                ? 'bg-[var(--color-success)] shadow-[0_0_6px_var(--color-success)]'
                : 'bg-[var(--color-text-tertiary)]/40',
            )}
          />
          {running && (
            <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-[var(--color-success)]/45" />
          )}
        </span>
      </div>
      {dropAfter && (
        <div className="pointer-events-none absolute -bottom-px inset-x-2 h-0.5 rounded-full bg-[var(--color-accent)] z-10" />
      )}
    </div>
  )
}
