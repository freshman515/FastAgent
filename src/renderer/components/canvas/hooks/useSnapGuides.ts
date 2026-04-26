import type { CanvasCard } from '@shared/types'
import type { SnapGuide } from '@/stores/canvasUi'

const GRID_SIZE = 20
const FRAME_INSET = 32

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

/**
 * Given the current drag delta and the set of cards being dragged, return an
 * adjusted delta that snaps to:
 *   - other cards' left / right / horizontal-center edges
 *   - other cards' top / bottom / vertical-center edges
 *   - the 20px grid (when `gridSnap` is true)
 *
 * The snap threshold is measured in screen-space pixels and converted to world
 * units via `scale`, so the snap feel stays consistent at any zoom level.
 */
export function computeSnap(
  dx: number,
  dy: number,
  draggedIds: string[],
  allCards: CanvasCard[],
  scale: number,
  gridSnap: boolean,
): SnapResult {
  const screenThreshold = 6
  const threshold = screenThreshold / scale

  const draggedSet = new Set(draggedIds)
  const dragged = allCards.filter((c) => draggedSet.has(c.id))
  const others = allCards.filter((c) => !draggedSet.has(c.id))
  if (dragged.length === 0) return { dx, dy, guides: [] }

  // Candidate anchors on the dragged group (after applying the raw delta).
  const buildAnchors = (cards: CanvasCard[], deltaX: number, deltaY: number): {
    xAnchors: Array<{ value: number; span: [number, number] }>
    yAnchors: Array<{ value: number; span: [number, number] }>
  } => {
    const xs: Array<{ value: number; span: [number, number] }> = []
    const ys: Array<{ value: number; span: [number, number] }> = []
    for (const card of cards) {
      const x = card.x + deltaX
      const y = card.y + deltaY
      const w = card.width
      const h = card.height
      xs.push({ value: x, span: [y, y + h] })
      xs.push({ value: x + w / 2, span: [y, y + h] })
      xs.push({ value: x + w, span: [y, y + h] })
      ys.push({ value: y, span: [x, x + w] })
      ys.push({ value: y + h / 2, span: [x, x + w] })
      ys.push({ value: y + h, span: [x, x + w] })
    }
    return { xAnchors: xs, yAnchors: ys }
  }

  const dragAnchors = buildAnchors(dragged, dx, dy)
  const otherAnchors = buildAnchors(others, 0, 0)
  for (const frame of others.filter((card) => card.kind === 'frame')) {
    const left = frame.x + FRAME_INSET
    const right = frame.x + frame.width - FRAME_INSET
    const top = frame.y + FRAME_INSET
    const bottom = frame.y + frame.height - FRAME_INSET
    if (right > left) {
      otherAnchors.xAnchors.push({ value: left, span: [frame.y, frame.y + frame.height] })
      otherAnchors.xAnchors.push({ value: left + (right - left) / 2, span: [frame.y, frame.y + frame.height] })
      otherAnchors.xAnchors.push({ value: right, span: [frame.y, frame.y + frame.height] })
    }
    if (bottom > top) {
      otherAnchors.yAnchors.push({ value: top, span: [frame.x, frame.x + frame.width] })
      otherAnchors.yAnchors.push({ value: top + (bottom - top) / 2, span: [frame.x, frame.x + frame.width] })
      otherAnchors.yAnchors.push({ value: bottom, span: [frame.x, frame.x + frame.width] })
    }
  }

  const findClosest = (
    draggedList: typeof dragAnchors.xAnchors,
    othersList: typeof dragAnchors.xAnchors,
  ): { delta: number; target: number; span: [number, number] } | null => {
    let best: { delta: number; target: number; span: [number, number] } | null = null
    for (const source of draggedList) {
      for (const target of othersList) {
        const delta = target.value - source.value
        if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best.delta))) {
          const span: [number, number] = [
            Math.min(source.span[0], target.span[0]),
            Math.max(source.span[1], target.span[1]),
          ]
          best = { delta, target: target.value, span }
        }
      }
    }
    return best
  }

  const xSnap = findClosest(dragAnchors.xAnchors, otherAnchors.xAnchors)
  const ySnap = findClosest(dragAnchors.yAnchors, otherAnchors.yAnchors)

  let adjustedDx = dx
  let adjustedDy = dy
  const guides: SnapGuide[] = []
  if (xSnap) {
    adjustedDx = dx + xSnap.delta
    guides.push({ axis: 'vertical', position: xSnap.target, start: xSnap.span[0], end: xSnap.span[1] })
  }
  if (ySnap) {
    adjustedDy = dy + ySnap.delta
    guides.push({ axis: 'horizontal', position: ySnap.target, start: ySnap.span[0], end: ySnap.span[1] })
  }

  // Grid snap — only applied when no card-edge snap already fired for that axis.
  if (gridSnap) {
    if (!xSnap) {
      // Snap the first dragged card's left edge to the grid.
      const anchor = dragged[0]
      const proposed = anchor.x + adjustedDx
      const snapped = Math.round(proposed / GRID_SIZE) * GRID_SIZE
      if (Math.abs(snapped - proposed) <= threshold) {
        adjustedDx += snapped - proposed
      }
    }
    if (!ySnap) {
      const anchor = dragged[0]
      const proposed = anchor.y + adjustedDy
      const snapped = Math.round(proposed / GRID_SIZE) * GRID_SIZE
      if (Math.abs(snapped - proposed) <= threshold) {
        adjustedDy += snapped - proposed
      }
    }
  }

  return { dx: adjustedDx, dy: adjustedDy, guides }
}
