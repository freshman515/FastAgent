import { useEffect } from 'react'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useWorktreesStore } from '@/stores/worktrees'
import { SplitContainer } from '@/components/split/SplitContainer'
import { EmptyState } from '@/components/session/EmptyState'

export function MainPanel(): JSX.Element {
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const worktreesLoaded = useWorktreesStore((s) => s._loaded)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const sessions = useSessionsStore((s) => s.sessions)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const currentLayoutKey = usePanesStore((s) => s.currentProjectId)

  // Keep panes in sync with the selected project/worktree without overwriting
  // an explicit switch that already restored the correct layout.
  useEffect(() => {
    if (!selectedProjectId) return
    if (!worktreesLoaded) return

    const projectWorktrees = worktrees.filter((w) => w.projectId === selectedProjectId)
    const mainWorktree = projectWorktrees.find((w) => w.isMain)
    const layoutWorktree = currentLayoutKey
      ? projectWorktrees.find((w) => w.id === currentLayoutKey)
      : undefined
    const selectedWorktree = selectedWorktreeId
      ? projectWorktrees.find((w) => w.id === selectedWorktreeId)
      : (layoutWorktree ?? mainWorktree)

    if (selectedWorktree) {
      const worktreeSessionIds = sessions
        .filter((s) =>
          s.projectId === selectedProjectId
          && (s.worktreeId === selectedWorktree.id || (!s.worktreeId && selectedWorktree.isMain)),
        )
        .map((s) => s.id)
      const nextActiveSessionId = activeSessionId && worktreeSessionIds.includes(activeSessionId)
        ? activeSessionId
        : (worktreeSessionIds[0] ?? null)

      if (currentLayoutKey !== selectedWorktree.id) {
        usePanesStore.getState().switchWorktree(
          selectedWorktree.id,
          worktreeSessionIds,
          nextActiveSessionId,
        )
      }
      return
    }

    const projectSessionIds = sessions
      .filter((s) => s.projectId === selectedProjectId)
      .map((s) => s.id)
    const nextActiveSessionId = activeSessionId && projectSessionIds.includes(activeSessionId)
      ? activeSessionId
      : (projectSessionIds[0] ?? null)

    if (currentLayoutKey !== selectedProjectId) {
      usePanesStore.getState().switchProject(
        selectedProjectId,
        projectSessionIds,
        nextActiveSessionId,
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on project/worktree switch, not on session changes
  }, [selectedProjectId, selectedWorktreeId, currentLayoutKey, worktreesLoaded, worktrees])

  // Dynamic window title
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  useEffect(() => {
    document.title = activeSession ? `${activeSession.name} — FastAgents` : 'FastAgents'
  }, [activeSession?.name, activeSession?.id])

  if (!selectedProjectId) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <EmptyState
          title="Select a project"
          description="Choose a project from the sidebar to manage its agent sessions."
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-primary)]">
      <SplitContainer projectId={selectedProjectId} />
    </div>
  )
}
