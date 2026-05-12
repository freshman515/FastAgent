import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { CANVAS_MAX_SCALE, CANVAS_MIN_SCALE } from '@shared/types'
import { cancelViewportAnimation, useCanvasStore } from '@/stores/canvas'
import { useUIStore, type CanvasInputMode, type CanvasWheelZoomModifier } from '@/stores/ui'

type DetectedCanvasInputMode = 'mouse' | 'trackpad'
type CanvasViewportSnapshot = { scale: number; offsetX: number; offsetY: number }

function getPrimaryWheelZoomModifier(): 'ctrl' | 'meta' {
  return window.api.platform === 'darwin' ? 'meta' : 'ctrl'
}

function isWheelZoomModifierPressed(event: WheelEvent, modifier: CanvasWheelZoomModifier): boolean {
  const resolved = modifier === 'primary' ? getPrimaryWheelZoomModifier() : modifier
  if (resolved === 'meta') return event.metaKey
  if (resolved === 'ctrl') return event.ctrlKey
  return event.altKey
}

function looksLikeTrackpadWheel(event: WheelEvent): boolean {
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false
  const absX = Math.abs(event.deltaX)
  const absY = Math.abs(event.deltaY)
  if (absX > 0 && absY > 0) return true
  if (absX > 0 && absY === 0) return true
  const primaryDelta = Math.max(absX, absY)
  if (primaryDelta === 0) return false
  return primaryDelta < 80 || !Number.isInteger(primaryDelta)
}

function resolveInputMode(setting: CanvasInputMode, detected: DetectedCanvasInputMode): DetectedCanvasInputMode {
  return setting === 'auto' ? detected : setting
}

/**
 * Wire wheel-based zoom (anchored on cursor), wheel-based pan, and
 * space/middle-click drag-to-pan onto the given viewport element.
 *
 * Viewport state lives in `useCanvasStore`. Pointer drag-to-pan moves one
 * shared screen-space layer during the gesture and commits the final viewport
 * on release, matching the single-viewport movement model used by OpenCove.
 * Wheel gestures commit directly because zoom needs cursor anchoring.
 */
export function useCanvasViewport(viewportEl: HTMLDivElement | null): void {
  // We intentionally read from the store imperatively inside listeners to avoid
  // rebinding them on every viewport change.
  const isPanningRef = useRef(false)
  const spaceDownRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const panStartViewportRef = useRef<CanvasViewportSnapshot | null>(null)
  const livePanOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const detectedInputModeRef = useRef<DetectedCanvasInputMode>('mouse')

  useEffect(() => {
    if (!viewportEl) return
    const panLayer = viewportEl.querySelector<HTMLElement>('[data-canvas-pan-layer]')

    const resetLivePanLayer = (): void => {
      if (!panLayer) return
      panLayer.style.transform = ''
      panLayer.style.willChange = ''
    }

    const applyLivePanLayer = (x: number, y: number): void => {
      if (!panLayer) return
      panLayer.style.willChange = 'transform'
      panLayer.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }

    const commitLivePan = (): void => {
      const startViewport = panStartViewportRef.current
      if (!startViewport) {
        resetLivePanLayer()
        return
      }

      const { x, y } = livePanOffsetRef.current
      if (x === 0 && y === 0) {
        resetLivePanLayer()
        return
      }

      flushSync(() => {
        useCanvasStore.getState().setViewport({
          offsetX: startViewport.offsetX + x,
          offsetY: startViewport.offsetY + y,
        })
      })
      resetLivePanLayer()
    }

    const onWheel = (event: WheelEvent): void => {
      const settings = useUIStore.getState().settings
      const target = event.target as HTMLElement | null
      const overCardContent = Boolean(target?.closest('[data-card-wheel-content]'))
      const zoomModifierPressed = isWheelZoomModifierPressed(event, settings.canvasWheelZoomModifier)
      const pinchZoom = event.ctrlKey && looksLikeTrackpadWheel(event)
      if (overCardContent && !zoomModifierPressed && !pinchZoom) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      cancelViewportAnimation()
      useCanvasStore.getState().clearFocusReturn()

      const rect = viewportEl.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      const { scale, offsetX, offsetY } = useCanvasStore.getState().getViewport()
      const eventInputMode = looksLikeTrackpadWheel(event) ? 'trackpad' : 'mouse'
      if (settings.canvasInputMode === 'auto') detectedInputModeRef.current = eventInputMode
      const inputMode = resolveInputMode(settings.canvasInputMode, detectedInputModeRef.current)

      const panViewport = (deltaX: number, deltaY: number): void => {
        useCanvasStore.getState().setViewport({
          offsetX: offsetX - deltaX,
          offsetY: offsetY - deltaY,
        })
      }

      // Shift + wheel → horizontal pan (convenience for mouse-wheel users).
      if (event.shiftKey && !zoomModifierPressed && !pinchZoom) {
        const step = event.deltaY || event.deltaX
        panViewport(step, 0)
        return
      }

      const shouldPan = inputMode === 'trackpad'
        ? !zoomModifierPressed && !pinchZoom
        : settings.canvasWheelBehavior === 'pan' && !zoomModifierPressed && !pinchZoom

      if (shouldPan) {
        panViewport(event.deltaX, event.deltaY)
        return
      }

      // Everything else (mouse zoom, modifier+wheel, trackpad pinch) → zoom
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
      panStartViewportRef.current = useCanvasStore.getState().getViewport()
      livePanOffsetRef.current = { x: 0, y: 0 }
      applyLivePanLayer(0, 0)
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
      const next = {
        x: livePanOffsetRef.current.x + dx,
        y: livePanOffsetRef.current.y + dy,
      }
      livePanOffsetRef.current = next
      applyLivePanLayer(next.x, next.y)
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      lastPointerRef.current = null
      try { viewportEl.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      commitLivePan()
      panStartViewportRef.current = null
      livePanOffsetRef.current = { x: 0, y: 0 }
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
      resetLivePanLayer()
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
