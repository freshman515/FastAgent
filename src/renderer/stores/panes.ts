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

export type WorkspaceMode = 'project' | 'sessions'

export const SESSIONS_LAYOUT_KEY = '__sessions__'

interface StoredPaneLayout {
  root: PaneNode
  activePaneId: string
  paneSessions: Record<string, string[]>
  paneActiveSession: Record<string, string | null>
  paneRecentSessions?: Record<string, string[]>
  fullscreenPaneId: string | null
}

// ─── Store ───

interface PanesState {
  root: PaneNode
  activePaneId: string
  fullscreenPaneId: string | null
  splitResizeActive: boolean

  // paneId → ordered session IDs in that pane
  paneSessions: Record<string, string[]>
  // paneId → active session ID in that pane
  paneActiveSession: Record<string, string | null>
  // paneId → recently activated session IDs, most recent first
  paneRecentSessions: Record<string, string[]>

  // Per-project layout cache: projectId → saved layout (SESSIONS_LAYOUT_KEY for sessions mode)
  projectLayouts: Record<string, StoredPaneLayout>
  currentProjectId: string | null

  // 'project' = pane layout scoped to a project/worktree (classic behavior).
  // 'sessions' = free-form layout where panes can host sessions from any project.
  workspaceMode: WorkspaceMode

