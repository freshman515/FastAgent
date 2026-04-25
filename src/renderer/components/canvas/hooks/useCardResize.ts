import { useEffect, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import type { CardCoordinateMode } from '../cards/CardFrame'

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface UseCardResizeOptions {
  cardId: string
  /** Host element hosting the resize handles (children with `data-card-resize=handle`). */
  element: HTMLDivElement | null
  minWidth?: number
  minHeight?: number
  coordinateMode?: CardCoordinateMode
}

/**
 * Edge/corner resize. Like drag, we mutate the card's style during move and
 * commit once on pointerup — avoids per-frame React renders.
 */
export function useCardResize({
  cardId,
  element,
  minWidth = 180,
  minHeight = 120,
  coordinateMode = 'world',
}: UseCardResizeOptions): void {
  const stateRef = useRef<{
    handle: ResizeHandle
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    startWidth: number
    startHeight: number
    liveWidth: number
    liveHeight: number
    liveX: number
    liveY: number
  } | null>(null)

  useEffect(() => {
    if (!element) return

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (!target) return
      const handle = target.closest<HTMLElement>('[data-card-resize]')
      if (!handle) return
      const direction = handle.dataset.cardResize as ResizeHandle | undefined
      if (!direction) return
      event.preventDefault()
      event.stopPropagation()

      const card = useCanvasStore.getState().getCard(cardId)
      if (!card) return

      stateRef.current = {
        handle: direction,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: card.x,
        startY: card.y,
        startWidth: card.width,
        startHeight: card.height,
        liveWidth: card.width,
        liveHeight: card.height,
        liveX: card.x,
        liveY: card.y,
      }
      element.setPointerCapture(event.pointerId)
      useCanvasStore.getState().setSelection([cardId])
      useCanvasStore.getState().bringToFront(cardId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      const state = stateRef.current
      if (!state) return
      const scale = useCanvasStore.getState().getLayout().viewport.scale
      const dx = (event.clientX - state.startClientX) / scale
      const dy = (event.clientY - state.startClientY) / scale
      const { handle, startX, startY, startWidth, startHeight } = state

      let nextX = startX
      let nextY = startY
      let nextWidth = startWidth
      let nextHeight = startHeight

      if (handle === 'e' || handle === 'ne' || handle === 'se') {
        nextWidth = Math.max(minWidth, startWidth + dx)
      }
      if (handle === 'w' || handle === 'nw' || handle === 'sw') {
        nextWidth = Math.max(minWidth, startWidth - dx)
        nextX = startX + (startWidth - nextWidth)
      }
      if (handle === 's' || handle === 'se' || handle === 'sw') {
        nextHeight = Math.max(minHeight, startHeight + dy)
      }
      if (handle === 'n' || handle === 'ne' || handle === 'nw') {
        nextHeight = Math.max(minHeight, startHeight - dy)
        nextY = startY + (startHeight - nextHeight)
      }

      state.liveWidth = nextWidth
      state.liveHeight = nextHeight
      state.liveX = nextX
      state.liveY = nextY

      const cardEl = document.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`)
      if (cardEl) {
        if (coordinateMode === 'screen') {
          const viewport = useCanvasStore.getState().getLayout().viewport
          cardEl.style.left = `${Math.round(nextX * viewport.scale + viewport.offsetX)}px`
          cardEl.style.top = `${Math.round(nextY * viewport.scale + viewport.offsetY)}px`
          cardEl.style.width = `${Math.max(1, Math.round(nextWidth * viewport.scale))}px`
          cardEl.style.height = `${Math.max(1, Math.round(nextHeight * viewport.scale))}px`
        } else if (coordinateMode === 'screen-transform') {
          const viewport = useCanvasStore.getState().getLayout().viewport
          cardEl.style.left = `${Math.round(nextX * viewport.scale + viewport.offsetX)}px`
          cardEl.style.top = `${Math.round(nextY * viewport.scale + viewport.offsetY)}px`
          cardEl.style.width = `${nextWidth}px`
          cardEl.style.height = `${nextHeight}px`
        } else {
          cardEl.style.left = `${nextX}px`
          cardEl.style.top = `${nextY}px`
          cardEl.style.width = `${nextWidth}px`
          cardEl.style.height = `${nextHeight}px`
        }
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      const state = stateRef.current
      if (!state) return
      try { element.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      const { liveWidth, liveHeight, liveX, liveY } = state
      stateRef.current = null
      useCanvasStore.getState().resizeCard(cardId, liveWidth, liveHeight, liveX, liveY)
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
  }, [element, cardId, minWidth, minHeight, coordinateMode])
}
