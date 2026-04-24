import { create } from 'zustand'
import {
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  CANVAS_SCHEMA_VERSION,
  type CanvasCard,
  type CanvasCardKind,
  type CanvasLayout,
  type CanvasViewport,
} from '@shared/types'
import { generateId } from '@/lib/utils'
import { SESSIONS_LAYOUT_KEY } from './panes'

// ─── Canvas state ───
//
// State is keyed by the same layout scope identifier the panes store uses
// (`currentProjectId` / worktree id / SESSIONS_LAYOUT_KEY). When the user
// switches project/worktree, `setActiveLayout` swaps the visible layout.

const GLOBAL_LAYOUT_KEY = '__global__'

function defaultViewport(): CanvasViewport {
  return { scale: 1, offsetX: 0, offsetY: 0 }
}

function defaultLayout(): CanvasLayout {
  return { cards: [], viewport: defaultViewport() }
}

function clampScale(scale: number): number {
  return Math.max(CANVAS_MIN_SCALE, Math.min(CANVAS_MAX_SCALE, scale))
}

/**
 * Fraction of the viewport's shorter axis a focused card should occupy.
 * 0.75 leaves a comfortable margin around the focused card.
 */
export const FOCUS_ZOOM_FRACTION = 0.75

/** Viewport transition duration when focusing a card, in ms. */
const FOCUS_ANIMATION_MS = 360

// ─── Programmatic viewport animation ───
//
// Used by `focusOnCard` — eases from the current viewport to a target with
// a soft ease-out curve. Any wheel / pointer gesture should call
// `cancelViewportAnimation` first so user input isn't overwritten.

let animationFrame: number | null = null

export function cancelViewportAnimation(): void {
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

function animateViewport(target: CanvasViewport): void {
  cancelViewportAnimation()
  const start = useCanvasStore.getState().getViewport()
  const startTime = performance.now()
  const ease = (t: number): number => 1 - Math.pow(1 - t, 4)

  const step = (now: number): void => {
    const t = Math.min(1, (now - startTime) / FOCUS_ANIMATION_MS)
    const progress = ease(t)
    useCanvasStore.getState().setViewport({
      scale: start.scale + (target.scale - start.scale) * progress,
      offsetX: start.offsetX + (target.offsetX - start.offsetX) * progress,
      offsetY: start.offsetY + (target.offsetY - start.offsetY) * progress,
    })
    if (t < 1) {
      animationFrame = requestAnimationFrame(step)
    } else {
      animationFrame = null
    }
  }
  animationFrame = requestAnimationFrame(step)
}

function getViewportSize(): { width: number; height: number } | null {
  const el = document.querySelector('[data-canvas-viewport]') as HTMLDivElement | null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { width: rect.width, height: rect.height }
}

function isValidCard(value: unknown): value is CanvasCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<string, unknown>
  return (
    typeof card.id === 'string'
    && (card.kind === 'session' || card.kind === 'terminal' || card.kind === 'note')
    && (card.refId === null || typeof card.refId === 'string')
    && typeof card.x === 'number'
    && typeof card.y === 'number'
    && typeof card.width === 'number'
    && typeof card.height === 'number'
    && typeof card.zIndex === 'number'
  )
}

function sanitizeLayout(raw: unknown): CanvasLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const rawCards = Array.isArray(data.cards) ? data.cards : []
  const cards = rawCards.filter(isValidCard).map((card) => ({
    ...card,
    collapsed: Boolean(card.collapsed),
    createdAt: typeof card.createdAt === 'number' ? card.createdAt : Date.now(),
    updatedAt: typeof card.updatedAt === 'number' ? card.updatedAt : Date.now(),
  }))

  const rawViewport = data.viewport && typeof data.viewport === 'object'
    ? (data.viewport as Record<string, unknown>)
    : {}
  const viewport: CanvasViewport = {
    scale: typeof rawViewport.scale === 'number' ? clampScale(rawViewport.scale) : 1,
    offsetX: typeof rawViewport.offsetX === 'number' ? rawViewport.offsetX : 0,
    offsetY: typeof rawViewport.offsetY === 'number' ? rawViewport.offsetY : 0,
  }
  return { cards, viewport }
}

// ─── Card defaults ───

