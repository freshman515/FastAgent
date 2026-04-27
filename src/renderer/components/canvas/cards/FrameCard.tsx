import { ChevronDown, ChevronRight } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { cn } from '@/lib/utils'
import type { CanvasCard } from '@shared/types'
import { CardFrame, type CardCoordinateMode } from './CardFrame'

export const FRAME_COLORS: Record<string, { label: string; accent: string }> = {
  violet: { label: '紫', accent: '#8b7cf6' },
  blue: { label: '蓝', accent: '#38bdf8' },
  emerald: { label: '绿', accent: '#34d399' },
  amber: { label: '黄', accent: '#f59e0b' },
  rose: { label: '粉', accent: '#fb7185' },
  slate: { label: '灰', accent: '#94a3b8' },
}

interface FrameCardProps {
  card: CanvasCard
  coordinateMode?: CardCoordinateMode
}

export function FrameCard({ card, coordinateMode }: FrameCardProps): JSX.Element {
  const focusOnCard = useCanvasStore((state) => state.focusOnCard)
  const updateCard = useCanvasStore((state) => state.updateCard)
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
  const frameColorKey = card.frameColor ?? 'violet'
  const frameColor = FRAME_COLORS[frameColorKey] ?? FRAME_COLORS.violet
  const focusFrame = (): void => {
    const canvas = useCanvasStore.getState()
    if (canvas.focusReturn?.cardId === card.id) {
      canvas.setSelection([card.id])
      return
    }
    focusOnCard(card.id)
  }
  const focusFrameWorkspace = (): void => useCanvasStore.getState().focusFrameWorkspace(card.id)

  const title = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[var(--ui-font-sm)] font-semibold text-[var(--canvas-frame-accent)]">
        {card.frameTitle?.trim() || '分组'}
      </span>
      {memberCount > 0 && (
        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--canvas-frame-accent)_15%,transparent)] px-2 py-0.5 text-[var(--ui-font-2xs)] font-semibold text-[var(--canvas-frame-accent)]">
          {memberCount}
        </span>
      )}
    </span>
  )

  return (
    <CardFrame
      card={card}
      title={title}
      headerActions={(
        <>
          <div data-card-control className="hidden items-center gap-1 sm:flex">
            {Object.entries(FRAME_COLORS).map(([key, value]) => (
              <button
                key={key}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  updateCard(card.id, { frameColor: key })
                }}
                className={cn(
                  'h-4 w-4 rounded-full border transition-transform hover:scale-110',
                  frameColorKey === key && 'scale-110 ring-1 ring-white/45',
                )}
                style={{ backgroundColor: value.accent, borderColor: value.accent }}
                title={value.label}
                aria-label={`设置分组颜色：${value.label}`}
              />
            ))}
          </div>
          {memberCount > 0 && (
            <button
              type="button"
              data-card-control
              onClick={(event) => {
                event.stopPropagation()
                toggleFrameCollapsed(card.id)
              }}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--canvas-frame-accent)]"
              title={card.collapsed ? '展开分组' : '折叠分组'}
            >
              {card.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
        </>
      )}
      onDelete={() => removeCard(card.id)}
      deleteTitle="删除分组"
      onHeaderClick={focusFrame}
      onHeaderDoubleClick={focusFrameWorkspace}
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
        '--canvas-frame-accent': frameColor.accent,
      } as CSSProperties}
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
