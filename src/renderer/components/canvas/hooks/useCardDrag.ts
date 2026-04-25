import { useEffect, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { useUIStore, type CanvasArrangeMode } from '@/stores/ui'
import type { CanvasCard } from '@shared/types'
import { computeSnap } from './useSnapGuides'

const DOUBLE_CLICK_MS = 300
const DOUBLE_CLICK_SLOP_PX = 8
const AVOID_OVERLAP_GAP = 24
const AVOID_OVERLAP_TRANSITION_MS = 140
const ARRANGE_CONSTRAINT_GAP = 24
const ARRANGE_CONSTRAINT_TRANSITION_MS = 140

interface CardRect {
  id: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}

interface AvoidanceState {
  positions: Map<string, { x: number; y: number }>
  affectedIds: Set<string>
}

interface ArrangeConstraintState {
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
}: UseCardDragOptions): void {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const clickCandidateRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastClickRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const draggedIdsRef = useRef<string[]>([])
  const liveDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const avoidanceRef = useRef<AvoidanceState>({ positions: new Map(), affectedIds: new Set() })
  const arrangementRef = useRef<ArrangeConstraintState>({ positions: new Map(), affectedIds: new Set() })

  useEffect(() => {
    if (!element) return

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (!target || !target.closest(handleSelector)) return
      // Let controls within the handle (buttons etc.) still work.
      if (target.closest('[data-card-control]')) return
      event.preventDefault()
      event.stopPropagation()

      const now = performance.now()
      const lastClick = lastClickRef.current
      const isDoubleClick = Boolean(
        lastClick
          && now - lastClick.time <= DOUBLE_CLICK_MS
          && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) <= DOUBLE_CLICK_SLOP_PX,
      )
      if (isDoubleClick && enableDoubleClickFocus) {
        startRef.current = null
        clickCandidateRef.current = null
        lastClickRef.current = null
        useCanvasStore.getState().focusOnCard(cardId)
        return
      }

      const store = useCanvasStore.getState()
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
      arrangementRef.current = { positions: new Map(), affectedIds: new Set() }
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
      const arrangeMode = settings.canvasArrangeMode
      const constrainArrangement = settings.canvasArrangeConstrained && arrangeMode !== 'free'
      const snapEnabled = settings.canvasSnapEnabled
      const snap = !constrainArrangement && snapEnabled
        ? computeSnap(rawDx, rawDy, ids, cards, scale, true)
        : { dx: rawDx, dy: rawDy, guides: [] }
      let { dx, dy } = snap
      let constrainedArrangement: ArrangeConstraintState | null = null

      if (constrainArrangement) {
        constrainedArrangement = resolveConstrainedArrangement(cards, ids, cardId, arrangeMode as Exclude<CanvasArrangeMode, 'free'>, rawDx, rawDy)
        applyArrangementConstraintStyles(cards, constrainedArrangement, arrangementRef.current, ids)
        arrangementRef.current = constrainedArrangement
        useCanvasUiStore.getState().clearGuides()
        if (avoidanceRef.current.affectedIds.size > 0) {
          applyAvoidanceStyles(cards, { positions: new Map(), affectedIds: new Set() }, avoidanceRef.current)
          avoidanceRef.current = { positions: new Map(), affectedIds: new Set() }
        }
        const primaryCard = cards.find((card) => card.id === cardId)
        const primaryPosition = constrainedArrangement.positions.get(cardId)
        if (primaryCard && primaryPosition) {
          dx = primaryPosition.x - primaryCard.x
          dy = primaryPosition.y - primaryCard.y
        }
      } else {
        if (arrangementRef.current.affectedIds.size > 0) {
          applyArrangementConstraintStyles(cards, { positions: new Map(), affectedIds: new Set() }, arrangementRef.current, ids)
          arrangementRef.current = { positions: new Map(), affectedIds: new Set() }
        }
        useCanvasUiStore.getState().setGuides(snap.guides)
      }
      liveDeltaRef.current = { dx, dy }

      if (!constrainArrangement && settings.canvasOverlapMode === 'avoid') {
        const avoidance = resolveAvoidOverlap(cards, ids, dx, dy)
        applyAvoidanceStyles(cards, avoidance, avoidanceRef.current)
        avoidanceRef.current = avoidance
      } else if (!constrainArrangement && avoidanceRef.current.affectedIds.size > 0) {
        applyAvoidanceStyles(cards, { positions: new Map(), affectedIds: new Set() }, avoidanceRef.current)
        avoidanceRef.current = { positions: new Map(), affectedIds: new Set() }
      }

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
        const constrainedPosition = constrainedArrangement?.positions.get(id)
        const liveDxWorld = constrainedPosition ? constrainedPosition.x - card.x : dx
        const liveDyWorld = constrainedPosition ? constrainedPosition.y - card.y : dy
        const liveDx = isScreenProjected ? liveDxWorld * scale : liveDxWorld
        const liveDy = isScreenProjected ? liveDyWorld * scale : liveDyWorld
        if (mode === 'screen-transform') {
          el.style.setProperty('--card-live-dx', `${liveDx}px`)
          el.style.setProperty('--card-live-dy', `${liveDy}px`)
        } else {
          el.style.transform = `translate(${liveDx}px, ${liveDy}px)`
        }
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      const start = startRef.current
      if (!start) return
      try { element.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      const { dx, dy } = liveDeltaRef.current
      const ids = draggedIdsRef.current
      const avoidance = avoidanceRef.current
      const arrangement = arrangementRef.current
      const clickCandidate = clickCandidateRef.current
      const movedScreen = Math.hypot(event.clientX - start.x, event.clientY - start.y) > DOUBLE_CLICK_SLOP_PX
      startRef.current = null
      clickCandidateRef.current = null
      draggedIdsRef.current = []
      liveDeltaRef.current = { dx: 0, dy: 0 }
      avoidanceRef.current = { positions: new Map(), affectedIds: new Set() }
      arrangementRef.current = { positions: new Map(), affectedIds: new Set() }

      // Reset transforms so commit takes effect via re-render.
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
      useCanvasUiStore.getState().clearGuides()
      if (arrangement.positions.size > 0) {
        useCanvasStore.getState().updateCardPositions(arrangement.positions)
      } else if (dx !== 0 || dy !== 0) {
        useCanvasStore.getState().moveCards(ids, dx, dy)
        const ui = useUIStore.getState()
        if (ui.settings.canvasArrangeMode !== 'free') {
          ui.updateSettings({ canvasArrangeMode: 'free' })
        }
      }
      if (arrangement.positions.size === 0 && avoidance.positions.size > 0) {
        useCanvasStore.getState().updateCardPositions(avoidance.positions)
      }
      cleanupArrangementConstraintTransitions(arrangement.affectedIds)
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
  }, [element, cardId, handleSelector, enableDoubleClickFocus])
}

