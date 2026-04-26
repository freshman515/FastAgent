import { useCanvasStore } from '@/stores/canvas'
import type { CanvasCard } from '@shared/types'
import { CardFrame, type CardCoordinateMode } from './CardFrame'

interface FrameCardProps {
  card: CanvasCard
  coordinateMode?: CardCoordinateMode
}

export function FrameCard({ card, coordinateMode }: FrameCardProps): JSX.Element {
  const updateCard = useCanvasStore((state) => state.updateCard)
  const removeCard = useCanvasStore((state) => state.removeCard)

  const title = (
    <input
      data-card-control
      value={card.frameTitle ?? '分组'}
      onChange={(event) => updateCard(card.id, { frameTitle: event.target.value })}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 bg-transparent text-[var(--ui-font-sm)] font-semibold text-[var(--color-accent)] outline-none"
      spellCheck={false}
    />
  )

  return (
    <CardFrame
      card={card}
      title={title}
      onDelete={() => removeCard(card.id)}
      deleteTitle="删除分组"
      minWidth={240}
      minHeight={160}
      borderless
      coordinateMode={coordinateMode}
      focusOnClick={false}
      passThroughBody
      frameClassName="canvas-frame-card"
      headerClassName="canvas-frame-header"
      bodyClassName="canvas-frame-body"
      frameStyleOverride={{
        background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
        border: '1px dashed color-mix(in srgb, var(--color-accent) 62%, transparent)',
        boxShadow: 'none',
      }}
    >
      <div className="h-full w-full" />
    </CardFrame>
  )
}
