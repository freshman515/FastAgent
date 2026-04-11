import { create } from 'zustand'
import type { Session, SessionType, SessionStatus, OutputState } from '@shared/types'
import { SESSION_TYPE_CONFIG, isClaudeCodeType } from '@shared/types'
import { generateId } from '@/lib/utils'

const RUNTIME_ONLY_SESSION_FIELDS = new Set<keyof Omit<Session, 'id'>>([
  'ptyId',
  'status',
  'updatedAt',
])

function sanitizeSession(s: unknown): Session | null {
  if (!s || typeof s !== 'object') return null
  const obj = s as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.projectId !== 'string') return null
  return {
    id: obj.id,
    projectId: obj.projectId,
    type: (['claude-code', 'claude-code-yolo', 'codex', 'codex-yolo', 'opencode', 'terminal'].includes(obj.type as string)
      ? obj.type
      : 'terminal') as SessionType,
    name: typeof obj.name === 'string' ? obj.name : 'Session',
    status: 'stopped' as SessionStatus,
    ptyId: null,
    initialized: obj.initialized === true,
    resumeUUID: typeof obj.resumeUUID === 'string' ? obj.resumeUUID : null,
    pinned: obj.pinned === true,
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
    updatedAt: Date.now(),
    worktreeId: typeof obj.worktreeId === 'string' ? obj.worktreeId : undefined,
    color: typeof obj.color === 'string' ? obj.color : undefined,
    label: typeof obj.label === 'string' ? obj.label : undefined,
  }
}

function persist(sessions: Session[]): void {
  // Don't persist from detached windows — they have incomplete session lists
  if (window.api.detach.isDetached) return
  const toSave = sessions.map((s) => ({ ...s, status: 'stopped', ptyId: null }))
  window.api.config.write('sessions', toSave)
}

interface SessionsState {
  sessions: Session[]
  activeSessionId: string | null
  splitSessionId: string | null // second pane in split view
  splitDirection: 'horizontal' | 'vertical'
  outputStates: Record<string, OutputState>
  closedStack: Session[]
  _loaded: boolean
  _loadFromConfig: (raw: unknown[]) => void
  upsertSessions: (sessions: Session[]) => void

  addSession: (projectId: string, type: SessionType, worktreeId?: string) => string
  addSessionFromTemplate: (projectId: string, item: { type: SessionType; name: string; prompt?: string }, worktreeId?: string) => string
  removeSession: (id: string) => void
  restoreLastClosed: () => void
  setSplit: (id: string | null) => void
  toggleSplitDirection: () => void
  setActive: (id: string | null) => void
  updateSession: (id: string, updates: Partial<Omit<Session, 'id'>>) => void
  updateStatus: (id: string, status: SessionStatus) => void

  reorderSessions: (fromId: string, toId: string) => void
  setOutputState: (id: string, state: OutputState) => void
  markAsRead: (id: string) => void
  clearOutputState: (id: string) => void
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  splitSessionId: null,
  splitDirection: 'horizontal',
  outputStates: {},
  closedStack: [],
  _loaded: false,

  _loadFromConfig: (raw) => {
    const sessions = (Array.isArray(raw) ? raw : [])
      .map(sanitizeSession)
      .filter((s): s is Session => s !== null)
    // Auto-activate the first session on startup
    const activeSessionId = sessions.length > 0 ? sessions[0].id : null
    set({ sessions, activeSessionId, _loaded: true })
  },

  upsertSessions: (incomingSessions) =>
    set((state) => {
      if (incomingSessions.length === 0) return state
      const byId = new Map(state.sessions.map((session) => [session.id, session]))
      for (const session of incomingSessions) {
        byId.set(session.id, session)
      }
      const sessions = Array.from(byId.values())
      persist(sessions)
      return {
        sessions,
        activeSessionId: state.activeSessionId ?? incomingSessions[0]?.id ?? null,
      }
    }),

