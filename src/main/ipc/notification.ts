import { BrowserWindow, ipcMain, Notification } from 'electron'
import { IPC } from '@shared/types'

interface NotificationOptions {
  title: string
  body?: string
  sessionId?: string
  projectId?: string
}

export function registerNotificationHandlers(): void {
  ipcMain.handle(IPC.NOTIFICATION_SHOW, (event, options: NotificationOptions) => {
    if (!Notification.isSupported()) return

    const win = BrowserWindow.fromWebContents(event.sender)

    // Show system notification only when window is not focused
    if (win && !win.isFocused()) {
      const notification = new Notification({
        title: options.title,
        body: options.body ?? '',
        silent: false,
      })

      notification.on('click', () => {
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore()
          win.focus()
          win.webContents.send(IPC.NOTIFICATION_CLICK, {
            sessionId: options.sessionId,
            projectId: options.projectId,
          })
        }
      })

      notification.show()
    }
  })
}
