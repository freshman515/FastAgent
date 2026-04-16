import { Play, Pause, SkipBack, SkipForward, Music } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { AudioAnalyzer } from './audio/AudioAnalyzer'
import { MelodyRenderer } from './audio/MelodyRenderer'

interface MediaInfo {
  title: string
  artist: string
  status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
  artwork: string
}

export function MusicPlayer(): JSX.Element {
  const [media, setMedia] = useState<MediaInfo>({ title: '', artist: '', status: 'Stopped', artwork: '' })
  const [audioConnected, setAudioConnected] = useState(false)
  const vizMode = useUIStore((s) => s.settings.visualizerMode)
  const vizWidth = useUIStore((s) => s.settings.visualizerWidth)
  const showControls = useUIStore((s) => s.settings.showPlayerControls)
  const showTrackInfo = useUIStore((s) => s.settings.showTrackInfo)
  const analyzerRef = useRef<AudioAnalyzer>(new AudioAnalyzer())
  const rendererRef = useRef<MelodyRenderer>(new MelodyRenderer())
  const animRef = useRef<number>(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const playing = media.status === 'Playing'
  const hasMedia = media.title.length > 0

  // ── System media info subscription ──
  useEffect(() => {
    window.api.media.get().then(setMedia)
    const unsubscribe = window.api.media.onUpdate((info) => setMedia(info as MediaInfo))
    return () => {
      unsubscribe()
    }
  }, [])

  // ── Audio capture toggle ──
  const toggleAudioCapture = useCallback(async () => {
    const analyzer = analyzerRef.current
    if (analyzer.connected) {
      analyzer.disconnect()
      setAudioConnected(false)
    } else {
      try {
        await analyzer.connect()
        setAudioConnected(true)
      } catch {
        setAudioConnected(false)
      }
    }
  }, [])

  // ── Auto-connect system audio on mount ──
  useEffect(() => {
    const analyzer = analyzerRef.current
    if (!analyzer.connected) {
      analyzer.connect().then(() => setAudioConnected(true)).catch(() => {})
    }
  }, [])

  // ── Sync visualizer mode from settings ──
  useEffect(() => {
    rendererRef.current.mode = vizMode
  }, [vizMode])

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      analyzerRef.current.disconnect()
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  // ── Animation loop ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const analyzer = analyzerRef.current
    const renderer = rendererRef.current

    const draw = (): void => {
      if (audioConnected && analyzer.connected) {
        const features = analyzer.getFeatures()
        renderer.render(ctx, w, h, features)
      } else {
        renderer.renderIdle(ctx, w, h)
      }
      animRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [audioConnected, playing, vizWidth])

  // ── Media controls ──
  const handlePlayPause = useCallback(() => window.api.media.command('play-pause'), [])
  const handlePrev = useCallback(() => window.api.media.command('prev'), [])
  const handleNext = useCallback(() => window.api.media.command('next'), [])

  const displayText = hasMedia
    ? media.artist ? `${media.artist} - ${media.title}` : media.title
    : 'No media'

  return (
    <div className="flex items-center gap-2 pl-1.5 pr-3 py-0.5">
      {/* Controls group */}
      {showControls && (
      <div className="no-drag flex items-center gap-1">
        {/* Prev */}
        <button
          onClick={handlePrev}
          disabled={!hasMedia}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full',
            'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            'hover:bg-white/8 hover:-translate-x-px',
            'transition-all duration-150 active:scale-90',
            !hasMedia && 'opacity-30 pointer-events-none',
          )}
          aria-label="上一首"
        >
          <SkipBack size={13} fill="currentColor" strokeWidth={0} />
        </button>

        {/* Play/Pause — gradient ring + soft halo when playing */}
        <button
          onClick={handlePlayPause}
          disabled={!hasMedia}
          className={cn(
            'relative flex h-8 w-8 items-center justify-center rounded-full',
            'bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-hover)] text-white',
            'shadow-[0_2px_8px_-2px_var(--color-accent)]',
            'hover:brightness-110 hover:scale-105 hover:shadow-[0_3px_12px_-2px_var(--color-accent)]',
            'transition-all duration-150 active:scale-90',
            playing && 'ring-2 ring-[var(--color-accent)]/35 ring-offset-0',
            !hasMedia && 'opacity-30 pointer-events-none',
          )}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing
            ? <Pause size={14} fill="currentColor" strokeWidth={0} />
            : <Play size={14} fill="currentColor" strokeWidth={0} className="ml-0.5" />}
        </button>

        {/* Next */}
        <button
          onClick={handleNext}
          disabled={!hasMedia}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full',
            'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            'hover:bg-white/8 hover:translate-x-px',
            'transition-all duration-150 active:scale-90',
            !hasMedia && 'opacity-30 pointer-events-none',
          )}
          aria-label="下一首"
        >
          <SkipForward size={13} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
      )}

      {/* Melody Visualizer — click-through to title bar drag */}
      <div className="relative pointer-events-none">
        <canvas ref={canvasRef} className="h-7 rounded" style={{ width: vizWidth }} />
      </div>

      {/* Track info with artwork — inherits `drag` region from the parent
          title bar (no `.no-drag`), so clicking the track name grabs the
          window like the surrounding title bar. */}
      {showTrackInfo && (
        hasMedia ? (
          <div className="flex items-center gap-2 min-w-0 max-w-[240px] select-none">
            {media.artwork && (
              <img
                src={media.artwork}
                alt=""
                className="h-7 w-7 shrink-0 rounded object-cover shadow-sm"
                draggable={false}
              />
            )}
            <span
              className="truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]"
              title={displayText}
            >
              {displayText}
            </span>
          </div>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)]">
            <Music size={10} />
            No media
          </span>
        )
      )}
    </div>
  )
}
