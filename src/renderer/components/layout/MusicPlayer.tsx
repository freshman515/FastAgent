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
    <div className="flex items-center gap-4 pl-2 pr-4 py-0.5">
      {/* ─── Controls: Floating Console Style ─── */}
      {showControls && (
        <div className="no-drag flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/20 ring-1 ring-white/[0.03] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
          {/* Prev */}
          <button
            onClick={handlePrev}
            disabled={!hasMedia}
            className={cn(
              'flex h-6.5 w-6.5 items-center justify-center rounded-full',
              'text-[var(--color-text-tertiary)] hover:text-white',
              'hover:bg-white/[0.08] transition-all duration-200 active:scale-90',
              !hasMedia && 'opacity-20 pointer-events-none',
            )}
            title="上一首"
          >
            <SkipBack size={12} fill="currentColor" strokeWidth={0} />
          </button>

          {/* Play/Pause: Neon Pulsing Button */}
          <button
            onClick={handlePlayPause}
            disabled={!hasMedia}
            className={cn(
              'group/play relative flex h-8.5 w-8.5 items-center justify-center rounded-full',
              'bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-hover)] text-white',
              'shadow-[0_4px_12px_-2px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.3)]',
              'transition-all duration-300 active:scale-95',
              playing ? 'animate-[pulse_4s_infinite]' : 'brightness-90 hover:brightness-110',
              !hasMedia && 'opacity-30 grayscale pointer-events-none',
            )}
            aria-label={playing ? '暂停' : '播放'}
          >
            {/* Inner Glow */}
            <div className="absolute inset-0 rounded-full bg-[var(--color-accent)] blur-[8px] opacity-0 group-hover/play:opacity-40 transition-opacity" />
            {playing
              ? <Pause size={15} fill="currentColor" strokeWidth={0} className="relative z-10" />
              : <Play size={15} fill="currentColor" strokeWidth={0} className="relative z-10 ml-0.5" />}
          </button>

          {/* Next */}
          <button
            onClick={handleNext}
            disabled={!hasMedia}
            className={cn(
              'flex h-6.5 w-6.5 items-center justify-center rounded-full',
              'text-[var(--color-text-tertiary)] hover:text-white',
              'hover:bg-white/[0.08] transition-all duration-200 active:scale-90',
              !hasMedia && 'opacity-20 pointer-events-none',
            )}
            title="下一首"
          >
            <SkipForward size={12} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      )}

      {/* ─── Visualizer: Recessed Deep Container ─── */}
      <div className="relative flex items-center justify-center px-1 py-1 rounded-[var(--radius-md)] bg-black/40 shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.04]">
        <canvas ref={canvasRef} className="h-7 opacity-90" style={{ width: vizWidth }} />
        {/* Subtle glass reflection overlay */}
        <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-md)] bg-gradient-to-b from-white/[0.03] to-transparent" />
      </div>

      {/* ─── Track Info: Premium Badge ─── */}
      {showTrackInfo && (
        hasMedia ? (
          <div className="flex items-center gap-3 min-w-0 max-w-[280px] select-none group/info">
            {media.artwork && (
              <div className="relative no-drag shrink-0">
                <button
                  ref={coverButtonRef}
                  type="button"
                  onClick={toggleDetails}
                  className={cn(
                    'group relative block rounded-lg transition-all duration-300',
                    'ring-2 ring-transparent hover:ring-[var(--color-accent)]/30',
                    detailsOpen && 'scale-110 ring-[var(--color-accent)]/50',
                  )}
                >
                  <img
                    src={media.artwork}
                    alt=""
                    className={cn(
                      'h-8 w-8 rounded-lg object-cover shadow-lg transition-all duration-500',
                      detailsOpen ? 'brightness-110' : 'group-hover:brightness-110',
                    )}
                    draggable={false}
                  />
                  {/* Floating shine effect */}
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                <AnimatePresence>
                  {detailsOpen && (
                    <motion.div
                      ref={detailsRef}
                      initial={{ opacity: 0, y: -12, scale: 0.92, filter: 'blur(10px)' }}
                      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, y: -8, scale: 0.95, filter: 'blur(8px)' }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                      className={cn(
                        'absolute left-0 top-full z-[80] mt-3 w-72 overflow-hidden rounded-[24px]',
                        'border border-white/10 bg-[#0f0f11]/95 backdrop-blur-3xl',
                        'shadow-[0_24px_50px_-12px_rgba(0,0,0,0.8)]',
                      )}
                    >
                      {/* Artistic background blur based on artwork */}
                      <div
                        className="absolute inset-0 opacity-40 blur-2xl scale-110"
                        style={{
                          backgroundImage: `url(${media.artwork})`,
                          backgroundPosition: 'center',
                          backgroundSize: 'cover',
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0f0f11]/80 to-[#0f0f11]" />

                      <div className="relative flex flex-col gap-4 px-4 py-5">
                        <div className="flex items-center gap-4">
                          <img
                            src={media.artwork}
                            alt=""
                            className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-[0_12px_24px_rgba(0,0,0,0.5)] ring-1 ring-white/10"
                            draggable={false}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-pulse shadow-[0_0_8px_var(--color-accent)]" />
                              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--color-accent)]">
                                {formatPlaybackStatus(media.status)}
                              </div>
                            </div>
                            <div className="mt-1.5 truncate text-[15px] font-bold text-white tracking-tight">
                              {media.title}
                            </div>
                            <div className="mt-0.5 truncate text-[12px] font-medium text-white/60">
                              {media.artist || '未知歌手'}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5 rounded-2xl border border-white/[0.06] bg-black/30 p-3.5 backdrop-blur-sm">
                          {detailRows.map((row) => (
                            <div key={row.label} className="flex items-start justify-between gap-4 text-[11px]">
                              <span className="shrink-0 font-bold text-white/30 uppercase tracking-wider">{row.label}</span>
                              <span className="min-w-0 text-right font-medium text-white/80 break-all">
                                {row.value}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="px-1 text-[10px] font-bold text-white/20 uppercase tracking-[0.1em]">
                          点击外部区域收起详情
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            
            <div className="flex flex-col min-w-0">
              <span
                className="truncate text-[12px] font-bold tracking-tight text-white group-hover/info:text-[var(--color-accent)] transition-colors duration-300"
                title={displayText}
              >
                {media.title || '正在获取曲目...'}
              </span>
              <span className="truncate text-[10px] font-medium text-[var(--color-text-tertiary)] opacity-80 group-hover/info:opacity-100 transition-opacity">
                {media.artist || '未知艺术家'}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.05] transition-all hover:bg-white/[0.06]">
            <Music size={11} className="text-[var(--color-text-tertiary)] animate-bounce" />
            <span className="text-[11px] font-bold tracking-tight text-[var(--color-text-tertiary)] opacity-60">
              未检测到播放中的媒体
            </span>
          </div>
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
