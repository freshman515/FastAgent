import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'

/** Purple snap guides rendered in screen-space during a drag. */
export function CanvasGuideLines(): JSX.Element | null {
  const guides = useCanvasUiStore((state) => state.guides)
  const viewport = useCanvasStore((state) => state.getLayout().viewport)
  if (guides.length === 0) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      style={{ width: '100%', height: '100%' }}
    >
      {guides.map((guide, index) => {
        const screenPos = guide.axis === 'vertical'
          ? guide.position * viewport.scale + viewport.offsetX
          : guide.position * viewport.scale + viewport.offsetY
        const start = guide.start !== undefined
          ? (guide.axis === 'vertical'
              ? guide.start * viewport.scale + viewport.offsetY
              : guide.start * viewport.scale + viewport.offsetX)
          : 0
        const end = guide.end !== undefined
          ? (guide.axis === 'vertical'
              ? guide.end * viewport.scale + viewport.offsetY
              : guide.end * viewport.scale + viewport.offsetX)
          : 10000
        const line = guide.axis === 'vertical'
          ? { x1: screenPos, x2: screenPos, y1: start, y2: end }
          : { x1: start, x2: end, y1: screenPos, y2: screenPos }
        return (
          <line
            key={`${guide.axis}-${guide.position}-${index}`}
            x1={line.x1}
            x2={line.x2}
            y1={line.y1}
            y2={line.y2}
            stroke="var(--color-accent)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )
      })}
    </svg>
  )
}
