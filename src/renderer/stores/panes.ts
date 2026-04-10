import { create } from 'zustand'
import { generateId } from '@/lib/utils'

// ─── Split Tree Data Model ───

export interface PaneLeaf {
  type: 'leaf'
  id: string
}

export interface PaneSplit {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  ratio: number // 0~1, first child gets this ratio
  first: PaneNode
  second: PaneNode
}

export type PaneNode = PaneLeaf | PaneSplit

export type SplitPosition = 'left' | 'right' | 'up' | 'down'

// ─── Store ───

interface PanesState {
  root: PaneNode
  activePaneId: string

  // paneId → ordered session IDs in that pane
  paneSessions: Record<string, string[]>
  // paneId → active session ID in that pane
  paneActiveSession: Record<string, string | null>

  // Per-project layout cache: projectId → saved layout
  projectLayouts: Record<string, { root: PaneNode; activePaneId: string; paneSessions: Record<string, string[]>; paneActiveSession: Record<string, string | null> }>
  currentProjectId: string | null

  // Actions
  switchProject: (projectId: string, projectSessionIds: string[], activeSessionId: string | null) => void
  switchWorktree: (worktreeId: string, worktreeSessionIds: string[], activeSessionId: string | null) => void
  initPane: (sessionIds: string[], activeSessionId: string | null) => void
  loadFromConfig: (raw: Record<string, unknown>) => void
  splitPane: (paneId: string, position: SplitPosition, sessionId: string) => void
  closePane: (paneId: string) => void
  setActivePaneId: (paneId: string) => void
  setPaneActiveSession: (paneId: string, sessionId: string | null) => void
  addSessionToPane: (paneId: string, sessionId: string) => void
  removeSessionFromPane: (paneId: string, sessionId: string) => void
  moveSession: (fromPaneId: string, toPaneId: string, sessionId: string) => void
  resizeSplit: (splitId: string, ratio: number) => void
  reorderPaneSessions: (paneId: string, fromId: string, toId: string) => void
  findPaneForSession: (sessionId: string) => string | null
  getPaneIdForActiveSession: () => string
}

const DEFAULT_PANE_ID = 'pane-root'

function findNode(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root
  if (root.type === 'split') {
    return findNode(root.first, id) || findNode(root.second, id)
  }
  return null
}

function findParent(root: PaneNode, id: string): { parent: PaneSplit; which: 'first' | 'second' } | null {
  if (root.type !== 'split') return null
  if (root.first.id === id) return { parent: root, which: 'first' }
  if (root.second.id === id) return { parent: root, which: 'second' }
  return findParent(root.first, id) || findParent(root.second, id)
}

function replaceNode(root: PaneNode, id: string, replacement: PaneNode): PaneNode {
  if (root.id === id) return replacement
  if (root.type === 'split') {
    return {
      ...root,
      first: replaceNode(root.first, id, replacement),
      second: replaceNode(root.second, id, replacement),
    }
  }
  return root
}

function getSibling(parent: PaneSplit, which: 'first' | 'second'): PaneNode {
  return which === 'first' ? parent.second : parent.first
}

function getAllLeafIds(node: PaneNode): string[] {
  if (node.type === 'leaf') return [node.id]
  return [...getAllLeafIds(node.first), ...getAllLeafIds(node.second)]
}

function getFirstLeafId(node: PaneNode): string {
  if (node.type === 'leaf') return node.id
  return getFirstLeafId(node.first)
}

function getLastLeafId(node: PaneNode): string {
  if (node.type === 'leaf') return node.id
  return getLastLeafId(node.second)
}

// Registry of pane DOM elements for screen-position-based navigation
const paneElements = new Map<string, HTMLElement>()

export function registerPaneElement(paneId: string, el: HTMLElement | null): void {
  if (el) paneElements.set(paneId, el)
  else paneElements.delete(paneId)
}

// Find closest pane in the given direction based on screen rectangles
function findClosestPaneByRect(currentId: string, direction: 'left' | 'right' | 'up' | 'down'): string | null {
  const currentEl = paneElements.get(currentId)
  if (!currentEl) return null
  const cur = currentEl.getBoundingClientRect()
  const curCx = cur.left + cur.width / 2
  const curCy = cur.top + cur.height / 2

  let bestId: string | null = null
  let bestDist = Infinity

  for (const [id, el] of paneElements) {
    if (id === currentId) continue
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2

    // Check if candidate is in the correct direction
    let valid = false
    if (direction === 'left' && cx < curCx) valid = true
    if (direction === 'right' && cx > curCx) valid = true
    if (direction === 'up' && cy < curCy) valid = true
    if (direction === 'down' && cy > curCy) valid = true
    if (!valid) continue

    // Distance: primary axis + small cross-axis penalty
    let dist: number
    if (direction === 'left' || direction === 'right') {
      dist = Math.abs(cx - curCx) + Math.abs(cy - curCy) * 0.3
    } else {
      dist = Math.abs(cy - curCy) + Math.abs(cx - curCx) * 0.3
    }

    if (dist < bestDist) {
      bestDist = dist
      bestId = id
    }
  }

  return bestId
}

