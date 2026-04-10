import { create } from 'zustand'
import type { GitBranchInfo, GitWorktreeInfo } from '@shared/types'
import { useWorktreesStore } from './worktrees'

/** Normalize path separators for consistent comparison (Windows git returns backslashes) */
function normPath(p: string): string {
  return p.replace(/\\/g, '/')
}

interface GitState {
  branchInfo: Record<string, GitBranchInfo>  // keyed by projectId or worktreeId
  fetchStatus: (projectId: string, path: string) => Promise<void>
  fetchWorktrees: (projectId: string, projectPath: string) => Promise<void>
  createBranch: (projectId: string, path: string, name: string) => Promise<void>
  checkoutBranch: (projectId: string, path: string, name: string) => Promise<void>
}

export const useGitStore = create<GitState>((set, get) => ({
  branchInfo: {},

  fetchStatus: async (projectId, path) => {
    try {
      const info = await window.api.git.getStatus(path)
      set((state) => ({
        branchInfo: { ...state.branchInfo, [projectId]: info },
      }))
    } catch {
      // Silently ignore — project may not be a git repo
    }
  },

  fetchWorktrees: async (projectId, projectPath) => {
    try {
      const worktreeInfos: GitWorktreeInfo[] = await window.api.git.listWorktrees(projectPath)
      const wtStore = useWorktreesStore.getState()

      // Ensure each worktree from disk has a store entry (normalize paths for comparison)
      const diskPaths = new Set<string>()
      for (const info of worktreeInfos) {
        const np = normPath(info.path)
        diskPaths.add(np)
        const existing = wtStore.getWorktreesForProject(projectId).find((w) => normPath(w.path) === np)
        if (existing) {
          if (existing.branch !== info.branch) {
            wtStore.updateBranch(existing.id, info.branch)
          }
        } else {
          wtStore.addWorktree(projectId, info.branch, info.path, info.isMain)
        }
      }

      // Remove store entries that no longer exist on disk (except main)
      const storeWorktrees = useWorktreesStore.getState().getWorktreesForProject(projectId)
      for (const w of storeWorktrees) {
        if (!w.isMain && !diskPaths.has(normPath(w.path))) {
          wtStore.removeWorktree(w.id)
        }
      }
    } catch {
      // Silently ignore — project may not support worktrees
    }
  },

  createBranch: async (projectId, path, name) => {
    await window.api.git.createBranch(path, name)
    await get().fetchStatus(projectId, path)
  },

  checkoutBranch: async (projectId, path, name) => {
    await window.api.git.checkoutBranch(path, name)
    await get().fetchStatus(projectId, path)
  },
}))
