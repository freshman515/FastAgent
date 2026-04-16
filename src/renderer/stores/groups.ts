import { create } from 'zustand'
import type { Group } from '@shared/types'
import { generateId } from '@/lib/utils'

const GROUP_COLORS = [
  '#7c6aef', '#3ecf7b', '#f0a23b', '#ef5757', '#5fa0f5',
  '#e879a8', '#45c8c8', '#c084fc', '#f97316', '#64748b',
]

function sanitizeGroup(g: unknown): Group | null {
  if (!g || typeof g !== 'object') return null
  const obj = g as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return null
  return {
    id: obj.id,
    name: obj.name,
    color: typeof obj.color === 'string' ? obj.color : '#7c6aef',
    collapsed: obj.collapsed === true,
    projectIds: Array.isArray(obj.projectIds)
      ? obj.projectIds.filter((x) => typeof x === 'string')
      : [],
  }
}

function persist(groups: Group[]): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('groups', groups)
}

interface GroupsState {
  groups: Group[]
  _loaded: boolean
  _loadFromConfig: (raw: unknown[]) => void
  addGroup: (name: string) => string
  removeGroup: (id: string) => void
  updateGroup: (id: string, updates: Partial<Omit<Group, 'id'>>) => void
  reorderGroups: (fromIndex: number, toIndex: number) => void
  toggleCollapse: (id: string) => void
  addProjectToGroup: (groupId: string, projectId: string) => void
  removeProjectFromGroup: (groupId: string, projectId: string) => void
  reorderGroupById: (fromId: string, toId: string) => void
  reorderProjectInGroup: (groupId: string, fromProjId: string, toProjId: string) => void
  moveProjectToGroup: (projectId: string, fromGroupId: string, toGroupId: string) => void
  moveProjectToGroupAt: (projectId: string, fromGroupId: string, toGroupId: string, beforeProjId: string) => void
}

export const useGroupsStore = create<GroupsState>((set, get) => ({
  groups: [],
  _loaded: false,

  _loadFromConfig: (raw) => {
    const groups = (Array.isArray(raw) ? raw : [])
      .map(sanitizeGroup)
      .filter((g): g is Group => g !== null)
    set({ groups, _loaded: true })
  },

  addGroup: (name) => {
    const id = generateId()
    const colorIndex = get().groups.length % GROUP_COLORS.length
    const newGroup: Group = {
      id,
      name,
      color: GROUP_COLORS[colorIndex],
      collapsed: false,
      projectIds: [],
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

  reorderGroups: (fromIndex, toIndex) =>
    set((state) => {
      const groups = [...state.groups]
      const [moved] = groups.splice(fromIndex, 1)
      groups.splice(toIndex, 0, moved)
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

  addProjectToGroup: (groupId, projectId) =>
    set((state) => {
      const groups = state.groups.map((g) =>
        g.id === groupId
          ? { ...g, projectIds: [...(g.projectIds ?? []), projectId] }
          : g,
      )
      persist(groups)
      return { groups }
    }),

  removeProjectFromGroup: (groupId, projectId) =>
    set((state) => {
      const groups = state.groups.map((g) =>
        g.id === groupId
          ? { ...g, projectIds: (g.projectIds ?? []).filter((pid) => pid !== projectId) }
          : g,
      )
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

  reorderProjectInGroup: (groupId, fromProjId, toProjId) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (g.id !== groupId) return g
        const ids = [...(g.projectIds ?? [])]
        const fromIdx = ids.indexOf(fromProjId)
        const toIdx = ids.indexOf(toProjId)
        if (fromIdx === -1 || toIdx === -1) return g
        const [moved] = ids.splice(fromIdx, 1)
        ids.splice(toIdx, 0, moved)
        return { ...g, projectIds: ids }
      })
      persist(groups)
      return { groups }
    }),

  moveProjectToGroup: (projectId, fromGroupId, toGroupId) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (g.id === fromGroupId) return { ...g, projectIds: (g.projectIds ?? []).filter((pid) => pid !== projectId) }
        if (g.id === toGroupId) return { ...g, projectIds: [...(g.projectIds ?? []), projectId] }
        return g
      })
      persist(groups)
      return { groups }
    }),

  moveProjectToGroupAt: (projectId: string, fromGroupId: string, toGroupId: string, beforeProjId: string) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (g.id === fromGroupId) {
          return { ...g, projectIds: (g.projectIds ?? []).filter((pid) => pid !== projectId) }
        }
        if (g.id === toGroupId) {
          const ids = [...(g.projectIds ?? []).filter((pid) => pid !== projectId)]
          const idx = ids.indexOf(beforeProjId)
          if (idx !== -1) {
            ids.splice(idx, 0, projectId)
          } else {
            ids.push(projectId)
          }
          return { ...g, projectIds: ids }
        }
        return g
      })
      persist(groups)
      return { groups }
    }),
}))