  // Actions
  switchProject: (projectId: string, projectSessionIds: string[], activeSessionId: string | null) => void
  switchWorktree: (worktreeId: string, worktreeSessionIds: string[], activeSessionId: string | null) => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
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
  beginSplitResize: () => void
  endSplitResize: () => void
  reorderPaneSessions: (paneId: string, fromId: string, toId: string) => void
  findPaneForSession: (sessionId: string) => string | null
  getPaneIdForActiveSession: () => string
  navigatePane: (direction: 'left' | 'right' | 'up' | 'down') => void
  mergeAllPanes: () => void
  mergePane: (paneId: string) => void
  togglePaneFullscreen: (paneId?: string) => void
  exitPaneFullscreen: () => void
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

export function getPaneLeafIds(node: PaneNode): string[] {
  return getAllLeafIds(node)
}

function getFirstLeafId(node: PaneNode): string {
  if (node.type === 'leaf') return node.id
  return getFirstLeafId(node.first)
}

function getLastLeafId(node: PaneNode): string {
  if (node.type === 'leaf') return node.id
  return getLastLeafId(node.second)
}

function hasLeaf(node: PaneNode, paneId: string): boolean {
  if (node.type === 'leaf') return node.id === paneId
  return hasLeaf(node.first, paneId) || hasLeaf(node.second, paneId)
}

function sanitizeFullscreenPaneId(
  root: PaneNode,
  paneSessions: Record<string, string[]>,
  paneId: unknown,
): string | null {
  if (typeof paneId !== 'string' || !hasLeaf(root, paneId)) return null
  const targetSessions = paneSessions[paneId] ?? []
  const hasAnySessions = Object.values(paneSessions).some((sessions) => sessions.length > 0)
  if (hasAnySessions && targetSessions.length === 0) return null
  return paneId
}

function buildPaneRecentSessions(
  sessionIds: string[],
  activeSessionId: string | null,
  existingRecent: string[] = [],
): string[] {
  const validIds = new Set(sessionIds)
  const seen = new Set<string>()
  const recent: string[] = []
  const activeId = activeSessionId && validIds.has(activeSessionId) ? activeSessionId : null

  if (activeId) {
    recent.push(activeId)
    seen.add(activeId)
  }

  for (const id of existingRecent) {
    if (!validIds.has(id) || seen.has(id)) continue
    recent.push(id)
    seen.add(id)
  }

  for (const id of sessionIds) {
    if (seen.has(id)) continue
    recent.push(id)
    seen.add(id)
  }

  return recent
}

function seedPaneRecentSessions(
  paneSessions: Record<string, string[]>,
  paneActiveSession: Record<string, string | null>,
  existingRecentSessions?: Record<string, string[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(paneSessions).map(([paneId, sessionIds]) => [
      paneId,
      buildPaneRecentSessions(
        sessionIds,
        paneActiveSession[paneId] ?? null,
        existingRecentSessions?.[paneId] ?? [],
      ),
    ]),
  )
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
  // Don't persist from detached windows — they have incomplete state
  if (window.api.detach.isDetached) return
  window.api.config.write('panes', {
    root: state.root,
    activePaneId: state.activePaneId,
    fullscreenPaneId: state.fullscreenPaneId,
    paneSessions: state.paneSessions,
    paneActiveSession: state.paneActiveSession,
    paneRecentSessions: state.paneRecentSessions,
    currentProjectId: state.currentProjectId,
    projectLayouts: state.projectLayouts,
    workspaceMode: state.workspaceMode,
  })
}

export const usePanesStore = create<PanesState>((set, get) => ({
  root: { type: 'leaf', id: DEFAULT_PANE_ID } as PaneNode,
  activePaneId: DEFAULT_PANE_ID,
  fullscreenPaneId: null,
  splitResizeActive: false,
  paneSessions: { [DEFAULT_PANE_ID]: [] },
  paneActiveSession: { [DEFAULT_PANE_ID]: null },
  paneRecentSessions: { [DEFAULT_PANE_ID]: [] },
  projectLayouts: {},
  currentProjectId: null,
  workspaceMode: 'project',

  initPane: (sessionIds, activeSessionId) => {
    const paneSessions = { [DEFAULT_PANE_ID]: sessionIds }
    const paneActiveSession = { [DEFAULT_PANE_ID]: activeSessionId }
    set({
      root: { type: 'leaf', id: DEFAULT_PANE_ID },
      activePaneId: DEFAULT_PANE_ID,
      fullscreenPaneId: null,
      paneSessions,
      paneActiveSession,
      paneRecentSessions: seedPaneRecentSessions(paneSessions, paneActiveSession),
    })
  },

  setWorkspaceMode: (mode) => {
    const state = get()
    if (state.workspaceMode === mode) return

    // Snapshot the current layout under its scope key before swapping.
    const updatedLayouts = { ...state.projectLayouts }
    if (state.currentProjectId) {
      updatedLayouts[state.currentProjectId] = {
        root: state.root,
        activePaneId: state.activePaneId,
        paneSessions: { ...state.paneSessions },
        paneActiveSession: { ...state.paneActiveSession },
        paneRecentSessions: { ...state.paneRecentSessions },
        fullscreenPaneId: state.fullscreenPaneId,
      }
    }

    if (mode === 'sessions') {
      const saved = updatedLayouts[SESSIONS_LAYOUT_KEY]
      if (saved) {
        set({
          workspaceMode: 'sessions',
          root: saved.root,
          activePaneId: saved.activePaneId,
          fullscreenPaneId: sanitizeFullscreenPaneId(saved.root, saved.paneSessions, saved.fullscreenPaneId),
          paneSessions: saved.paneSessions,
          paneActiveSession: saved.paneActiveSession,
          paneRecentSessions: seedPaneRecentSessions(
            saved.paneSessions,
            saved.paneActiveSession,
            saved.paneRecentSessions,
          ),
          currentProjectId: SESSIONS_LAYOUT_KEY,
          projectLayouts: updatedLayouts,
        })
      } else {
        set({
          workspaceMode: 'sessions',
          root: { type: 'leaf', id: DEFAULT_PANE_ID },
          activePaneId: DEFAULT_PANE_ID,
          fullscreenPaneId: null,
          paneSessions: { [DEFAULT_PANE_ID]: [] },
          paneActiveSession: { [DEFAULT_PANE_ID]: null },
          paneRecentSessions: { [DEFAULT_PANE_ID]: [] },
          currentProjectId: SESSIONS_LAYOUT_KEY,
          projectLayouts: updatedLayouts,
        })
      }
      return
    }

    // Back to project mode: reset to an empty layout so the sessions-mode
    // pane tree doesn't briefly render against the selected project before
    // MainPanel's effect restores the project's saved layout.
    set({
      workspaceMode: 'project',
      root: { type: 'leaf', id: DEFAULT_PANE_ID },
      activePaneId: DEFAULT_PANE_ID,
      fullscreenPaneId: null,
      paneSessions: { [DEFAULT_PANE_ID]: [] },
      paneActiveSession: { [DEFAULT_PANE_ID]: null },
      paneRecentSessions: { [DEFAULT_PANE_ID]: [] },
      currentProjectId: null,
      projectLayouts: updatedLayouts,
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
        paneRecentSessions: { ...state.paneRecentSessions },
        fullscreenPaneId: state.fullscreenPaneId,
      }
    }

    // Restore target project's layout if cached
    const saved = updatedLayouts[projectId]
    if (saved) {
      const allSaved = Object.values(saved.paneSessions).flat()
      const allValid = allSaved.every((sid) => projectSessionIds.includes(sid))
      if (allValid && allSaved.length > 0) {
        set({
          workspaceMode: 'project',
          root: saved.root,
          activePaneId: saved.activePaneId,
          fullscreenPaneId: sanitizeFullscreenPaneId(saved.root, saved.paneSessions, saved.fullscreenPaneId),
          paneSessions: saved.paneSessions,
          paneActiveSession: saved.paneActiveSession,
          paneRecentSessions: seedPaneRecentSessions(
            saved.paneSessions,
            saved.paneActiveSession,
            saved.paneRecentSessions,
          ),
          currentProjectId: projectId,
          projectLayouts: updatedLayouts,
        })
        return
      }
    }

    // No saved layout — init fresh
    set({
      workspaceMode: 'project',
      root: { type: 'leaf', id: DEFAULT_PANE_ID },
      activePaneId: DEFAULT_PANE_ID,
      fullscreenPaneId: null,
      paneSessions: { [DEFAULT_PANE_ID]: projectSessionIds },
      paneActiveSession: { [DEFAULT_PANE_ID]: activeSessionId },
      paneRecentSessions: seedPaneRecentSessions(
        { [DEFAULT_PANE_ID]: projectSessionIds },
        { [DEFAULT_PANE_ID]: activeSessionId },
      ),
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
        paneRecentSessions: { ...state.paneRecentSessions },
        fullscreenPaneId: state.fullscreenPaneId,
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
          workspaceMode: 'project',
          root: saved.root,
          activePaneId: saved.activePaneId,
          fullscreenPaneId: sanitizeFullscreenPaneId(saved.root, cleanedPaneSessions, saved.fullscreenPaneId),
          paneSessions: cleanedPaneSessions,
          paneActiveSession: cleanedPaneActive,
          paneRecentSessions: seedPaneRecentSessions(
            cleanedPaneSessions,
            cleanedPaneActive,
            saved.paneRecentSessions,
          ),
          currentProjectId: worktreeId,
          projectLayouts: updatedLayouts,
        })
        return
      }
    }

    // No saved layout — init fresh
    set({
      workspaceMode: 'project',
      root: { type: 'leaf', id: DEFAULT_PANE_ID },
      activePaneId: DEFAULT_PANE_ID,
      fullscreenPaneId: null,
      paneSessions: { [DEFAULT_PANE_ID]: worktreeSessionIds },
      paneActiveSession: { [DEFAULT_PANE_ID]: activeSessionId },
      paneRecentSessions: seedPaneRecentSessions(
        { [DEFAULT_PANE_ID]: worktreeSessionIds },
        { [DEFAULT_PANE_ID]: activeSessionId },
      ),
      currentProjectId: worktreeId,
      projectLayouts: updatedLayouts,
    })
  },

  loadFromConfig: (raw: Record<string, unknown>) => {
    if (!raw || typeof raw !== 'object') return
    if (raw.root && raw.paneSessions) {
      const root = raw.root as PaneNode
      const paneSessions = raw.paneSessions as Record<string, string[]>
      const paneActiveSession = (raw.paneActiveSession as Record<string, string | null>) ?? {}
      const paneRecentSessions = raw.paneRecentSessions && typeof raw.paneRecentSessions === 'object'
        ? raw.paneRecentSessions as Record<string, string[]>
        : undefined
      const rawMode = raw.workspaceMode
      const workspaceMode: WorkspaceMode = rawMode === 'sessions' ? 'sessions' : 'project'
      set({
        root,
        activePaneId: (raw.activePaneId as string) ?? DEFAULT_PANE_ID,
        fullscreenPaneId: sanitizeFullscreenPaneId(root, paneSessions, raw.fullscreenPaneId),
        paneSessions,
        paneActiveSession,
        paneRecentSessions: seedPaneRecentSessions(paneSessions, paneActiveSession, paneRecentSessions),
        currentProjectId: (raw.currentProjectId as string) ?? null,
        projectLayouts: (raw.projectLayouts ?? {}) as PanesState['projectLayouts'],
        workspaceMode,
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
    const oldPaneRecent = buildPaneRecentSessions(
      oldSessions,
      newOldActive,
      state.paneRecentSessions[paneId] ?? [],
    )
    const newPaneRecent = buildPaneRecentSessions(newSessions, sessionId)

    set({
      root: newRoot,
      activePaneId: newPaneId,
      fullscreenPaneId: state.fullscreenPaneId === paneId ? newPaneId : state.fullscreenPaneId,
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
      paneRecentSessions: {
        ...state.paneRecentSessions,
        [paneId]: oldPaneRecent,
        [newPaneId]: newPaneRecent,
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
    const { [paneId]: ___, ...restRecent } = state.paneRecentSessions

    // If the active pane was closed, switch to sibling's first leaf
    let newActivePaneId = state.activePaneId
    if (state.activePaneId === paneId) {
      newActivePaneId = getFirstLeafId(sibling)
    }
    const nextFullscreenPaneId = state.fullscreenPaneId === paneId
      ? getFirstLeafId(sibling)
      : sanitizeFullscreenPaneId(newRoot, restSessions, state.fullscreenPaneId)

    set({
      root: newRoot,
      activePaneId: newActivePaneId,
      fullscreenPaneId: nextFullscreenPaneId,
      paneSessions: restSessions,
      paneActiveSession: restActive,
      paneRecentSessions: restRecent,
    })
  },

  setActivePaneId: (paneId) => set((state) => ({
    activePaneId: paneId,
    fullscreenPaneId: state.fullscreenPaneId ? paneId : null,
  })),

  setPaneActiveSession: (paneId, sessionId) =>
    set((state) => {
      const sessions = state.paneSessions[paneId] ?? []
      if (sessionId !== null && !sessions.includes(sessionId)) return state
      if ((state.paneActiveSession[paneId] ?? null) === sessionId) return state

      return {
        paneActiveSession: { ...state.paneActiveSession, [paneId]: sessionId },
        paneRecentSessions: {
          ...state.paneRecentSessions,
          [paneId]: buildPaneRecentSessions(
            sessions,
            sessionId,
            state.paneRecentSessions[paneId] ?? [],
          ),
        },
      }
    }),

  addSessionToPane: (paneId, sessionId) =>
    set((state) => {
      const sessions = state.paneSessions[paneId] ?? []
      if (sessions.includes(sessionId)) return state
      const nextSessions = [...sessions, sessionId]
      return {
        paneSessions: { ...state.paneSessions, [paneId]: nextSessions },
        paneActiveSession: { ...state.paneActiveSession, [paneId]: sessionId },
        paneRecentSessions: {
          ...state.paneRecentSessions,
          [paneId]: buildPaneRecentSessions(
            nextSessions,
            sessionId,
            state.paneRecentSessions[paneId] ?? [],
          ),
        },
      }
    }),

  removeSessionFromPane: (paneId, sessionId) => {
    const state = get()
    const sessions = (state.paneSessions[paneId] ?? []).filter((id) => id !== sessionId)
    const active = state.paneActiveSession[paneId]
    const existingRecent = (state.paneRecentSessions[paneId] ?? []).filter((id) => id !== sessionId)
    const newActive = active === sessionId
      ? (existingRecent[0] ?? sessions[0] ?? null)
      : (active && sessions.includes(active) ? active : (existingRecent[0] ?? sessions[0] ?? null))
    set({
      paneSessions: { ...state.paneSessions, [paneId]: sessions },
      paneActiveSession: { ...state.paneActiveSession, [paneId]: newActive },
      paneRecentSessions: {
        ...state.paneRecentSessions,
        [paneId]: buildPaneRecentSessions(sessions, newActive, existingRecent),
      },
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
    const fromRecent = (state.paneRecentSessions[fromPaneId] ?? []).filter((id) => id !== sessionId)
    const newFromActive = fromActive === sessionId
      ? (fromRecent[0] ?? fromSessions[0] ?? null)
      : (fromActive && fromSessions.includes(fromActive) ? fromActive : (fromRecent[0] ?? fromSessions[0] ?? null))
    const newToRecent = buildPaneRecentSessions(
      toSessions,
      sessionId,
      state.paneRecentSessions[toPaneId] ?? [],
    )

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
      paneRecentSessions: {
        ...state.paneRecentSessions,
        [fromPaneId]: buildPaneRecentSessions(fromSessions, newFromActive, fromRecent),
        [toPaneId]: newToRecent,
      },
      activePaneId: toPaneId,
      fullscreenPaneId: state.fullscreenPaneId === fromPaneId ? toPaneId : state.fullscreenPaneId,
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
        if (node.type !== 'split') {
          return node
        }

        const nextFirst = update(node.first)
        const nextSecond = update(node.second)

        if (node.id === splitId) {
          if (nextFirst === node.first && nextSecond === node.second && node.ratio === clamped) {
            return node
          }
          return { ...node, ratio: clamped, first: nextFirst, second: nextSecond }
        }

        if (nextFirst === node.first && nextSecond === node.second) {
          return node
        }

        return { ...node, first: nextFirst, second: nextSecond }
      }
      return { root: update(state.root) }
    }),

  beginSplitResize: () => set({ splitResizeActive: true }),

  endSplitResize: () => set({ splitResizeActive: false }),

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

  // Merge all split panes into a single pane with all sessions as tabs
  mergeAllPanes: () => {
    const state = get()
    if (state.root.type !== 'split') return

    // Collect all sessions from all panes in order
    const allLeafIds = getAllLeafIds(state.root)
    const allSessionIds: string[] = []
    for (const leafId of allLeafIds) {
      const sessions = state.paneSessions[leafId] ?? []
      allSessionIds.push(...sessions)
    }

    // Use the current active session as the active tab, fallback to first
    const currentActivePane = state.activePaneId
    const activeSession = state.paneActiveSession[currentActivePane] ?? allSessionIds[0] ?? null

    set({
      root: { type: 'leaf', id: DEFAULT_PANE_ID },
      activePaneId: DEFAULT_PANE_ID,
      fullscreenPaneId: state.fullscreenPaneId ? DEFAULT_PANE_ID : null,
      paneSessions: { [DEFAULT_PANE_ID]: allSessionIds },
      paneActiveSession: { [DEFAULT_PANE_ID]: activeSession },
      paneRecentSessions: {
        [DEFAULT_PANE_ID]: buildPaneRecentSessions(
          allSessionIds,
          activeSession,
          allLeafIds.flatMap((leafId) => state.paneRecentSessions[leafId] ?? []),
        ),
      },
    })
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
    const siblingActive = sessionsToMove[0] ?? state.paneActiveSession[siblingLeafId]
    set({
      paneSessions: { ...state.paneSessions, [siblingLeafId]: sibSessions, [paneId]: [] },
      paneActiveSession: {
        ...state.paneActiveSession,
        [siblingLeafId]: siblingActive,
      },
      paneRecentSessions: {
        ...state.paneRecentSessions,
        [siblingLeafId]: buildPaneRecentSessions(
          sibSessions,
          siblingActive,
          [
            ...(state.paneRecentSessions[paneId] ?? []),
            ...(state.paneRecentSessions[siblingLeafId] ?? []),
          ],
        ),
        [paneId]: [],
      },
      fullscreenPaneId: state.fullscreenPaneId === paneId ? siblingLeafId : state.fullscreenPaneId,
    })
    get().closePane(paneId)
  },

  togglePaneFullscreen: (paneId) => {
    const state = get()
    const targetPaneId = paneId ?? state.activePaneId
    if (!hasLeaf(state.root, targetPaneId)) return
    set({
      activePaneId: targetPaneId,
      fullscreenPaneId: state.fullscreenPaneId === targetPaneId ? null : targetPaneId,
    })
  },

  exitPaneFullscreen: () => set({ fullscreenPaneId: null }),
}))

// Auto-persist on state change (debounced)
let persistTimer: ReturnType<typeof setTimeout> | null = null
usePanesStore.subscribe((state) => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistPanes(state)
  }, 500)
})
