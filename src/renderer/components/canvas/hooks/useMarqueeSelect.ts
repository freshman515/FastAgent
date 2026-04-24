import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { screenToWorld } from './useCanvasViewport'

/**
 * Drag-to-select on the canvas viewport. Must attach to the same element
 * the viewport uses. Starts when pointerdown hits the viewport itself (not
 * a card or children).
 *
 * We intentionally don't swallow pointerdown on cards — `useCardDrag` owns
 * those via stopPropagation.
 */
export function useMarqueeSelect(viewportEl: HTMLDivElement | null): void {
  useEffect(() => {
    if (!viewportEl) return

    let startWorld: { x: number; y: number } | null = null
    let additive = false

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      if (event.target !== viewportEl) return
      // Space = pan; don't marquee.
      if ((event as PointerEvent & { ctrlKey: boolean }).ctrlKey === true) {
        // Ctrl+click on empty area: keep selection but start marquee for additive
        additive = true
      } else {
        additive = event.shiftKey
      }
      const rect = viewportEl.getBoundingClientRect()
      const viewport = useCanvasStore.getState().getViewport()
      startWorld = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewport)
      useCanvasUiStore.getState().setMarquee({ x: startWorld.x, y: startWorld.y, width: 0, height: 0 })
      viewportEl.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!startWorld) return
      const rect = viewportEl.getBoundingClientRect()
      const viewport = useCanvasStore.getState().getViewport()
      const here = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewport)
      const marquee = {
        x: Math.min(startWorld.x, here.x),
        y: Math.min(startWorld.y, here.y),
        width: Math.abs(here.x - startWorld.x),
        height: Math.abs(here.y - startWorld.y),
      }
      useCanvasUiStore.getState().setMarquee(marquee)

      // Live selection update.
      const cards = useCanvasStore.getState().getCards()
      const intersects = cards
        .filter((card) => {
          const right = card.x + card.width
          const bottom = card.y + card.height
          const mr = marquee.x + marquee.width
          const mb = marquee.y + marquee.height
          return !(right < marquee.x || card.x > mr || bottom < marquee.y || card.y > mb)
        })
        .map((card) => card.id)

      if (additive) {
        const existing = useCanvasStore.getState().selectedCardIds
        const merged = Array.from(new Set([...existing, ...intersects]))
        useCanvasStore.getState().setSelection(merged)
      } else {
        useCanvasStore.getState().setSelection(intersects)
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (!startWorld) return
      startWorld = null
      additive = false
      try { viewportEl.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      useCanvasUiStore.getState().setMarquee(null)
    }

    viewportEl.addEventListener('pointerdown', onPointerDown)
    viewportEl.addEventListener('pointermove', onPointerMove)
    viewportEl.addEventListener('pointerup', onPointerUp)
    viewportEl.addEventListener('pointercancel', onPointerUp)

    return () => {
      viewportEl.removeEventListener('pointerdown', onPointerDown)
      viewportEl.removeEventListener('pointermove', onPointerMove)
      viewportEl.removeEventListener('pointerup', onPointerUp)
      viewportEl.removeEventListener('pointercancel', onPointerUp)
    }
  }, [viewportEl])
}