function resolveConstrainedArrangement(
  cards: CanvasCard[],
  draggedIds: string[],
  primaryId: string,
  mode: Exclude<CanvasArrangeMode, 'free'>,
  dx: number,
  dy: number,
): ArrangeConstraintState {
  const ordered = sortCardsForArrangeMode(cards, mode)
  const dragged = new Set(draggedIds)
  const draggedGroup = ordered.filter((card) => dragged.has(card.id))
  if (draggedGroup.length === 0) return { positions: new Map(), affectedIds: new Set() }

  const others = ordered.filter((card) => !dragged.has(card.id))
  const primary = cards.find((card) => card.id === primaryId) ?? draggedGroup[0]
  const origin = getArrangeOrigin(cards)
  const insertIndex = getArrangeInsertIndex(others, cards.length, primary, mode, origin, dx, dy)
  const nextOrder = [
    ...others.slice(0, insertIndex),
    ...draggedGroup,
    ...others.slice(insertIndex),
  ]
  const positions = computeArrangePositions(nextOrder, mode, origin)
  return { positions, affectedIds: new Set(positions.keys()) }
}

function sortCardsForArrangeMode(cards: CanvasCard[], mode: Exclude<CanvasArrangeMode, 'free'>): CanvasCard[] {
  const byX = (a: CanvasCard, b: CanvasCard): number => (a.x - b.x) || (a.y - b.y) || (a.createdAt - b.createdAt)
  const byY = (a: CanvasCard, b: CanvasCard): number => (a.y - b.y) || (a.x - b.x) || (a.createdAt - b.createdAt)
  if (mode === 'rowFlow') return [...cards].sort(byX)
  if (mode === 'colFlow') return [...cards].sort(byY)
  return [...cards].sort(byY)
}

function getArrangeOrigin(cards: CanvasCard[]): { x: number; y: number } {
  return {
    x: Math.min(...cards.map((card) => card.x)),
    y: Math.min(...cards.map((card) => card.y)),
  }
}

