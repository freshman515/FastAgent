import { ipcMain } from 'electron'
import { mediaMonitor } from '../services/MediaMonitor'

export function registerMediaHandlers(): void {
  ipcMain.handle('media:get', () => {
    return mediaMonitor.getCurrent()
  })

  ipcMain.handle('media:command', (_event, command: 'play-pause' | 'next' | 'prev') => {
    mediaMonitor.sendCommand(command)
  })
}
