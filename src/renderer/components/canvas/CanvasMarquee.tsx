import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'

export function CanvasMarquee(): JSX.Element | null {
  const marquee = useCanvasUiStore((state) => state.marquee)
  const viewport = useCanvasStore((state) => state.getLayout().viewport)
  if (!marquee) return null

  const left = marquee.x * viewport.scale + viewport.offsetX
  const top = marquee.y * viewport.scale + viewport.offsetY
  const width = marquee.width * viewport.scale
  const height = marquee.height * viewport.scale

  return (
    <div
      className="pointer-events-none absolute z-[3]"
      style={{
        left,
        top,
        width,
        height,
        border: '1px solid var(--color-accent)',
        background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        borderRadius: 2,
      }}
    />
  )
}
