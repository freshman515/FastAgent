import { useEffect } from 'react'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { SplitContainer } from '@/components/split/SplitContainer'
import { EmptyState } from '@/components/session/EmptyState'

export function MainPanel(): JSX.Element {
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const sessions = useSessionsStore((s) => s.sessions)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)

  // Switch pane layout when project changes
  useEffect(() => {
    if (!selectedProjectId) return
    const projectSessionIds = sessions
      .filter((s) => s.projectId === selectedProjectId)
      .map((s) => s.id)
    usePanesStore.getState().switchProject(selectedProjectId, projectSessionIds, activeSessionId)
  }, [selectedProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

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
