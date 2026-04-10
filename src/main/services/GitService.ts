import { execFile } from 'child_process'
import type { GitWorktreeInfo } from '@shared/types'

export interface GitBranchInfo {
  current: string
  branches: string[]
  isDirty: boolean
}

const EMPTY_INFO: GitBranchInfo = { current: '', branches: [], isDirty: false }

function exec(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

class GitService {
  async getStatus(cwd: string): Promise<GitBranchInfo> {
    try {
      const [branchOutput, statusOutput] = await Promise.all([
        exec('git', ['branch'], cwd),
        exec('git', ['status', '--porcelain'], cwd),
      ])

      const branches: string[] = []
      let current = ''

      for (const line of branchOutput.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (trimmed.startsWith('* ')) {
          current = trimmed.slice(2)
          branches.push(current)
        } else {
          branches.push(trimmed)
        }
      }

      const isDirty = statusOutput.trim().length > 0

      return { current, branches, isDirty }
    } catch {
      return EMPTY_INFO
    }
  }

  async initRepo(cwd: string): Promise<void> {
    await exec('git', ['init'], cwd)
    // Create initial commit so branches work
    await exec('git', ['add', '.'], cwd)
    await exec('git', ['commit', '-m', 'Initial commit', '--allow-empty'], cwd)
  }

  async createBranch(cwd: string, name: string): Promise<void> {
    await exec('git', ['checkout', '-b', name], cwd)
  }

  async checkoutBranch(cwd: string, name: string): Promise<void> {
    await exec('git', ['checkout', name], cwd)
  }

  async listWorktrees(cwd: string): Promise<GitWorktreeInfo[]> {
    try {
      const output = await exec('git', ['worktree', 'list', '--porcelain'], cwd)
      const result: GitWorktreeInfo[] = []
      const blocks = output.split('\n\n').filter((b) => b.trim().length > 0)

      for (let i = 0; i < blocks.length; i++) {
        const lines = blocks[i].split('\n')
        let path = ''
        let branch = ''

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            path = line.slice('worktree '.length)
          } else if (line.startsWith('branch ')) {
            const ref = line.slice('branch '.length)
            branch = ref.replace('refs/heads/', '')
          }
        }

        if (path) {
          result.push({ path, branch, isMain: i === 0 })
        }
      }

      return result
    } catch {
      return []
    }
  }

  async addWorktree(cwd: string, worktreePath: string, branch: string): Promise<void> {
    const branchList = await exec('git', ['branch', '--list', branch], cwd)
    if (branchList.trim().length > 0) {
      await exec('git', ['worktree', 'add', worktreePath, branch], cwd)
    } else {
      await exec('git', ['worktree', 'add', '-b', branch, worktreePath], cwd)
    }
  }

  async removeWorktree(cwd: string, worktreePath: string): Promise<void> {
    await exec('git', ['worktree', 'remove', worktreePath, '--force'], cwd)
  }
}

export const gitService = new GitService()
