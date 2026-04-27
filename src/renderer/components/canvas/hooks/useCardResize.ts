import { useEffect, useRef } from 'react'
import { cancelViewportAnimation, useCanvasStore } from '@/stores/canvas'
import { useUIStore } from '@/stores/ui'
import type { CardCoordinateMode } from '../cards/CardFrame'
import { screenToWorld } from './useCanvasViewport'

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const EDGE_PAN_MARGIN_PX = 72
const EDGE_PAN_MAX_SPEED_PX_PER_SECOND = 820

interface ResizeState {
  handle: ResizeHandle
  viewportEl: HTMLDivElement | null
  startClientX: number
  startClientY: number
  startPointerWorldX: number
  startPointerWorldY: number
  lastClientX: number
  lastClientY: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  liveWidth: number
  liveHeight: number
  liveX: number
  liveY: number
}

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
  const stateRef = useRef<ResizeState | null>(null)
  const autoPanFrameRef = useRef<number | null>(null)
  const lastAutoPanTimeRef = useRef<number | null>(null)

  useEffect(() => {
    if (!element) return

    const stopAutoPan = (): void => {
      if (autoPanFrameRef.current !== null) {
        window.cancelAnimationFrame(autoPanFrameRef.current)
        autoPanFrameRef.current = null
      }
      lastAutoPanTimeRef.current = null
    }

    const getPointerWorld = (viewportEl: HTMLDivElement, clientX: number, clientY: number): { x: number; y: number } => {
      const rect = viewportEl.getBoundingClientRect()
      return screenToWorld(
        clientX - rect.left,
        clientY - rect.top,
        useCanvasStore.getState().getLayout().viewport,
      )
    }

    const applyResizeFromPointer = (state: ResizeState, clientX: number, clientY: number): void => {
      state.lastClientX = clientX
      state.lastClientY = clientY

      const viewport = useCanvasStore.getState().getLayout().viewport
      const pointerWorld = state.viewportEl ? getPointerWorld(state.viewportEl, clientX, clientY) : null
      const dx = pointerWorld ? pointerWorld.x - state.startPointerWorldX : (clientX - state.startClientX) / viewport.scale
      const dy = pointerWorld ? pointerWorld.y - state.startPointerWorldY : (clientY - state.startClientY) / viewport.scale
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
          cardEl.style.left = `${Math.round(nextX * viewport.scale + viewport.offsetX)}px`
          cardEl.style.top = `${Math.round(nextY * viewport.scale + viewport.offsetY)}px`
          cardEl.style.width = `${Math.max(1, Math.round(nextWidth * viewport.scale))}px`
          cardEl.style.height = `${Math.max(1, Math.round(nextHeight * viewport.scale))}px`
        } else if (coordinateMode === 'screen-transform') {
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

    const getEdgePanVelocity = (state: ResizeState): { x: number; y: number } => {
      const viewportEl = state.viewportEl
      if (!viewportEl) return { x: 0, y: 0 }

      const rect = viewportEl.getBoundingClientRect()
      const horizontal = state.handle.includes('e') || state.handle.includes('w')
      const vertical = state.handle.includes('n') || state.handle.includes('s')
      let x = 0
      let y = 0

      if (horizontal) {
        const leftDistance = state.lastClientX - rect.left
        const rightDistance = rect.right - state.lastClientX
        if (leftDistance < EDGE_PAN_MARGIN_PX) {
          x = getEdgePanSpeed(leftDistance)
        } else if (rightDistance < EDGE_PAN_MARGIN_PX) {
          x = -getEdgePanSpeed(rightDistance)
        }
      }

      if (vertical) {
        const topDistance = state.lastClientY - rect.top
        const bottomDistance = rect.bottom - state.lastClientY
        if (topDistance < EDGE_PAN_MARGIN_PX) {
          y = getEdgePanSpeed(topDistance)
        } else if (bottomDistance < EDGE_PAN_MARGIN_PX) {
          y = -getEdgePanSpeed(bottomDistance)
        }
      }

      return { x, y }
    }

    const startAutoPan = (): void => {
      if (autoPanFrameRef.current !== null) return

      const tick = (now: number): void => {
        const state = stateRef.current
        if (!state) {
          stopAutoPan()
          return
        }

        const previous = lastAutoPanTimeRef.current ?? now
        const elapsedSeconds = Math.min(0.04, Math.max(0, now - previous) / 1000)
        lastAutoPanTimeRef.current = now

        const velocity = getEdgePanVelocity(state)
        if (velocity.x !== 0 || velocity.y !== 0) {
          const viewport = useCanvasStore.getState().getLayout().viewport
          useCanvasStore.getState().setViewport({
            offsetX: viewport.offsetX + velocity.x * elapsedSeconds,
            offsetY: viewport.offsetY + velocity.y * elapsedSeconds,
          })
          applyResizeFromPointer(state, state.lastClientX, state.lastClientY)
        }

        autoPanFrameRef.current = window.requestAnimationFrame(tick)
      }

      autoPanFrameRef.current = window.requestAnimationFrame(tick)
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (!target) return
      const handle = target.closest<HTMLElement>('[data-card-resize]')
      if (!handle) return
      const direction = handle.dataset.cardResize as ResizeHandle | undefined
      if (!direction) return
      if (useUIStore.getState().settings.canvasLayoutLocked) return
      event.preventDefault()
      event.stopPropagation()

      const card = useCanvasStore.getState().getCard(cardId)
      if (!card) return

      cancelViewportAnimation()
      useCanvasStore.getState().clearFocusReturn()
      const viewportEl = element.closest<HTMLDivElement>('[data-canvas-viewport]')
      const pointerWorld = viewportEl ? getPointerWorld(viewportEl, event.clientX, event.clientY) : null
      stateRef.current = {
        handle: direction,
        viewportEl,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPointerWorldX: pointerWorld?.x ?? 0,
        startPointerWorldY: pointerWorld?.y ?? 0,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
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
      if (card.kind !== 'frame') useCanvasStore.getState().bringToFront(cardId)
      startAutoPan()
    }

    const onPointerMove = (event: PointerEvent): void => {
      const state = stateRef.current
      if (!state) return
      applyResizeFromPointer(state, event.clientX, event.clientY)
    }

    const onPointerUp = (event: PointerEvent): void => {
      const state = stateRef.current
      if (!state) return
      try { element.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      stopAutoPan()
      const { liveWidth, liveHeight, liveX, liveY } = state
      stateRef.current = null
      useCanvasStore.getState().resizeCard(cardId, liveWidth, liveHeight, liveX, liveY)
      if (event.type === 'pointerup') {
        requestAnimationFrame(() => {
          useCanvasStore.getState().focusOnCard(cardId)
        })
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
      stopAutoPan()
    }
  }, [element, cardId, minWidth, minHeight, coordinateMode])
}

function getEdgePanSpeed(distanceToEdge: number): number {
  const strength = Math.min(1, Math.max(0, (EDGE_PAN_MARGIN_PX - distanceToEdge) / EDGE_PAN_MARGIN_PX))
  return strength * strength * EDGE_PAN_MAX_SPEED_PX_PER_SECOND
}
