import { AnimatePresence, motion } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, Music } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { AudioAnalyzer } from './audio/AudioAnalyzer'
import { MelodyRenderer } from './audio/MelodyRenderer'
import { extractArtworkPalette } from './audio/artworkHue'

interface MediaInfo {
  title: string
  artist: string
  albumTitle: string
  albumArtist: string
  sourceAppId: string
  trackNumber: number | null
  status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
  artwork: string
}

export function MusicPlayer(): JSX.Element {
  const [media, setMedia] = useState<MediaInfo>({
    title: '',
    artist: '',
    albumTitle: '',
    albumArtist: '',
    sourceAppId: '',
    trackNumber: null,
    status: 'Stopped',
    artwork: '',
  })
  const [audioConnected, setAudioConnected] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const vizMode = useUIStore((s) => s.settings.visualizerMode)
  const vizWidth = useUIStore((s) => s.settings.visualizerWidth)
  const showControls = useUIStore((s) => s.settings.showPlayerControls)
  const showTrackInfo = useUIStore((s) => s.settings.showTrackInfo)
  const analyzerRef = useRef<AudioAnalyzer>(new AudioAnalyzer())
  const rendererRef = useRef<MelodyRenderer>(new MelodyRenderer())
  const animRef = useRef<number>(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const detailsRef = useRef<HTMLDivElement>(null)
  const coverButtonRef = useRef<HTMLButtonElement>(null)

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

  // ── Derive visualizer palette from album artwork ──
  useEffect(() => {
    let cancelled = false
    const renderer = rendererRef.current
    if (!media.artwork) {
      renderer.setArtworkPalette(null)
      console.debug('[visualizer] no artwork, reset palette')
      return
    }
    extractArtworkPalette(media.artwork).then((palette) => {
      if (cancelled) return
      renderer.setArtworkPalette(palette)
      console.debug('[visualizer] artwork palette =', palette, 'length=', media.artwork.length)
    })
    return () => {
      cancelled = true
    }
  }, [media.artwork])

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      analyzerRef.current.disconnect()
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  useEffect(() => {
    if (media.artwork && hasMedia) return
    setDetailsOpen(false)
  }, [hasMedia, media.artwork])

  useEffect(() => {
    if (!detailsOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (detailsRef.current?.contains(target) || coverButtonRef.current?.contains(target)) return
      setDetailsOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [detailsOpen])

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
  const toggleDetails = useCallback(() => {
    if (!media.artwork || !hasMedia) return
    setDetailsOpen((open) => !open)
  }, [hasMedia, media.artwork])

  const displayText = hasMedia
    ? media.artist ? `${media.artist} - ${media.title}` : media.title
    : 'No media'
  const detailRows = [
    { label: '歌曲', value: media.title },
    { label: '歌手', value: media.artist || '未知歌手' },
    { label: '专辑', value: media.albumTitle || null },
    { label: '专辑艺术家', value: media.albumArtist || null },
    { label: '曲目号', value: media.trackNumber ? String(media.trackNumber) : null },
    { label: '状态', value: formatPlaybackStatus(media.status) },
    { label: '来源', value: formatSourceAppLabel(media.sourceAppId) || null },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value))

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
              <div className="relative no-drag shrink-0">
                <button
                  ref={coverButtonRef}
                  type="button"
                  onClick={toggleDetails}
                  aria-label={detailsOpen ? '收起歌曲详情' : '展开歌曲详情'}
                  className={cn(
                    'group relative block rounded-md transition-transform duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/55',
                    detailsOpen && 'scale-[1.04]',
                  )}
                >
                  <img
                    src={media.artwork}
                    alt=""
                    className={cn(
                      'h-7 w-7 rounded object-cover shadow-sm transition-all duration-200',
                      detailsOpen
                        ? 'shadow-[0_8px_22px_-8px_rgba(0,0,0,0.7)] brightness-110'
                        : 'group-hover:brightness-110 group-hover:shadow-md',
                    )}
                    draggable={false}
                  />
                  <span
                    className={cn(
                      'pointer-events-none absolute inset-0 rounded border transition-colors duration-200',
                      detailsOpen
                        ? 'border-white/35'
                        : 'border-white/0 group-hover:border-white/20',
                    )}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {detailsOpen && (
                    <motion.div
                      ref={detailsRef}
                      initial={{ opacity: 0, y: -8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
                      className={cn(
                        'absolute left-0 top-full z-[80] mt-2 w-72 overflow-hidden rounded-2xl',
                        'border border-white/12 bg-[var(--color-bg-secondary)]/94 backdrop-blur-xl',
                        'shadow-[0_18px_40px_-16px_rgba(0,0,0,0.82)]',
                      )}
                    >
                      <div
                        className="absolute inset-0 opacity-30"
                        style={{
                          backgroundImage: `linear-gradient(160deg, rgba(255,255,255,0.16), rgba(0,0,0,0.06)), url(${media.artwork})`,
                          backgroundPosition: 'center',
                          backgroundSize: 'cover',
                        }}
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,12,16,0.22),rgba(12,12,16,0.88)_48%,rgba(12,12,16,0.96))]" />

                      <div className="relative flex flex-col gap-3 px-3 py-3">
                        <div className="flex items-start gap-3">
                          <img
                            src={media.artwork}
                            alt=""
                            className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-lg shadow-black/35"
                            draggable={false}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
                              {formatPlaybackStatus(media.status)}
                            </div>
                            <div className="mt-1 truncate text-sm font-semibold text-white">
                              {media.title}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-white/72">
                              {media.artist || '未知歌手'}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-1.5 rounded-xl border border-white/8 bg-black/18 p-2.5">
                          {detailRows.map((row) => (
                            <div key={row.label} className="flex items-start justify-between gap-3 text-xs">
                              <span className="shrink-0 text-white/48">{row.label}</span>
                              <span className="min-w-0 text-right leading-relaxed text-white/82 break-all">
                                {row.value}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="text-[10px] text-white/42">
                          点击其他区域可收起
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
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

function formatPlaybackStatus(status: MediaInfo['status']): string {
  switch (status) {
    case 'Playing':
      return '播放中'
    case 'Paused':
      return '已暂停'
    case 'Stopped':
      return '已停止'
    default:
      return '未知状态'
  }
}

function formatSourceAppLabel(sourceAppId: string): string {
  if (!sourceAppId) return ''

  const lower = sourceAppId.toLowerCase()
  if (lower.includes('qqmusic')) return 'QQ 音乐'
  if (lower.includes('spotify')) return 'Spotify'
  if (lower.includes('cloudmusic') || lower.includes('music.163') || lower.includes('netease')) return '网易云音乐'
  if (lower.includes('kugou')) return '酷狗音乐'
  if (lower.includes('kwmusic') || lower.includes('kuwo')) return '酷我音乐'
  if (lower.includes('applemusic') || lower.includes('itunes')) return 'Apple Music'
  if (lower.includes('zune') || lower.includes('mediaplayer')) return 'Windows Media Player'

  const compact = sourceAppId.replace(/^.*!/, '').replace(/[._-]+/g, ' ').trim()
  return compact || sourceAppId
}
