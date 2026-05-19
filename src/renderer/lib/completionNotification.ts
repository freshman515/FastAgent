import type { Session } from '@shared/types'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore, type CompletionNotification } from '@/stores/ui'

interface CompletedSessionNotificationOptions {
  session: Session
  title?: string
  body?: string
  type?: CompletionNotification['type']
}

export function addCompletedSessionNotification({
  session,
  title = 'Task completed',
  body,
  type = 'success',
}: CompletedSessionNotificationOptions): void {
  const ui = useUIStore.getState()
  if (!ui.settings.completionNotificationEnabled) return

  const project = useProjectsStore.getState().projects.find((item) => item.id === session.projectId)
  const projectName = project?.name ?? 'Unknown project'
  const sessionName = session.name

  ui.addCompletionNotification({
    title,
    body: body ?? `${projectName}\n${sessionName}`,
    type,
    sessionId: session.id,
    projectId: session.projectId,
    sessionName,
    projectName,
    duration: ui.settings.completionNotificationDurationMs,
  })
}
