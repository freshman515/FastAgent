import { create } from 'zustand'
import type { AgentSessionType } from '@shared/types'
import { generateId } from '@/lib/utils'

export type InfiniteTaskStatus =
  | 'queued'
  | 'running'
  | 'reviewing'
  | 'revising'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface InfiniteTaskEvent {
  id: string
  ts: number
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export interface InfiniteTaskItem {
  id: string
  title: string
  prompt: string
  status: InfiniteTaskStatus
  stage: string
  projectId: string
  sourceFileName?: string
  workerSessionId?: string
  reviewSessionId?: string
  allowedSessionTypes: AgentSessionType[]
  isolateWorktree: boolean
  maxReviewRounds: number
  reviewRound: number
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  lastReport?: string
  lastReview?: string
  error?: string
  events: InfiniteTaskEvent[]
}

export interface InfiniteTaskSettings {
  allowedSessionTypes: AgentSessionType[]
  isolateWorktree: boolean
  maxReviewRounds: number
}

const VALID_AGENT_TYPES = new Set<AgentSessionType>([
  'claude-code',
  'claude-code-yolo',
  'claude-code-wsl',
  'claude-code-yolo-wsl',
  'codex',
  'codex-yolo',
  'codex-wsl',
  'codex-yolo-wsl',
  'gemini',
  'gemini-yolo',
  'opencode',
])

const VALID_STATUSES = new Set<InfiniteTaskStatus>([
  'queued',
  'running',
  'reviewing',
  'revising',
  'verifying',
  'completed',
  'failed',
  'cancelled',
])

const DEFAULT_SETTINGS: InfiniteTaskSettings = {
  allowedSessionTypes: ['codex-yolo'],
  isolateWorktree: false,
  maxReviewRounds: 2,
}

function sanitizeAgentTypes(value: unknown, fallback: AgentSessionType[] = DEFAULT_SETTINGS.allowedSessionTypes): AgentSessionType[] {
  const items = Array.isArray(value)
    ? value.filter((item): item is AgentSessionType => typeof item === 'string' && VALID_AGENT_TYPES.has(item as AgentSessionType))
    : []
  return items.length > 0 ? Array.from(new Set(items)) : [...fallback]
}

function sanitizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback
}

function sanitizeEvents(value: unknown): InfiniteTaskEvent[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item): InfiniteTaskEvent[] => {
      if (!item || typeof item !== 'object') return []
      const raw = item as Record<string, unknown>
      if (typeof raw.message !== 'string' || !raw.message.trim()) return []
      const level = raw.level === 'success' || raw.level === 'warning' || raw.level === 'error' ? raw.level : 'info'
      return [{
        id: typeof raw.id === 'string' ? raw.id : generateId(),
        ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
        level,
        message: raw.message,
      }]
    })
    .slice(-80)
}

function sanitizeTask(value: unknown): InfiniteTaskItem | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.projectId !== 'string' || typeof raw.prompt !== 'string') return null
  const status = typeof raw.status === 'string' && VALID_STATUSES.has(raw.status as InfiniteTaskStatus)
    ? raw.status as InfiniteTaskStatus
    : 'queued'
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : raw.prompt.slice(0, 40),
    prompt: raw.prompt,
    status,
    stage: typeof raw.stage === 'string' ? raw.stage : '',
    projectId: raw.projectId,
    sourceFileName: typeof raw.sourceFileName === 'string' ? raw.sourceFileName : undefined,
    workerSessionId: typeof raw.workerSessionId === 'string' ? raw.workerSessionId : undefined,
    reviewSessionId: typeof raw.reviewSessionId === 'string' ? raw.reviewSessionId : undefined,
    allowedSessionTypes: sanitizeAgentTypes(raw.allowedSessionTypes),
    isolateWorktree: raw.isolateWorktree === true,
    maxReviewRounds: sanitizeNumber(raw.maxReviewRounds, DEFAULT_SETTINGS.maxReviewRounds, 0, 5),
    reviewRound: sanitizeNumber(raw.reviewRound, 0, 0, 20),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : undefined,
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : undefined,
    lastReport: typeof raw.lastReport === 'string' ? raw.lastReport : undefined,
    lastReview: typeof raw.lastReview === 'string' ? raw.lastReview : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    events: sanitizeEvents(raw.events),
  }
}

function createTask(projectId: string, prompt: string, settings: InfiniteTaskSettings, sourceFileName?: string): InfiniteTaskItem {
  const normalizedPrompt = prompt.trim()
  const firstLine = normalizedPrompt.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '未命名任务'
  return {
    id: generateId(),
    title: firstLine.slice(0, 80),
    prompt: normalizedPrompt,
    status: 'queued',
    stage: '等待启动',
    projectId,
    sourceFileName,
    allowedSessionTypes: [...settings.allowedSessionTypes],
    isolateWorktree: settings.isolateWorktree,
    maxReviewRounds: settings.maxReviewRounds,
    reviewRound: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [{
      id: generateId(),
      ts: Date.now(),
      level: 'info',
      message: sourceFileName ? `从 ${sourceFileName} 导入` : '已加入任务队列',
    }],
  }
}

