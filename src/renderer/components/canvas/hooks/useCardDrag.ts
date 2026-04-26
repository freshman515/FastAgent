import { useEffect, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { useUIStore } from '@/stores/ui'
import type { CanvasCard } from '@shared/types'
import { computeSnap } from './useSnapGuides'

const DOUBLE_CLICK_MS = 300
const DOUBLE_CLICK_SLOP_PX = 8
const AVOID_OVERLAP_GAP = 24
const AVOID_OVERLAP_TRANSITION_MS = 140

interface CardRect {
  id: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}

export interface AvoidanceState {
  positions: Map<string, { x: number; y: number }>
  affectedIds: Set<string>
}

interface UseCardDragOptions {
  cardId: string
  /** Ref to the card outer element — pointer events dispatched from its drag handle start the drag. */
  element: HTMLDivElement | null
  /** DOM selector that, when matched by the pointerdown target, starts the drag. */
  handleSelector?: string
  enableDoubleClickFocus?: boolean
  onHandleDoubleClick?: () => void
}

/**
 * Pointer-based drag. During the drag we only mutate each selected card's
 * inline transform or live transform variables — no re-renders. On pointerup
 * we commit the delta to the store (which triggers a single render).
 */
export function useCardDrag({
  cardId,
  element,
  handleSelector = '[data-card-drag]',
  enableDoubleClickFocus = true,
  onHandleDoubleClick,
}: UseCardDragOptions): void {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const clickCandidateRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastClickRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const draggedIdsRef = useRef<string[]>([])
  const liveDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const avoidanceRef = useRef<AvoidanceState>({ positions: new Map(), affectedIds: new Set() })

  useEffect(() => {
    if (!element) return

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (!target || !target.closest(handleSelector)) return
      // Let controls within the handle (buttons etc.) still work.
      if (target.closest('[data-card-control]')) return
      const now = performance.now()
      const lastClick = lastClickRef.current
      const isDoubleClick = Boolean(
        lastClick
          && now - lastClick.time <= DOUBLE_CLICK_MS
          && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) <= DOUBLE_CLICK_SLOP_PX,
      )
      if (isDoubleClick && (onHandleDoubleClick || enableDoubleClickFocus)) {
        event.preventDefault()
        event.stopPropagation()
        startRef.current = null
        clickCandidateRef.current = null
        lastClickRef.current = null
        if (onHandleDoubleClick) {
          onHandleDoubleClick()
        } else {
          useCanvasStore.getState().focusOnCard(cardId)
        }
        return
      }

      const store = useCanvasStore.getState()
      if (useUIStore.getState().settings.canvasLayoutLocked || store.maximizedCardId === cardId) {
        lastClickRef.current = { x: event.clientX, y: event.clientY, time: now }
        return
      }
      event.preventDefault()
      event.stopPropagation()

      const selection = store.selectedCardIds
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      if (!selection.includes(cardId)) {
        store.setSelection(additive ? [...selection, cardId] : [cardId])
      } else if (additive) {
        store.toggleSelection(cardId, true)
      }
      store.bringToFront(cardId)

      startRef.current = { x: event.clientX, y: event.clientY }
      clickCandidateRef.current = { x: event.clientX, y: event.clientY, time: now }
      draggedIdsRef.current = useCanvasStore.getState().selectedCardIds
      liveDeltaRef.current = { dx: 0, dy: 0 }
      avoidanceRef.current = { positions: new Map(), affectedIds: new Set() }
      element.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!startRef.current) return
      const scale = useCanvasStore.getState().getLayout().viewport.scale
      const dxScreen = event.clientX - startRef.current.x
      const dyScreen = event.clientY - startRef.current.y
      const rawDx = dxScreen / scale
      const rawDy = dyScreen / scale

      const ids = draggedIdsRef.current
      const cards = useCanvasStore.getState().getLayout().cards
      const settings = useUIStore.getState().settings
      const snapEnabled = settings.canvasSnapEnabled
      const snap = snapEnabled
        ? computeSnap(rawDx, rawDy, ids, cards, scale, true)
        : { dx: rawDx, dy: rawDy, guides: [] }
      const { dx, dy } = snap

      useCanvasUiStore.getState().setGuides(snap.guides)
      liveDeltaRef.current = { dx, dy }

      if (settings.canvasOverlapMode === 'avoid') {
        const avoidance = resolveAvoidOverlap(cards, ids, dx, dy)
        applyAvoidanceStyles(cards, avoidance, avoidanceRef.current)
        avoidanceRef.current = avoidance
      } else if (avoidanceRef.current.affectedIds.size > 0) {
        applyAvoidanceStyles(cards, { positions: new Map(), affectedIds: new Set() }, avoidanceRef.current)
        avoidanceRef.current = { positions: new Map(), affectedIds: new Set() }
      }

      applyLiveCardMovement(ids, cards, dx, dy, scale)
    }

    const onPointerUp = (event: PointerEvent): void => {
      const start = startRef.current
      if (!start) return
      try { element.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      const { dx, dy } = liveDeltaRef.current
      const ids = draggedIdsRef.current
      const avoidance = avoidanceRef.current
      const clickCandidate = clickCandidateRef.current
      const movedScreen = Math.hypot(event.clientX - start.x, event.clientY - start.y) > DOUBLE_CLICK_SLOP_PX
      startRef.current = null
      clickCandidateRef.current = null
      draggedIdsRef.current = []
      liveDeltaRef.current = { dx: 0, dy: 0 }
      avoidanceRef.current = { positions: new Map(), affectedIds: new Set() }

      resetLiveCardMovement(ids)
      useCanvasUiStore.getState().clearGuides()
      if (dx !== 0 || dy !== 0) {
        useCanvasStore.getState().moveCards(ids, dx, dy)
        const ui = useUIStore.getState()
        if (ui.settings.canvasArrangeMode !== 'free') {
          ui.updateSettings({ canvasArrangeMode: 'free' })
        }
      }
      if (avoidance.positions.size > 0) {
        useCanvasStore.getState().updateCardPositions(avoidance.positions)
      }
      cleanupAvoidanceTransitions(avoidance.affectedIds)
      lastClickRef.current = !movedScreen && event.type === 'pointerup' ? clickCandidate : null
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
  }, [element, cardId, handleSelector, enableDoubleClickFocus, onHandleDoubleClick])
}

