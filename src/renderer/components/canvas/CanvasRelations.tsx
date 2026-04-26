import { useMemo } from 'react'
import { useCanvasStore } from '@/stores/canvas'

export function CanvasRelations(): JSX.Element | null {
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const relations = useCanvasStore((state) => state.getLayout().relations)
  const viewport = useCanvasStore((state) => state.getLayout().viewport)
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)

  const paths = useMemo(() => {
    const byId = new Map(cards.filter((card) => !card.hidden).map((card) => [card.id, card]))
    const selected = new Set(selectedCardIds)
    return relations.flatMap((relation) => {
      const from = byId.get(relation.fromCardId)
      const to = byId.get(relation.toCardId)
      if (!from || !to) return []

      const fromX = (from.x + from.width / 2) * viewport.scale + viewport.offsetX
      const fromY = (from.y + from.height / 2) * viewport.scale + viewport.offsetY
      const toX = (to.x + to.width / 2) * viewport.scale + viewport.offsetX
      const toY = (to.y + to.height / 2) * viewport.scale + viewport.offsetY
      const dx = toX - fromX
      const curve = Math.max(48, Math.min(220, Math.abs(dx) * 0.35))
      const c1x = fromX + (dx >= 0 ? curve : -curve)
      const c2x = toX - (dx >= 0 ? curve : -curve)
      const active = selected.has(from.id) || selected.has(to.id)

      return [{
        id: relation.id,
        d: `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${toY}, ${toX} ${toY}`,
        active,
      }]
    })
  }, [cards, relations, selectedCardIds, viewport.offsetX, viewport.offsetY, viewport.scale])

  if (paths.length === 0) return null

  return (
    <svg className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-visible">
      <defs>
        <marker
          id="canvas-relation-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="color-mix(in srgb, var(--color-accent) 78%, transparent)" />
        </marker>
      </defs>
      {paths.map((path) => (
        <path
          key={path.id}
          d={path.d}
          fill="none"
          stroke={path.active ? 'var(--color-accent)' : 'color-mix(in srgb, var(--color-text-tertiary) 52%, transparent)'}
          strokeWidth={path.active ? 2.2 : 1.5}
          strokeLinecap="round"
          markerEnd="url(#canvas-relation-arrow)"
        />
      ))}
    </svg>
  )
}
