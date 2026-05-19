import type { Session } from '@shared/types'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore, type CompletionNotification } from '@/stores/ui'

interface CompletedSessionNotificationOptions {
  session: Session
  title?: string
  body?: string
  type?: CompletionNotification['type']
}

interface RunningSessionNotificationOptions {
  session: Session
  title?: string
  body?: string
}

function getSessionNotificationNames(session: Session): { projectName: string; sessionName: string } {
  const project = useProjectsStore.getState().projects.find((item) => item.id === session.projectId)
  return {
    projectName: project?.name ?? 'Unknown project',
    sessionName: session.name,
  }
}

export function addRunningSessionNotification({
  session,
  title = 'Task started',
  body,
}: RunningSessionNotificationOptions): void {
  const ui = useUIStore.getState()
  if (!ui.settings.completionNotificationEnabled || !ui.settings.runningNotificationEnabled) return

  const existing = ui.completionNotifications.find(
    (item) => item.sessionId === session.id && item.status === 'running',
  )
  if (existing) return

  const { projectName, sessionName } = getSessionNotificationNames(session)

  ui.addCompletionNotification({
    title,
    body: body ?? `${projectName}\n${sessionName}`,
    type: 'success',
    status: 'running',
    sessionId: session.id,
    projectId: session.projectId,
    sessionName,
    projectName,
    duration: 0,
  })
}

export function addCompletedSessionNotification({
  session,
  title = 'Task completed',
  body,
  type = 'success',
}: CompletedSessionNotificationOptions): void {
  const ui = useUIStore.getState()
  if (!ui.settings.completionNotificationEnabled) return

  const { projectName, sessionName } = getSessionNotificationNames(session)

  ui.addCompletionNotification({
    title,
    body: body ?? `${projectName}\n${sessionName}`,
    type,
    status: 'completed',
    sessionId: session.id,
    projectId: session.projectId,
    sessionName,
    projectName,
    duration: ui.settings.completionNotificationDurationMs,
  })
}
