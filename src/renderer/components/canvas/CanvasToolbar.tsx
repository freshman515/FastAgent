import { StickyNote, Maximize2, RotateCcw, Grid3x3, Magnet, LayoutGrid } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/stores/canvas'
import { useUIStore } from '@/stores/ui'

interface CanvasToolbarProps {
  viewportRef: React.RefObject<HTMLDivElement | null>
}

export function CanvasToolbar({ viewportRef }: CanvasToolbarProps): JSX.Element {
  const scale = useCanvasStore((state) => state.getLayout().viewport.scale)
  const addCard = useCanvasStore((state) => state.addCard)
  const resetViewport = useCanvasStore((state) => state.resetViewport)
  const fitAll = useCanvasStore((state) => state.fitAll)
  const arrange = useCanvasStore((state) => state.arrange)

  const gridEnabled = useUIStore((state) => state.settings.canvasGridEnabled)
  const snapEnabled = useUIStore((state) => state.settings.canvasSnapEnabled)
  const updateSettings = useUIStore((state) => state.updateSettings)

  const [arrangeOpen, setArrangeOpen] = useState(false)
  const arrangeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!arrangeOpen) return
    const onDown = (event: MouseEvent): void => {
      if (!arrangeRef.current) return
      if (arrangeRef.current.contains(event.target as Node)) return
      setArrangeOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [arrangeOpen])

  const createNoteAtCenter = (): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const { scale: s, offsetX, offsetY } = useCanvasStore.getState().getLayout().viewport
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const x = (centerX - offsetX) / s - 120
    const y = (centerY - offsetY) / s - 80
    addCard({ kind: 'note', x, y, noteBody: '', noteColor: 'yellow' })
  }

  const handleFitAll = (): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    fitAll(rect.width, rect.height)
  }

  const btn = (active: boolean): string => cn(
    'flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] transition-colors',
    active
      ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
  )

  const handleArrange = (kind: 'grid' | 'rowFlow' | 'colFlow' | 'pack'): void => {
    arrange(kind)
    setArrangeOpen(false)
  }

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/95 p-1 shadow-lg backdrop-blur">
      <button type="button" onClick={createNoteAtCenter} className={btn(false)} title="新建便签">
        <StickyNote size={16} />
      </button>
      <div className="mx-0.5 h-6 w-px bg-[var(--color-border)]" />

      <div ref={arrangeRef} className="relative">
        <button
          type="button"
          onClick={() => setArrangeOpen((prev) => !prev)}
          className={btn(arrangeOpen)}
          title="自动排列"
        >
          <LayoutGrid size={16} />
        </button>
        {arrangeOpen && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[160px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] py-1 shadow-xl">
            <ArrangeItem label="网格" onClick={() => handleArrange('grid')} />
            <ArrangeItem label="横向流" onClick={() => handleArrange('rowFlow')} />
            <ArrangeItem label="纵向流" onClick={() => handleArrange('colFlow')} />
            <ArrangeItem label="紧凑打包" onClick={() => handleArrange('pack')} />
          </div>
        )}
      </div>

      <button type="button" onClick={handleFitAll} className={btn(false)} title="适配所有内容">
        <Maximize2 size={16} />
      </button>
      <button type="button" onClick={resetViewport} className={btn(false)} title="重置视图 (100%)">
        <RotateCcw size={16} />
      </button>
      <button
        type="button"
        onClick={() => updateSettings({ canvasGridEnabled: !gridEnabled })}
        className={btn(gridEnabled)}
        title="显示网格"
      >
        <Grid3x3 size={16} />
      </button>
      <button
        type="button"
        onClick={() => updateSettings({ canvasSnapEnabled: !snapEnabled })}
        className={btn(snapEnabled)}
        title="吸附到网格"
      >
        <Magnet size={16} />
      </button>
      <div className="mx-0.5 h-6 w-px bg-[var(--color-border)]" />
      <span
        className="px-2 text-[var(--ui-font-xs)] font-mono text-[var(--color-text-tertiary)]"
        title="缩放"
      >
        {Math.round(scale * 100)}%
      </span>
    </div>
  )
}

function ArrangeItem({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
    >
      {label}
    </button>
  )
}
