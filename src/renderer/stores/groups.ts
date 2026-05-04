import { create } from 'zustand'
import type { Group, GroupItemOrderEntry } from '@shared/types'
import { generateId } from '@/lib/utils'

export const DEFAULT_GROUP_COLOR = '#7c6aef'

export const GROUP_COLOR_PRESETS = [
  '#7c6aef', '#8b5cf6', '#a855f7', '#c084fc',
  '#5fa0f5', '#38bdf8', '#45c8c8', '#14b8a6',
  '#3ecf7b', '#84cc16', '#facc15', '#f0a23b',
  '#f97316', '#ef5757', '#f43f5e', '#e879a8',
  '#f472b6', '#64748b', '#8e8e96', '#d4d4d8',
]

export function parseGroupColor(color: unknown): string | null {
  if (typeof color !== 'string') return null
  const value = color.trim()
  const shortHex = /^#([0-9a-f]{3})$/i.exec(value)
  if (shortHex) {
    return `#${shortHex[1].split('').map((char) => `${char}${char}`).join('')}`.toLowerCase()
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  return null
}

export function normalizeGroupColor(color: unknown): string {
  return parseGroupColor(color) ?? DEFAULT_GROUP_COLOR
}

function sanitizeGroup(g: unknown): Group | null {
  if (!g || typeof g !== 'object') return null
  const obj = g as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return null
  return {
    id: obj.id,
    name: obj.name,
    color: normalizeGroupColor(obj.color),
    collapsed: obj.collapsed === true,
    parentId: typeof obj.parentId === 'string' ? obj.parentId : null,
    childGroupIds: Array.isArray(obj.childGroupIds)
      ? uniqueStrings(obj.childGroupIds)
      : [],
    projectIds: Array.isArray(obj.projectIds)
      ? uniqueStrings(obj.projectIds)
      : [],
    itemOrder: Array.isArray(obj.itemOrder)
      ? sanitizeItemOrder(obj.itemOrder)
      : [],
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.filter((x): x is string => typeof x === 'string')))
}

