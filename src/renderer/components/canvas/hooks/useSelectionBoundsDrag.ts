import { useEffect, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { useUIStore } from '@/stores/ui'
import type { CanvasCard } from '@shared/types'
import {
  applyAvoidanceStyles,
  applyLiveFrameAutoLayoutForMovement,
  applyLiveCardMovement,
  cleanupAvoidanceTransitions,
  expandFrameDragIds,
  resetLiveFrameAutoLayout,
  resetLiveCardMovement,
  resolveAvoidOverlap,
  type AvoidanceState,
} from './useCardDrag'
import { computeSnap } from './useSnapGuides'

export type SelectionResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface CardRect {
  id: string
  x: number
  y: number
  width: number
  height: number
  minWidth: number
  minHeight: number
}

interface BoundsRect {
  x: number
  y: number
  width: number
  height: number
}

type InteractionState =
  | {
    kind: 'drag'
    startClientX: number
    startClientY: number
    ids: string[]
    liveDx: number
    liveDy: number
    avoidance: AvoidanceState
    liveFrameIds: Set<string>
  }
  | {
    kind: 'resize'
    handle: SelectionResizeHandle
    startClientX: number
    startClientY: number
    bounds: BoundsRect
    cards: CardRect[]
    liveGeometry: Map<string, BoundsRect>
  }

export function useSelectionBoundsDrag(element: HTMLDivElement | null): void {
  const stateRef = useRef<InteractionState | null>(null)

  useEffect(() => {
    if (!element) return

    const getSelectedCards = (): CanvasCard[] => {
      const store = useCanvasStore.getState()
      const selected = new Set(store.selectedCardIds)
      return store.getLayout().cards.filter((card) => selected.has(card.id))
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      if (useUIStore.getState().settings.canvasLayoutLocked) return
      const selectedCards = getSelectedCards()
      if (selectedCards.length <= 1) return

      const target = event.target as HTMLElement | null
      const resizeHandle = target?.closest<HTMLElement>('[data-selection-resize]')?.dataset.selectionResize as SelectionResizeHandle | undefined

      event.preventDefault()
      event.stopPropagation()

      if (resizeHandle) {
        stateRef.current = {
          kind: 'resize',
          handle: resizeHandle,
          startClientX: event.clientX,
          startClientY: event.clientY,
          bounds: getBounds(selectedCards),
          cards: selectedCards.map((card) => ({
            id: card.id,
            x: card.x,
            y: card.y,
            width: card.width,
            height: card.height,
            ...getMinSize(card),
          })),
          liveGeometry: new Map(),
        }
        element.dataset.resizing = resizeHandle
      } else {
        stateRef.current = {
          kind: 'drag',
          startClientX: event.clientX,
          startClientY: event.clientY,
          ids: expandFrameDragIds(selectedCards.map((card) => card.id), useCanvasStore.getState().getLayout().cards),
          liveDx: 0,
          liveDy: 0,
          avoidance: { positions: new Map(), affectedIds: new Set() },
          liveFrameIds: new Set(),
        }
        element.dataset.dragging = 'true'
      }
      element.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      const state = stateRef.current
      if (!state) return
      if (state.kind === 'drag') {
        handleDragMove(element, state, event)
      } else {
        handleResizeMove(element, state, event)
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      const state = stateRef.current
      if (!state) return
      try { element.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      stateRef.current = null
      element.style.transform = ''
      delete element.dataset.dragging
      delete element.dataset.resizing

      if (state.kind === 'drag') {
        resetLiveCardMovement(state.ids)
        useCanvasUiStore.getState().clearGuides()
        if (state.liveDx !== 0 || state.liveDy !== 0) {
          useCanvasStore.getState().moveCards(state.ids, state.liveDx, state.liveDy)
          const ui = useUIStore.getState()
          if (ui.settings.canvasArrangeMode !== 'free') {
            ui.updateSettings({ canvasArrangeMode: 'free' })
          }
        }
        if (state.avoidance.positions.size > 0) {
          useCanvasStore.getState().updateCardPositions(state.avoidance.positions)
        }
        resetLiveFrameAutoLayout(state.liveFrameIds)
        cleanupAvoidanceTransitions(state.avoidance.affectedIds)
        return
      }

      if (state.liveGeometry.size > 0) {
        useCanvasStore.getState().updateCardsGeometry(state.liveGeometry)
        const ui = useUIStore.getState()
        if (ui.settings.canvasArrangeMode !== 'free') {
          ui.updateSettings({ canvasArrangeMode: 'free' })
        }
      }
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerUp)

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerUp)
    }
  }, [element])
}

function handleDragMove(
  element: HTMLDivElement,
  state: Extract<InteractionState, { kind: 'drag' }>,
  event: PointerEvent,
): void {
  const scale = useCanvasStore.getState().getLayout().viewport.scale
  const rawDx = (event.clientX - state.startClientX) / scale
  const rawDy = (event.clientY - state.startClientY) / scale
  const cards = useCanvasStore.getState().getLayout().cards
  const settings = useUIStore.getState().settings
  const snap = settings.canvasSnapEnabled
    ? computeSnap(rawDx, rawDy, state.ids, cards, scale, true)
    : { dx: rawDx, dy: rawDy, guides: [] }
  const { dx, dy } = snap

  useCanvasUiStore.getState().setGuides(snap.guides)
  state.liveDx = dx
  state.liveDy = dy
  element.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`

  if (settings.canvasOverlapMode === 'avoid') {
    const avoidance = resolveAvoidOverlap(cards, state.ids, dx, dy)
    applyAvoidanceStyles(cards, avoidance, state.avoidance)
    state.avoidance = avoidance
  } else if (state.avoidance.affectedIds.size > 0) {
    applyAvoidanceStyles(cards, { positions: new Map(), affectedIds: new Set() }, state.avoidance)
    state.avoidance = { positions: new Map(), affectedIds: new Set() }
  }

  applyLiveCardMovement(state.ids, cards, dx, dy, scale)
  state.liveFrameIds = applyLiveFrameAutoLayoutForMovement(state.ids, cards, dx, dy, state.liveFrameIds)
}

function handleResizeMove(
  element: HTMLDivElement,
  state: Extract<InteractionState, { kind: 'resize' }>,
  event: PointerEvent,
): void {
  const viewport = useCanvasStore.getState().getLayout().viewport
  const dx = (event.clientX - state.startClientX) / viewport.scale
  const dy = (event.clientY - state.startClientY) / viewport.scale
  const geometry = computeGroupResize(state.bounds, state.cards, state.handle, dx, dy)
  state.liveGeometry = geometry
  applyLiveResizeGeometry(geometry, viewport)

  const nextBounds = getBounds([...geometry.entries()].map(([id, rect]) => ({
    id,
    kind: 'note',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  } as CanvasCard)))
  element.style.left = `${nextBounds.x * viewport.scale + viewport.offsetX - 8}px`
  element.style.top = `${nextBounds.y * viewport.scale + viewport.offsetY - 8}px`
  element.style.width = `${nextBounds.width * viewport.scale + 16}px`
  element.style.height = `${nextBounds.height * viewport.scale + 16}px`
}

function computeGroupResize(
  bounds: BoundsRect,
  cards: CardRect[],
  handle: SelectionResizeHandle,
  dx: number,
  dy: number,
): Map<string, BoundsRect> {
  const horizontal = handle.includes('e') || handle.includes('w')
  const vertical = handle.includes('n') || handle.includes('s')
  const minScaleX = horizontal
    ? Math.max(...cards.map((card) => card.minWidth / Math.max(1, card.width)), 0.05)
    : 1
  const minScaleY = vertical
    ? Math.max(...cards.map((card) => card.minHeight / Math.max(1, card.height)), 0.05)
    : 1

  let nextX = bounds.x
  let nextY = bounds.y
  let nextWidth = bounds.width
  let nextHeight = bounds.height

  if (handle.includes('e')) {
    nextWidth = Math.max(bounds.width * minScaleX, bounds.width + dx)
  }
  if (handle.includes('w')) {
    nextWidth = Math.max(bounds.width * minScaleX, bounds.width - dx)
    nextX = bounds.x + bounds.width - nextWidth
  }
  if (handle.includes('s')) {
    nextHeight = Math.max(bounds.height * minScaleY, bounds.height + dy)
  }
  if (handle.includes('n')) {
    nextHeight = Math.max(bounds.height * minScaleY, bounds.height - dy)
    nextY = bounds.y + bounds.height - nextHeight
  }

  const scaleX = horizontal ? nextWidth / bounds.width : 1
  const scaleY = vertical ? nextHeight / bounds.height : 1
  const geometry = new Map<string, BoundsRect>()

  for (const card of cards) {
    const x = horizontal ? nextX + (card.x - bounds.x) * scaleX : card.x
    const y = vertical ? nextY + (card.y - bounds.y) * scaleY : card.y
    const width = horizontal ? Math.max(card.minWidth, card.width * scaleX) : card.width
    const height = vertical ? Math.max(card.minHeight, card.height * scaleY) : card.height
    geometry.set(card.id, { x, y, width, height })
  }

  return geometry
}

function applyLiveResizeGeometry(
  geometry: Map<string, BoundsRect>,
  viewport: { scale: number; offsetX: number; offsetY: number },
): void {
  for (const [id, rect] of geometry) {
    const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
    if (!el) continue
    const mode = el.dataset.cardCoordinateMode
    if (mode === 'screen') {
      el.style.left = `${Math.round(rect.x * viewport.scale + viewport.offsetX)}px`
      el.style.top = `${Math.round(rect.y * viewport.scale + viewport.offsetY)}px`
      el.style.width = `${Math.max(1, Math.round(rect.width * viewport.scale))}px`
      el.style.height = `${Math.max(1, Math.round(rect.height * viewport.scale))}px`
    } else if (mode === 'screen-transform') {
      el.style.left = `${Math.round(rect.x * viewport.scale + viewport.offsetX)}px`
      el.style.top = `${Math.round(rect.y * viewport.scale + viewport.offsetY)}px`
      el.style.width = `${rect.width}px`
      el.style.height = `${rect.height}px`
    } else {
      el.style.left = `${rect.x}px`
      el.style.top = `${rect.y}px`
      el.style.width = `${rect.width}px`
      el.style.height = `${rect.height}px`
    }
  }
}

function getBounds(cards: Array<{ x: number; y: number; width: number; height: number }>): BoundsRect {
  const minX = Math.min(...cards.map((card) => card.x))
  const minY = Math.min(...cards.map((card) => card.y))
  const maxX = Math.max(...cards.map((card) => card.x + card.width))
  const maxY = Math.max(...cards.map((card) => card.y + card.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function getMinSize(card: CanvasCard): { minWidth: number; minHeight: number } {
  if (card.kind === 'session' || card.kind === 'terminal') {
    return { minWidth: 320, minHeight: card.collapsed ? 104 : 240 }
  }
  if (card.kind === 'frame') return { minWidth: 240, minHeight: 160 }
  if (card.kind === 'note') return { minWidth: 160, minHeight: 120 }
  return { minWidth: 120, minHeight: 80 }
}
