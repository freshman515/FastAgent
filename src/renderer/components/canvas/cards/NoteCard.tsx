import { useCanvasStore } from '@/stores/canvas'
import type { CanvasCard } from '@shared/types'
import { CardFrame, type CardCoordinateMode } from './CardFrame'

const NOTE_COLORS: Record<string, { label: string; bg: string; border: string }> = {
  yellow: { label: '黄', bg: 'color-mix(in srgb, #fde68a 20%, var(--color-bg-primary))', border: '#fde68a' },
  blue: { label: '蓝', bg: 'color-mix(in srgb, #93c5fd 18%, var(--color-bg-primary))', border: '#93c5fd' },
  green: { label: '绿', bg: 'color-mix(in srgb, #86efac 18%, var(--color-bg-primary))', border: '#86efac' },
  pink: { label: '粉', bg: 'color-mix(in srgb, #f9a8d4 18%, var(--color-bg-primary))', border: '#f9a8d4' },
  gray: { label: '灰', bg: 'var(--color-bg-surface)', border: 'var(--color-border)' },
}

interface NoteCardProps {
  card: CanvasCard
  coordinateMode?: CardCoordinateMode
}

export function NoteCard({ card, coordinateMode }: NoteCardProps): JSX.Element {
  const color = NOTE_COLORS[card.noteColor ?? 'yellow'] ?? NOTE_COLORS.yellow
  const updateCard = useCanvasStore((state) => state.updateCard)
  const removeCard = useCanvasStore((state) => state.removeCard)

  const title = (
    <span className="flex items-center gap-2">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color.border }}
      />
      <span className="text-[var(--color-text-tertiary)]">便签</span>
    </span>
  )

  const headerActions = (
    <div className="flex items-center gap-0.5">
      {Object.entries(NOTE_COLORS).map(([key, value]) => (
        <button
          key={key}
          type="button"
          onClick={(e) => { e.stopPropagation(); updateCard(card.id, { noteColor: key }) }}
          className="h-4 w-4 rounded-full border"
          style={{ backgroundColor: value.border, borderColor: value.border }}
          title={value.label}
        />
      ))}
    </div>
  )

  return (
    <CardFrame
      card={card}
      title={title}
      headerActions={headerActions}
      onDelete={() => removeCard(card.id)}
      minWidth={160}
      minHeight={120}
      coordinateMode={coordinateMode}
    >
      <textarea
        value={card.noteBody ?? ''}
        onChange={(e) => updateCard(card.id, { noteBody: e.target.value })}
        placeholder="写点什么..."
        className="h-full w-full resize-none border-0 bg-transparent p-3 text-[var(--ui-font-sm)] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        style={{ backgroundColor: color.bg }}
      />
    </CardFrame>
  )
}
