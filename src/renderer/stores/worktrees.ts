import { create } from 'zustand'
import type { Worktree } from '@shared/types'
import { generateId } from '@/lib/utils'

function sanitizeWorktree(w: unknown): Worktree | null {
  if (!w || typeof w !== 'object') return null
  const obj = w as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.projectId !== 'string' || typeof obj.path !== 'string') return null
  return {
    id: obj.id,
    projectId: obj.projectId,
    branch: typeof obj.branch === 'string' ? obj.branch : 'unknown',
    path: obj.path,
    isMain: obj.isMain === true,
  }
}

function persist(worktrees: Worktree[]): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('worktrees', worktrees)
}

interface WorktreesState {
  worktrees: Worktree[]
  selectedWorktreeId: string | null
  _loaded: boolean
  _loadFromConfig: (raw: unknown[]) => void
  addWorktree: (projectId: string, branch: string, path: string, isMain: boolean) => string
  removeWorktree: (id: string) => void
  selectWorktree: (id: string | null) => void
  getWorktreesForProject: (projectId: string) => Worktree[]
  getMainWorktree: (projectId: string) => Worktree | undefined
  ensureMainWorktree: (projectId: string, projectPath: string, branch?: string) => string
  updateBranch: (id: string, branch: string) => void
}

export const useWorktreesStore = create<WorktreesState>((set, get) => ({
  worktrees: [],
  selectedWorktreeId: null,
  _loaded: false,

  _loadFromConfig: (raw) => {
    const worktrees = (Array.isArray(raw) ? raw : [])
      .map(sanitizeWorktree)
      .filter((w): w is Worktree => w !== null)
    set({ worktrees, _loaded: true })
  },

  addWorktree: (projectId, branch, path, isMain) => {
    const id = generateId()
    const worktree: Worktree = { id, projectId, branch, path, isMain }
    set((state) => {
      const worktrees = [...state.worktrees, worktree]
      persist(worktrees)
      return { worktrees }
    })
    return id
  },

  removeWorktree: (id) =>
    set((state) => {
      const worktrees = state.worktrees.filter((w) => w.id !== id)
      persist(worktrees)
      const selectedWorktreeId = state.selectedWorktreeId === id ? null : state.selectedWorktreeId
      return { worktrees, selectedWorktreeId }
    }),

  selectWorktree: (id) => set({ selectedWorktreeId: id }),

  getWorktreesForProject: (projectId) => {
    return get().worktrees.filter((w) => w.projectId === projectId)
  },

  getMainWorktree: (projectId) => {
    return get().worktrees.find((w) => w.isMain && w.projectId === projectId)
  },

  ensureMainWorktree: (projectId, projectPath, branch) => {
    const existing = get().getMainWorktree(projectId)
    if (existing) return existing.id
    return get().addWorktree(projectId, branch ?? 'unknown', projectPath, true)
  },

  updateBranch: (id, branch) =>
    set((state) => {
      const worktrees = state.worktrees.map((w) =>
        w.id === id ? { ...w, branch } : w,
      )
      persist(worktrees)
      return { worktrees }
    }),
}))
