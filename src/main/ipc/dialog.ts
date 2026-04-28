import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, type ExternalIdeId, type TerminalShellMode } from '@shared/types'
import { getAvailableIdes, openProjectInIde } from '../services/IdeLauncher'
import { detectTerminalShellAvailability } from '../services/ShellDetector'

export function registerDialogHandlers(): void {
  ipcMain.handle(IPC.SHELL_OPEN_PATH, (_event, path: string) => {
    shell.openPath(path)
  })

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return
    void shell.openExternal(url)
  })

  ipcMain.handle(IPC.SHELL_OPEN_IN_IDE, (_event, ide: ExternalIdeId, path: string) => {
    return openProjectInIde(ide, path)
  })

  ipcMain.handle(IPC.SHELL_LIST_IDES, () => {
    return getAvailableIdes()
  })

  ipcMain.handle(IPC.SHELL_RESOLVE_TERMINAL_SHELL, (_event, mode: TerminalShellMode) => {
    return detectTerminalShellAvailability(mode)
  })

  ipcMain.handle(IPC.DIALOG_SELECT_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}
