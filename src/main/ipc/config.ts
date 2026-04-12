import { app, ipcMain } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ANONYMOUS_PROJECT_DIR_NAME } from '@shared/types'
import { readConfig, writeConfig } from '../services/ConfigStore'

export function registerConfigHandlers(): void {
  ipcMain.handle('config:read', () => {
    return readConfig()
  })

  ipcMain.handle('config:get-anonymous-workspace', async () => {
    const dir = join(app.getPath('userData'), ANONYMOUS_PROJECT_DIR_NAME)
    await mkdir(dir, { recursive: true })
    return dir
  })

  ipcMain.handle('config:write', (_event, key: string, value: unknown) => {
    writeConfig(
      key as 'groups' | 'projects' | 'sessions' | 'editors' | 'worktrees' | 'templates' | 'activeTasks' | 'ui' | 'panes' | 'claudeGui' | 'customThemes',
      value,
    )
  })
}