function getArrangeInsertIndex(
  others: CanvasCard[],
  totalCount: number,
  primary: CanvasCard,
  mode: Exclude<CanvasArrangeMode, 'free'>,
  origin: { x: number; y: number },
  dx: number,
  dy: number,
): number {
  const pointerX = primary.x + dx + primary.width / 2
  const pointerY = primary.y + dy + primary.height / 2

  if (mode === 'rowFlow') {
    return others.filter((card) => pointerX > card.x + card.width / 2).length
  }
  if (mode === 'colFlow') {
    return others.filter((card) => pointerY > card.y + card.height / 2).length
  }

  const metrics = getGridMetrics([...others, primary], totalCount)
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < totalCount; index += 1) {
    const col = index % metrics.cols
    const row = Math.floor(index / metrics.cols)
    const centerX = origin.x + col * metrics.cellWidth + metrics.cellWidth / 2
    const centerY = origin.y + row * metrics.cellHeight + metrics.cellHeight / 2
    const distance = Math.hypot(pointerX - centerX, pointerY - centerY)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }
  return Math.max(0, Math.min(others.length, nearestIndex))
}

function computeArrangePositions(
  ordered: CanvasCard[],
  mode: Exclude<CanvasArrangeMode, 'free'>,
  origin: { x: number; y: number },
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()

  if (mode === 'rowFlow') {
    let x = origin.x
    for (const card of ordered) {
      positions.set(card.id, { x, y: origin.y })
      x += card.width + ARRANGE_CONSTRAINT_GAP
    }
    return positions
  }

  if (mode === 'colFlow') {
    let y = origin.y
    for (const card of ordered) {
      positions.set(card.id, { x: origin.x, y })
      y += card.height + ARRANGE_CONSTRAINT_GAP
    }
    return positions
  }

  const metrics = getGridMetrics(ordered, ordered.length)
  let y = origin.y
  for (let rowStart = 0; rowStart < ordered.length; rowStart += metrics.cols) {
    const rowCards = ordered.slice(rowStart, rowStart + metrics.cols)
    const rowHeight = Math.max(...rowCards.map((rowCard) => rowCard.height))
    rowCards.forEach((rowCard, col) => {
      positions.set(rowCard.id, {
        x: origin.x + col * metrics.cellWidth,
        y,
      })
    })
    y += rowHeight + ARRANGE_CONSTRAINT_GAP
  }
  return positions
}

function getGridMetrics(
  cards: CanvasCard[],
  totalCount: number,
): { cols: number; cellWidth: number; cellHeight: number } {
  return {
    cols: Math.max(1, Math.ceil(Math.sqrt(totalCount))),
    cellWidth: Math.max(...cards.map((card) => card.width)) + ARRANGE_CONSTRAINT_GAP,
    cellHeight: Math.max(...cards.map((card) => card.height)) + ARRANGE_CONSTRAINT_GAP,
  }
}

function resolveAvoidOverlap(
  cards: CanvasCard[],
  draggedIds: string[],
  dx: number,
  dy: number,
): AvoidanceState {
  const dragged = new Set(draggedIds)
  const rects = new Map<string, CardRect>()
  const moved = new Set<string>()

  for (const card of cards) {
    rects.set(card.id, {
      id: card.id,
      x: card.x + (dragged.has(card.id) ? dx : 0),
      y: card.y + (dragged.has(card.id) ? dy : 0),
      width: card.width,
      height: card.height,
      zIndex: card.zIndex,
    })
  }

  const ordered = [...cards].sort((a, b) => a.zIndex - b.zIndex)
  const maxIterations = Math.max(12, cards.length * 8)

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
  for (const card of cards) {
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

function applyArrangementConstraintStyles(
  cards: CanvasCard[],
  next: ArrangeConstraintState,
  previous: ArrangeConstraintState,
  draggedIds: string[],
): void {
  const dragged = new Set(draggedIds)
  const viewport = useCanvasStore.getState().getLayout().viewport
  const affectedIds = new Set([...previous.affectedIds, ...next.affectedIds])

  for (const id of affectedIds) {
    if (dragged.has(id)) continue
    const card = cards.find((candidate) => candidate.id === id)
    if (!card) continue
    const position = next.positions.get(id) ?? { x: card.x, y: card.y }
    const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
    if (!el) continue

    el.style.transition = `left ${ARRANGE_CONSTRAINT_TRANSITION_MS}ms ease, top ${ARRANGE_CONSTRAINT_TRANSITION_MS}ms ease`

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

function cleanupArrangementConstraintTransitions(affectedIds: Set<string>): void {
  if (affectedIds.size === 0) return
  setTimeout(() => {
    for (const id of affectedIds) {
      const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
      if (el) el.style.transition = ''
    }
  }, ARRANGE_CONSTRAINT_TRANSITION_MS + 40)
}

function applyAvoidanceStyles(
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

function cleanupAvoidanceTransitions(affectedIds: Set<string>): void {
  if (affectedIds.size === 0) return
  setTimeout(() => {
    for (const id of affectedIds) {
      const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
      if (el) el.style.transition = ''
    }
  }, AVOID_OVERLAP_TRANSITION_MS + 40)
}
