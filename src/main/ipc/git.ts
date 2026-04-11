import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gitService } from '../services/GitService'

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

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

  // File-level git status
  ipcMain.handle('git:file-status', async (_event, cwd: string) => {
    try {
      const output = await execGit(cwd, ['status', '--porcelain', '-u'])
      const results: Array<{ path: string; status: string; staged: boolean }> = []
      for (const line of output.split(/\r?\n/).filter((entry) => entry.length > 0)) {
        const x = line[0] // staged status
        const y = line[1] // unstaged status
        const filePath = line.slice(3)
        // Staged change
        if (x !== ' ' && x !== '?') {
          results.push({ path: filePath, status: x, staged: true })
        }
        // Unstaged change
        if (y !== ' ' && x !== '?') {
          results.push({ path: filePath, status: y, staged: false })
        }
        // Untracked
        if (x === '?') {
          results.push({ path: filePath, status: '?', staged: false })
        }
      }
      return results
    } catch {
      return []
    }
  })

  // Git diff for a specific file
  ipcMain.handle('git:diff', async (_event, cwd: string, filePath: string) => {
    try {
      const output = await execGit(cwd, ['diff', '--', filePath])
      if (output.trim()) return output
      // Try staged diff
      return await execGit(cwd, ['diff', '--cached', '--', filePath])
    } catch {
      return ''
    }
  })

  // Git stage
  ipcMain.handle('git:stage', async (_event, cwd: string, filePath: string) => {
    await execGit(cwd, ['add', '--', filePath])
  })

  // Git unstage
  ipcMain.handle('git:unstage', async (_event, cwd: string, filePath: string) => {
    try {
      await execGit(cwd, ['restore', '--staged', '--', filePath])
    } catch {
      // Fallback for files not in HEAD (e.g., newly added)
      await execGit(cwd, ['rm', '--cached', '--', filePath])
    }
  })

  // Git commit
  ipcMain.handle('git:commit', async (_event, cwd: string, message: string) => {
    await execGit(cwd, ['commit', '-m', message])
  })

  // Git discard changes
  ipcMain.handle('git:discard', async (_event, cwd: string, filePath: string) => {
    await execGit(cwd, ['checkout', '--', filePath])
  })

  // Filesystem: read directory entries
  ipcMain.handle('fs:read-dir', async (_event, dirPath: string) => {
    try {
      const entries = await readdir(dirPath)
      const results: Array<{ name: string; isDir: boolean }> = []
      for (const name of entries) {
        try {
          const s = await stat(join(dirPath, name))
          results.push({ name, isDir: s.isDirectory() })
        } catch {
          // skip inaccessible entries
        }
      }
      return results
    } catch {
      return []
    }
  })

  // Git show HEAD version of a file
  ipcMain.handle('git:show-head', async (_event, cwd: string, filePath: string) => {
    try {
      return await execGit(cwd, ['show', `HEAD:${filePath}`])
    } catch {
      return ''
    }
  })

  // Filesystem: read file content
  ipcMain.handle('fs:read-file', async (_event, filePath: string) => {
    return readFile(filePath, 'utf-8')
  })

  // Filesystem: write file content
  ipcMain.handle('fs:write-file', async (_event, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
  })
}