function sanitizeItemOrder(values: unknown[]): GroupItemOrderEntry[] {
  const seen = new Set<string>()
  const result: GroupItemOrderEntry[] = []
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    const obj = value as Record<string, unknown>
    const type = obj.type === 'group' || obj.type === 'project' ? obj.type : null
    if (!type || typeof obj.id !== 'string') continue
    const key = `${type}:${obj.id}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ type, id: obj.id })
  }
  return result
}

function sameOrderItem(a: GroupItemOrderEntry, b: GroupItemOrderEntry): boolean {
  return a.type === b.type && a.id === b.id
}

function withoutOrderItem(items: GroupItemOrderEntry[], item: GroupItemOrderEntry): GroupItemOrderEntry[] {
  return items.filter((entry) => !sameOrderItem(entry, item))
}

function insertOrderItemBefore(
  items: GroupItemOrderEntry[],
  item: GroupItemOrderEntry,
  before: GroupItemOrderEntry | null,
): GroupItemOrderEntry[] {
  const next = withoutOrderItem(items, item)
  if (!before) return [...next, item]
  const index = next.findIndex((entry) => sameOrderItem(entry, before))
  if (index < 0) return [...next, item]
  next.splice(index, 0, item)
  return next
}

function parentCreatesCycle(groupsById: Map<string, Group>, groupId: string, parentId: string): boolean {
  let current: string | null = parentId
  const visited = new Set<string>()
  while (current) {
    if (current === groupId) return true
    if (visited.has(current)) return true
    visited.add(current)
    current = groupsById.get(current)?.parentId ?? null
  }
  return false
}

function normalizeGroupTree(groups: Group[]): Group[] {
  const ids = new Set(groups.map((group) => group.id))
  const initialById = new Map(groups.map((group) => [group.id, group]))
  const normalized = groups.map((group) => {
    const parentId = group.parentId && ids.has(group.parentId) && group.parentId !== group.id && !parentCreatesCycle(initialById, group.id, group.parentId)
      ? group.parentId
      : null
    return { ...group, parentId, childGroupIds: [], itemOrder: [] }
  })
  const byId = new Map(normalized.map((group) => [group.id, group]))

  for (const group of groups) {
    const parent = byId.get(group.id)
    if (!parent) continue
    for (const childId of group.childGroupIds) {
      const child = byId.get(childId)
      if (!child || child.parentId !== group.id || parent.childGroupIds.includes(childId)) continue
      parent.childGroupIds.push(childId)
    }
  }

  for (const group of normalized) {
    if (!group.parentId) continue
    const parent = byId.get(group.parentId)
    if (!parent || parent.childGroupIds.includes(group.id)) continue
    parent.childGroupIds.push(group.id)
  }

  return normalized.map((group) => {
    const originalOrder = initialById.get(group.id)?.itemOrder ?? []
    const childIds = new Set(group.childGroupIds)
    const projectIds = new Set(group.projectIds)
    const itemOrder = originalOrder
      .filter((entry) => entry.type === 'group' ? childIds.has(entry.id) : projectIds.has(entry.id))
    const present = new Set(itemOrder.map((entry) => `${entry.type}:${entry.id}`))

    for (const childId of group.childGroupIds) {
      const key = `group:${childId}`
      if (!present.has(key)) {
        itemOrder.push({ type: 'group', id: childId })
        present.add(key)
      }
    }
    for (const projectId of group.projectIds) {
      const key = `project:${projectId}`
      if (!present.has(key)) {
        itemOrder.push({ type: 'project', id: projectId })
        present.add(key)
      }
    }

    return { ...group, itemOrder }
  })
}

export function getDescendantGroupIds(groups: Group[], groupId: string): string[] {
  const byParent = new Map<string, string[]>()
  for (const group of groups) {
    if (!group.parentId) continue
    byParent.set(group.parentId, [...(byParent.get(group.parentId) ?? []), group.id])
  }

  const result: string[] = []
  const visit = (id: string): void => {
    for (const childId of byParent.get(id) ?? []) {
      result.push(childId)
      visit(childId)
    }
  }
  visit(groupId)
  return result
}

function persist(groups: Group[]): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('groups', groups)
}

interface GroupsState {
  groups: Group[]
  _loaded: boolean
  _loadFromConfig: (raw: unknown[]) => void
  addGroup: (name: string, parentId?: string | null) => string
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
  moveProjectToGroupBefore: (projectId: string, fromGroupId: string, toGroupId: string, before: GroupItemOrderEntry | null) => void
  moveGroupToParent: (groupId: string, parentId: string | null) => void
  moveGroupToParentAt: (groupId: string, parentId: string | null, before: GroupItemOrderEntry | null) => void
}

export const useGroupsStore = create<GroupsState>((set, get) => ({
  groups: [],
  _loaded: false,

  _loadFromConfig: (raw) => {
    const groups = (Array.isArray(raw) ? raw : [])
      .map(sanitizeGroup)
      .filter((g): g is Group => g !== null)
    set({ groups: normalizeGroupTree(groups), _loaded: true })
  },

  addGroup: (name, parentId = null) => {
    const id = generateId()
    const colorIndex = get().groups.length % GROUP_COLOR_PRESETS.length
    const safeParentId = parentId && get().groups.some((group) => group.id === parentId) ? parentId : null
    const newGroup: Group = {
      id,
      name,
      color: GROUP_COLOR_PRESETS[colorIndex],
      collapsed: false,
      parentId: safeParentId,
      childGroupIds: [],
      projectIds: [],
      itemOrder: [],
    }
    set((state) => {
      const groups = normalizeGroupTree([
        ...state.groups.map((group) => group.id === safeParentId
          ? {
            ...group,
            childGroupIds: [...group.childGroupIds, id],
            itemOrder: [...group.itemOrder, { type: 'group' as const, id }],
            collapsed: false,
          }
          : group),
        newGroup,
      ])
      persist(groups)
      return { groups }
    })
    return id
  },

  removeGroup: (id) =>
    set((state) => {
      const removed = state.groups.find((group) => group.id === id)
      if (!removed) return state
      const childIds = removed.childGroupIds ?? []
      const groups = normalizeGroupTree(state.groups
        .filter((group) => group.id !== id)
        .map((group) => {
          const childGroupIds = (group.childGroupIds ?? []).filter((childId) => childId !== id)
          if (group.id === removed.parentId) {
            childGroupIds.push(...childIds.filter((childId) => childId !== group.id && !childGroupIds.includes(childId)))
          }
          return {
            ...group,
            parentId: group.parentId === id ? removed.parentId : group.parentId,
            childGroupIds,
            itemOrder: group.itemOrder.filter((entry) => !(entry.type === 'group' && entry.id === id)),
          }
        }))
      persist(groups)
      return { groups }
    }),

  updateGroup: (id, updates) =>
    set((state) => {
      const safeUpdates = updates.color === undefined
        ? updates
        : { ...updates, color: normalizeGroupColor(updates.color) }
      const groups = normalizeGroupTree(state.groups.map((g) => (g.id === id ? { ...g, ...safeUpdates } : g)))
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
          ? {
            ...g,
            projectIds: [...(g.projectIds ?? []).filter((id) => id !== projectId), projectId],
            itemOrder: insertOrderItemBefore(g.itemOrder, { type: 'project', id: projectId }, null),
          }
          : g,
      )
      const normalized = normalizeGroupTree(groups)
      persist(normalized)
      return { groups: normalized }
    }),

  removeProjectFromGroup: (groupId, projectId) =>
    set((state) => {
      const groups = state.groups.map((g) =>
        g.id === groupId
          ? {
            ...g,
            projectIds: (g.projectIds ?? []).filter((pid) => pid !== projectId),
            itemOrder: withoutOrderItem(g.itemOrder, { type: 'project', id: projectId }),
          }
          : g,
      )
      const normalized = normalizeGroupTree(groups)
      persist(normalized)
      return { groups: normalized }
    }),

  reorderGroupById: (fromId, toId) =>
    set((state) => {
      const fromGroup = state.groups.find((g) => g.id === fromId)
      const toGroup = state.groups.find((g) => g.id === toId)
      if (!fromGroup || !toGroup || fromGroup.parentId !== toGroup.parentId) return state
      let groups = [...state.groups]
      if (fromGroup.parentId) {
        groups = groups.map((group) => {
          if (group.id !== fromGroup.parentId) return group
          const ids = [...group.childGroupIds]
          const fromIdx = ids.indexOf(fromId)
          const toIdx = ids.indexOf(toId)
          if (fromIdx === -1 || toIdx === -1) return group
          const [moved] = ids.splice(fromIdx, 1)
          ids.splice(toIdx, 0, moved)
          return {
            ...group,
            childGroupIds: ids,
            itemOrder: insertOrderItemBefore(group.itemOrder, { type: 'group', id: fromId }, { type: 'group', id: toId }),
          }
        })
      } else {
        const fromIdx = groups.findIndex((g) => g.id === fromId)
        const toIdx = groups.findIndex((g) => g.id === toId)
        if (fromIdx === -1 || toIdx === -1) return state
        const [moved] = groups.splice(fromIdx, 1)
        groups.splice(toIdx, 0, moved)
      }
      groups = normalizeGroupTree(groups)
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
        return {
          ...g,
          projectIds: ids,
          itemOrder: insertOrderItemBefore(g.itemOrder, { type: 'project', id: fromProjId }, { type: 'project', id: toProjId }),
        }
      })
      const normalized = normalizeGroupTree(groups)
      persist(normalized)
      return { groups: normalized }
    }),

  moveProjectToGroup: (projectId, fromGroupId, toGroupId) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (g.id === fromGroupId) {
          return {
            ...g,
            projectIds: (g.projectIds ?? []).filter((pid) => pid !== projectId),
            itemOrder: withoutOrderItem(g.itemOrder, { type: 'project', id: projectId }),
          }
        }
        if (g.id === toGroupId) {
          return {
            ...g,
            projectIds: [...(g.projectIds ?? []).filter((pid) => pid !== projectId), projectId],
            itemOrder: insertOrderItemBefore(g.itemOrder, { type: 'project', id: projectId }, null),
          }
        }
        return g
      })
      const normalized = normalizeGroupTree(groups)
      persist(normalized)
      return { groups: normalized }
    }),

  moveProjectToGroupAt: (projectId: string, fromGroupId: string, toGroupId: string, beforeProjId: string) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (fromGroupId === toGroupId && g.id === toGroupId) {
          const ids = [...(g.projectIds ?? []).filter((pid) => pid !== projectId)]
          const idx = ids.indexOf(beforeProjId)
          if (idx !== -1) ids.splice(idx, 0, projectId)
          else ids.push(projectId)
          return {
            ...g,
            projectIds: ids,
            itemOrder: insertOrderItemBefore(g.itemOrder, { type: 'project', id: projectId }, { type: 'project', id: beforeProjId }),
          }
        }
        if (g.id === fromGroupId) {
          return {
            ...g,
            projectIds: (g.projectIds ?? []).filter((pid) => pid !== projectId),
            itemOrder: withoutOrderItem(g.itemOrder, { type: 'project', id: projectId }),
          }
        }
        if (g.id === toGroupId) {
          const ids = [...(g.projectIds ?? []).filter((pid) => pid !== projectId)]
          const idx = ids.indexOf(beforeProjId)
          if (idx !== -1) {
            ids.splice(idx, 0, projectId)
          } else {
            ids.push(projectId)
          }
          return {
            ...g,
            projectIds: ids,
            itemOrder: insertOrderItemBefore(g.itemOrder, { type: 'project', id: projectId }, { type: 'project', id: beforeProjId }),
          }
        }
        return g
      })
      const normalized = normalizeGroupTree(groups)
      persist(normalized)
      return { groups: normalized }
    }),

  moveProjectToGroupBefore: (projectId, fromGroupId, toGroupId, before) =>
    set((state) => {
      const groups = state.groups.map((g) => {
        if (fromGroupId === toGroupId && g.id === toGroupId) {
          return {
            ...g,
            projectIds: [...(g.projectIds ?? []).filter((pid) => pid !== projectId), projectId],
            itemOrder: insertOrderItemBefore(g.itemOrder, { type: 'project', id: projectId }, before),
          }
        }
        if (g.id === fromGroupId) {
          return {
            ...g,
            projectIds: (g.projectIds ?? []).filter((pid) => pid !== projectId),
            itemOrder: withoutOrderItem(g.itemOrder, { type: 'project', id: projectId }),
          }
        }
        if (g.id === toGroupId) {
          return {
            ...g,
            projectIds: [...(g.projectIds ?? []).filter((pid) => pid !== projectId), projectId],
            itemOrder: insertOrderItemBefore(g.itemOrder, { type: 'project', id: projectId }, before),
          }
        }
        return g
      })
      const normalized = normalizeGroupTree(groups)
      persist(normalized)
      return { groups: normalized }
    }),

  moveGroupToParent: (groupId, parentId) =>
    set((state) => {
      const group = state.groups.find((item) => item.id === groupId)
      const targetParentId = parentId && state.groups.some((item) => item.id === parentId) ? parentId : null
      if (!group || group.parentId === targetParentId || group.id === targetParentId) return state
      if (targetParentId && getDescendantGroupIds(state.groups, group.id).includes(targetParentId)) return state

      const groups = normalizeGroupTree(state.groups.map((item) => {
        const childGroupIds = (item.childGroupIds ?? []).filter((childId) => childId !== groupId)
        const itemOrder = withoutOrderItem(item.itemOrder, { type: 'group', id: groupId })
        if (item.id === groupId) return { ...item, parentId: targetParentId, childGroupIds, itemOrder }
        if (item.id === targetParentId && !childGroupIds.includes(groupId)) {
          return {
            ...item,
            collapsed: false,
            childGroupIds: [...childGroupIds, groupId],
            itemOrder: insertOrderItemBefore(itemOrder, { type: 'group', id: groupId }, null),
          }
        }
        return { ...item, childGroupIds, itemOrder }
      }))
      persist(groups)
      return { groups }
    }),

  moveGroupToParentAt: (groupId, parentId, before) =>
    set((state) => {
      const group = state.groups.find((item) => item.id === groupId)
      const targetParentId = parentId && state.groups.some((item) => item.id === parentId) ? parentId : null
      if (!group || group.id === targetParentId) return state
      if (targetParentId && getDescendantGroupIds(state.groups, group.id).includes(targetParentId)) return state

      let groups = normalizeGroupTree(state.groups.map((item) => {
        const childGroupIds = (item.childGroupIds ?? []).filter((childId) => childId !== groupId)
        const itemOrder = withoutOrderItem(item.itemOrder, { type: 'group', id: groupId })
        if (item.id === groupId) return { ...item, parentId: targetParentId, childGroupIds, itemOrder }
        if (item.id === targetParentId && !childGroupIds.includes(groupId)) {
          return {
            ...item,
            collapsed: false,
            childGroupIds: [...childGroupIds, groupId],
            itemOrder: insertOrderItemBefore(itemOrder, { type: 'group', id: groupId }, before),
          }
        }
        return { ...item, childGroupIds, itemOrder }
      }))
      if (!targetParentId) {
        const fromIndex = groups.findIndex((item) => item.id === groupId)
        if (fromIndex >= 0) {
          const [moved] = groups.splice(fromIndex, 1)
          const toIndex = before?.type === 'group'
            ? groups.findIndex((item) => item.id === before.id)
            : -1
          groups.splice(toIndex >= 0 ? toIndex : groups.length, 0, moved)
        }
      }
      persist(groups)
      return { groups }
    }),
}))
