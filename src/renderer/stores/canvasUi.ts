import { create } from 'zustand'

// Transient UI state that doesn't belong in the persisted canvas store —
// marquee selection rectangle, snap guide lines, and drag previews.

export interface MarqueeRect {
  /** World-space rectangle covered by the marquee selection. */
  x: number
  y: number
  width: number
  height: number
}

export type SnapGuideAxis = 'vertical' | 'horizontal'

export interface SnapGuide {
  axis: SnapGuideAxis
  /** World-space coordinate (X for vertical guide, Y for horizontal). */
  position: number
  /** Optional span in the perpendicular axis — helps keep guides short. */
  start?: number
  end?: number
}

export interface LiveCanvasCardGeometry {
  x: number
  y: number
  width: number
  height: number
}

interface CanvasUiState {
  marquee: MarqueeRect | null
  guides: SnapGuide[]
  liveCardGeometry: Record<string, LiveCanvasCardGeometry>
  pendingSessionFocusId: string | null
  activeSpaceId: string | null

  setMarquee: (rect: MarqueeRect | null) => void
  setGuides: (guides: SnapGuide[]) => void
  clearGuides: () => void
  setLiveCardGeometry: (geometry: Map<string, LiveCanvasCardGeometry> | Record<string, LiveCanvasCardGeometry>) => void
  clearLiveCardGeometry: (ids?: string[]) => void
  requestSessionFocus: (sessionId: string) => void
  clearPendingSessionFocus: (sessionId?: string) => void
  setActiveSpaceId: (spaceId: string | null) => void
}

export const useCanvasUiStore = create<CanvasUiState>((set) => ({
  marquee: null,
  guides: [],
  liveCardGeometry: {},
  pendingSessionFocusId: null,
  activeSpaceId: null,

  setMarquee: (rect) => set({ marquee: rect }),
  setGuides: (guides) => set({ guides }),
  clearGuides: () => set({ guides: [] }),
  setLiveCardGeometry: (geometry) => set({
    liveCardGeometry: geometry instanceof Map
      ? Object.fromEntries(geometry)
      : { ...geometry },
  }),
  clearLiveCardGeometry: (ids) => set((state) => {
    if (!ids) {
      if (Object.keys(state.liveCardGeometry).length === 0) return state
      return { liveCardGeometry: {} }
    }
    let changed = false
    const next = { ...state.liveCardGeometry }
    for (const id of ids) {
      if (id in next) {
        delete next[id]
        changed = true
      }
    }
    return changed ? { liveCardGeometry: next } : state
  }),
  requestSessionFocus: (sessionId) => set({ pendingSessionFocusId: sessionId }),
  clearPendingSessionFocus: (sessionId) => set((state) => {
    if (sessionId && state.pendingSessionFocusId !== sessionId) return state
    return { pendingSessionFocusId: null }
  }),
  setActiveSpaceId: (spaceId) => set({ activeSpaceId: spaceId }),
}))
