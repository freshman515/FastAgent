import { ipcMain } from 'electron'
import { gitService } from '../services/GitService'

export function registerGitHandlers(): void {
  ipcMain.handle('git:get-status', (_event, path: string) => {
    return gitService.getStatus(path)
  })

  ipcMain.handle('git:init', (_event, path: string) => {
    return gitService.initRepo(path)
  })

  ipcMain.handle('git:create-branch', (_event, path: string, name: string) => {
    return gitService.createBranch(path, name)
  })

  ipcMain.handle('git:checkout-branch', (_event, path: string, name: string) => {
    return gitService.checkoutBranch(path, name)
  })

  ipcMain.handle('git:worktree-list', (_event, path: string) =>
    gitService.listWorktrees(path)
  )

  ipcMain.handle('git:worktree-add', (_event, cwd: string, path: string, branch: string) =>
    gitService.addWorktree(cwd, path, branch)
  )

  ipcMain.handle('git:worktree-remove', (_event, cwd: string, path: string) =>
    gitService.removeWorktree(cwd, path)
  )
}
