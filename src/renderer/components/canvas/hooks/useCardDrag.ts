import { useEffect, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { useUIStore } from '@/stores/ui'
import { computeSnap } from './useSnapGuides'

const DOUBLE_CLICK_MS = 300
const DOUBLE_CLICK_SLOP_PX = 8

interface UseCardDragOptions {
  cardId: string
  /** Ref to the card outer element — pointer events dispatched from its drag handle start the drag. */
  element: HTMLDivElement | null
  /** DOM selector that, when matched by the pointerdown target, starts the drag. */
  handleSelector?: string
}

/**
 * Pointer-based drag. During the drag we only mutate `element.style.transform`
 * for every selected card — no re-renders. On pointerup we commit the delta to
 * the store (which triggers a single render).
 */
export function useCardDrag({ cardId, element, handleSelector = '[data-card-drag]' }: UseCardDragOptions): void {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const clickCandidateRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastClickRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const draggedIdsRef = useRef<string[]>([])
  const liveDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

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
      if (isDoubleClick) {
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
      const snapEnabled = useUIStore.getState().settings.canvasSnapEnabled
      const { dx, dy, guides } = snapEnabled
        ? computeSnap(rawDx, rawDy, ids, cards, scale, true)
        : { dx: rawDx, dy: rawDy, guides: [] }
      liveDeltaRef.current = { dx, dy }
      useCanvasUiStore.getState().setGuides(guides)

      // Apply live movement in the coordinate space used by each card's layer.
      // Screen-projected cards are not inside the scaled world layer, so their
      // visual delta must be converted back to screen pixels.
      for (const id of ids) {
        const card = cards.find((c) => c.id === id)
        if (!card) continue
        const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
        if (!el) continue
        const isScreenProjected = el.dataset.cardCoordinateMode === 'screen'
        const liveDx = isScreenProjected ? dx * scale : dx
        const liveDy = isScreenProjected ? dy * scale : dy
        el.style.transform = `translate(${liveDx}px, ${liveDy}px)`
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      const start = startRef.current
      if (!start) return
      try { element.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      const { dx, dy } = liveDeltaRef.current
      const ids = draggedIdsRef.current
      const clickCandidate = clickCandidateRef.current
      const movedScreen = Math.hypot(event.clientX - start.x, event.clientY - start.y) > DOUBLE_CLICK_SLOP_PX
      startRef.current = null
      clickCandidateRef.current = null
      draggedIdsRef.current = []
      liveDeltaRef.current = { dx: 0, dy: 0 }

      // Reset transforms so commit takes effect via re-render.
      for (const id of ids) {
        const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
        if (el) el.style.transform = ''
      }
      useCanvasUiStore.getState().clearGuides()
      if (dx !== 0 || dy !== 0) {
        useCanvasStore.getState().moveCards(ids, dx, dy)
      }
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
  }, [element, cardId, handleSelector])
}