  addSession: (projectId, type, worktreeId) => {
    const id = generateId()
    const config = SESSION_TYPE_CONFIG[type]
    const existing = get().sessions.filter((s) => s.projectId === projectId && s.type === type)
    let maxNum = 0
    for (const s of existing) {
      const match = s.name.match(new RegExp(`^${config.label}\\s+(\\d+)$`))
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10))
    }
    const name = `${config.label} ${maxNum + 1}`

    const session: Session = {
      id,
      projectId,
      type,
      name,
      status: 'stopped',
      ptyId: null,
      initialized: false,
      resumeUUID: null,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      worktreeId,
    }

    set((state) => {
      const sessions = [...state.sessions, session]
      persist(sessions)
      return { sessions, activeSessionId: id }
    })
    return id
  },

  addSessionFromTemplate: (projectId, item, worktreeId) => {
    const id = generateId()
    const session: Session = {
      id,
      projectId,
      type: item.type,
      name: item.name,
      status: 'stopped',
      ptyId: null,
      initialized: false,
      resumeUUID: null,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      worktreeId,
    }
    set((state) => {
      const sessions = [...state.sessions, session]
      persist(sessions)
      return { sessions, activeSessionId: id }
    })
    return id
  },

  removeSession: (id) =>
    set((state) => {
      const target = state.sessions.find((s) => s.id === id)
      if (target?.pinned) return state // cannot close pinned
      const idx = state.sessions.findIndex((s) => s.id === id)
      const removed = target
      const sessions = state.sessions.filter((s) => s.id !== id)
      persist(sessions)
      const { [id]: _, ...outputStates } = state.outputStates

      let nextActiveId = state.activeSessionId
      if (state.activeSessionId === id) {
        const next = sessions[idx] ?? sessions[idx - 1] ?? null
        nextActiveId = next?.id ?? null
      }

      // Push to closed stack (max 20)
      const closedStack = removed
        ? [{ ...removed, status: 'stopped' as SessionStatus, ptyId: null }, ...state.closedStack].slice(0, 20)
        : state.closedStack

      return { sessions, outputStates, activeSessionId: nextActiveId, closedStack }
    }),

  restoreLastClosed: () =>
    set((state) => {
      if (state.closedStack.length === 0) return state
      const [restored, ...rest] = state.closedStack
      const session: Session = {
        ...restored,
        id: generateId(), // new id to avoid conflicts
        status: 'stopped',
        ptyId: null,
        initialized: isClaudeCodeType(restored.type) ? restored.initialized : false,
      }
      const sessions = [...state.sessions, session]
      persist(sessions)
      return { sessions, closedStack: rest, activeSessionId: session.id }
    }),

  setActive: (id) => set({ activeSessionId: id }),

  setSplit: (id) => set({ splitSessionId: id }),

  toggleSplitDirection: () => set((s) => ({
    splitDirection: s.splitDirection === 'horizontal' ? 'vertical' : 'horizontal',
  })),

  updateSession: (id, updates) =>
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s,
      )
      // Persist any non-runtime field change (name, initialized, worktreeId, color, label, etc).
      const hasPersistedField = Object.keys(updates).some((key) =>
        !RUNTIME_ONLY_SESSION_FIELDS.has(key as keyof Omit<Session, 'id'>),
      )
      if (hasPersistedField) {
        persist(sessions)
      }
      return { sessions }
    }),

  updateStatus: (id, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status, updatedAt: Date.now() } : s,
      ),
    })),

  reorderSessions: (fromId, toId) =>
    set((state) => {
      const sessions = [...state.sessions]
      const fromIdx = sessions.findIndex((s) => s.id === fromId)
      const toIdx = sessions.findIndex((s) => s.id === toId)
      if (fromIdx === -1 || toIdx === -1) return state
      const [moved] = sessions.splice(fromIdx, 1)
      sessions.splice(toIdx, 0, moved)
      persist(sessions)
      return { sessions }
    }),

  setOutputState: (id, outputState) =>
    set((state) => ({
      outputStates: { ...state.outputStates, [id]: outputState },
    })),

  markAsRead: (id) =>
    set((state) => {
      if (state.outputStates[id] !== 'unread') return state
      return { outputStates: { ...state.outputStates, [id]: 'idle' } }
    }),

  clearOutputState: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.outputStates
      return { outputStates: rest }
    }),
}))