const DEFAULT_CARD_SIZE: Record<CanvasCardKind, { width: number; height: number }> = {
  session: { width: 520, height: 640 },
  terminal: { width: 560, height: 380 },
  note: { width: 240, height: 180 },
}

// ─── Store ───

interface CanvasState {
  activeLayoutKey: string
  layouts: Record<string, CanvasLayout>
  selectedCardIds: string[]
  focusReturn: { cardId: string; viewport: CanvasViewport } | null

  // getters
  getLayout: (key?: string) => CanvasLayout
  getCards: () => CanvasCard[]
  getViewport: () => CanvasViewport
  getCard: (id: string) => CanvasCard | undefined

  // lifecycle
  loadFromConfig: (raw: Record<string, unknown>) => void
  setActiveLayout: (key: string | null) => void

  // viewport
  setViewport: (viewport: Partial<CanvasViewport>) => void
  resetViewport: () => void
  clearFocusReturn: () => void
  fitAll: (containerWidth: number, containerHeight: number) => void
  /**
   * Animate the viewport so `cardId` lands centered and scaled to
   * `FOCUS_ZOOM_FRACTION` of the shorter viewport axis. Also selects and
   * brings the card to front so the session terminal gets keyboard focus.
   */
  focusOnCard: (cardId: string) => void

  // cards
  addCard: (partial: Partial<CanvasCard> & { kind: CanvasCardKind }) => string
  updateCard: (id: string, updates: Partial<CanvasCard>) => void
  moveCards: (ids: string[], dx: number, dy: number) => void
  resizeCard: (id: string, width: number, height: number, x?: number, y?: number) => void
  removeCard: (id: string) => void
  bringToFront: (id: string) => void

  // selection
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string, additive: boolean) => void
  clearSelection: () => void

  // session card helpers
  /** Find the card (in any layout) that references the given session id. */
  findCardBySessionId: (sessionId: string) => { layoutKey: string; card: CanvasCard } | null
  /** Attach a session as a card in the current active layout. Idempotent — if
   *  a card already exists we return its id and optionally center the viewport. */
  attachSession: (
    sessionId: string,
    kind: 'session' | 'terminal',
    position?: { x: number; y: number },
  ) => string
  /** Remove all cards that reference this session (in every layout). */
  detachSessionEverywhere: (sessionId: string) => void
  /** Auto-populate the current layout from a list of session ids in horizontal
   *  flow. Returns the new card ids that were actually created (skipping any
   *  session that already had a card). */
  autoPopulateFromSessions: (
    sessionIds: string[],
    kindFor: (id: string) => 'session' | 'terminal',
  ) => string[]

  // bulk ops (used by context menu / keyboard)
  removeCards: (ids: string[]) => void
  duplicateCards: (ids: string[]) => string[]

  // arrangement
  arrange: (kind: 'grid' | 'rowFlow' | 'colFlow' | 'pack', ids?: string[]) => void
  alignCards: (axis: 'left' | 'right' | 'top' | 'bottom' | 'hCenter' | 'vCenter', ids: string[]) => void
  distributeCards: (axis: 'horizontal' | 'vertical', ids: string[]) => void
}

