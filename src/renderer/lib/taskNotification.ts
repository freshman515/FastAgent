import type { ToastNotification } from '@shared/types'
import { useUIStore } from '@/stores/ui'

type TaskNotification = Omit<ToastNotification, 'id' | 'createdAt'>

export async function showTaskNotification(notification: TaskNotification): Promise<void> {
  const settings = useUIStore.getState().settings
  if (!settings.notificationToastEnabled) return

  if (settings.notificationDisplayMode === 'in-app') {
    useUIStore.getState().addToast(notification)
    return
  }

  const desktopNotificationShown = await window.api.notification.show({
    title: notification.title,
    body: notification.body,
    sessionId: notification.sessionId,
    projectId: notification.projectId,
    force: settings.notificationDisplayMode === 'desktop',
  }).catch(() => false)

  if (!desktopNotificationShown && settings.notificationDisplayMode === 'smart') {
    useUIStore.getState().addToast(notification)
  }
}
