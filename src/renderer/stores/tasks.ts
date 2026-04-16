import { create } from 'zustand'
import type {
  ActiveTask,
  StructuredWorkerReport,
  TaskBundle,
  TaskBundleType,
  TaskGraphNode,
  TaskGraphNodeStatus,
} from '@shared/types'
import { BUILT_IN_BUNDLES } from '@shared/taskBundles'
import { generateId } from '@/lib/utils'

const VALID_STATUSES = ['active', 'completed', 'cancelled'] as const
const VALID_NODE_STATUSES: TaskGraphNodeStatus[] = ['pending', 'running', 'blocked', 'completed', 'failed']

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function sanitizeGraphNode(value: unknown): TaskGraphNode | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string' || typeof obj.prompt !== 'string') return null
  if (!['claude-code', 'claude-code-yolo', 'codex', 'codex-yolo', 'opencode'].includes(obj.type as string)) return null
  const status = VALID_NODE_STATUSES.includes(obj.status as TaskGraphNodeStatus)
    ? obj.status as TaskGraphNodeStatus
    : 'pending'
  return {
    id: obj.id,
    templateId: typeof obj.templateId === 'string' ? obj.templateId : undefined,
    name: obj.name,
    type: obj.type as TaskGraphNode['type'],
    prompt: obj.prompt,
    dependsOn: sanitizeStringArray(obj.dependsOn),
    ownership: sanitizeStringArray(obj.ownership),
    isolatedWorktree: obj.isolatedWorktree === true,
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : undefined,
    worktreeId: typeof obj.worktreeId === 'string' ? obj.worktreeId : undefined,
    status,
  }
}

function sanitizeReport(value: unknown): StructuredWorkerReport | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  return {
    status: typeof obj.status === 'string' ? obj.status : '',
    filesChanged: sanitizeStringArray(obj.filesChanged),
    verification: typeof obj.verification === 'string' ? obj.verification : '',
    risks: typeof obj.risks === 'string' ? obj.risks : '',
    blockers: typeof obj.blockers === 'string' ? obj.blockers : '',
    suggestedNextAction: typeof obj.suggestedNextAction === 'string' ? obj.suggestedNextAction : '',
    raw: typeof obj.raw === 'string' ? obj.raw : '',
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
  }
}

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
    graphNodes: Array.isArray(obj.graphNodes)
      ? obj.graphNodes.map(sanitizeGraphNode).filter((node): node is TaskGraphNode => node !== null)
      : undefined,
    reports: obj.reports && typeof obj.reports === 'object' && !Array.isArray(obj.reports)
      ? Object.fromEntries(
        Object.entries(obj.reports as Record<string, unknown>)
          .flatMap(([nodeId, report]) => {
            const sanitized = sanitizeReport(report)
            return sanitized ? [[nodeId, sanitized]] : []
          }),
      )
      : undefined,
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
  startGraphTask: (projectId: string, description: string, graphNodes: TaskGraphNode[], branch?: string) => ActiveTask
  completeTask: (taskId: string) => void
  cancelTask: (taskId: string) => void
  addSessionToTask: (taskId: string, sessionId: string) => void
  updateTaskNode: (taskId: string, nodeId: string, updates: Partial<TaskGraphNode>) => void
  attachNodeSession: (taskId: string, nodeId: string, sessionId: string, worktreeId?: string) => void
  setNodeReport: (taskId: string, nodeId: string, report: StructuredWorkerReport) => void
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

  startGraphTask: (projectId, description, graphNodes, branch) => {
    const task: ActiveTask = {
      id: generateId(),
      bundleId: 'agent-dag',
      projectId,
      branch,
      description,
      sessionIds: [],
      status: 'active',
      createdAt: Date.now(),
      graphNodes,
      reports: {},
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
        t.id === taskId && !t.sessionIds.includes(sessionId)
          ? { ...t, sessionIds: [...t.sessionIds, sessionId] }
          : t,
      )
      persist(activeTasks)
      return { activeTasks }
    }),

  updateTaskNode: (taskId, nodeId, updates) =>
    set((state) => {
      const activeTasks = state.activeTasks.map((task) => {
        if (task.id !== taskId || !task.graphNodes) return task
        return {
          ...task,
          graphNodes: task.graphNodes.map((node) =>
            node.id === nodeId ? { ...node, ...updates } : node,
          ),
        }
      })
      persist(activeTasks)
      return { activeTasks }
    }),

  attachNodeSession: (taskId, nodeId, sessionId, worktreeId) =>
    set((state) => {
      const activeTasks = state.activeTasks.map((task) => {
        if (task.id !== taskId || !task.graphNodes) return task
        return {
          ...task,
          sessionIds: task.sessionIds.includes(sessionId) ? task.sessionIds : [...task.sessionIds, sessionId],
          graphNodes: task.graphNodes.map((node) =>
            node.id === nodeId
              ? { ...node, sessionId, worktreeId, status: 'running' as const }
              : node,
          ),
        }
      })
      persist(activeTasks)
      return { activeTasks }
    }),

  setNodeReport: (taskId, nodeId, report) =>
    set((state) => {
      const activeTasks = state.activeTasks.map((task) => {
        if (task.id !== taskId) return task
        return {
          ...task,
          reports: {
            ...(task.reports ?? {}),
            [nodeId]: report,
          },
          graphNodes: task.graphNodes?.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  status: report.blockers.trim() ? 'blocked' as const : 'completed' as const,
                }
              : node,
          ),
        }
      })
      persist(activeTasks)
      return { activeTasks }
    }),
}))