export function applyLiveCardMovement(
  ids: string[],
  cards: CanvasCard[],
  dx: number,
  dy: number,
  scale: number,
): void {
  // Apply live movement in the coordinate space used by each card's layer.
  // Screen-projected cards are not inside the scaled world layer, so their
  // visual delta must be converted back to screen pixels.
  for (const id of ids) {
    const card = cards.find((c) => c.id === id)
    if (!card) continue
    const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
    if (!el) continue
    const mode = el.dataset.cardCoordinateMode
    const isScreenProjected = mode === 'screen' || mode === 'screen-transform'
    const liveDx = isScreenProjected ? dx * scale : dx
    const liveDy = isScreenProjected ? dy * scale : dy
    if (mode === 'screen-transform') {
      el.style.setProperty('--card-live-dx', `${liveDx}px`)
      el.style.setProperty('--card-live-dy', `${liveDy}px`)
    } else {
      el.style.transform = `translate(${liveDx}px, ${liveDy}px)`
    }
  }
}

export function resetLiveCardMovement(ids: string[]): void {
  for (const id of ids) {
    const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
    if (el) {
      if (el.dataset.cardCoordinateMode !== 'screen-transform') {
        el.style.transform = ''
      }
      el.style.removeProperty('--card-live-dx')
      el.style.removeProperty('--card-live-dy')
    }
  }
}

