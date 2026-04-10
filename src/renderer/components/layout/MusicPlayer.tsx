import { Play, Pause, SkipBack, SkipForward, Music, Radio } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { AudioAnalyzer } from './audio/AudioAnalyzer'
import { MelodyRenderer } from './audio/MelodyRenderer'

interface MediaInfo {
  title: string
  artist: string
  status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
}

export function MusicPlayer(): JSX.Element {
  const [media, setMedia] = useState<MediaInfo>({ title: '', artist: '', status: 'Stopped' })
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
        renderer.renderIdle(ctx, w, h, playing)
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
    <div className="no-drag flex items-center gap-1.5 rounded-full bg-[var(--color-bg-primary)]/60 px-2 py-0.5 backdrop-blur-sm">
      {/* Prev */}
      <button
        onClick={handlePrev}
        disabled={!hasMedia}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full',
          'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
          'transition-colors duration-100',
          !hasMedia && 'opacity-40 pointer-events-none',
        )}
      >
        <SkipBack size={10} fill="currentColor" />
      </button>

      {/* Play/Pause */}
      <button
        onClick={handlePlayPause}
        disabled={!hasMedia}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full',
          'bg-[var(--color-accent)] text-white',
          'hover:brightness-110 transition-all duration-100',
          !hasMedia && 'opacity-40 pointer-events-none',
        )}
      >
        {playing ? <Pause size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
      </button>

      {/* Next */}
      <button
        onClick={handleNext}
        disabled={!hasMedia}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full',
          'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
          'transition-colors duration-100',
          !hasMedia && 'opacity-40 pointer-events-none',
        )}
      >
        <SkipForward size={10} fill="currentColor" />
      </button>

      {/* Melody Visualizer */}
      <button
        onClick={toggleAudioCapture}
        className="relative cursor-pointer"
        title={audioConnected ? 'Disconnect audio visualization' : 'Connect system audio for visualization'}
      >
        <canvas ref={canvasRef} className="h-7 w-48 rounded" />
        {/* Connection indicator */}
        {!audioConnected && (
          <div className="absolute inset-0 flex items-center justify-center rounded bg-[var(--color-bg-primary)]/30 opacity-0 transition-opacity hover:opacity-100">
            <Radio size={12} className="text-[var(--color-text-tertiary)]" />
          </div>
        )}
        {audioConnected && (
          <div className="absolute right-1 top-0.5">
            <span className="block h-1 w-1 rounded-full bg-green-400 shadow-[0_0_3px_theme(colors.green.400)]" />
          </div>
        )}
      </button>

      {/* Track info */}
      {hasMedia ? (
        <span
          className="max-w-[120px] truncate text-[10px] font-medium text-[var(--color-text-secondary)]"
          title={displayText}
        >
          {displayText}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)]">
          <Music size={10} />
          No media
        </span>
      )}
    </div>
  )
}
