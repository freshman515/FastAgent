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

interface CanvasUiState {
  marquee: MarqueeRect | null
  guides: SnapGuide[]
  pendingSessionFocusId: string | null

  setMarquee: (rect: MarqueeRect | null) => void
  setGuides: (guides: SnapGuide[]) => void
  clearGuides: () => void
  requestSessionFocus: (sessionId: string) => void
  clearPendingSessionFocus: (sessionId?: string) => void
}

export const useCanvasUiStore = create<CanvasUiState>((set) => ({
  marquee: null,
  guides: [],
  pendingSessionFocusId: null,

  setMarquee: (rect) => set({ marquee: rect }),
  setGuides: (guides) => set({ guides }),
  clearGuides: () => set({ guides: [] }),
  requestSessionFocus: (sessionId) => set({ pendingSessionFocusId: sessionId }),
  clearPendingSessionFocus: (sessionId) => set((state) => {
    if (sessionId && state.pendingSessionFocusId !== sessionId) return state
    return { pendingSessionFocusId: null }
  }),
}))
