import { ipcMain } from 'electron'
import { readConfig, writeConfig } from '../services/ConfigStore'

export function registerConfigHandlers(): void {
  ipcMain.handle('config:read', () => {
    return readConfig()
  })

  ipcMain.handle('config:write', (_event, key: string, value: unknown) => {
    writeConfig(
      key as 'groups' | 'projects' | 'sessions' | 'worktrees' | 'templates' | 'activeTasks' | 'ui' | 'panes',
      value,
    )
  })
}
