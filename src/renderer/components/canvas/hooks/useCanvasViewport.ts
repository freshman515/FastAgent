import { useEffect, useRef } from 'react'
import { CANVAS_MAX_SCALE, CANVAS_MIN_SCALE } from '@shared/types'
import { cancelViewportAnimation, useCanvasStore } from '@/stores/canvas'

/**
 * Wire wheel-based zoom (anchored on cursor), wheel-based pan, and
 * space/middle-click drag-to-pan onto the given viewport element.
 *
 * Viewport state lives in `useCanvasStore` and is committed synchronously —
 * high frequency wheel events pass through `setViewport` which only produces
 * a new layout object for the active key. Cards that opt into screen-space
 * projection use that viewport to compute crisp, non-transformed bounds.
 */
export function useCanvasViewport(viewportEl: HTMLDivElement | null): void {
  // We intentionally read from the store imperatively inside listeners to avoid
  // rebinding them on every viewport change.
  const isPanningRef = useRef(false)
  const spaceDownRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!viewportEl) return

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      cancelViewportAnimation()
      useCanvasStore.getState().clearFocusReturn()

      const rect = viewportEl.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      const { scale, offsetX, offsetY } = useCanvasStore.getState().getViewport()

      // Shift + wheel → horizontal pan (convenience for mouse-wheel users).
      if (event.shiftKey) {
        const step = event.deltaY || event.deltaX
        useCanvasStore.getState().setViewport({
          offsetX: offsetX - step,
          offsetY,
        })
        return
      }

      // Everything else (plain wheel, Ctrl/Meta+wheel, trackpad pinch) → zoom
      // anchored on the cursor. Trackpad pinch arrives as wheel+ctrlKey with
      // fractional deltaY, which the same math handles smoothly.
      const intensity = event.ctrlKey || event.metaKey ? 1.1 : 1.15
      const zoomFactor = event.deltaY < 0 ? intensity : 1 / intensity
      const nextScale = Math.max(CANVAS_MIN_SCALE, Math.min(CANVAS_MAX_SCALE, scale * zoomFactor))
      if (nextScale === scale) return
      const worldX = (screenX - offsetX) / scale
      const worldY = (screenY - offsetY) / scale
      useCanvasStore.getState().setViewport({
        scale: nextScale,
        offsetX: screenX - worldX * nextScale,
        offsetY: screenY - worldY * nextScale,
      })
    }

    const onPointerDown = (event: PointerEvent): void => {
      const usingMiddle = event.button === 1
      const usingSpace = event.button === 0 && spaceDownRef.current
      if (!usingMiddle && !usingSpace) return
      if (!usingMiddle && event.target !== viewportEl) return

      cancelViewportAnimation()
      useCanvasStore.getState().clearFocusReturn()
      isPanningRef.current = true
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      viewportEl.setPointerCapture(event.pointerId)
      viewportEl.style.cursor = 'grabbing'
      event.preventDefault()
      event.stopPropagation()
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!isPanningRef.current || !lastPointerRef.current) return
      const dx = event.clientX - lastPointerRef.current.x
      const dy = event.clientY - lastPointerRef.current.y
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      const { offsetX, offsetY } = useCanvasStore.getState().getViewport()
      useCanvasStore.getState().setViewport({
        offsetX: offsetX + dx,
        offsetY: offsetY + dy,
      })
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      lastPointerRef.current = null
      try { viewportEl.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      viewportEl.style.cursor = spaceDownRef.current ? 'grab' : ''
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === ' ' && !event.repeat) {
        // Only enable space-pan when no input / textarea has focus.
        const active = document.activeElement
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return
        spaceDownRef.current = true
        viewportEl.style.cursor = 'grab'
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === ' ') {
        spaceDownRef.current = false
        if (!isPanningRef.current) viewportEl.style.cursor = ''
      }
    }

    // Capture phase keeps canvas zoom/pan consistent even when the pointer is
    // over xterm, whose internal wheel handler stops bubbling.
    viewportEl.addEventListener('wheel', onWheel, { passive: false, capture: true })
    viewportEl.addEventListener('pointerdown', onPointerDown, { capture: true })
    viewportEl.addEventListener('pointermove', onPointerMove)
    viewportEl.addEventListener('pointerup', onPointerUp)
    viewportEl.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      viewportEl.removeEventListener('wheel', onWheel, { capture: true })
      viewportEl.removeEventListener('pointerdown', onPointerDown, { capture: true })
      viewportEl.removeEventListener('pointermove', onPointerMove)
      viewportEl.removeEventListener('pointerup', onPointerUp)
      viewportEl.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [viewportEl])
}

/**
 * Convert a screen-space point (relative to viewport) to world coordinates,
 * given the current viewport transform.
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: { scale: number; offsetX: number; offsetY: number },
): { x: number; y: number } {
  return {
    x: (screenX - viewport.offsetX) / viewport.scale,
    y: (screenY - viewport.offsetY) / viewport.scale,
  }
}
