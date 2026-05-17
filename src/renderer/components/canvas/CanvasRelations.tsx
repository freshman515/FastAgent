import { useMemo } from 'react'
import type { CanvasCard, CanvasRelationKind } from '@shared/types'
import { isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore, type LiveCanvasCardGeometry } from '@/stores/canvasUi'

const RELATION_STYLE: Record<CanvasRelationKind, { label: string; color: string; dash?: string }> = {
  related: { label: '相关', color: 'color-mix(in srgb, var(--color-text-secondary) 84%, transparent)' },
  depends: { label: '依赖', color: '#f59e0b' },
  file: { label: '相关文件', color: '#60a5fa' },
  debug: { label: '调试输出', color: '#34d399' },
  todo: { label: '待处理', color: '#fb7185', dash: '7 6' },
}

export function CanvasRelations({ cards: scopedCards }: { cards?: CanvasCard[] }): JSX.Element | null {
  const allCards = useCanvasStore((state) => state.getLayout().cards)
  const cards = scopedCards ?? allCards
  const relations = useCanvasStore((state) => state.getLayout().relations)
  const viewport = useCanvasStore((state) => state.getLayout().viewport)
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)
  const liveCardGeometry = useCanvasUiStore((state) => state.liveCardGeometry)

  const paths = useMemo(() => {
    const byId = new Map(cards.filter((card) => !isCanvasCardHidden(card)).map((card) => {
      const live = liveCardGeometry[card.id]
      return [card.id, live ? applyLiveGeometry(card, live) : card]
    }))
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
      const kind = relation.kind ?? 'related'
      const style = RELATION_STYLE[kind] ?? RELATION_STYLE.related
      const midX = (fromX + toX) / 2
      const midY = (fromY + toY) / 2
      const label = relation.label?.trim() || (kind === 'related' ? '' : style.label)
      const direction = relation.direction ?? 'forward'

      return [{
        id: relation.id,
        fromCardId: relation.fromCardId,
        toCardId: relation.toCardId,
        d: `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${toY}, ${toX} ${toY}`,
        active,
        color: style.color,
        dash: style.dash,
        label,
        midX,
        midY,
        direction,
      }]
    })
  }, [cards, liveCardGeometry, relations, selectedCardIds, viewport.offsetX, viewport.offsetY, viewport.scale])

  if (paths.length === 0) return null

  const focusRelationTarget = (fromCardId: string, toCardId: string): void => {
    const canvas = useCanvasStore.getState()
    const selected = new Set(canvas.selectedCardIds)
    const targetId = selected.has(fromCardId) && !selected.has(toCardId)
      ? toCardId
      : selected.has(toCardId) && !selected.has(fromCardId)
        ? fromCardId
        : toCardId
    if (!canvas.getCard(targetId)) return
    canvas.clearMaximizedCard()
    canvas.clearFocusReturn()
    requestAnimationFrame(() => useCanvasStore.getState().focusOnCard(targetId, { allowReturn: false }))
  }

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
          <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
        </marker>
      </defs>
      {paths.map((path) => (
        <g key={path.id}>
          <path
            d={path.d}
            fill="none"
            stroke="transparent"
            strokeWidth={18}
            strokeLinecap="round"
            pointerEvents="stroke"
            className="pointer-events-auto cursor-pointer"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              focusRelationTarget(path.fromCardId, path.toCardId)
            }}
          />
          <path
            d={path.d}
            fill="none"
            stroke={path.active ? 'var(--color-accent)' : path.color}
            strokeWidth={path.active ? 8 : 6}
            strokeDasharray={path.dash}
            strokeLinecap="round"
            opacity={path.active ? 0.24 : 0.18}
          />
          <path
            d={path.d}
            fill="none"
            stroke={path.active ? 'var(--color-accent)' : path.color}
            strokeWidth={path.active ? 2.8 : 2.2}
            strokeDasharray={path.dash}
            strokeLinecap="round"
            opacity={path.active ? 1 : 0.92}
            markerStart={path.direction === 'backward' || path.direction === 'both' ? 'url(#canvas-relation-arrow)' : undefined}
            markerEnd={path.direction === 'forward' || path.direction === 'both' ? 'url(#canvas-relation-arrow)' : undefined}
          />
          {path.label && (
            <text
              x={path.midX}
              y={path.midY - 8}
              textAnchor="middle"
              className="select-none fill-[var(--color-text-secondary)] text-[10px] font-medium"
              paintOrder="stroke"
              stroke="var(--color-bg-primary)"
              strokeWidth={4}
              strokeLinejoin="round"
            >
              {path.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

function applyLiveGeometry(card: CanvasCard, live: LiveCanvasCardGeometry): CanvasCard {
  return {
    ...card,
    x: live.x,
    y: live.y,
    width: live.width,
    height: live.height,
  }
}