export function resolveAvoidOverlap(
  cards: CanvasCard[],
  draggedIds: string[],
  dx: number,
  dy: number,
): AvoidanceState {
  const dragged = new Set(draggedIds)
  const collisionCards = cards.filter((card) => card.kind !== 'frame')
  const rects = new Map<string, CardRect>()
  const moved = new Set<string>()

  for (const card of collisionCards) {
    rects.set(card.id, {
      id: card.id,
      x: card.x + (dragged.has(card.id) ? dx : 0),
      y: card.y + (dragged.has(card.id) ? dy : 0),
      width: card.width,
      height: card.height,
      zIndex: card.zIndex,
    })
  }

  const ordered = [...collisionCards].sort((a, b) => a.zIndex - b.zIndex)
  const maxIterations = Math.max(12, collisionCards.length * 8)

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false

    for (let aIndex = 0; aIndex < ordered.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < ordered.length; bIndex += 1) {
        const a = rects.get(ordered[aIndex].id)
        const b = rects.get(ordered[bIndex].id)
        if (!a || !b || !overlapsWithGap(a, b, AVOID_OVERLAP_GAP)) continue

        const aDragged = dragged.has(a.id)
        const bDragged = dragged.has(b.id)
        if (aDragged && bDragged) continue

        const { anchor, mover } = chooseCollisionPair(a, b, dragged, moved)
        const push = computePush(anchor, mover, AVOID_OVERLAP_GAP)
        if (Math.abs(push.dx) < 0.1 && Math.abs(push.dy) < 0.1) continue

        mover.x += push.dx
        mover.y += push.dy
        moved.add(mover.id)
        changed = true
      }
    }

    if (!changed) break
  }

  const positions = new Map<string, { x: number; y: number }>()
  for (const card of collisionCards) {
    if (dragged.has(card.id)) continue
    const rect = rects.get(card.id)
    if (!rect) continue
    if (Math.abs(rect.x - card.x) > 0.1 || Math.abs(rect.y - card.y) > 0.1) {
      positions.set(card.id, { x: rect.x, y: rect.y })
    }
  }

  return { positions, affectedIds: new Set([...moved, ...positions.keys()]) }
}

function chooseCollisionPair(
  a: CardRect,
  b: CardRect,
  dragged: Set<string>,
  moved: Set<string>,
): { anchor: CardRect; mover: CardRect } {
  if (dragged.has(a.id) && !dragged.has(b.id)) return { anchor: a, mover: b }
  if (dragged.has(b.id) && !dragged.has(a.id)) return { anchor: b, mover: a }
  if (moved.has(a.id) && !moved.has(b.id)) return { anchor: a, mover: b }
  if (moved.has(b.id) && !moved.has(a.id)) return { anchor: b, mover: a }
  return a.zIndex >= b.zIndex ? { anchor: a, mover: b } : { anchor: b, mover: a }
}

function overlapsWithGap(a: CardRect, b: CardRect, gap: number): boolean {
  return a.x < b.x + b.width + gap
    && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap
    && a.y + a.height + gap > b.y
}

function computePush(anchor: CardRect, mover: CardRect, gap: number): { dx: number; dy: number } {
  const anchorCenterX = anchor.x + anchor.width / 2
  const anchorCenterY = anchor.y + anchor.height / 2
  const moverCenterX = mover.x + mover.width / 2
  const moverCenterY = mover.y + mover.height / 2

  const shiftRight = moverCenterX >= anchorCenterX
  const shiftDown = moverCenterY >= anchorCenterY
  const pushX = shiftRight
    ? anchor.x + anchor.width + gap - mover.x
    : anchor.x - gap - (mover.x + mover.width)
  const pushY = shiftDown
    ? anchor.y + anchor.height + gap - mover.y
    : anchor.y - gap - (mover.y + mover.height)

  return Math.abs(pushX) <= Math.abs(pushY)
    ? { dx: pushX, dy: 0 }
    : { dx: 0, dy: pushY }
}

export function applyAvoidanceStyles(
  cards: CanvasCard[],
  next: AvoidanceState,
  previous: AvoidanceState,
): void {
  const viewport = useCanvasStore.getState().getLayout().viewport
  const affectedIds = new Set([...previous.affectedIds, ...next.affectedIds])

  for (const id of affectedIds) {
    const card = cards.find((candidate) => candidate.id === id)
    if (!card) continue
    const position = next.positions.get(id) ?? { x: card.x, y: card.y }
    const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
    if (!el) continue

    el.style.transition = `left ${AVOID_OVERLAP_TRANSITION_MS}ms ease, top ${AVOID_OVERLAP_TRANSITION_MS}ms ease`

    const mode = el.dataset.cardCoordinateMode
    if (mode === 'screen' || mode === 'screen-transform') {
      el.style.left = `${Math.round(position.x * viewport.scale + viewport.offsetX)}px`
      el.style.top = `${Math.round(position.y * viewport.scale + viewport.offsetY)}px`
    } else {
      el.style.left = `${position.x}px`
      el.style.top = `${position.y}px`
    }
  }
}

export function cleanupAvoidanceTransitions(affectedIds: Set<string>): void {
  if (affectedIds.size === 0) return
  setTimeout(() => {
    for (const id of affectedIds) {
      const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
      if (el) el.style.transition = ''
    }
  }, AVOID_OVERLAP_TRANSITION_MS + 40)
}