function persist(tasks: InfiniteTaskItem[], settings: InfiniteTaskSettings): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('infiniteTasks', { tasks, settings })
}

interface InfiniteTasksState {
  tasks: InfiniteTaskItem[]
  settings: InfiniteTaskSettings
  running: boolean
  activeTaskId: string | null
  _loaded: boolean
  _loadFromConfig: (raw: unknown) => void
  setSettings: (updates: Partial<InfiniteTaskSettings>) => void
  addTask: (projectId: string, prompt: string, sourceFileName?: string) => InfiniteTaskItem
  addTasks: (projectId: string, prompts: Array<{ prompt: string; sourceFileName?: string }>) => InfiniteTaskItem[]
  updateTask: (taskId: string, updates: Partial<InfiniteTaskItem>) => void
  appendTaskEvent: (taskId: string, level: InfiniteTaskEvent['level'], message: string) => void
  removeTask: (taskId: string) => void
  clearFinished: () => void
  setRunning: (running: boolean, activeTaskId?: string | null) => void
}

export const useInfiniteTasksStore = create<InfiniteTasksState>((set, get) => ({
  tasks: [],
  settings: { ...DEFAULT_SETTINGS },
  running: false,
  activeTaskId: null,
  _loaded: false,

  _loadFromConfig: (raw) => {
    const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const rawSettings = obj.settings && typeof obj.settings === 'object' ? obj.settings as Record<string, unknown> : {}
    const settings: InfiniteTaskSettings = {
      allowedSessionTypes: sanitizeAgentTypes(rawSettings.allowedSessionTypes),
      isolateWorktree: rawSettings.isolateWorktree === true,
      maxReviewRounds: sanitizeNumber(rawSettings.maxReviewRounds, DEFAULT_SETTINGS.maxReviewRounds, 0, 5),
    }
    const tasks = Array.isArray(obj.tasks)
      ? obj.tasks.map(sanitizeTask).filter((task): task is InfiniteTaskItem => task !== null)
      : []
    set({ tasks, settings, running: false, activeTaskId: null, _loaded: true })
  },

  setSettings: (updates) =>
    set((state) => {
      const settings: InfiniteTaskSettings = {
        ...state.settings,
        ...updates,
        allowedSessionTypes: sanitizeAgentTypes(updates.allowedSessionTypes ?? state.settings.allowedSessionTypes),
        maxReviewRounds: sanitizeNumber(updates.maxReviewRounds ?? state.settings.maxReviewRounds, state.settings.maxReviewRounds, 0, 5),
      }
      persist(state.tasks, settings)
      return { settings }
    }),

  addTask: (projectId, prompt, sourceFileName) => {
    const task = createTask(projectId, prompt, get().settings, sourceFileName)
    set((state) => {
      const tasks = [task, ...state.tasks]
      persist(tasks, state.settings)
      return { tasks }
    })
    return task
  },

  addTasks: (projectId, prompts) => {
    const created = prompts
      .filter((item) => item.prompt.trim())
      .map((item) => createTask(projectId, item.prompt, get().settings, item.sourceFileName))
    if (created.length === 0) return []
    set((state) => {
      const tasks = [...created, ...state.tasks]
      persist(tasks, state.settings)
      return { tasks }
    })
    return created
  },

  updateTask: (taskId, updates) =>
    set((state) => {
      const tasks = state.tasks.map((task) => task.id === taskId
        ? { ...task, ...updates, updatedAt: Date.now() }
        : task)
      persist(tasks, state.settings)
      return { tasks }
    }),

  appendTaskEvent: (taskId, level, message) =>
    set((state) => {
      const tasks = state.tasks.map((task) => {
        if (task.id !== taskId) return task
        return {
          ...task,
          updatedAt: Date.now(),
          events: [...task.events, { id: generateId(), ts: Date.now(), level, message }].slice(-80),
        }
      })
      persist(tasks, state.settings)
      return { tasks }
    }),

  removeTask: (taskId) =>
    set((state) => {
      const tasks = state.tasks.filter((task) => task.id !== taskId)
      persist(tasks, state.settings)
      return { tasks }
    }),

  clearFinished: () =>
    set((state) => {
      const tasks = state.tasks.filter((task) => task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled')
      persist(tasks, state.settings)
      return { tasks }
    }),

  setRunning: (running, activeTaskId = null) => {
    set({ running, activeTaskId })
  },
}))
