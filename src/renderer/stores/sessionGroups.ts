import { create } from 'zustand'
import type { SessionGroup } from '@shared/types'
import { generateId } from '@/lib/utils'

const GROUP_COLORS = [
  '#7c6aef', '#3ecf7b', '#f0a23b', '#ef5757', '#5fa0f5',
  '#e879a8', '#45c8c8', '#c084fc', '#f97316', '#64748b',
]

function sanitizeSessionGroup(g: unknown): SessionGroup | null {
  if (!g || typeof g !== 'object') return null
  const obj = g as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return null
  return {
    id: obj.id,
    name: obj.name,
    color: typeof obj.color === 'string' ? obj.color : '#7c6aef',
    collapsed: obj.collapsed === true,
    sessionIds: Array.isArray(obj.sessionIds)
      ? obj.sessionIds.filter((x) => typeof x === 'string')
      : [],
  }
}

function persist(groups: SessionGroup[]): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('sessionGroups', groups)
}

interface SessionGroupsState {
  groups: SessionGroup[]
  _loaded: boolean
  _loadFromConfig: (raw: unknown[]) => void
  addGroup: (name: string) => string
  removeGroup: (id: string) => void
  updateGroup: (id: string, updates: Partial<Omit<SessionGroup, 'id'>>) => void
  toggleCollapse: (id: string) => void
  addSessionToGroup: (groupId: string, sessionId: string) => void
  removeSessionFromGroup: (groupId: string, sessionId: string) => void
  removeSessionFromAllGroups: (sessionId: string) => void
  reorderGroupById: (fromId: string, toId: string) => void
  reorderSessionInGroup: (groupId: string, fromSessionId: string, toSessionId: string) => void
  moveSessionToGroupAt: (sessionId: string, fromGroupId: string | null, toGroupId: string, beforeSessionId: string | null) => void
}

export const useSessionGroupsStore = create<SessionGroupsState>((set, get) => ({
  groups: [],
  _loaded: false,

  _loadFromConfig: (raw) => {
    const groups = (Array.isArray(raw) ? raw : [])
      .map(sanitizeSessionGroup)
      .filter((g): g is SessionGroup => g !== null)
    set({ groups, _loaded: true })
  },

  addGroup: (name) => {
    const id = generateId()
    const colorIndex = get().groups.length % GROUP_COLORS.length
    const newGroup: SessionGroup = {
      id,
      name,
      color: GROUP_COLORS[colorIndex],
      collapsed: false,
      sessionIds: [],
    }
    set((state) => {
      const groups = [...state.groups, newGroup]
      persist(groups)
      return { groups }
    })
    return id
  },

  removeGroup: (id) =>
    set((state) => {
      const groups = state.groups.filter((g) => g.id !== id)
      persist(groups)
      return { groups }
    }),

  updateGroup: (id, updates) =>
    set((state) => {
      const groups = state.groups.map((g) => (g.id === id ? { ...g, ...updates } : g))
      persist(groups)
      return { groups }
    }),

  toggleCollapse: (id) =>
    set((state) => {
      const groups = state.groups.map((g) =>
        g.id === id ? { ...g, collapsed: !g.collapsed } : g,
      )
      persist(groups)
      return { groups }
    }),

  addSessionToGroup: (groupId, sessionId) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (g.id !== groupId) {
          // Remove from any other group (a session belongs to at most one group)
          return { ...g, sessionIds: g.sessionIds.filter((sid) => sid !== sessionId) }
        }
        if (g.sessionIds.includes(sessionId)) return g
        return { ...g, sessionIds: [...g.sessionIds, sessionId] }
      })
      persist(groups)
      return { groups }
    }),

  removeSessionFromGroup: (groupId, sessionId) =>
    set((state) => {
      const groups = state.groups.map((g) =>
        g.id === groupId
          ? { ...g, sessionIds: g.sessionIds.filter((sid) => sid !== sessionId) }
          : g,
      )
      persist(groups)
      return { groups }
    }),

  removeSessionFromAllGroups: (sessionId) =>
    set((state) => {
      let changed = false
      const groups = state.groups.map((g) => {
        if (!g.sessionIds.includes(sessionId)) return g
        changed = true
        return { ...g, sessionIds: g.sessionIds.filter((sid) => sid !== sessionId) }
      })
      if (!changed) return state
      persist(groups)
      return { groups }
    }),

  reorderGroupById: (fromId, toId) =>
    set((state) => {
      const groups = [...state.groups]
      const fromIdx = groups.findIndex((g) => g.id === fromId)
      const toIdx = groups.findIndex((g) => g.id === toId)
      if (fromIdx === -1 || toIdx === -1) return state
      const [moved] = groups.splice(fromIdx, 1)
      groups.splice(toIdx, 0, moved)
      persist(groups)
      return { groups }
    }),

  reorderSessionInGroup: (groupId, fromSessionId, toSessionId) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (g.id !== groupId) return g
        const ids = [...g.sessionIds]
        const fromIdx = ids.indexOf(fromSessionId)
        const toIdx = ids.indexOf(toSessionId)
        if (fromIdx === -1 || toIdx === -1) return g
        const [moved] = ids.splice(fromIdx, 1)
        ids.splice(toIdx, 0, moved)
        return { ...g, sessionIds: ids }
      })
      persist(groups)
      return { groups }
    }),

  moveSessionToGroupAt: (sessionId, fromGroupId, toGroupId, beforeSessionId) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (g.id !== toGroupId) {
          // Remove from every other group so the session ends up only in the target group
          return { ...g, sessionIds: g.sessionIds.filter((sid) => sid !== sessionId) }
        }
        const ids = g.sessionIds.filter((sid) => sid !== sessionId)
        if (beforeSessionId) {
          const idx = ids.indexOf(beforeSessionId)
          if (idx !== -1) {
            ids.splice(idx, 0, sessionId)
            return { ...g, sessionIds: ids }
          }
        }
        ids.push(sessionId)
        return { ...g, sessionIds: ids }
      })
      // Avoid unused-parameter lint warning — fromGroupId is kept for API symmetry
      void fromGroupId
      persist(groups)
      return { groups }
    }),
}))
