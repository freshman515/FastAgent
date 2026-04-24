import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/stores/canvas'
import { useCardDrag } from '../hooks/useCardDrag'
import { useCardResize, type ResizeHandle } from '../hooks/useCardResize'
import type { CanvasCard } from '@shared/types'

export type CardCoordinateMode = 'world' | 'screen'

interface CardFrameProps {
  card: CanvasCard
  title: React.ReactNode
  children: React.ReactNode
  onDelete?: () => void
  headerActions?: React.ReactNode
  minWidth?: number
  minHeight?: number
  borderless?: boolean
  bodyClassName?: string
  frameClassName?: string
  coordinateMode?: CardCoordinateMode
}

const RESIZE_HANDLES: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function handleStyle(handle: ResizeHandle): React.CSSProperties {
  const size = 10
  const offset = -(size / 2)
  const base: React.CSSProperties = {
    position: 'absolute',
    width: handle === 'n' || handle === 's' ? '100%' : `${size}px`,
    height: handle === 'e' || handle === 'w' ? '100%' : `${size}px`,
  }
  if (handle.includes('n')) base.top = offset
  if (handle.includes('s')) base.bottom = offset
  if (handle.includes('w')) base.left = offset
  if (handle.includes('e')) base.right = offset
  if (handle === 'n' || handle === 's') base.left = 0
  if (handle === 'e' || handle === 'w') base.top = 0
  switch (handle) {
    case 'n':
    case 's':
      base.cursor = 'ns-resize'
      break
    case 'e':
    case 'w':
      base.cursor = 'ew-resize'
      break
    case 'ne':
    case 'sw':
      base.cursor = 'nesw-resize'
      break
    case 'nw':
    case 'se':
      base.cursor = 'nwse-resize'
      break
  }
  return base
}

export function CardFrame({
  card,
  title,
  children,
  onDelete,
  headerActions,
  minWidth,
  minHeight,
  borderless = false,
  bodyClassName,
  frameClassName,
  coordinateMode = 'world',
}: CardFrameProps): JSX.Element {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null)
  const outerRef = useRef<HTMLDivElement | null>(null)
  useCardDrag({ cardId: card.id, element: hostEl })
  useCardResize({ cardId: card.id, element: hostEl, minWidth, minHeight, coordinateMode })
  const selected = useCanvasStore((state) => state.selectedCardIds.includes(card.id))
  const viewport = useCanvasStore((state) => coordinateMode === 'screen' ? state.getLayout().viewport : null)

  const frameStyle: React.CSSProperties = viewport
    ? {
        left: Math.round(card.x * viewport.scale + viewport.offsetX),
        top: Math.round(card.y * viewport.scale + viewport.offsetY),
        width: Math.max(1, Math.round(card.width * viewport.scale)),
        height: Math.max(1, Math.round(card.height * viewport.scale)),
        zIndex: card.zIndex,
        contain: 'layout paint style',
      }
    : {
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
        zIndex: card.zIndex,
        contain: 'layout paint style',
      }

  useEffect(() => {
    if (outerRef.current) setHostEl(outerRef.current)
  }, [])

  return (
    <div
      ref={outerRef}
      data-card-id={card.id}
      data-card-coordinate-mode={coordinateMode}
      className={cn(
        'pointer-events-auto absolute flex flex-col rounded-[var(--radius-lg)] bg-[var(--color-bg-primary)] shadow-lg',
        !borderless && 'border',
        selected
          ? cn(!borderless && 'border-[var(--color-accent)]', 'ring-2 ring-[var(--color-accent-muted)]')
          : !borderless && 'border-[var(--color-border)]',
        frameClassName,
      )}
      style={frameStyle}
    >
      {/* Drag handle / title bar. Double-click is handled in useCardDrag so pointer capture cannot swallow it. */}
      <div
        data-card-drag
        className={cn(
          'flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 rounded-t-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-3 select-none',
          !borderless && 'border-b border-[var(--color-border)]',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]">
          {title}
        </div>
        <div data-card-control className="flex shrink-0 items-center gap-1">
          {headerActions}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              title="删除"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className={cn('min-h-0 flex-1 overflow-hidden rounded-b-[var(--radius-lg)]', bodyClassName)}>{children}</div>

      {/* Resize handles */}
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle}
          data-card-resize={handle}
          style={handleStyle(handle)}
        />
      ))}
    </div>
  )
}
