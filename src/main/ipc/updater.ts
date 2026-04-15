import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { updaterService } from '../services/UpdaterService'

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC.UPDATER_CHECK, async (): Promise<void> => {
    await updaterService.checkNow()
  })

  ipcMain.handle(IPC.UPDATER_DOWNLOAD, async (): Promise<void> => {
    await updaterService.download()
  })

  ipcMain.handle(IPC.UPDATER_INSTALL, (): void => {
    updaterService.quitAndInstall()
  })
}
