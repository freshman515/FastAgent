import { BrowserWindow, ipcMain } from 'electron'
import { IPC, type ConfigSyncKey } from '@shared/types'
import { addConfigObserver, readConfig, writeConfig } from '../services/ConfigStore'

let configBroadcastRegistered = false

export function registerConfigHandlers(): void {
  if (!configBroadcastRegistered) {
    configBroadcastRegistered = true
    addConfigObserver((event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.CONFIG_CHANGED, event)
      }
    })
  }

  ipcMain.handle('config:read', () => {
    return readConfig()
  })

  ipcMain.handle('config:write', (_event, key: string, value: unknown) => {
    writeConfig(key as ConfigSyncKey, value)
  })
}
