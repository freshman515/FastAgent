import { create } from 'zustand'
import type { ActiveTask, TaskBundle, TaskBundleType } from '@shared/types'
import { BUILT_IN_BUNDLES } from '@shared/taskBundles'
import { generateId } from '@/lib/utils'

const VALID_STATUSES = ['active', 'completed', 'cancelled'] as const

function sanitizeActiveTask(t: unknown): ActiveTask | null {
  if (!t || typeof t !== 'object') return null
  const obj = t as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.bundleId !== 'string' || typeof obj.projectId !== 'string') return null
  if (typeof obj.description !== 'string') return null
  const status = VALID_STATUSES.includes(obj.status as typeof VALID_STATUSES[number])
    ? (obj.status as ActiveTask['status'])
    : 'active'
  return {
    id: obj.id,
    bundleId: obj.bundleId,
    projectId: obj.projectId,
    branch: typeof obj.branch === 'string' ? obj.branch : undefined,
    description: obj.description,
    sessionIds: Array.isArray(obj.sessionIds)
      ? obj.sessionIds.filter((s): s is string => typeof s === 'string')
      : [],
    status,
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
  }
}

function persist(activeTasks: ActiveTask[]): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('activeTasks', activeTasks)
}

interface TasksState {
  bundles: TaskBundle[]
  activeTasks: ActiveTask[]
  _loaded: boolean
  _loadFromConfig: (raw: { activeTasks?: unknown[] }) => void
  startTask: (bundleId: string, projectId: string, description: string, branch?: string) => ActiveTask
  completeTask: (taskId: string) => void
  cancelTask: (taskId: string) => void
  addSessionToTask: (taskId: string, sessionId: string) => void
}

export const useTasksStore = create<TasksState>((set, get) => ({
  bundles: [...BUILT_IN_BUNDLES],
  activeTasks: [],
  _loaded: false,

  _loadFromConfig: (raw) => {
    const activeTasks = (Array.isArray(raw.activeTasks) ? raw.activeTasks : [])
      .map(sanitizeActiveTask)
      .filter((t): t is ActiveTask => t !== null)
    set({ activeTasks, _loaded: true })
  },

  startTask: (bundleId, projectId, description, branch) => {
    const task: ActiveTask = {
      id: generateId(),
      bundleId,
      projectId,
      branch,
      description,
      sessionIds: [],
      status: 'active',
      createdAt: Date.now(),
    }
    set((state) => {
      const activeTasks = [...state.activeTasks, task]
      persist(activeTasks)
      return { activeTasks }
    })
    return task
  },

  completeTask: (taskId) =>
    set((state) => {
      const activeTasks = state.activeTasks.map((t) =>
        t.id === taskId ? { ...t, status: 'completed' as const } : t,
      )
      persist(activeTasks)
      return { activeTasks }
    }),

  cancelTask: (taskId) =>
    set((state) => {
      const activeTasks = state.activeTasks.map((t) =>
        t.id === taskId ? { ...t, status: 'cancelled' as const } : t,
      )
      persist(activeTasks)
      return { activeTasks }
    }),

  addSessionToTask: (taskId, sessionId) =>
    set((state) => {
      const activeTasks = state.activeTasks.map((t) =>
        t.id === taskId ? { ...t, sessionIds: [...t.sessionIds, sessionId] } : t,
      )
      persist(activeTasks)
      return { activeTasks }
    }),
}))
