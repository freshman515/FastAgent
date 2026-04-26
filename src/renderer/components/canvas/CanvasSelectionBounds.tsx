import { useState } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useSelectionBoundsDrag, type SelectionResizeHandle } from './hooks/useSelectionBoundsDrag'

const RESIZE_HANDLES: SelectionResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function handleStyle(handle: SelectionResizeHandle): React.CSSProperties {
  const size = 12
  const offset = -(size / 2)
  const style: React.CSSProperties = {
    width: handle === 'n' || handle === 's' ? 'calc(100% - 24px)' : `${size}px`,
    height: handle === 'e' || handle === 'w' ? 'calc(100% - 24px)' : `${size}px`,
  }
  if (handle.includes('n')) style.top = offset
  if (handle.includes('s')) style.bottom = offset
  if (handle.includes('w')) style.left = offset
  if (handle.includes('e')) style.right = offset
  if (handle === 'n' || handle === 's') style.left = 12
  if (handle === 'e' || handle === 'w') style.top = 12

  switch (handle) {
    case 'n':
    case 's':
      style.cursor = 'ns-resize'
      break
    case 'e':
    case 'w':
      style.cursor = 'ew-resize'
      break
    case 'ne':
    case 'sw':
      style.cursor = 'nesw-resize'
      break
    case 'nw':
    case 'se':
      style.cursor = 'nwse-resize'
      break
  }
  return style
}

export function CanvasSelectionBounds(): JSX.Element | null {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)
  const viewport = useCanvasStore((state) => state.getLayout().viewport)
  useSelectionBoundsDrag(element)

  if (selectedCardIds.length <= 1) return null

  const selected = cards.filter((card) => selectedCardIds.includes(card.id) && !card.hidden)
  if (selected.length <= 1) return null

  const minX = Math.min(...selected.map((card) => card.x))
  const minY = Math.min(...selected.map((card) => card.y))
  const maxX = Math.max(...selected.map((card) => card.x + card.width))
  const maxY = Math.max(...selected.map((card) => card.y + card.height))
  const padding = 8
  const left = minX * viewport.scale + viewport.offsetX - padding
  const top = minY * viewport.scale + viewport.offsetY - padding
  const width = (maxX - minX) * viewport.scale + padding * 2
  const height = (maxY - minY) * viewport.scale + padding * 2

  return (
    <div
      ref={setElement}
      data-canvas-selection-bounds
      className="canvas-selection-bounds pointer-events-auto absolute z-[4] cursor-grab rounded-[var(--radius-lg)] active:cursor-grabbing"
      style={{
        left,
        top,
        width,
        height,
      }}
    >
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle}
          data-selection-resize={handle}
          className="canvas-selection-resize-handle absolute"
          style={handleStyle(handle)}
        />
      ))}
    </div>
  )
}
