import { BrowserWindow, ipcMain, Notification } from 'electron'
import { IPC } from '@shared/types'

interface NotificationOptions {
  title: string
  body?: string
  sessionId?: string
  projectId?: string
  force?: boolean
}

const activeNotifications = new Set<Notification>()

function focusNotificationWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.moveTop()
  win.focus()
  if (process.platform === 'win32') {
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setAlwaysOnTop(false)
    win.focus()
  }
}

export function registerNotificationHandlers(): void {
  ipcMain.handle(IPC.NOTIFICATION_SHOW, (event, options: NotificationOptions) => {
    if (!Notification.isSupported()) return false

    const win = BrowserWindow.fromWebContents(event.sender)

    // Smart mode only shows system notifications while the app is out of focus;
    // desktop-only mode can force a native notification even when focused.
    if (win && (options.force || !win.isFocused())) {
      const notification = new Notification({
        title: options.title,
        body: options.body ?? '',
        silent: false,
      })

      activeNotifications.add(notification)
      notification.on('close', () => {
        activeNotifications.delete(notification)
      })
      notification.on('click', () => {
        if (win && !win.isDestroyed()) {
          focusNotificationWindow(win)
          win.webContents.send(IPC.NOTIFICATION_CLICK, {
            sessionId: options.sessionId,
            projectId: options.projectId,
          })
        }
        activeNotifications.delete(notification)
      })

      notification.show()
      return true
    }

    return false
  })
}
