import { useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { usePanesStore } from '@/stores/panes'

interface ResizeHandleProps {
  splitId: string
  direction: 'horizontal' | 'vertical'
  currentRatio: number
}

export function ResizeHandle({ splitId, direction, currentRatio }: ResizeHandleProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const savedRatioRef = useRef<number | null>(null)
  const resizeSplit = usePanesStore((s) => s.resizeSplit)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const parentEl = containerRef.current?.parentElement
      if (!parentEl) return

      const parentRect = parentEl.getBoundingClientRect()

      const handleMouseMove = (ev: MouseEvent): void => {
        let ratio: number
        if (direction === 'horizontal') {
          ratio = (ev.clientX - parentRect.left) / parentRect.width
        } else {
          ratio = (ev.clientY - parentRect.top) / parentRect.height
        }
        resizeSplit(splitId, ratio)
      }

      const handleMouseUp = (): void => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [splitId, direction, resizeSplit],
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

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'group shrink-0 bg-[var(--color-titlebar-bg)]',
        isHorizontal ? 'w-[var(--layout-gap)] cursor-col-resize' : 'h-[var(--layout-gap)] cursor-row-resize',
        'relative',
      )}
    >
      <div
        className={cn(
          'absolute z-10',
          isHorizontal
            ? 'inset-y-0 -left-1.5 -right-1.5 group-hover:bg-[var(--color-accent)]/30'
            : 'inset-x-0 -top-1.5 -bottom-1.5 group-hover:bg-[var(--color-accent)]/30',
          'transition-colors duration-75',
        )}
      />
    </div>
  )
}
