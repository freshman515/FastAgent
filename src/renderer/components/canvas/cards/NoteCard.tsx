import { useCanvasStore } from '@/stores/canvas'
import { cn } from '@/lib/utils'
import type { CanvasCard } from '@shared/types'
import { CardFrame, type CardCoordinateMode } from './CardFrame'

const NOTE_COLORS: Record<string, { label: string; accent: string }> = {
  yellow: {
    label: '黄',
    accent: '#fbbf24',
  },
  blue: {
    label: '蓝',
    accent: '#60a5fa',
  },
  green: {
    label: '绿',
    accent: '#4ade80',
  },
  pink: {
    label: '粉',
    accent: '#f472b6',
  },
  gray: {
    label: '灰',
    accent: 'var(--color-text-tertiary)',
  },
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
        className="h-2.5 w-2.5 rounded-full shadow-sm"
        style={{ backgroundColor: color.accent, boxShadow: `0 0 0 3px color-mix(in srgb, ${color.accent} 18%, transparent)` }}
      />
      <span className="font-medium text-[var(--color-text-secondary)]">便签</span>
    </span>
  )

  const headerActions = (
    <div className="flex items-center gap-0.5">
      {Object.entries(NOTE_COLORS).map(([key, value]) => (
        <button
          key={key}
          type="button"
          onClick={(e) => { e.stopPropagation(); updateCard(card.id, { noteColor: key }) }}
          className={cn(
            'h-4 w-4 rounded-full border transition-transform hover:scale-110',
            (card.noteColor ?? 'yellow') === key && 'scale-110 ring-1 ring-white/40',
          )}
          style={{ backgroundColor: value.accent, borderColor: value.accent }}
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
      focusOnClick
      showSelectionRing={false}
      frameClassName="canvas-note-frame"
      headerClassName="canvas-note-header"
      bodyClassName="canvas-note-body"
      frameStyleOverride={{
        background: 'var(--color-terminal-bg)',
        borderColor: 'var(--color-border)',
      }}
    >
      <textarea
        value={card.noteBody ?? ''}
        onChange={(e) => updateCard(card.id, { noteBody: e.target.value })}
        placeholder="写点什么..."
        className="h-full w-full resize-none border-0 bg-transparent px-4 pb-4 pt-3 text-[var(--ui-font-sm)] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
      />
    </CardFrame>
  )
}
