import { useMemo, useRef } from 'react'
import { isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'

interface CanvasMinimapProps {
  viewportRef: React.RefObject<HTMLDivElement | null>
}

const MINIMAP_WIDTH = 180
const MINIMAP_HEIGHT = 130
const PADDING = 60

export function CanvasMinimap({ viewportRef }: CanvasMinimapProps): JSX.Element | null {
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const viewport = useCanvasStore((state) => state.getLayout().viewport)
  const mapRef = useRef<HTMLDivElement>(null)
  const visibleCards = useMemo(() => cards.filter((card) => !isCanvasCardHidden(card)), [cards])

  const bounds = useMemo(() => {
    if (visibleCards.length === 0) {
      return { minX: -PADDING, minY: -PADDING, maxX: PADDING, maxY: PADDING }
    }
    return {
      minX: Math.min(...visibleCards.map((c) => c.x)) - PADDING,
      minY: Math.min(...visibleCards.map((c) => c.y)) - PADDING,
      maxX: Math.max(...visibleCards.map((c) => c.x + c.width)) + PADDING,
      maxY: Math.max(...visibleCards.map((c) => c.y + c.height)) + PADDING,
    }
  }, [visibleCards])

  const boundsWidth = Math.max(bounds.maxX - bounds.minX, 200)
  const boundsHeight = Math.max(bounds.maxY - bounds.minY, 140)
  const scale = Math.min(MINIMAP_WIDTH / boundsWidth, MINIMAP_HEIGHT / boundsHeight)
  const worldToMapX = (x: number): number => (x - bounds.minX) * scale
  const worldToMapY = (y: number): number => (y - bounds.minY) * scale

  // Current viewport rectangle in world coordinates.
  const viewRect = (() => {
    const el = viewportRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: -viewport.offsetX / viewport.scale,
      y: -viewport.offsetY / viewport.scale,
      width: rect.width / viewport.scale,
      height: rect.height / viewport.scale,
    }
  })()

  const jumpTo = (clientX: number, clientY: number): void => {
    if (!mapRef.current || !viewportRef.current) return
    const mapRect = mapRef.current.getBoundingClientRect()
    const mx = clientX - mapRect.left
    const my = clientY - mapRect.top
    const worldX = mx / scale + bounds.minX
    const worldY = my / scale + bounds.minY
    const viewportRect = viewportRef.current.getBoundingClientRect()
    const currentViewport = useCanvasStore.getState().getViewport()
    useCanvasStore.getState().setViewport({
      offsetX: viewportRect.width / 2 - worldX * currentViewport.scale,
      offsetY: viewportRect.height / 2 - worldY * currentViewport.scale,
    })
  }

  return (
    <div
      ref={mapRef}
      className="absolute right-4 bottom-4 z-[100000] cursor-pointer overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/80 opacity-45 shadow-lg backdrop-blur transition-opacity duration-150 hover:opacity-100 active:opacity-100"
      style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
      onPointerDown={(e) => { e.stopPropagation(); jumpTo(e.clientX, e.clientY) }}
      onPointerMove={(e) => {
        if (e.buttons & 1) jumpTo(e.clientX, e.clientY)
      }}
    >
      <svg width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} style={{ display: 'block' }}>
        {visibleCards.map((card) => {
          const isSession = card.kind === 'session' || card.kind === 'terminal'
          const isFrame = card.kind === 'frame'
          return (
            <rect
              key={card.id}
              x={worldToMapX(card.x)}
              y={worldToMapY(card.y)}
              width={Math.max(2, card.width * scale)}
              height={Math.max(2, card.height * scale)}
              fill={isFrame ? 'transparent' : isSession ? 'color-mix(in srgb, var(--color-accent) 60%, transparent)' : 'color-mix(in srgb, var(--color-text-tertiary) 40%, transparent)'}
              stroke={isFrame ? 'color-mix(in srgb, var(--color-accent) 62%, transparent)' : undefined}
              strokeWidth={isFrame ? 1 : undefined}
              rx={1}
            />
          )
        })}
        {viewRect && (
          <rect
            x={worldToMapX(viewRect.x)}
            y={worldToMapY(viewRect.y)}
            width={Math.max(4, viewRect.width * scale)}
            height={Math.max(4, viewRect.height * scale)}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            rx={1}
          />
        )}
      </svg>
    </div>
  )
}
