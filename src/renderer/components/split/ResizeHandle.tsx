import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { usePanesStore } from '@/stores/panes'
import type { PaneUiMode } from '@/stores/ui'

interface ResizeHandleProps {
  splitId: string
  direction: 'horizontal' | 'vertical'
  currentRatio: number
  mode?: PaneUiMode
}

interface ActiveDrag {
  handleMouseMove: (event: MouseEvent) => void
  handleMouseUp: () => void
  frameId: number | null
  latestRatio: number
  hasMoved: boolean
}

export function ResizeHandle({ splitId, direction, currentRatio, mode = 'separated' }: ResizeHandleProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const savedRatioRef = useRef<number | null>(null)
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const resizeSplit = usePanesStore((s) => s.resizeSplit)

  const stopActiveDrag = useCallback(
    (commitPending: boolean) => {
      const activeDrag = activeDragRef.current
      if (!activeDrag) return

      document.removeEventListener('mousemove', activeDrag.handleMouseMove)
      document.removeEventListener('mouseup', activeDrag.handleMouseUp)
      if (activeDrag.frameId !== null) {
        cancelAnimationFrame(activeDrag.frameId)
        activeDrag.frameId = null
      }
      if (commitPending && activeDrag.hasMoved) {
        resizeSplit(splitId, activeDrag.latestRatio)
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      activeDragRef.current = null
    },
    [resizeSplit, splitId],
  )

  useEffect(() => {
    return () => {
      stopActiveDrag(false)
    }
  }, [stopActiveDrag])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const parentEl = containerRef.current?.parentElement
      if (!parentEl) return

      const parentRect = parentEl.getBoundingClientRect()
      stopActiveDrag(true)

      const activeDrag: ActiveDrag = {
        handleMouseMove: () => {},
        handleMouseUp: () => {},
        frameId: null,
        latestRatio: currentRatio,
        hasMoved: false,
      }

      const scheduleResize = (): void => {
        if (activeDrag.frameId !== null) return
        activeDrag.frameId = requestAnimationFrame(() => {
          activeDrag.frameId = null
          resizeSplit(splitId, activeDrag.latestRatio)
        })
      }

      activeDrag.handleMouseMove = (ev: MouseEvent): void => {
        let ratio: number
        if (direction === 'horizontal') {
          ratio = (ev.clientX - parentRect.left) / parentRect.width
        } else {
          ratio = (ev.clientY - parentRect.top) / parentRect.height
        }
        activeDrag.latestRatio = ratio
        activeDrag.hasMoved = true
        scheduleResize()
      }

      activeDrag.handleMouseUp = (): void => {
        stopActiveDrag(true)
      }

      activeDragRef.current = activeDrag
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', activeDrag.handleMouseMove)
      document.addEventListener('mouseup', activeDrag.handleMouseUp)
    },
    [currentRatio, direction, resizeSplit, splitId, stopActiveDrag],
  )

  const handleDoubleClick = useCallback(() => {
    // Toggle between maximized first pane and restore
    if (savedRatioRef.current !== null) {
      // Restore saved ratio
      resizeSplit(splitId, savedRatioRef.current)
      savedRatioRef.current = null
    } else {
      // Save current ratio, maximize first pane
      savedRatioRef.current = currentRatio
      resizeSplit(splitId, 0.85)
    }
  }, [splitId, currentRatio, resizeSplit])

  const isHorizontal = direction === 'horizontal'
  const classic = mode === 'classic'

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'group relative shrink-0',
        classic ? 'bg-[var(--color-border)]' : 'bg-[var(--color-titlebar-bg)]',
        isHorizontal
          ? cn(classic ? 'w-px' : 'w-[var(--layout-gap)]', 'cursor-col-resize')
          : cn(classic ? 'h-px' : 'h-[var(--layout-gap)]', 'cursor-row-resize'),
      )}
    >
      {/* Widened hit area with subtle hover highlight */}
      <div
        className={cn(
          'absolute z-10 transition-colors duration-120',
          isHorizontal
            ? 'inset-y-0 -left-1.5 -right-1.5 group-hover:bg-[var(--color-accent)]/20'
            : 'inset-x-0 -top-1.5 -bottom-1.5 group-hover:bg-[var(--color-accent)]/20',
        )}
      />
      {/* Center drag affordance — 3 dots that appear on hover */}
      {!classic && (
        <div
          className={cn(
            'pointer-events-none absolute z-20 flex items-center justify-center',
            'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
            isHorizontal
              ? 'inset-y-0 left-1/2 -translate-x-1/2 flex-col gap-[2px]'
              : 'inset-x-0 top-1/2 -translate-y-1/2 flex-row gap-[2px]',
          )}
        >
          <span className="h-[3px] w-[3px] rounded-full bg-[var(--color-accent)]/70" />
          <span className="h-[3px] w-[3px] rounded-full bg-[var(--color-accent)]/70" />
          <span className="h-[3px] w-[3px] rounded-full bg-[var(--color-accent)]/70" />
        </div>
      )}
    </div>
  )
}
