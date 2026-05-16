import { useMemo, type CSSProperties } from 'react'
import type { CanvasCard } from '@shared/types'
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { cn } from '@/lib/utils'

export function CanvasSpaceSwitcher(): JSX.Element | null {
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const activeSpaceId = useCanvasUiStore((state) => state.activeSpaceId)
  const setActiveSpaceId = useCanvasUiStore((state) => state.setActiveSpaceId)

  const spaces = useMemo(
    () => cards
      .filter((card): card is CanvasCard => card.kind === 'frame')
      .sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.createdAt - b.createdAt)),
    [cards],
  )
  const activeSpace = activeSpaceId ? spaces.find((space) => space.id === activeSpaceId) ?? null : null

  const activateAll = (): void => {
    setActiveSpaceId(null)
    useCanvasStore.getState().showAllCards()
    const viewport = document.querySelector('[data-canvas-viewport]') as HTMLDivElement | null
    const rect = viewport?.getBoundingClientRect()
    if (rect) requestAnimationFrame(() => useCanvasStore.getState().fitAll(rect.width, rect.height))
  }

  const activateSpace = (spaceId: string): void => {
    setActiveSpaceId(spaceId)
    useCanvasStore.getState().clearMaximizedCard()
    useCanvasStore.getState().focusFrameWorkspace(spaceId)
  }

  return (
    <div
      className="canvas-space-switcher"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={activateAll}
        className={cn('canvas-space-switcher__item canvas-space-switcher__item--root', activeSpaceId === null && 'canvas-space-switcher__item--active')}
        title="显示全部空间和卡片"
      >
        全部
      </button>
      {activeSpace && (
        <>
          <span className="canvas-space-switcher__separator">/</span>
          <button
            type="button"
            onClick={() => activateSpace(activeSpace.id)}
            className="canvas-space-switcher__item canvas-space-switcher__item--active"
            style={{ '--canvas-space-accent': getSpaceAccent(activeSpace) } as CSSProperties}
            title={`${activeSpace.frameTitle?.trim() || '空间'} · ${activeSpace.frameMemberIds?.length ?? 0} 张卡片`}
          >
            <span className="canvas-space-switcher__dot" />
            <span className="canvas-space-switcher__label">{activeSpace.frameTitle?.trim() || '空间'}</span>
          </button>
        </>
      )}
      {spaces.map((space) => (
        activeSpaceId === space.id ? null :
        <button
          key={space.id}
          type="button"
          onClick={() => activateSpace(space.id)}
          className={cn('canvas-space-switcher__item', activeSpaceId === space.id && 'canvas-space-switcher__item--active')}
          style={{ '--canvas-space-accent': getSpaceAccent(space) } as CSSProperties}
          title={`${space.frameTitle?.trim() || '空间'} · ${space.frameMemberIds?.length ?? 0} 张卡片`}
        >
          <span className="canvas-space-switcher__dot" />
          <span className="canvas-space-switcher__label">{space.frameTitle?.trim() || '空间'}</span>
        </button>
      ))}
    </div>
  )
}

function getSpaceAccent(space: CanvasCard): string {
  switch (space.frameColor) {
    case 'blue': return '#38bdf8'
    case 'emerald': return '#34d399'
    case 'amber': return '#f59e0b'
    case 'rose': return '#fb7185'
    case 'slate': return '#94a3b8'
    case 'violet':
    default:
      return '#8b7cf6'
  }
}
