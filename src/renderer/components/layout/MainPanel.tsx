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
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const sessions = useSessionsStore((s) => s.sessions)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const currentLayoutKey = usePanesStore((s) => s.currentProjectId)

  // Keep panes in sync with the selected project/worktree without overwriting
  // an explicit switch that already restored the correct layout.
  useEffect(() => {
    if (!selectedProjectId) return

    const selectedWorktree = selectedWorktreeId
      ? worktrees.find((w) => w.id === selectedWorktreeId && w.projectId === selectedProjectId)
      : undefined

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
  }, [selectedProjectId, selectedWorktreeId, worktrees, sessions, activeSessionId, currentLayoutKey])

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