function persistCanvas(state: CanvasState): void {
  // Detached windows don't own the canvas layout.
  if (window.api.detach.isDetached) return
  void window.api.config.write('canvas', {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    layouts: state.layouts,
  })
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  activeLayoutKey: GLOBAL_LAYOUT_KEY,
  layouts: { [GLOBAL_LAYOUT_KEY]: defaultLayout() },
  selectedCardIds: [],
  focusReturn: null,

  getLayout: (key) => {
    const layoutKey = key ?? get().activeLayoutKey
    return get().layouts[layoutKey] ?? defaultLayout()
  },
  getCards: () => get().getLayout().cards,
  getViewport: () => get().getLayout().viewport,
  getCard: (id) => get().getCards().find((card) => card.id === id),

  loadFromConfig: (raw) => {
    if (!raw || typeof raw !== 'object') return
    const rawLayouts = raw.layouts && typeof raw.layouts === 'object'
      ? raw.layouts as Record<string, unknown>
      : {}
    const layouts: Record<string, CanvasLayout> = {}
    for (const [key, value] of Object.entries(rawLayouts)) {
      const layout = sanitizeLayout(value)
      if (layout) layouts[key] = layout
    }
    if (Object.keys(layouts).length === 0) {
      layouts[GLOBAL_LAYOUT_KEY] = defaultLayout()
    }
    set({ layouts, selectedCardIds: [], focusReturn: null })
  },

  setActiveLayout: (key) => {
    const layoutKey = key ?? GLOBAL_LAYOUT_KEY
    set((state) => {
      if (state.activeLayoutKey === layoutKey) return state
      const layouts = state.layouts[layoutKey]
        ? state.layouts
        : { ...state.layouts, [layoutKey]: defaultLayout() }
      return {
        activeLayoutKey: layoutKey,
        layouts,
        selectedCardIds: [],
        focusReturn: null,
      }
    })
  },

  setViewport: (viewport) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const nextViewport: CanvasViewport = {
        scale: viewport.scale !== undefined ? clampScale(viewport.scale) : layout.viewport.scale,
        offsetX: viewport.offsetX !== undefined ? viewport.offsetX : layout.viewport.offsetX,
        offsetY: viewport.offsetY !== undefined ? viewport.offsetY : layout.viewport.offsetY,
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, viewport: nextViewport },
        },
      }
    })
  },

  resetViewport: () => {
    set({ focusReturn: null })
    get().setViewport({ scale: 1, offsetX: 0, offsetY: 0 })
  },

  clearFocusReturn: () => set({ focusReturn: null }),

  focusOnCard: (cardId) => {
    cancelViewportAnimation()
    const focusReturn = get().focusReturn
    if (focusReturn?.cardId === cardId) {
      get().setSelection([cardId])
      get().bringToFront(cardId)
      set({ focusReturn: null })
      animateViewport(focusReturn.viewport)
      return
    }

    const card = get().getCard(cardId)
    if (!card) return
    const size = getViewportSize()
    if (!size) return
    const returnViewport = get().getViewport()

    const scaleX = (size.width * FOCUS_ZOOM_FRACTION) / card.width
    const scaleY = (size.height * FOCUS_ZOOM_FRACTION) / card.height
    const targetScale = clampScale(Math.min(scaleX, scaleY))
    const centerX = card.x + card.width / 2
    const centerY = card.y + card.height / 2
    const targetOffsetX = size.width / 2 - centerX * targetScale
    const targetOffsetY = size.height / 2 - centerY * targetScale

    get().setSelection([cardId])
    get().bringToFront(cardId)
    set({ focusReturn: { cardId, viewport: returnViewport } })
    animateViewport({
      scale: targetScale,
      offsetX: targetOffsetX,
      offsetY: targetOffsetY,
    })
  },

  fitAll: (containerWidth, containerHeight) => {
    const { cards } = get().getLayout()
    if (cards.length === 0) {
      get().resetViewport()
      return
    }
    const minX = Math.min(...cards.map((c) => c.x))
    const minY = Math.min(...cards.map((c) => c.y))
    const maxX = Math.max(...cards.map((c) => c.x + c.width))
    const maxY = Math.max(...cards.map((c) => c.y + c.height))
    const bboxWidth = maxX - minX
    const bboxHeight = maxY - minY
    const padding = 80
    const scaleX = (containerWidth - padding * 2) / bboxWidth
    const scaleY = (containerHeight - padding * 2) / bboxHeight
    const scale = clampScale(Math.min(scaleX, scaleY, 1))
    const centerX = minX + bboxWidth / 2
    const centerY = minY + bboxHeight / 2
    const offsetX = containerWidth / 2 - centerX * scale
    const offsetY = containerHeight / 2 - centerY * scale
    set({ focusReturn: null })
    get().setViewport({ scale, offsetX, offsetY })
  },

  addCard: (partial) => {
    const id = partial.id ?? `card-${generateId()}`
    const size = DEFAULT_CARD_SIZE[partial.kind]
    const now = Date.now()
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const maxZ = layout.cards.reduce((acc, card) => Math.max(acc, card.zIndex), 0)
      const card: CanvasCard = {
        id,
        kind: partial.kind,
        refId: partial.refId ?? null,
        x: partial.x ?? 0,
        y: partial.y ?? 0,
        width: partial.width ?? size.width,
        height: partial.height ?? size.height,
        zIndex: partial.zIndex ?? maxZ + 1,
        collapsed: partial.collapsed ?? false,
        noteBody: partial.noteBody,
        noteColor: partial.noteColor,
        createdAt: partial.createdAt ?? now,
        updatedAt: now,
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards: [...layout.cards, card] },
        },
        selectedCardIds: [id],
      }
    })
    return id
  },

  updateCard: (id, updates) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const nextCard: CanvasCard = { ...layout.cards[index], ...updates, updatedAt: Date.now() }
      const cards = [...layout.cards]
      cards[index] = nextCard
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  moveCards: (ids, dx, dy) => {
    if (dx === 0 && dy === 0) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const idSet = new Set(ids)
      let touched = false
      const cards = layout.cards.map((card) => {
        if (!idSet.has(card.id)) return card
        touched = true
        return { ...card, x: card.x + dx, y: card.y + dy, updatedAt: Date.now() }
      })
      if (!touched) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  resizeCard: (id, width, height, x, y) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const card = layout.cards[index]
      const nextCard: CanvasCard = {
        ...card,
        width: Math.max(120, width),
        height: Math.max(80, height),
        x: x ?? card.x,
        y: y ?? card.y,
        updatedAt: Date.now(),
      }
      const cards = [...layout.cards]
      cards[index] = nextCard
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  removeCard: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const cards = layout.cards.filter((card) => card.id !== id)
      if (cards.length === layout.cards.length) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        selectedCardIds: state.selectedCardIds.filter((cardId) => cardId !== id),
        focusReturn: state.focusReturn?.cardId === id ? null : state.focusReturn,
      }
    })
  },

  bringToFront: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const card = layout.cards.find((c) => c.id === id)
      if (!card) return state
      const maxZ = layout.cards.reduce((acc, c) => Math.max(acc, c.zIndex), 0)
      if (card.zIndex === maxZ) return state
      const cards = layout.cards.map((c) =>
        c.id === id ? { ...c, zIndex: maxZ + 1, updatedAt: Date.now() } : c,
      )
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  setSelection: (ids) => set({ selectedCardIds: ids }),
  toggleSelection: (id, additive) => {
    set((state) => {
      if (!additive) return { selectedCardIds: [id] }
      const current = new Set(state.selectedCardIds)
      if (current.has(id)) current.delete(id)
      else current.add(id)
      return { selectedCardIds: Array.from(current) }
    })
  },
  clearSelection: () => set({ selectedCardIds: [] }),

  // ─── Session <-> card mapping ───

  findCardBySessionId: (sessionId) => {
    const { layouts } = get()
    for (const [layoutKey, layout] of Object.entries(layouts)) {
      const card = layout.cards.find((c) => c.refId === sessionId)
      if (card) return { layoutKey, card }
    }
    return null
  },

  attachSession: (sessionId, kind, position) => {
    const existing = get().findCardBySessionId(sessionId)
    if (existing && existing.layoutKey === get().activeLayoutKey) {
      get().setSelection([existing.card.id])
      get().bringToFront(existing.card.id)
      return existing.card.id
    }
    if (existing) {
      // Session is parked in another layout — move it to the active one.
      set((state) => {
        const nextLayouts = { ...state.layouts }
        const fromLayout = nextLayouts[existing.layoutKey]
        if (fromLayout) {
          nextLayouts[existing.layoutKey] = {
            ...fromLayout,
            cards: fromLayout.cards.filter((c) => c.id !== existing.card.id),
          }
        }
        const toKey = state.activeLayoutKey
        const toLayout = nextLayouts[toKey] ?? defaultLayout()
        nextLayouts[toKey] = {
          ...toLayout,
          cards: [
            ...toLayout.cards,
            {
              ...existing.card,
              x: position?.x ?? existing.card.x,
              y: position?.y ?? existing.card.y,
              updatedAt: Date.now(),
            },
          ],
        }
        return { layouts: nextLayouts, selectedCardIds: [existing.card.id] }
      })
      return existing.card.id
    }
    const size = DEFAULT_CARD_SIZE[kind]
    return get().addCard({
      kind,
      refId: sessionId,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      width: size.width,
      height: size.height,
    })
  },

  detachSessionEverywhere: (sessionId) => {
    set((state) => {
      const layouts: Record<string, CanvasLayout> = {}
      for (const [key, layout] of Object.entries(state.layouts)) {
        const cards = layout.cards.filter((c) => c.refId !== sessionId)
        layouts[key] = cards.length === layout.cards.length ? layout : { ...layout, cards }
      }
      const selectedCardIds = state.selectedCardIds.filter((id) => {
        const card = Object.values(layouts).flatMap((l) => l.cards).find((c) => c.id === id)
        return Boolean(card)
      })
      return { layouts, selectedCardIds }
    })
  },

  autoPopulateFromSessions: (sessionIds, kindFor) => {
    if (sessionIds.length === 0) return []
    const existingRefIds = new Set(get().getCards().map((c) => c.refId).filter(Boolean) as string[])
    const newSessionIds = sessionIds.filter((id) => !existingRefIds.has(id))
    if (newSessionIds.length === 0) return []

    const createdCardIds: string[] = []
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const gap = 24
      let startX = 0
      let maxZ = layout.cards.reduce((acc, c) => Math.max(acc, c.zIndex), 0)
      if (layout.cards.length > 0) {
        startX = Math.max(...layout.cards.map((c) => c.x + c.width)) + gap
      }
      const now = Date.now()
      const cards = [...layout.cards]
      for (const sessionId of newSessionIds) {
        const kind = kindFor(sessionId)
        const size = DEFAULT_CARD_SIZE[kind]
        maxZ += 1
        const cardId = `card-${generateId()}`
        createdCardIds.push(cardId)
        cards.push({
          id: cardId,
          kind,
          refId: sessionId,
          x: startX,
          y: 0,
          width: size.width,
          height: size.height,
          zIndex: maxZ,
          collapsed: false,
          createdAt: now,
          updatedAt: now,
        })
        startX += size.width + gap
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
    return createdCardIds
  },

  // ─── Bulk ops ───

  removeCards: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const cards = layout.cards.filter((c) => !idSet.has(c.id))
      if (cards.length === layout.cards.length) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        selectedCardIds: state.selectedCardIds.filter((id) => !idSet.has(id)),
        focusReturn: state.focusReturn && idSet.has(state.focusReturn.cardId) ? null : state.focusReturn,
      }
    })
  },

  duplicateCards: (ids) => {
    if (ids.length === 0) return []
    const newIds: string[] = []
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const now = Date.now()
      let maxZ = layout.cards.reduce((acc, c) => Math.max(acc, c.zIndex), 0)
      const clones: CanvasCard[] = []
      for (const id of ids) {
        const src = layout.cards.find((c) => c.id === id)
        if (!src) continue
        // Only note cards make sense to clone standalone; session/terminal cards
        // can't have two cards pointing to the same PTY — clone as notes would
        // be confusing, so we only clone notes here.
        if (src.kind !== 'note') continue
        maxZ += 1
        const clone: CanvasCard = {
          ...src,
          id: `card-${generateId()}`,
          x: src.x + 24,
          y: src.y + 24,
          zIndex: maxZ,
          createdAt: now,
          updatedAt: now,
        }
        clones.push(clone)
        newIds.push(clone.id)
      }
      if (clones.length === 0) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards: [...layout.cards, ...clones] },
        },
        selectedCardIds: newIds,
      }
    })
    return newIds
  },

  // ─── Arrangement ───

  arrange: (kind, ids) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const targets = ids && ids.length > 0
        ? layout.cards.filter((c) => ids.includes(c.id))
        : layout.cards
      if (targets.length === 0) return state

      const gap = 24
      const startX = targets[0].x
      const startY = targets[0].y
      let layoutPositions = new Map<string, { x: number; y: number }>()

      if (kind === 'rowFlow') {
        let x = startX
        for (const card of targets) {
          layoutPositions.set(card.id, { x, y: startY })
          x += card.width + gap
        }
      } else if (kind === 'colFlow') {
        let y = startY
        for (const card of targets) {
          layoutPositions.set(card.id, { x: startX, y })
          y += card.height + gap
        }
      } else if (kind === 'grid') {
        const cols = Math.ceil(Math.sqrt(targets.length))
        const cellWidth = Math.max(...targets.map((c) => c.width)) + gap
        const cellHeight = Math.max(...targets.map((c) => c.height)) + gap
        targets.forEach((card, index) => {
          const col = index % cols
          const row = Math.floor(index / cols)
          layoutPositions.set(card.id, {
            x: startX + col * cellWidth,
            y: startY + row * cellHeight,
          })
        })
      } else if (kind === 'pack') {
        // Simple shelf packing: group rows by a shared max-width band.
        const bandWidth = 1400
        let x = startX
        let y = startY
        let rowHeight = 0
        for (const card of targets) {
          if (x > startX && x + card.width > startX + bandWidth) {
            x = startX
            y += rowHeight + gap
            rowHeight = 0
          }
          layoutPositions.set(card.id, { x, y })
          x += card.width + gap
          rowHeight = Math.max(rowHeight, card.height)
        }
      }

      const now = Date.now()
      const cards = layout.cards.map((card) => {
        const pos = layoutPositions.get(card.id)
        if (!pos) return card
        return { ...card, x: pos.x, y: pos.y, updatedAt: now }
      })
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  alignCards: (axis, ids) => {
    if (ids.length < 2) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const idSet = new Set(ids)
      const targets = layout.cards.filter((c) => idSet.has(c.id))
      if (targets.length < 2) return state

      let reference: number
      if (axis === 'left') reference = Math.min(...targets.map((c) => c.x))
      else if (axis === 'right') reference = Math.max(...targets.map((c) => c.x + c.width))
      else if (axis === 'top') reference = Math.min(...targets.map((c) => c.y))
      else if (axis === 'bottom') reference = Math.max(...targets.map((c) => c.y + c.height))
      else if (axis === 'hCenter') {
        const avg = targets.reduce((acc, c) => acc + c.x + c.width / 2, 0) / targets.length
        reference = avg
      } else {
        const avg = targets.reduce((acc, c) => acc + c.y + c.height / 2, 0) / targets.length
        reference = avg
      }

      const now = Date.now()
      const cards = layout.cards.map((card) => {
        if (!idSet.has(card.id)) return card
        switch (axis) {
          case 'left': return { ...card, x: reference, updatedAt: now }
          case 'right': return { ...card, x: reference - card.width, updatedAt: now }
          case 'top': return { ...card, y: reference, updatedAt: now }
          case 'bottom': return { ...card, y: reference - card.height, updatedAt: now }
          case 'hCenter': return { ...card, x: reference - card.width / 2, updatedAt: now }
          case 'vCenter': return { ...card, y: reference - card.height / 2, updatedAt: now }
        }
      })
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  distributeCards: (axis, ids) => {
    if (ids.length < 3) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const idSet = new Set(ids)
      const targets = layout.cards.filter((c) => idSet.has(c.id))
      if (targets.length < 3) return state

      const sorted = [...targets].sort((a, b) => axis === 'horizontal' ? a.x - b.x : a.y - b.y)
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const sizeSum = sorted.reduce((acc, c) => acc + (axis === 'horizontal' ? c.width : c.height), 0)
      const span = axis === 'horizontal'
        ? (last.x + last.width) - first.x
        : (last.y + last.height) - first.y
      const gap = (span - sizeSum) / (sorted.length - 1)

      const positions = new Map<string, number>()
      let cursor = axis === 'horizontal' ? first.x : first.y
      for (const card of sorted) {
        positions.set(card.id, cursor)
        cursor += (axis === 'horizontal' ? card.width : card.height) + gap
      }

      const now = Date.now()
      const cards = layout.cards.map((card) => {
        const pos = positions.get(card.id)
        if (pos === undefined) return card
        return axis === 'horizontal'
          ? { ...card, x: pos, updatedAt: now }
          : { ...card, y: pos, updatedAt: now }
      })
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },
}))

// ─── Helpers for use in components ───

export { GLOBAL_LAYOUT_KEY, SESSIONS_LAYOUT_KEY }

/** Resolve the layout key for the current project/worktree context. */
export function resolveCanvasLayoutKey(
  workspaceMode: 'project' | 'sessions',
  projectLayoutKey: string | null,
): string {
  if (workspaceMode === 'sessions') return SESSIONS_LAYOUT_KEY
  return projectLayoutKey ?? GLOBAL_LAYOUT_KEY
}

// ─── Debounced persistence ───
let persistTimer: ReturnType<typeof setTimeout> | null = null
let lastLayouts: CanvasState['layouts'] | null = null
useCanvasStore.subscribe((state) => {
  if (state.layouts === lastLayouts) return
  lastLayouts = state.layouts
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistCanvas(useCanvasStore.getState())
  }, 400)
})
