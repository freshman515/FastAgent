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
    return unsubscribe
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
  }, [audioConnected, playing])

  // ── Media controls ──
  const handlePlayPause = useCallback(() => window.api.media.command('play-pause'), [])
  const handlePrev = useCallback(() => window.api.media.command('prev'), [])
  const handleNext = useCallback(() => window.api.media.command('next'), [])

  const displayText = hasMedia
    ? media.artist ? `${media.artist} - ${media.title}` : media.title
    : 'No media'

  return (
    <div className="no-drag flex items-center gap-2 rounded-full bg-[var(--color-bg-primary)]/50 pl-1.5 pr-3 py-0.5 backdrop-blur-sm border border-[var(--color-border)]/30">
      {/* Controls group */}
      <div className="flex items-center gap-0.5">
        {/* Prev */}
        <button
          onClick={handlePrev}
          disabled={!hasMedia}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full',
            'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-white/5',
            'transition-all duration-150 active:scale-90',
            !hasMedia && 'opacity-30 pointer-events-none',
          )}
        >
          <SkipBack size={11} fill="currentColor" />
        </button>

        {/* Play/Pause */}
        <button
          onClick={handlePlayPause}
          disabled={!hasMedia}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full',
            'bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/30',
            'hover:shadow-md hover:shadow-[var(--color-accent)]/40 hover:brightness-110',
            'transition-all duration-150 active:scale-90',
            !hasMedia && 'opacity-30 pointer-events-none',
          )}
        >
          {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
        </button>

        {/* Next */}
        <button
          onClick={handleNext}
          disabled={!hasMedia}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full',
            'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-white/5',
            'transition-all duration-150 active:scale-90',
            !hasMedia && 'opacity-30 pointer-events-none',
          )}
        >
          <SkipForward size={11} fill="currentColor" />
        </button>
      </div>

      {/* Melody Visualizer */}
      <button
        onClick={toggleAudioCapture}
        className="relative cursor-pointer"
        title={audioConnected ? 'Disconnect audio visualization' : 'Connect system audio for visualization'}
      >
        <canvas ref={canvasRef} className="h-7 w-48 rounded" />
      </button>

      {/* Track info with artwork */}
      {hasMedia ? (
        <div className="flex items-center gap-1.5 min-w-0 max-w-[180px]">
          {media.artwork && (
            <img
              src={media.artwork}
              alt=""
              className="h-6 w-6 shrink-0 rounded object-cover shadow-sm"
            />
          )}
          <span
            className="truncate text-xs font-medium text-[var(--color-text-primary)]"
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
      )}
    </div>
  )
}
