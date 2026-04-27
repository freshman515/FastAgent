import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvas'
import type { CanvasCard } from '@shared/types'
import { CardFrame, type CardCoordinateMode } from './CardFrame'

interface FrameCardProps {
  card: CanvasCard
  coordinateMode?: CardCoordinateMode
}

export function FrameCard({ card, coordinateMode }: FrameCardProps): JSX.Element {
  const focusOnCard = useCanvasStore((state) => state.focusOnCard)
  const removeCard = useCanvasStore((state) => state.removeCard)
  const toggleFrameCollapsed = useCanvasStore((state) => state.toggleFrameCollapsed)
  const frameZIndex = useCanvasStore((state) => {
    const cards = state.getLayout().cards
    const contentZIndexes = cards
      .filter((candidate) => candidate.kind !== 'frame')
      .map((candidate) => candidate.zIndex)

    if (contentZIndexes.length === 0) return card.zIndex

    const framesByZIndex = cards
      .filter((candidate) => candidate.kind === 'frame')
      .sort((a, b) => a.zIndex - b.zIndex)
    const frameRank = Math.max(0, framesByZIndex.findIndex((candidate) => candidate.id === card.id))
    const frameLayerCeiling = Math.min(...contentZIndexes) - framesByZIndex.length - 1 + frameRank
    return Math.min(card.zIndex, frameLayerCeiling)
  })
  const memberCount = card.frameMemberIds?.length ?? 0
  const focusFrame = (): void => {
    const canvas = useCanvasStore.getState()
    if (canvas.focusReturn?.cardId === card.id) {
      canvas.setSelection([card.id])
      return
    }
    focusOnCard(card.id)
  }

  const title = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-accent)]">
        {card.frameTitle?.trim() || '分组'}
      </span>
      {memberCount > 0 && (
        <span className="shrink-0 rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-[var(--ui-font-2xs)] font-semibold text-[var(--color-accent)]">
          {memberCount}
        </span>
      )}
    </span>
  )

  return (
    <CardFrame
      card={card}
      title={title}
      headerActions={memberCount > 0 && (
        <button
          type="button"
          data-card-control
          onClick={(event) => {
            event.stopPropagation()
            toggleFrameCollapsed(card.id)
          }}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-accent)]"
          title={card.collapsed ? '展开分组' : '折叠分组'}
        >
          {card.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
      )}
      onDelete={() => removeCard(card.id)}
      deleteTitle="删除分组"
      onHeaderClick={focusFrame}
      minWidth={240}
      minHeight={160}
      borderless
      coordinateMode={coordinateMode}
      passThroughBody
      stopBodyContextMenu={false}
      bodyUsesWheelContent={false}
      frameClassName="canvas-frame-card"
      headerClassName="canvas-frame-header"
      bodyClassName="canvas-frame-body pointer-events-auto"
      frameStyleOverride={{
        zIndex: frameZIndex,
        background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
        border: '1px dashed color-mix(in srgb, var(--color-accent) 62%, transparent)',
        boxShadow: 'none',
      }}
    >
      <div
        className="h-full w-full pointer-events-auto"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
          focusFrame()
        }}
      />
    </CardFrame>
  )
}
