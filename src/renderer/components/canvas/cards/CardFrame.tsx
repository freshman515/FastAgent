import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/stores/canvas'
import { useCardDrag } from '../hooks/useCardDrag'
import { useCardResize, type ResizeHandle } from '../hooks/useCardResize'
import type { CanvasCard } from '@shared/types'

export type CardCoordinateMode = 'world' | 'screen' | 'screen-transform'

interface CardFrameProps {
  card: CanvasCard
  title: React.ReactNode
  children: React.ReactNode
  onDelete?: () => void
  deleteTitle?: string
  onHeaderContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
  headerActions?: React.ReactNode
  minWidth?: number
  minHeight?: number
  borderless?: boolean
  bodyClassName?: string
  frameClassName?: string
  headerClassName?: string
  frameStyleOverride?: React.CSSProperties
  coordinateMode?: CardCoordinateMode
  focusOnClick?: boolean
  showSelectionRing?: boolean
  passThroughBody?: boolean
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
  deleteTitle = '删除',
  onHeaderContextMenu,
  headerActions,
  minWidth,
  minHeight,
  borderless = false,
  bodyClassName,
  frameClassName,
  headerClassName,
  frameStyleOverride,
  coordinateMode = 'world',
  focusOnClick = false,
  showSelectionRing = true,
  passThroughBody = false,
}: CardFrameProps): JSX.Element {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null)
  const outerRef = useRef<HTMLDivElement | null>(null)
  const clickStartRef = useRef<{ x: number; y: number } | null>(null)
  const isMaximized = useCanvasStore((state) => state.maximizedCardId === card.id)
  const toggleMaximizedCard = useCanvasStore((state) => state.toggleMaximizedCard)
  const handleHeaderDoubleClick = useCallback(() => {
    toggleMaximizedCard(card.id)
  }, [card.id, toggleMaximizedCard])
  useCardDrag({
    cardId: card.id,
    element: hostEl,
    enableDoubleClickFocus: !focusOnClick,
    onHandleDoubleClick: handleHeaderDoubleClick,
  })
  useCardResize({ cardId: card.id, element: hostEl, minWidth, minHeight, coordinateMode })
  const selected = useCanvasStore((state) => state.selectedCardIds.includes(card.id))
  const viewport = useCanvasStore((state) => coordinateMode.startsWith('screen') ? state.getLayout().viewport : null)

  const baseFrameStyle: React.CSSProperties = viewport
    ? coordinateMode === 'screen-transform'
      ? {
        left: Math.round(card.x * viewport.scale + viewport.offsetX),
        top: Math.round(card.y * viewport.scale + viewport.offsetY),
        width: card.width,
        height: card.height,
        zIndex: card.zIndex,
        contain: 'layout paint style',
        transform: `translate(var(--card-live-dx, 0px), var(--card-live-dy, 0px)) scale(${viewport.scale})`,
        transformOrigin: 'top left',
      }
      : {
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
  const maximizedFrameStyle: React.CSSProperties | null = isMaximized
    ? {
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        zIndex: 100000,
        transform: 'none',
      }
    : null
  const frameStyle = {
    ...baseFrameStyle,
    ...frameStyleOverride,
    ...maximizedFrameStyle,
  }

  useEffect(() => {
    if (outerRef.current) setHostEl(outerRef.current)
  }, [])

  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>): void => {
    clickStartRef.current = focusOnClick && event.button === 0
      ? { x: event.clientX, y: event.clientY }
      : null
  }

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!focusOnClick || event.button !== 0) return
    const clickStart = clickStartRef.current
    clickStartRef.current = null
    if (clickStart && Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) > 8) return

    const target = event.target as HTMLElement | null
    if (target?.closest('[data-card-control],[data-card-resize]')) return

    const canvas = useCanvasStore.getState()
    if (isMaximized) {
      canvas.setSelection([card.id])
      return
    }
    if (canvas.focusReturn?.cardId === card.id) {
      canvas.setSelection([card.id])
      canvas.bringToFront(card.id)
      return
    }
    canvas.focusOnCard(card.id)
  }

  return (
    <div
      ref={outerRef}
      data-card-id={card.id}
      data-card-coordinate-mode={coordinateMode}
      data-card-maximized={isMaximized ? 'true' : undefined}
      onPointerDownCapture={handlePointerDownCapture}
      onClickCapture={handleClickCapture}
      className={cn(
        'absolute flex flex-col rounded-[var(--radius-lg)] bg-[var(--color-bg-primary)] shadow-lg',
        isMaximized && 'canvas-card-maximized',
        passThroughBody ? 'pointer-events-none' : 'pointer-events-auto',
        !borderless && 'border',
        selected && showSelectionRing
          ? cn(!borderless && 'border-[var(--color-accent)]', 'ring-2 ring-[var(--color-accent-muted)]')
          : !borderless && 'border-[var(--color-border)]',
        frameClassName,
      )}
      style={frameStyle}
    >
      {/* Drag handle / title bar. Double-click is handled in useCardDrag so pointer capture cannot swallow it. */}
      <div
        data-card-drag
        onContextMenu={(event) => {
          if (!onHeaderContextMenu) return
          event.preventDefault()
          event.stopPropagation()
          onHeaderContextMenu(event)
        }}
        className={cn(
          'flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 rounded-t-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-3 select-none',
          passThroughBody && 'pointer-events-auto',
          !borderless && 'border-b border-[var(--color-border)]',
          headerClassName,
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
              className={cn(
                '-mr-3 flex h-9 w-10 items-center justify-center rounded-none rounded-tr-[var(--radius-lg)]',
                'text-[var(--color-text-tertiary)] transition-colors duration-100',
                'hover:bg-[var(--color-error)] hover:text-white',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]/55',
              )}
              title={deleteTitle}
              aria-label={deleteTitle}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        data-card-wheel-content
        onContextMenu={(event) => event.stopPropagation()}
        className={cn('min-h-0 flex-1 overflow-hidden rounded-b-[var(--radius-lg)]', passThroughBody && 'pointer-events-none', bodyClassName)}
      >
        {children}
      </div>

      {/* Resize handles */}
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle}
          data-card-resize={handle}
          className={passThroughBody ? 'pointer-events-auto' : undefined}
          style={handleStyle(handle)}
        />
      ))}
    </div>
  )
}
