import { dialog, ipcMain, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { IPC } from '@shared/types'
import type { SessionCreateOptions } from '@shared/types'
import { ptyManager } from '../services/PtyManager'
import { activityMonitor } from '../services/ActivityMonitor'

export function registerSessionHandlers(): void {
  ipcMain.handle(IPC.SESSION_CREATE, (_event, options: SessionCreateOptions) => {
    const ptyId = ptyManager.create(options)
    return { ptyId }
  })

  ipcMain.handle(IPC.SESSION_WRITE, (_event, ptyId: string, data: string) => {
    ptyManager.write(ptyId, data)
  })

  ipcMain.handle(IPC.SESSION_RESIZE, (_event, ptyId: string, cols: number, rows: number) => {
    ptyManager.resize(ptyId, cols, rows)
  })

  ipcMain.handle(IPC.SESSION_KILL, (_event, ptyId: string) => {
    activityMonitor.stopMonitoring(ptyId)
    ptyManager.kill(ptyId)
  })

  ipcMain.handle(IPC.SESSION_ACTIVITY, async (_event, ptyId: string) => {
    return activityMonitor.isActive(ptyId)
  })

  // Export terminal output to file
  ipcMain.handle(IPC.SESSION_EXPORT, async (event, ptyId: string, sessionName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const replay = ptyManager.getReplay(ptyId)
    if (!replay) return false
    // Strip all ANSI/VT escape sequences for clean text export
    const clean = replay
      // CSI sequences: ESC[ ... letter (includes private modes like ?25l, ?9001h)
      .replace(/\x1b\[[\?!]?[0-9;]*[a-zA-Z]/g, '')
      // OSC sequences: ESC] ... (BEL or ST)
      .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
      // Other ESC sequences: ESC followed by single char or (X
      .replace(/\x1b[()][0-9A-B]|\x1b[>=<]|\x1b[a-zA-Z]/g, '')
      // Remaining bare ESC
      .replace(/\x1b/g, '')
      // Control chars except \n \r \t
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
      // Collapse multiple blank lines
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${sessionName.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, clean, 'utf-8')
    return true
  })

  // Graceful shutdown: send Ctrl+C to Claude Code sessions, capture resume UUIDs
  ipcMain.handle(IPC.SESSION_GRACEFUL_SHUTDOWN, async () => {
    const uuidMap = await ptyManager.gracefulShutdownClaudeSessions()
    // Convert Map to plain object for IPC serialization
    const result: Record<string, string> = {}
    for (const [ptyId, uuid] of uuidMap) {
      result[ptyId] = uuid
    }
    return result
  })
}
