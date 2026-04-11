import { GitBranch, Cpu, Layers, Circle, Clock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useGitStore } from '@/stores/git'
import { useWorktreesStore } from '@/stores/worktrees'
import { usePanesStore } from '@/stores/panes'

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h${mins > 0 ? `${mins}m` : ''}`
}

export function StatusBar(): JSX.Element {
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.selectedProjectId),
  )
  const allSessions = useSessionsStore((s) => s.sessions)
  const branchInfo = useGitStore((s) =>
    selectedProjectId ? s.branchInfo[selectedProjectId] : undefined,
  )
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const selectedWorktree = useWorktreesStore((s) =>
    s.worktrees.find((w) => w.id === s.selectedWorktreeId),
  )
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const activeSessionId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const activeSession = useSessionsStore((s) => s.sessions.find((x) => x.id === activeSessionId))

  // Project sessions
  const projectSessions = useMemo(
    () => (selectedProjectId ? allSessions.filter((s) => s.projectId === selectedProjectId) : []),
    [allSessions, selectedProjectId],
  )
  const runningSessions = useMemo(
    () => projectSessions.filter((s) => s.status === 'running'),
    [projectSessions],
  )

  // Session uptime
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const activeUptime = activeSession?.status === 'running' && activeSession.createdAt
    ? formatUptime(now - activeSession.createdAt)
    : null

  // Branch display
  const branch = selectedWorktree && !selectedWorktree.isMain
    ? selectedWorktree.branch
    : branchInfo?.current
  const isDirty = branchInfo?.isDirty ?? false

  const ITEM = 'flex items-center gap-1.5 px-2 py-0.5 text-[var(--ui-font-sm)] transition-colors duration-75'

  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-1 select-none">
      {/* Left section */}
      <div className="flex items-center gap-0 min-w-0">
        {/* Project name */}
        {selectedProject ? (
          <span className={cn(ITEM, 'font-medium text-[var(--color-text-secondary)]')}>
            {selectedProject.name}
          </span>
        ) : (
          <span className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}>No project</span>
        )}

        {/* Git branch */}
        {branch && (
          <span className={cn(
            ITEM,
            isDirty ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-tertiary)]',
          )}>
            <GitBranch size={11} />
            <span className="max-w-[120px] truncate">{branch}</span>
            {isDirty && <Circle size={6} fill="currentColor" />}
          </span>
        )}

        {/* Separator */}
        {selectedProject && (
          <div className="mx-0.5 h-3 w-px bg-[var(--color-border)]" />
        )}

        {/* Running / Total sessions */}
        <span className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}>
          <Layers size={11} />
          <span>
            {runningSessions.length > 0 && (
              <span className="text-[var(--color-success)]">{runningSessions.length} running</span>
            )}
            {runningSessions.length > 0 && projectSessions.length > runningSessions.length && ' / '}
            {(runningSessions.length === 0 || projectSessions.length > runningSessions.length) && (
              <span>{projectSessions.length} total</span>
            )}
          </span>
        </span>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-0">
        {/* Active session status */}
        {activeSession && (
          <span className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}>
            <Circle
              size={7}
              fill={activeSession.status === 'running' ? 'var(--color-success)' : 'var(--color-text-tertiary)'}
              className={cn(
                activeSession.status === 'running' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]',
                activeSession.status === 'running' && 'animate-pulse',
              )}
            />
            <span className="max-w-[140px] truncate">{activeSession.name}</span>
          </span>
        )}

        {/* Uptime */}
        {activeUptime && (
          <span className={cn(ITEM, 'text-[var(--color-text-tertiary)] tabular-nums')}>
            <Clock size={11} />
            {activeUptime}
          </span>
        )}
      </div>
    </div>
  )
}
