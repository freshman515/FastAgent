import { useCanvasStore } from '@/stores/canvas'

/**
 * Infinite dot grid rendered as a CSS background-image on a screen-space layer.
 * Pattern size adapts to zoom so the grid never becomes too dense or too sparse.
 */
export function CanvasGrid(): JSX.Element {
  const scale = useCanvasStore((state) => state.getLayout().viewport.scale)
  const offsetX = useCanvasStore((state) => state.getLayout().viewport.offsetX)
  const offsetY = useCanvasStore((state) => state.getLayout().viewport.offsetY)

  // Pick a base grid size that stays readable across zoom levels.
  const baseGrid = 20
  const gridSize = scale < 0.4 ? baseGrid * 5 : scale < 0.75 ? baseGrid * 2 : baseGrid
  const effective = gridSize * scale
  const dotColor = 'color-mix(in srgb, var(--color-text-tertiary) 35%, transparent)'

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
        backgroundSize: `${effective}px ${effective}px`,
        backgroundPosition: `${offsetX % effective}px ${offsetY % effective}px`,
        opacity: 0.7,
      }}
    />
  )
}