function persistPanes(state: PanesState): void {
  window.api.config.write('panes', {
    root: state.root,
    activePaneId: state.activePaneId,
    paneSessions: state.paneSessions,
    paneActiveSession: state.paneActiveSession,
    currentProjectId: state.currentProjectId,
    projectLayouts: state.projectLayouts,
  })
}

export const usePanesStore = create<PanesState>((set, get) => ({
  root: { type: 'leaf', id: DEFAULT_PANE_ID } as PaneNode,
  activePaneId: DEFAULT_PANE_ID,
  paneSessions: { [DEFAULT_PANE_ID]: [] },
  paneActiveSession: { [DEFAULT_PANE_ID]: null },
  projectLayouts: {},
  currentProjectId: null,

  initPane: (sessionIds, activeSessionId) => {
    set({
      root: { type: 'leaf', id: DEFAULT_PANE_ID },
      activePaneId: DEFAULT_PANE_ID,
      paneSessions: { [DEFAULT_PANE_ID]: sessionIds },
      paneActiveSession: { [DEFAULT_PANE_ID]: activeSessionId },
    })
  },

  switchProject: (projectId, projectSessionIds, activeSessionId) => {
    const state = get()

    // Save current project's layout (immutable copy)
    const updatedLayouts = { ...state.projectLayouts }
    if (state.currentProjectId) {
      updatedLayouts[state.currentProjectId] = {
        root: state.root,
        activePaneId: state.activePaneId,
        paneSessions: { ...state.paneSessions },
        paneActiveSession: { ...state.paneActiveSession },
      }
    }

    // Restore target project's layout if cached
    const saved = updatedLayouts[projectId]
    if (saved) {
      const allSaved = Object.values(saved.paneSessions).flat()
      const allValid = allSaved.every((sid) => projectSessionIds.includes(sid))
      if (allValid && allSaved.length > 0) {
        set({
          root: saved.root,
          activePaneId: saved.activePaneId,
          paneSessions: saved.paneSessions,
          paneActiveSession: saved.paneActiveSession,
          currentProjectId: projectId,
          projectLayouts: updatedLayouts,
        })
        return
      }
    }

    // No saved layout — init fresh
    set({
      root: { type: 'leaf', id: DEFAULT_PANE_ID },
      activePaneId: DEFAULT_PANE_ID,
      paneSessions: { [DEFAULT_PANE_ID]: projectSessionIds },
      paneActiveSession: { [DEFAULT_PANE_ID]: activeSessionId },
      currentProjectId: projectId,
      projectLayouts: updatedLayouts,
    })
  },

  switchWorktree: (worktreeId, worktreeSessionIds, activeSessionId) => {
    const state = get()

    // Save current layout keyed by current context (immutable copy)
    const updatedLayouts = { ...state.projectLayouts }
    const currentKey = state.currentProjectId
    if (currentKey) {
      updatedLayouts[currentKey] = {
        root: state.root,
        activePaneId: state.activePaneId,
        paneSessions: { ...state.paneSessions },
        paneActiveSession: { ...state.paneActiveSession },
      }
    }

    // Restore worktree's saved layout if cached
    const saved = updatedLayouts[worktreeId]
    if (saved) {
      // Filter out sessions that no longer exist, keep ones that do
      const validSessionSet = new Set(worktreeSessionIds)
      const cleanedPaneSessions: Record<string, string[]> = {}
      const cleanedPaneActive: Record<string, string | null> = {}
      let hasAnySessions = false

      for (const [paneId, sids] of Object.entries(saved.paneSessions)) {
        const valid = sids.filter((sid) => validSessionSet.has(sid))
        cleanedPaneSessions[paneId] = valid
        cleanedPaneActive[paneId] = valid.includes(saved.paneActiveSession[paneId] ?? '')
          ? saved.paneActiveSession[paneId]
          : (valid[0] ?? null)
        if (valid.length > 0) hasAnySessions = true
      }

      // Add any new sessions (created since layout was cached) to the first pane
      const allCached = Object.values(cleanedPaneSessions).flat()
      const cachedSet = new Set(allCached)
      const newSessions = worktreeSessionIds.filter((sid) => !cachedSet.has(sid))
      if (newSessions.length > 0) {
        const firstPaneId = getFirstLeafId(saved.root)
        const pane = cleanedPaneSessions[firstPaneId] ?? []
        cleanedPaneSessions[firstPaneId] = [...pane, ...newSessions]
        if (!cleanedPaneActive[firstPaneId]) {
          cleanedPaneActive[firstPaneId] = newSessions[0]
        }
        hasAnySessions = true
      }

      if (hasAnySessions) {
        set({
          root: saved.root,
          activePaneId: saved.activePaneId,
          paneSessions: cleanedPaneSessions,
          paneActiveSession: cleanedPaneActive,
          currentProjectId: worktreeId,
          projectLayouts: updatedLayouts,
        })
        return
      }
    }

    // No saved layout — init fresh
    set({
      root: { type: 'leaf', id: DEFAULT_PANE_ID },
      activePaneId: DEFAULT_PANE_ID,
      paneSessions: { [DEFAULT_PANE_ID]: worktreeSessionIds },
      paneActiveSession: { [DEFAULT_PANE_ID]: activeSessionId },
      currentProjectId: worktreeId,
      projectLayouts: updatedLayouts,
    })
  },

  loadFromConfig: (raw: Record<string, unknown>) => {
    if (!raw || typeof raw !== 'object') return
    if (raw.root && raw.paneSessions) {
      set({
        root: raw.root as PaneNode,
        activePaneId: (raw.activePaneId as string) ?? DEFAULT_PANE_ID,
        paneSessions: raw.paneSessions as Record<string, string[]>,
        paneActiveSession: (raw.paneActiveSession as Record<string, string | null>) ?? {},
        currentProjectId: (raw.currentProjectId as string) ?? null,
        projectLayouts: (raw.projectLayouts ?? {}) as PanesState['projectLayouts'],
      })
    }
  },

  splitPane: (paneId, position, sessionId) => {
    const state = get()
    const node = findNode(state.root, paneId)
    if (!node || node.type !== 'leaf') return

    const newPaneId = `pane-${generateId()}`
    const direction: 'horizontal' | 'vertical' =
      position === 'left' || position === 'right' ? 'horizontal' : 'vertical'
    const isFirst = position === 'left' || position === 'up'

    // Remove session from old pane
    const oldSessions = (state.paneSessions[paneId] ?? []).filter((id) => id !== sessionId)
    const newSessions = [sessionId]

    const oldLeaf: PaneLeaf = { type: 'leaf', id: paneId }
    const newLeaf: PaneLeaf = { type: 'leaf', id: newPaneId }

    const splitNode: PaneSplit = {
      type: 'split',
      id: `split-${generateId()}`,
      direction,
      ratio: 0.5,
      first: isFirst ? newLeaf : oldLeaf,
      second: isFirst ? oldLeaf : newLeaf,
    }

    const newRoot = replaceNode(state.root, paneId, splitNode)

    // Update old pane's active session if it was the moved one
    const oldActive = state.paneActiveSession[paneId]
    const newOldActive = oldActive === sessionId
      ? (oldSessions[0] ?? null)
      : oldActive

    set({
      root: newRoot,
      activePaneId: newPaneId,
      paneSessions: {
        ...state.paneSessions,
        [paneId]: oldSessions,
        [newPaneId]: newSessions,
      },
      paneActiveSession: {
        ...state.paneActiveSession,
        [paneId]: newOldActive,
        [newPaneId]: sessionId,
      },
    })
  },

  closePane: (paneId) => {
    const state = get()
    const result = findParent(state.root, paneId)
    if (!result) {
      // It's the root pane, can't close
      return
    }

    const { parent, which } = result
    const sibling = getSibling(parent, which)

    // Replace parent split with sibling
    const newRoot = replaceNode(state.root, parent.id, sibling)

    // Clean up closed pane data
    const { [paneId]: _, ...restSessions } = state.paneSessions
    const { [paneId]: __, ...restActive } = state.paneActiveSession

    // If the active pane was closed, switch to sibling's first leaf
    let newActivePaneId = state.activePaneId
    if (state.activePaneId === paneId) {
      newActivePaneId = getFirstLeafId(sibling)
    }

    set({
      root: newRoot,
      activePaneId: newActivePaneId,
      paneSessions: restSessions,
      paneActiveSession: restActive,
    })
  },

  setActivePaneId: (paneId) => set({ activePaneId: paneId }),

  setPaneActiveSession: (paneId, sessionId) =>
    set((state) => ({
      paneActiveSession: { ...state.paneActiveSession, [paneId]: sessionId },
    })),

  addSessionToPane: (paneId, sessionId) =>
    set((state) => {
      const sessions = state.paneSessions[paneId] ?? []
      if (sessions.includes(sessionId)) return state
      return {
        paneSessions: { ...state.paneSessions, [paneId]: [...sessions, sessionId] },
        paneActiveSession: { ...state.paneActiveSession, [paneId]: sessionId },
      }
    }),

  removeSessionFromPane: (paneId, sessionId) => {
    const state = get()
    const sessions = (state.paneSessions[paneId] ?? []).filter((id) => id !== sessionId)
    const active = state.paneActiveSession[paneId]
    const newActive = active === sessionId ? (sessions[0] ?? null) : active
    set({
      paneSessions: { ...state.paneSessions, [paneId]: sessions },
      paneActiveSession: { ...state.paneActiveSession, [paneId]: newActive },
    })
    // Auto-close empty pane (if not the only pane)
    if (sessions.length === 0) {
      const current = get()
      if (current.root.type === 'split') {
        get().closePane(paneId)
      }
    }
  },

  moveSession: (fromPaneId, toPaneId, sessionId) => {
    const state = get()
    const fromSessions = (state.paneSessions[fromPaneId] ?? []).filter((id) => id !== sessionId)
    const toSessions = [...(state.paneSessions[toPaneId] ?? []), sessionId]

    const fromActive = state.paneActiveSession[fromPaneId]
    const newFromActive = fromActive === sessionId ? (fromSessions[0] ?? null) : fromActive

    set({
      paneSessions: {
        ...state.paneSessions,
        [fromPaneId]: fromSessions,
        [toPaneId]: toSessions,
      },
      paneActiveSession: {
        ...state.paneActiveSession,
        [fromPaneId]: newFromActive,
        [toPaneId]: sessionId,
      },
      activePaneId: toPaneId,
    })

    // Auto-close empty pane
    if (fromSessions.length === 0) {
      get().closePane(fromPaneId)
    }
  },

  resizeSplit: (splitId, ratio) =>
    set((state) => {
      const clamped = Math.max(0.15, Math.min(0.85, ratio))
      const update = (node: PaneNode): PaneNode => {
        if (node.id === splitId && node.type === 'split') {
          return { ...node, ratio: clamped }
        }
        if (node.type === 'split') {
          return { ...node, first: update(node.first), second: update(node.second) }
        }
        return node
      }
      return { root: update(state.root) }
    }),

  reorderPaneSessions: (paneId, fromId, toId) =>
    set((state) => {
      const sessions = [...(state.paneSessions[paneId] ?? [])]
      const fromIdx = sessions.indexOf(fromId)
      const toIdx = sessions.indexOf(toId)
      if (fromIdx === -1 || toIdx === -1) return state
      const [moved] = sessions.splice(fromIdx, 1)
      sessions.splice(toIdx, 0, moved)
      return { paneSessions: { ...state.paneSessions, [paneId]: sessions } }
    }),

  findPaneForSession: (sessionId) => {
    const state = get()
    for (const [paneId, sessions] of Object.entries(state.paneSessions)) {
      if (sessions.includes(sessionId)) return paneId
    }
    return null
  },

  getPaneIdForActiveSession: () => get().activePaneId,

  navigatePane: (direction: 'left' | 'right' | 'up' | 'down') => {
    const target = findClosestPaneByRect(get().activePaneId, direction)
    if (target) set({ activePaneId: target })
  },

  // Merge all sessions from paneId into the adjacent pane, then close
  mergePane: (paneId: string) => {
    const state = get()
    const result = findParent(state.root, paneId)
    if (!result) return // root pane, can't merge
    const { parent, which } = result
    const siblingNode = getSibling(parent, which)
    const siblingLeafId = getFirstLeafId(siblingNode)
    const sessionsToMove = state.paneSessions[paneId] ?? []
    // Move all sessions to sibling
    const sibSessions = [...(state.paneSessions[siblingLeafId] ?? []), ...sessionsToMove]
    set({
      paneSessions: { ...state.paneSessions, [siblingLeafId]: sibSessions, [paneId]: [] },
      paneActiveSession: {
        ...state.paneActiveSession,
        [siblingLeafId]: sessionsToMove[0] ?? state.paneActiveSession[siblingLeafId],
      },
    })
    get().closePane(paneId)
  },
}))

// Auto-persist on state change (debounced)
let persistTimer: ReturnType<typeof setTimeout> | null = null
usePanesStore.subscribe((state) => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistPanes(state)
  }, 500)
})
