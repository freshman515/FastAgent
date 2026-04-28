import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitService } from '../services/GitService'

function execGit(cwd: string, args: string[], maxBuffer = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

async function buildUntrackedPreviews(cwd: string): Promise<string> {
  let output = ''
  try {
    output = await execGit(cwd, ['ls-files', '--others', '--exclude-standard'], 1024 * 1024)
  } catch {
    return ''
  }

  const files = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20)
  if (files.length === 0) return ''

  const sections: string[] = ['## Untracked file previews']
  for (const filePath of files) {
    try {
      const content = await readFile(join(cwd, filePath), 'utf-8')
      const preview = content.length > 20000
        ? `${content.slice(0, 20000)}\n... [truncated ${content.length - 20000} chars]`
        : content
      sections.push(`### ${filePath}\n\`\`\`\n${preview}\n\`\`\``)
    } catch {
      sections.push(`### ${filePath}\n[Unable to preview this file]`)
    }
  }

  return sections.join('\n\n')
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

  ipcMain.handle('git:review-diff', async (_event, cwd: string) => {
    try {
      const [status, cachedDiff, worktreeDiff, untrackedPreviews] = await Promise.all([
        execGit(cwd, ['status', '--porcelain', '-u'], 1024 * 1024),
        execGit(cwd, ['diff', '--cached', '--no-ext-diff', '--unified=80'], 8 * 1024 * 1024),
        execGit(cwd, ['diff', '--no-ext-diff', '--unified=80'], 8 * 1024 * 1024),
        buildUntrackedPreviews(cwd),
      ])

      return [
        `## Git status\n\`\`\`\n${status.trim() || 'clean'}\n\`\`\``,
        cachedDiff.trim() ? `## Staged diff\n\`\`\`diff\n${cachedDiff.trim()}\n\`\`\`` : '',
        worktreeDiff.trim() ? `## Worktree diff\n\`\`\`diff\n${worktreeDiff.trim()}\n\`\`\`` : '',
        untrackedPreviews,
      ].filter(Boolean).join('\n\n')
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

  // Filesystem: create an empty file
  ipcMain.handle('fs:create-file', async (_event, filePath: string) => {
    await writeFile(filePath, '', { encoding: 'utf-8', flag: 'wx' })
  })

  // Filesystem: create a directory
  ipcMain.handle('fs:create-dir', async (_event, dirPath: string) => {
    await mkdir(dirPath)
  })

  // Filesystem: move/rename a file or directory
  ipcMain.handle('fs:move', async (_event, sourcePath: string, targetPath: string) => {
    await rename(sourcePath, targetPath)
  })

  // Filesystem: delete a file or directory
  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    await rm(targetPath, { recursive: true, force: false })
  })

  // Filesystem: write a temporary file and return the absolute path
  ipcMain.handle('fs:write-temp-file', async (_event, suggestedName: string, content: string, extension?: string) => {
    const safeBaseName = (suggestedName || 'fastagents-temp')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .trim()
      .replace(/\s+/g, '-')
      || 'fastagents-temp'
    const safeExtension = (extension || 'txt').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'txt'
    const tempDir = join(tmpdir(), 'fastagents')
    await mkdir(tempDir, { recursive: true })
    const filePath = join(
      tempDir,
      `${safeBaseName}-${Date.now()}-${randomUUID().slice(0, 8)}.${safeExtension}`,
    )
    await writeFile(filePath, content, 'utf-8')
    return filePath
  })

  ipcMain.handle('fs:write-temp-data-url', async (_event, suggestedName: string, dataUrl: string, extension?: string) => {
    const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl)
    if (!match) {
      throw new Error('Invalid data URL')
    }

    const mimeExtension = match[1].toLowerCase() === 'image/jpeg' ? 'jpg' : 'png'
    const safeBaseName = (suggestedName || 'fastagents-temp')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .trim()
      .replace(/\s+/g, '-')
      || 'fastagents-temp'
    const safeExtension = (extension || mimeExtension).replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || mimeExtension
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.byteLength > 20 * 1024 * 1024) {
      throw new Error('Temporary file is too large')
    }

    const tempDir = join(tmpdir(), 'fastagents')
    await mkdir(tempDir, { recursive: true })
    const filePath = join(
      tempDir,
      `${safeBaseName}-${Date.now()}-${randomUUID().slice(0, 8)}.${safeExtension}`,
    )
    await writeFile(filePath, buffer)
    return filePath
  })
}
