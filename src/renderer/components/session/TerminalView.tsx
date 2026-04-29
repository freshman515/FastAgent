import { X, ChevronUp, ChevronDown, Copy, ClipboardPaste, FileText, FolderOpen, Keyboard, ListChecks, Search, Eraser, Mic, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@shared/types'
import {
  findTerminalFileLinkAtCell,
  getTerminalQuestionNavigation,
  isTerminalAbsolutePath,
  joinTerminalCwd,
  scrollTerminalToLatest,
  scrollTerminalToQuestion,
  useXterm,
  type ParsedFileRef,
  type TerminalQuestionNavigation,
} from '@/hooks/useXterm'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { getSessionIcon } from '@/lib/sessionIcon'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'
import { SessionIconView } from './SessionIconView'

interface TerminalViewProps {
  session: Session
  isActive: boolean
}

const CONTEXT_MENU_ITEM =
  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]'
type SendPickerMode = 'send' | 'insert'
type VoiceCaptureState = 'recording' | 'finishing' | 'transcribing'
type PreparedVoiceAudio = {
  audio: ArrayBuffer
  mimeType: string
  audioFormat?: 'encoded' | 'pcm_s16le'
  sampleRate?: number
}
type StreamingVoiceState = {
  committedText: string
  liveText: string
  insertedText: string
  sentEnd: boolean
}
type TerminalContextFileLink = ParsedFileRef & {
  absolutePath: string
}

const FUNASR_TARGET_SAMPLE_RATE = 16000
const FUNASR_STREAM_FINAL_IDLE_MS = 1200
const LOCAL_ASR_READY_CACHE_MS = 5 * 60 * 1000
const LOCAL_ASR_WARMUP_CACHE_MS = 10 * 60 * 1000
const LOCAL_ASR_SHORTCUT_LABEL = 'Ctrl+Alt+V'
const MEDIA_RECORDER_VOICE_TIMESLICE_MS = 250
const VOICE_WAVE_BAR_COUNT = 40
const VOICE_WAVE_BAR_INDICES = Array.from({ length: VOICE_WAVE_BAR_COUNT }, (_, index) => index)
type LocalAsrStartupAction = 'start' | 'restart'
type LocalAsrReadyCache = { containerName: string; checkedAt: number }
type LocalAsrWarmupCache = { endpoint: string; containerName: string; checkedAt: number }
type LocalAsrReadyInFlight = {
  containerName: string
  action: LocalAsrStartupAction
  quiet: boolean
  promise: Promise<boolean>
}
type LocalAsrWarmupInFlight = {
  endpoint: string
  containerName: string
  promise: Promise<boolean>
}

let localAsrReadyCache: LocalAsrReadyCache | null = null
let localAsrWarmupCache: LocalAsrWarmupCache | null = null
let localAsrReadyInFlight: LocalAsrReadyInFlight | null = null
let localAsrWarmupInFlight: LocalAsrWarmupInFlight | null = null

function hasFreshLocalAsrReadyCache(containerName: string): boolean {
  return Boolean(
    localAsrReadyCache
      && localAsrReadyCache.containerName === containerName
      && Date.now() - localAsrReadyCache.checkedAt < LOCAL_ASR_READY_CACHE_MS,
  )
}

function markLocalAsrReady(containerName: string): void {
  localAsrReadyCache = { containerName, checkedAt: Date.now() }
}

function hasFreshLocalAsrWarmupCache(endpoint: string, containerName: string): boolean {
  return Boolean(
    localAsrWarmupCache
      && localAsrWarmupCache.endpoint === endpoint
      && localAsrWarmupCache.containerName === containerName
      && Date.now() - localAsrWarmupCache.checkedAt < LOCAL_ASR_WARMUP_CACHE_MS,
  )
}

function markLocalAsrWarm(containerName: string, endpoint: string): void {
  localAsrWarmupCache = { endpoint, containerName, checkedAt: Date.now() }
}

function invalidateLocalAsrReady(containerName?: string): void {
  if (!containerName || localAsrReadyCache?.containerName === containerName) {
    localAsrReadyCache = null
  }
  if (!containerName || localAsrWarmupCache?.containerName === containerName) {
    localAsrWarmupCache = null
  }
}

function buildBracketedPastePayload(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.includes('\n') ? `\x1b[200~${normalized}\x1b[201~` : normalized
}

function isWebSocketVoiceEndpoint(endpoint: string): boolean {
  return /^wss?:\/\//i.test(endpoint.trim())
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let index = 0
  while (index < max && a[index] === b[index]) index += 1
  return index
}

function mergeRecognizedText(base: string, addition: string): string {
  const left = base.trim()
  const right = addition.trim()
  if (!right) return left
  if (!left) return right
  if (left.endsWith(right)) return left
  if (right.startsWith(left)) return right

  const maxOverlap = Math.min(left.length, right.length)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (left.slice(-overlap) === right.slice(0, overlap)) {
      return left + right.slice(overlap)
    }
  }

  return left + right
}

function isOfflineFunasrMessage(message: Record<string, unknown>): boolean {
  const mode = typeof message.mode === 'string' ? message.mode.toLowerCase() : ''
  return mode.includes('offline') || message.is_final === true
}

function normalizeVoiceLevel(rms: number): number {
  return Math.max(0, Math.min(1, Math.pow(rms * 10, 0.72)))
}

function audioBufferToVoiceLevel(audioBuffer: AudioBuffer): number {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels)
  const stride = Math.max(1, Math.floor(audioBuffer.length / 1024))
  let sumSquares = 0
  let sampleCount = 0

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = audioBuffer.getChannelData(channelIndex)
    for (let i = 0; i < channel.length; i += stride) {
      const sample = channel[i]
      sumSquares += sample * sample
      sampleCount += 1
    }
  }

  if (sampleCount === 0) return 0
  return normalizeVoiceLevel(Math.sqrt(sumSquares / sampleCount))
}

function getVoiceCaptureCopy(state: VoiceCaptureState, acceptsInput: boolean): { title: string; subtitle: string } {
  if (state === 'recording' && !acceptsInput) return { title: '等待焦点', subtitle: '切回后继续输入' }
  if (state === 'recording') return { title: '正在录音', subtitle: '实时输入' }
  if (state === 'finishing') return { title: '正在收尾', subtitle: '等待最终文本' }
  return { title: '正在识别', subtitle: '请稍候' }
}

function createSilentPcmS16le(audioBuffer: AudioBuffer, targetSampleRate: number): ArrayBuffer {
  const sampleCount = Math.max(1, Math.round(audioBuffer.duration * targetSampleRate))
  return new Int16Array(sampleCount).buffer
}

function audioBufferToPcmS16le(audioBuffer: AudioBuffer, targetSampleRate: number): ArrayBuffer {
  if (audioBuffer.length === 0) throw new Error('录音为空。')

  const sourceRate = audioBuffer.sampleRate
  const channelCount = Math.max(1, audioBuffer.numberOfChannels)
  const channels = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index))
  const targetLength = Math.max(1, Math.round(audioBuffer.duration * targetSampleRate))
  const pcm = new Int16Array(targetLength)

  for (let i = 0; i < targetLength; i += 1) {
    const sourcePosition = i * sourceRate / targetSampleRate
    const sourceIndex = Math.min(Math.floor(sourcePosition), audioBuffer.length - 1)
    const nextIndex = Math.min(sourceIndex + 1, audioBuffer.length - 1)
    const fraction = sourcePosition - sourceIndex
    let mixed = 0

    for (const channel of channels) {
      const current = channel[sourceIndex]
      const next = channel[nextIndex]
      mixed += current + (next - current) * fraction
    }

    const sample = Math.max(-1, Math.min(1, mixed / channelCount))
    pcm[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff)
  }

  return pcm.buffer.slice(0)
}

async function prepareVoiceAudio(blob: Blob, mimeType: string, websocketEndpoint: boolean): Promise<PreparedVoiceAudio> {
  if (!websocketEndpoint) {
    return {
      audio: await blob.arrayBuffer(),
      mimeType,
      audioFormat: 'encoded',
    }
  }

  const AudioContextConstructor = window.AudioContext
    ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) throw new Error('当前环境不支持音频解码。')

  const encoded = await blob.arrayBuffer()
  const audioContext = new AudioContextConstructor()
  try {
    const decoded = await audioContext.decodeAudioData(encoded.slice(0))
    return {
      audio: audioBufferToPcmS16le(decoded, FUNASR_TARGET_SAMPLE_RATE),
      mimeType: 'audio/pcm; codec=s16le; rate=16000',
      audioFormat: 'pcm_s16le',
      sampleRate: FUNASR_TARGET_SAMPLE_RATE,
    }
  } finally {
    void audioContext.close().catch(() => {})
  }
}

export function TerminalView({ session, isActive }: TerminalViewProps): JSX.Element {
  const { containerRef, searchAddonRef, terminalRef, pasteFromClipboardRef, isAtBottom } = useXterm(session, isActive)
  const isDarkTheme = useIsDarkTheme()
  const allSessions = useSessionsStore((s) => s.sessions)
  const projects = useProjectsStore((s) => s.projects)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const settings = useUIStore((s) => s.settings)
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const addToast = useUIStore((s) => s.addToast)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    hasSelection: boolean
    fileLink: TerminalContextFileLink | null
    questionNavigation: TerminalQuestionNavigation
  } | null>(null)
  const [sendPicker, setSendPicker] = useState<{ x: number; y: number; text: string; mode: SendPickerMode } | null>(null)
  const [voiceCaptureState, setVoiceCaptureState] = useState<VoiceCaptureState | null>(null)
  const [voiceLevel, setVoiceLevel] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const voiceStreamIdRef = useRef<string | null>(null)
  const voiceStreamUnsubscribeRef = useRef<(() => void) | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const voiceMeterFrameRef = useRef<number | null>(null)
  const voiceMeterAudioContextRef = useRef<AudioContext | null>(null)
  const voiceMeterSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamingVoiceRef = useRef<StreamingVoiceState | null>(null)
  const streamingFinishTimerRef = useRef<number | null>(null)
  const voiceAcceptsInputRef = useRef(isActive)
  useEffect(() => {
    voiceAcceptsInputRef.current = isActive
  }, [isActive])
  const targetSessions = useMemo(
    () => allSessions.filter((item) =>
      item.id !== session.id
      && item.projectId === session.projectId
      && item.status === 'running'
      && Boolean(item.ptyId),
    ),
    [allSessions, session.id, session.projectId],
  )
  const sessionCwd = useMemo(() => {
    const project = projects.find((item) => item.id === session.projectId)
    const worktree = session.worktreeId
      ? worktrees.find((item) => item.id === session.worktreeId)
      : worktrees.find((item) => item.projectId === session.projectId && item.isMain)
    return session.cwd ?? worktree?.path ?? project?.path ?? ''
  }, [projects, session.cwd, session.projectId, session.worktreeId, worktrees])
  const resolveTerminalLinkPath = useCallback((path: string): string | null => {
    if (isTerminalAbsolutePath(path)) return path
    return sessionCwd ? joinTerminalCwd(sessionCwd, path) : null
  }, [sessionCwd])
  const getTerminalBufferLineAtPoint = useCallback((clientX: number, clientY: number): number | null => {
    const terminal = terminalRef.current
    const screen = terminal?.element?.querySelector('.xterm-screen') as HTMLElement | null | undefined
    if (!terminal || !screen || terminal.cols <= 0 || terminal.rows <= 0) return null

    const rect = screen.getBoundingClientRect()
    if (
      clientX < rect.left
      || clientX > rect.right
      || clientY < rect.top
      || clientY > rect.bottom
    ) {
      return null
    }

    const cellHeight = rect.height / terminal.rows
    if (cellHeight <= 0) return null

    const row = Math.max(0, Math.min(terminal.rows - 1, Math.floor((clientY - rect.top) / cellHeight)))
    return terminal.buffer.active.viewportY + row
  }, [terminalRef])
  const getTerminalFileLinkAtPoint = useCallback(async (
    clientX: number,
    clientY: number,
  ): Promise<TerminalContextFileLink | null> => {
    const terminal = terminalRef.current
    const screen = terminal?.element?.querySelector('.xterm-screen') as HTMLElement | null | undefined
    if (!terminal || !screen || terminal.cols <= 0 || terminal.rows <= 0) return null

    const rect = screen.getBoundingClientRect()
    if (
      clientX < rect.left
      || clientX > rect.right
      || clientY < rect.top
      || clientY > rect.bottom
    ) {
      return null
    }

    const cellWidth = rect.width / terminal.cols
    const cellHeight = rect.height / terminal.rows
    if (cellWidth <= 0 || cellHeight <= 0) return null

    const column = Math.max(0, Math.min(terminal.cols - 1, Math.floor((clientX - rect.left) / cellWidth)))
    const row = Math.max(0, Math.min(terminal.rows - 1, Math.floor((clientY - rect.top) / cellHeight)))
    const line = terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)
    if (!line) return null

    const candidate = findTerminalFileLinkAtCell(line, column)
    if (!candidate) return null

    const absolutePath = resolveTerminalLinkPath(candidate.ref.path)
    if (!absolutePath) return null

    const info = await window.api.fs.stat(absolutePath)
    if (!info.exists || !info.isFile) return null

    return { ...candidate.ref, absolutePath }
  }, [resolveTerminalLinkPath, terminalRef])
  const voiceWaveBars = useMemo(() => {
    const level = voiceCaptureState === 'recording' && isActive ? Math.max(voiceLevel, 0.05) : 0.16
    const midpoint = (VOICE_WAVE_BAR_COUNT - 1) / 2

    return VOICE_WAVE_BAR_INDICES.map((index) => {
      const distanceFromCenter = Math.abs(index - midpoint) / midpoint
      const centerWeight = 1 - distanceFromCenter * 0.46
      const ripple = 0.58 + Math.sin(index * 1.18 + level * 8.5) * 0.42
      const height = 7 + level * 30 * centerWeight + ripple * 9

      return {
        height: Math.max(6, Math.min(38, Math.round(height))),
        opacity: Math.max(0.38, Math.min(1, 0.46 + level * 0.7 + centerWeight * 0.16)),
      }
    })
  }, [isActive, voiceCaptureState, voiceLevel])
  const voiceCaptureCopy = voiceCaptureState ? getVoiceCaptureCopy(voiceCaptureState, isActive) : null

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchText('')
    searchAddonRef.current?.clearDecorations()
  }, [searchAddonRef])

  const searchDecorations = {
    matchBackground: '#f0a23b55',
    matchBorder: '#f0a23b',
    matchOverviewRuler: '#f0a23b',
    activeMatchBackground: '#f0a23baa',
    activeMatchBorder: '#ffffff',
    activeMatchColorOverviewRuler: '#ffffff',
  }

  const findNext = useCallback(() => {
    if (searchText) searchAddonRef.current?.findNext(searchText, { decorations: searchDecorations })
  }, [searchText, searchAddonRef])

  const findPrev = useCallback(() => {
    if (searchText) searchAddonRef.current?.findPrevious(searchText, { decorations: searchDecorations })
  }, [searchText, searchAddonRef])

  // Ctrl+F to open search. Shift does not change the behavior.
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
      }
      if (e.key === 'Escape' && searchOpen) {
        closeSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive, searchOpen, openSearch, closeSearch])

  // Live search as user types
  useEffect(() => {
    if (searchText) {
      searchAddonRef.current?.findNext(searchText, { decorations: searchDecorations })
    } else {
      searchAddonRef.current?.clearDecorations()
    }
  }, [searchText, searchAddonRef])

  // Close context menus on Escape
  useEffect(() => {
    if (!contextMenu && !sendPicker) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setContextMenu(null)
        setSendPicker(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contextMenu, sendPicker])

  const openContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const term = terminalRef.current
    const hasSelection = Boolean(term?.getSelection())
    const x = event.clientX
    const y = event.clientY
    const bufferLine = getTerminalBufferLineAtPoint(x, y)
    const questionNavigation = getTerminalQuestionNavigation(session.id, bufferLine)
    void getTerminalFileLinkAtPoint(x, y).then((fileLink) => {
      setContextMenu({ x, y, hasSelection, fileLink, questionNavigation })
    })
  }, [getTerminalBufferLineAtPoint, getTerminalFileLinkAtPoint, session.id, terminalRef])

  const doCopy = useCallback(() => {
    setContextMenu(null)
    const term = terminalRef.current
    if (!term) return
    const selection = term.getSelection()
    if (!selection) return
    void navigator.clipboard.writeText(selection)
    term.clearSelection()
  }, [terminalRef])

  const doPaste = useCallback(async () => {
    setContextMenu(null)
    await pasteFromClipboardRef.current?.()
  }, [pasteFromClipboardRef])

  const doPasteAndSubmit = useCallback(async () => {
    setContextMenu(null)
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return
      terminalRef.current?.focus()
      if (session.ptyId) {
        await window.api.session.submit(session.ptyId, text, true)
      } else {
        terminalRef.current?.paste(`${text}\r`)
      }
    } catch (error) {
      addToast({ type: 'error', title: '粘贴失败', body: error instanceof Error ? error.message : String(error) })
    }
  }, [addToast, session.ptyId, terminalRef])

  const doCopyCwd = useCallback(() => {
    setContextMenu(null)
    if (!sessionCwd) return
    void navigator.clipboard.writeText(sessionCwd)
      .then(() => addToast({ type: 'success', title: '已复制工作目录', body: sessionCwd }))
      .catch((error) => {
        addToast({ type: 'error', title: '复制失败', body: error instanceof Error ? error.message : String(error) })
      })
  }, [addToast, sessionCwd])

  const doOpenCwd = useCallback(() => {
    setContextMenu(null)
    if (!sessionCwd) return
    void window.api.shell.openPath(sessionCwd)
  }, [sessionCwd])

  const openEditorFile = useCallback((fileLink: TerminalContextFileLink) => {
    const context = {
      projectId: session.projectId,
      worktreeId: session.worktreeId ?? null,
    }
    const editors = useEditorsStore.getState()
    const tabId = fileLink.line !== null
      ? editors.openFileAtLocation(fileLink.absolutePath, { line: fileLink.line, column: fileLink.column ?? 1 }, context)
      : editors.openFile(fileLink.absolutePath, context)
    const paneStore = usePanesStore.getState()
    paneStore.addSessionToPane(paneStore.activePaneId, tabId)
    paneStore.setPaneActiveSession(paneStore.activePaneId, tabId)
  }, [session.projectId, session.worktreeId])

  const doOpenContextFile = useCallback(() => {
    const fileLink = contextMenu?.fileLink
    setContextMenu(null)
    if (!fileLink) return
    openEditorFile(fileLink)
  }, [contextMenu?.fileLink, openEditorFile])

  const doClearInput = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.focus()
    const clearCurrentLine = '\x15\x0b'
    if (session.ptyId) {
      window.api.session.write(session.ptyId, clearCurrentLine)
    } else {
      terminalRef.current?.paste(clearCurrentLine)
    }
  }, [session.ptyId, terminalRef])

  const doSystemVoiceInput = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.focus()

    if (window.api.platform !== 'win32') return

    window.setTimeout(() => {
      terminalRef.current?.focus()
      void window.api.window.startVoiceInput().then((result) => {
        if (!result.ok && result.error) {
          console.warn('[voice-input] failed to start:', result.error)
        }
      })
    }, 80)
  }, [terminalRef])

  const stopVoiceLevelMeter = useCallback(() => {
    if (voiceMeterFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceMeterFrameRef.current)
      voiceMeterFrameRef.current = null
    }

    const source = voiceMeterSourceRef.current
    voiceMeterSourceRef.current = null
    if (source) {
      try {
        source.disconnect()
      } catch {
        // Audio nodes may already be disconnected while stopping.
      }
    }

    const audioContext = voiceMeterAudioContextRef.current
    voiceMeterAudioContextRef.current = null
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(() => {})
    }

    setVoiceLevel(0)
  }, [])

  const startVoiceLevelMeter = useCallback((stream: MediaStream) => {
    stopVoiceLevelMeter()

    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) {
      setVoiceLevel(0.08)
      return
    }

    try {
      const audioContext = new AudioContextConstructor()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()

      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.72
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)

      voiceMeterAudioContextRef.current = audioContext
      voiceMeterSourceRef.current = source

      const update = (): void => {
        analyser.getFloatTimeDomainData(samples)
        let sumSquares = 0
        for (let i = 0; i < samples.length; i += 1) {
          sumSquares += samples[i] * samples[i]
        }
        const nextLevel = normalizeVoiceLevel(Math.sqrt(sumSquares / samples.length))
        setVoiceLevel((current) => current * 0.68 + nextLevel * 0.32)
        voiceMeterFrameRef.current = window.requestAnimationFrame(update)
      }

      void audioContext.resume().catch(() => {})
      update()
    } catch {
      stopVoiceLevelMeter()
      setVoiceLevel(0.08)
    }
  }, [stopVoiceLevelMeter])

  const cleanupStreamingAudio = useCallback(() => {
    if (streamingFinishTimerRef.current !== null) {
      window.clearTimeout(streamingFinishTimerRef.current)
      streamingFinishTimerRef.current = null
    }

    const processor = audioProcessorRef.current
    if (processor) {
      processor.onaudioprocess = null
      try {
        processor.disconnect()
      } catch {
        // Audio nodes may already be disconnected while stopping.
      }
    }
    audioProcessorRef.current = null

    const source = audioSourceRef.current
    if (source) {
      try {
        source.disconnect()
      } catch {
        // Audio nodes may already be disconnected while stopping.
      }
    }
    audioSourceRef.current = null

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null

    const audioContext = audioContextRef.current
    audioContextRef.current = null
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(() => {})
    }
    setVoiceLevel(0)
  }, [])

  const finishStreamingVoiceInput = useCallback((cancelRemote = true) => {
    cleanupStreamingAudio()
    stopVoiceLevelMeter()

    const unsubscribe = voiceStreamUnsubscribeRef.current
    voiceStreamUnsubscribeRef.current = null
    unsubscribe?.()

    const streamId = voiceStreamIdRef.current
    voiceStreamIdRef.current = null
    if (cancelRemote && streamId) {
      void window.api.window.cancelVoiceInputStream({ streamId }).catch(() => {})
    }

    streamingVoiceRef.current = null
    setVoiceCaptureState(null)
  }, [cleanupStreamingAudio, stopVoiceLevelMeter])

  const scheduleStreamingFinish = useCallback(() => {
    if (streamingFinishTimerRef.current !== null) {
      window.clearTimeout(streamingFinishTimerRef.current)
    }
    streamingFinishTimerRef.current = window.setTimeout(() => {
      finishStreamingVoiceInput()
    }, FUNASR_STREAM_FINAL_IDLE_MS)
  }, [finishStreamingVoiceInput])

  const writeStreamingVoiceText = useCallback((nextText: string) => {
    const state = streamingVoiceRef.current
    if (!state || !voiceAcceptsInputRef.current || nextText === state.insertedText) return

    terminalRef.current?.focus()
    const prefixLength = commonPrefixLength(state.insertedText, nextText)
    const deleteCount = Array.from(state.insertedText.slice(prefixLength)).length
    const addition = nextText.slice(prefixLength)
    const payload = `${'\x7f'.repeat(deleteCount)}${addition}`

    if (payload && session.ptyId) {
      window.api.session.write(session.ptyId, payload)
    } else if (addition) {
      terminalRef.current?.paste(addition)
    }

    state.insertedText = nextText
  }, [session.ptyId, terminalRef])

  const handleStreamingFunasrMessage = useCallback((message: Record<string, unknown>) => {
    const state = streamingVoiceRef.current
    if (!state) return
    if (!voiceAcceptsInputRef.current) {
      if (state.sentEnd) scheduleStreamingFinish()
      return
    }

    const text = typeof message.text === 'string' ? message.text.trim() : ''
    if (text) {
      if (isOfflineFunasrMessage(message)) {
        state.committedText = mergeRecognizedText(state.committedText, text)
        state.liveText = ''
      } else {
        state.liveText = mergeRecognizedText(state.liveText, text)
      }
    }

    const nextText = state.liveText
      ? mergeRecognizedText(state.committedText, state.liveText)
      : state.committedText
    writeStreamingVoiceText(nextText)

    if (state.sentEnd) scheduleStreamingFinish()
  }, [scheduleStreamingFinish, writeStreamingVoiceText])

  const stopStreamingVoiceInput = useCallback(() => {
    const state = streamingVoiceRef.current
    if (!state) return

    state.sentEnd = true
    cleanupStreamingAudio()
    setVoiceCaptureState('finishing')

    const streamId = voiceStreamIdRef.current
    if (!streamId) {
      finishStreamingVoiceInput(false)
      return
    }

    void window.api.window.stopVoiceInputStream({ streamId })
      .then((result) => {
        if (!result.ok && result.error) {
          addToast({ type: 'error', title: '语音识别失败', body: result.error })
          finishStreamingVoiceInput(false)
          return
        }
        scheduleStreamingFinish()
      })
      .catch((error) => {
        addToast({ type: 'error', title: '语音识别失败', body: error instanceof Error ? error.message : String(error) })
        finishStreamingVoiceInput(false)
      })
  }, [addToast, cleanupStreamingAudio, finishStreamingVoiceInput, scheduleStreamingFinish])

  const stopApiVoiceInput = useCallback(() => {
    if (streamingVoiceRef.current) {
      stopStreamingVoiceInput()
      return
    }

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }, [stopStreamingVoiceInput])

  const startStreamingVoiceInput = useCallback(async (serviceReadyPromise?: Promise<boolean>) => {
    setContextMenu(null)
    terminalRef.current?.focus()

    if (!navigator.mediaDevices?.getUserMedia) {
      addToast({ type: 'error', title: '无法录音', body: '当前环境不支持浏览器录音 API。' })
      return
    }

    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) {
      addToast({ type: 'error', title: '无法录音', body: '当前环境不支持实时音频处理。' })
      return
    }

    try {
      const [stream, serviceReady] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        }),
        serviceReadyPromise ?? Promise.resolve(true),
      ])
      if (!serviceReady) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const audioContext = new AudioContextConstructor()
      await audioContext.resume()

      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      const unsubscribe = window.api.window.onVoiceInputStreamEvent((event) => {
        if (event.streamId !== voiceStreamIdRef.current) return

        if (event.type === 'message') {
          handleStreamingFunasrMessage(event.message)
          return
        }

        if (event.type === 'error') {
          invalidateLocalAsrReady(settings.voiceLocalAsrDockerContainer.trim())
          addToast({ type: 'error', title: '语音识别失败', body: event.error })
          finishStreamingVoiceInput(false)
          return
        }

        finishStreamingVoiceInput(false)
      })

      mediaStreamRef.current = stream
      audioContextRef.current = audioContext
      audioSourceRef.current = source
      audioProcessorRef.current = processor
      voiceStreamUnsubscribeRef.current = unsubscribe

      const startResult = await window.api.window.startVoiceInputStream({
        endpoint: settings.voiceApiUrl.trim(),
        sampleRate: FUNASR_TARGET_SAMPLE_RATE,
        timeoutMs: settings.voiceApiTimeoutMs,
      })

      if (!startResult.ok || !startResult.streamId) {
        unsubscribe()
        invalidateLocalAsrReady(settings.voiceLocalAsrDockerContainer.trim())
        throw new Error(startResult.error ?? 'FunASR WebSocket 连接失败。')
      }

      voiceStreamIdRef.current = startResult.streamId
      streamingVoiceRef.current = {
        committedText: '',
        liveText: '',
        insertedText: '',
        sentEnd: false,
      }

      processor.onaudioprocess = (event): void => {
        const output = event.outputBuffer.getChannelData(0)
        output.fill(0)

        const streamId = voiceStreamIdRef.current
        const state = streamingVoiceRef.current
        if (!streamId || !state || state.sentEnd) return

        if (!voiceAcceptsInputRef.current) {
          setVoiceLevel((current) => current * 0.82)
          const silence = createSilentPcmS16le(event.inputBuffer, FUNASR_TARGET_SAMPLE_RATE)
          window.api.window.sendVoiceInputStreamChunk({ streamId, audio: silence })
          return
        }

        const nextVoiceLevel = audioBufferToVoiceLevel(event.inputBuffer)
        setVoiceLevel((current) => current * 0.62 + nextVoiceLevel * 0.38)

        const pcm = audioBufferToPcmS16le(event.inputBuffer, FUNASR_TARGET_SAMPLE_RATE)
        if (pcm.byteLength > 0) {
          window.api.window.sendVoiceInputStreamChunk({ streamId, audio: pcm })
        }
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
      setVoiceCaptureState('recording')
    } catch (error) {
      finishStreamingVoiceInput()
      addToast({ type: 'error', title: '无法开始录音', body: error instanceof Error ? error.message : String(error) })
    }
  }, [
    addToast,
    finishStreamingVoiceInput,
    handleStreamingFunasrMessage,
    settings.voiceApiTimeoutMs,
    settings.voiceApiUrl,
    settings.voiceLocalAsrDockerContainer,
    terminalRef,
  ])

  const ensureLocalAsrServiceReady = useCallback(async (options?: { force?: boolean; quiet?: boolean }): Promise<boolean> => {
    if (!settings.voiceLocalAsrAutoStart) return true

    const quiet = options?.quiet === true
    const containerName = settings.voiceLocalAsrDockerContainer.trim()
    if (!containerName) {
      if (!quiet) {
        addToast({ type: 'error', title: '本地 ASR 容器未配置', body: '请先在设置 > 终端 > 语音输入中填写 Docker 容器名。' })
      }
      return false
    }

    const action = settings.voiceLocalAsrStartupAction
    if (action === 'start' && !options?.force && hasFreshLocalAsrReadyCache(containerName)) {
      return true
    }

    if (
      !options?.force
      && localAsrReadyInFlight
      && localAsrReadyInFlight.containerName === containerName
      && localAsrReadyInFlight.action === action
      && (!localAsrReadyInFlight.quiet || quiet)
    ) {
      return localAsrReadyInFlight.promise
    }

    const readyPromise = window.api.window.manageVoiceLocalAsrService({ action, containerName })
      .then((result) => {
        if (!result.ok) {
          invalidateLocalAsrReady(containerName)
          if (!quiet) {
            addToast({
              type: 'error',
              title: action === 'restart' ? '重启本地 ASR 失败' : '启动本地 ASR 失败',
              body: result.error ?? 'Docker 命令执行失败。请确认 Docker Desktop 已启动。',
            })
          }
          return false
        }

        if (action === 'start') markLocalAsrReady(containerName)

        if (!quiet && !result.alreadyRunning) {
          addToast({
            type: 'success',
            title: action === 'restart' ? '本地 ASR 已重启' : '本地 ASR 已启动',
            body: result.containerName,
          })
        }

        return true
      })
      .catch((error) => {
        invalidateLocalAsrReady(containerName)
        if (!quiet) {
          addToast({
            type: 'error',
            title: action === 'restart' ? '重启本地 ASR 失败' : '启动本地 ASR 失败',
            body: error instanceof Error ? error.message : String(error),
          })
        }
        return false
      })

    localAsrReadyInFlight = { containerName, action, quiet, promise: readyPromise }
    try {
      return await readyPromise
    } finally {
      if (localAsrReadyInFlight?.promise === readyPromise) {
        localAsrReadyInFlight = null
      }
    }
  }, [
    addToast,
    settings.voiceLocalAsrAutoStart,
    settings.voiceLocalAsrDockerContainer,
    settings.voiceLocalAsrStartupAction,
  ])

  const warmupLocalAsrStream = useCallback(async (): Promise<boolean> => {
    const endpoint = settings.voiceApiUrl.trim()
    const containerName = settings.voiceLocalAsrDockerContainer.trim()
    if (!endpoint || !isWebSocketVoiceEndpoint(endpoint)) return false
    if (hasFreshLocalAsrWarmupCache(endpoint, containerName)) return true

    if (
      localAsrWarmupInFlight
      && localAsrWarmupInFlight.endpoint === endpoint
      && localAsrWarmupInFlight.containerName === containerName
    ) {
      return localAsrWarmupInFlight.promise
    }

    const warmupPromise = (async (): Promise<boolean> => {
      const ready = await ensureLocalAsrServiceReady({ quiet: true })
      if (!ready) return false

      const result = await window.api.window.warmupVoiceInputStream({
        endpoint,
        sampleRate: FUNASR_TARGET_SAMPLE_RATE,
        timeoutMs: settings.voiceApiTimeoutMs,
      })
      if (!result.ok) return false

      if (containerName) markLocalAsrReady(containerName)
      markLocalAsrWarm(containerName, endpoint)
      return true
    })()

    localAsrWarmupInFlight = { endpoint, containerName, promise: warmupPromise }
    try {
      return await warmupPromise
    } finally {
      if (localAsrWarmupInFlight?.promise === warmupPromise) {
        localAsrWarmupInFlight = null
      }
    }
  }, [
    ensureLocalAsrServiceReady,
    settings.voiceApiTimeoutMs,
    settings.voiceApiUrl,
    settings.voiceLocalAsrDockerContainer,
  ])

  useEffect(() => {
    if (
      !isActive
      || settingsOpen
      || settings.voiceInputMode !== 'api'
      || !settings.voiceApiUrl.trim()
      || !isWebSocketVoiceEndpoint(settings.voiceApiUrl)
    ) {
      return
    }

    const timer = window.setTimeout(() => {
      void warmupLocalAsrStream()
    }, 350)
    return () => window.clearTimeout(timer)
  }, [
    isActive,
    settings.voiceApiUrl,
    settings.voiceInputMode,
    settingsOpen,
    warmupLocalAsrStream,
  ])

  const startApiVoiceInput = useCallback(async () => {
    setContextMenu(null)
    terminalRef.current?.focus()

    if (!settings.voiceApiUrl.trim()) {
      addToast({ type: 'error', title: '本地 ASR 未配置', body: '请先在设置 > 终端 > 语音输入中配置本地 ASR 地址。' })
      return
    }

    const serviceReadyPromise = ensureLocalAsrServiceReady()

    if (isWebSocketVoiceEndpoint(settings.voiceApiUrl)) {
      await startStreamingVoiceInput(serviceReadyPromise)
      return
    }

    if (!await serviceReadyPromise) return

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      addToast({ type: 'error', title: '无法录音', body: '当前环境不支持浏览器录音 API。' })
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      startVoiceLevelMeter(stream)

      recorder.ondataavailable = (event): void => {
        if (!voiceAcceptsInputRef.current || event.data.size === 0) return
        audioChunksRef.current.push(event.data)
      }

      recorder.onerror = (): void => {
        addToast({ type: 'error', title: '录音失败', body: '录音过程中出现错误。' })
        setVoiceCaptureState(null)
        stopVoiceLevelMeter()
        stream.getTracks().forEach((track) => track.stop())
      }

      recorder.onstop = (): void => {
        const chunks = audioChunksRef.current
        const mimeType = recorder.mimeType || 'audio/webm'
        stopVoiceLevelMeter()
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null

        if (chunks.length === 0) {
          setVoiceCaptureState(null)
          addToast({ type: 'error', title: '没有录到音频', body: '请重新开始语音输入。' })
          return
        }

        setVoiceCaptureState('transcribing')
        const blob = new Blob(chunks, { type: mimeType })
        const websocketEndpoint = isWebSocketVoiceEndpoint(settings.voiceApiUrl)
        void prepareVoiceAudio(blob, mimeType, websocketEndpoint)
          .then((prepared) => window.api.window.transcribeVoiceInput({
            endpoint: settings.voiceApiUrl,
            audio: prepared.audio,
            mimeType: prepared.mimeType,
            audioFormat: prepared.audioFormat,
            sampleRate: prepared.sampleRate,
            bodyMode: settings.voiceApiBodyMode,
            fileFieldName: settings.voiceApiFileFieldName,
            responseTextPath: settings.voiceApiResponseTextPath,
            timeoutMs: settings.voiceApiTimeoutMs,
            authorization: settings.voiceApiAuthorization,
          }))
          .then((result) => {
            if (!result.ok || !result.text) {
              addToast({ type: 'error', title: '语音识别失败', body: result.error ?? '本地 ASR API 没有返回文本。' })
              return
            }
            if (!voiceAcceptsInputRef.current) return
            terminalRef.current?.focus()
            terminalRef.current?.paste(result.text)
          })
          .catch((error) => {
            addToast({ type: 'error', title: '语音识别失败', body: error instanceof Error ? error.message : String(error) })
          })
          .finally(() => setVoiceCaptureState(null))
      }

      recorder.start(MEDIA_RECORDER_VOICE_TIMESLICE_MS)
      setVoiceCaptureState('recording')
    } catch (error) {
      addToast({ type: 'error', title: '无法开始录音', body: error instanceof Error ? error.message : String(error) })
      stopVoiceLevelMeter()
      setVoiceCaptureState(null)
    }
  }, [addToast, ensureLocalAsrServiceReady, settings, startStreamingVoiceInput, startVoiceLevelMeter, stopVoiceLevelMeter, terminalRef])

  useEffect(() => {
    if (!isActive || settingsOpen) return

    const handler = (event: KeyboardEvent): void => {
      if (
        event.repeat
        || !event.ctrlKey
        || !event.altKey
        || event.shiftKey
        || event.metaKey
        || event.key.toLowerCase() !== 'v'
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (voiceCaptureState === 'recording') {
        stopApiVoiceInput()
        return
      }
      if (voiceCaptureState === null) {
        void startApiVoiceInput()
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [isActive, settingsOpen, startApiVoiceInput, stopApiVoiceInput, voiceCaptureState])

  const doVoiceInput = useCallback(() => {
    if (settings.voiceInputMode === 'api') {
      void startApiVoiceInput()
      return
    }
    doSystemVoiceInput()
  }, [doSystemVoiceInput, settings.voiceInputMode, startApiVoiceInput])

  useEffect(() => {
    return () => {
      finishStreamingVoiceInput()
      stopVoiceLevelMeter()
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [finishStreamingVoiceInput, stopVoiceLevelMeter])

  const openSendPicker = useCallback((mode: SendPickerMode) => {
    const term = terminalRef.current
    const selection = term?.getSelection()
    if (!selection || !contextMenu) return
    setContextMenu(null)
    setSendPicker({
      x: contextMenu.x,
      y: contextMenu.y,
      text: selection,
      mode,
    })
  }, [contextMenu, terminalRef])

  const sendSelectionToSession = useCallback((target: Session) => {
    if (!sendPicker || !target.ptyId) return
    const text = sendPicker.text
    const mode = sendPicker.mode
    const ptyId = target.ptyId
    setSendPicker(null)
    terminalRef.current?.clearSelection()
    if (mode === 'insert') {
      focusSessionTarget(target.id)
      window.setTimeout(() => {
        window.api.session.write(ptyId, buildBracketedPastePayload(text))
      }, 80)
      return
    }

    window.api.session.write(ptyId, `${text}\r`)
  }, [sendPicker, terminalRef])

  const doSelectAll = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.selectAll()
  }, [terminalRef])

  const doFind = useCallback(() => {
    setContextMenu(null)
    openSearch()
  }, [openSearch])

  const doClear = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.clear()
  }, [terminalRef])

  const scrollToLatest = useCallback(() => {
    terminalRef.current?.focus()
    scrollTerminalToLatest(session.id)
  }, [session.id, terminalRef])

  const doScrollToLatest = useCallback(() => {
    setContextMenu(null)
    scrollToLatest()
  }, [scrollToLatest])

  const doJumpToQuestionLine = useCallback((line: number | null) => {
    setContextMenu(null)
    if (line === null) return
    scrollTerminalToQuestion(session.id, line)
  }, [session.id])

  const doJumpToPreviousQuestion = useCallback(() => {
    doJumpToQuestionLine(contextMenu?.questionNavigation.previousLine ?? null)
  }, [contextMenu?.questionNavigation.previousLine, doJumpToQuestionLine])

  const doJumpToNextQuestion = useCallback(() => {
    doJumpToQuestionLine(contextMenu?.questionNavigation.nextLine ?? null)
  }, [contextMenu?.questionNavigation.nextLine, doJumpToQuestionLine])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.dataTransfer.files.length === 0) return
      event.preventDefault()
      const term = terminalRef.current
      if (!term) return
      const paths: string[] = []
      for (const file of Array.from(event.dataTransfer.files)) {
        const path = window.api.files.getPathForFile(file)
        if (!path) continue
        paths.push(/\s/.test(path) ? `"${path}"` : path)
      }
      if (paths.length === 0) return
      term.focus()
      term.paste(paths.join(' '))
    },
    [terminalRef],
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const menuWidth = 200
  const questionMenuItemCount = (contextMenu?.questionNavigation.previousLine != null ? 1 : 0)
    + (contextMenu?.questionNavigation.nextLine != null ? 1 : 0)
  const menuHeight = (contextMenu?.fileLink ? 590 : 548)
    + (questionMenuItemCount > 0 ? 8 + questionMenuItemCount * 34 : 0)
  const contextMenuStyle = contextMenu
    ? {
        left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - menuWidth - 8)),
        top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuHeight - 8)),
      }
    : undefined
  const pickerWidth = 240
  const pickerHeight = Math.min(320, 38 + Math.max(targetSessions.length, 1) * 34)
  const sendPickerStyle = sendPicker
    ? {
        left: Math.max(8, Math.min(sendPicker.x, window.innerWidth - pickerWidth - 8)),
        top: Math.max(8, Math.min(sendPicker.y, window.innerHeight - pickerHeight - 8)),
      }
    : undefined

  return (
    <div className="terminal-view group/terminal-view h-full w-full bg-[var(--color-terminal-bg)]">
      <div className="relative h-full w-full bg-[var(--color-terminal-bg)]">
      {/* Search bar */}
      {searchOpen && (
        <div className="terminal-search-bar absolute right-3 top-3 z-10 flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 shadow-lg">
          <input
            ref={inputRef}
            value={searchText}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? findPrev() : findNext()
              }
              if (e.key === 'Escape') closeSearch()
            }}
            placeholder="Search..."
            className="terminal-search-input w-40 bg-transparent text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none"
          />
          <button onClick={findPrev} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            <ChevronUp size={14} />
          </button>
          <button onClick={findNext} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            <ChevronDown size={14} />
          </button>
          <button onClick={closeSearch} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            <X size={14} />
          </button>
        </div>
      )}

        <div
          className="absolute inset-0 bg-[var(--color-terminal-bg)] p-[10px]"
          onContextMenu={openContextMenu}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
        <div
          ref={containerRef}
          className="h-full w-full bg-[var(--color-terminal-bg)]"
        />
      </div>
        {!isAtBottom && (
          <button
            type="button"
            onClick={scrollToLatest}
            className={cn(
              'absolute bottom-4 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full',
              'border border-white/[0.12] bg-[var(--color-bg-secondary)]/90 text-[var(--color-text-secondary)]',
              'opacity-80 shadow-lg shadow-black/25 backdrop-blur-md transition-all duration-150',
              'hover:scale-105 hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] hover:opacity-100',
              'active:scale-95',
            )}
            title="滚动到最新位置 (Ctrl+End / Cmd+↓)"
            aria-label="滚动到最新位置"
          >
            <ChevronDown size={20} strokeWidth={2.4} />
          </button>
        )}
        {voiceCaptureState && (
          <div className="absolute bottom-4 left-4 right-16 z-30 flex min-h-14 items-center gap-3 rounded-[var(--radius-lg)] border border-white/[0.14] bg-[linear-gradient(135deg,rgba(16,18,24,0.94),rgba(36,28,42,0.94))] px-3 py-2.5 text-white shadow-[0_16px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:left-1/2 sm:right-auto sm:w-[440px] sm:max-w-[calc(100%-112px)] sm:-translate-x-1/2">
            <div
              className={cn(
                'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border shadow-[0_0_24px_rgba(244,63,94,0.30)]',
                voiceCaptureState === 'recording'
                  ? 'border-rose-200/30 bg-rose-500/20 text-rose-100'
                  : 'border-cyan-200/25 bg-cyan-500/20 text-cyan-100',
              )}
            >
              {voiceCaptureState === 'recording' && <span className="absolute inset-0 rounded-[var(--radius-lg)] bg-rose-400/20 animate-ping" />}
              <Mic size={18} strokeWidth={2.4} className="relative" />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="min-w-[64px]">
                <span className="block truncate text-sm font-semibold leading-5 text-white">
                  {voiceCaptureCopy?.title}
                </span>
                <span className="block text-[10px] leading-4 text-white/48">
                  {voiceCaptureCopy?.subtitle}
                </span>
              </div>
              <div className="flex h-9 min-w-0 flex-1 items-center justify-between px-1" aria-hidden="true">
                {voiceWaveBars.map((bar, index) => (
                  <span
                    key={index}
                    className={cn(
                      'w-[3px] rounded-full bg-gradient-to-t from-rose-500 via-fuchsia-300 to-cyan-200 shadow-[0_0_10px_rgba(244,114,182,0.36)] transition-[height,opacity] duration-75 ease-out',
                      voiceCaptureState === 'transcribing' && 'animate-pulse',
                    )}
                    style={{ height: `${Math.min(30, bar.height)}px`, opacity: bar.opacity }}
                  />
                ))}
              </div>
              <div className="shrink-0">
                {voiceCaptureState === 'recording' && (
                  <button
                    type="button"
                    onClick={stopApiVoiceInput}
                    className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-rose-500 px-2.5 text-[11px] font-semibold text-white shadow-[0_8px_20px_rgba(244,63,94,0.28)] transition-colors hover:bg-rose-400 active:bg-rose-600"
                  >
                    <X size={13} strokeWidth={2.4} />
                    停止
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {contextMenu && contextMenuStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[119]"
            onMouseDown={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu(null)
            }}
          />
          <div
            className="no-drag fixed z-[120] w-[200px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/35"
            style={contextMenuStyle}
          >
            {contextMenu.fileLink && (
              <>
                <button
                  type="button"
                  className={CONTEXT_MENU_ITEM}
                  onClick={doOpenContextFile}
                >
                  <span className="flex items-center gap-2">
                    <FileText size={13} />
                    打开文件
                  </span>
                  {contextMenu.fileLink.line !== null && (
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      :{contextMenu.fileLink.line}
                    </span>
                  )}
                </button>
                <div className="my-1 h-px bg-[var(--color-border)]" />
              </>
            )}
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doCopy}
              disabled={!contextMenu.hasSelection}
            >
              <span className="flex items-center gap-2">
                <Copy size={13} />
                复制
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+C</span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doPaste}
            >
              <span className="flex items-center gap-2">
                <ClipboardPaste size={13} />
                粘贴
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+V</span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doPasteAndSubmit}
            >
              <span className="flex items-center gap-2">
                <ClipboardPaste size={13} />
                粘贴并回车
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Enter</span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doClearInput}
            >
              <span className="flex items-center gap-2">
                <Keyboard size={13} />
                清空输入框
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+U</span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doCopyCwd}
              disabled={!sessionCwd}
            >
              <span className="flex items-center gap-2">
                <Copy size={13} />
                复制工作目录
              </span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doOpenCwd}
              disabled={!sessionCwd}
            >
              <span className="flex items-center gap-2">
                <FolderOpen size={13} />
                在资源管理器打开
              </span>
            </button>
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doVoiceInput}
              disabled={settings.voiceInputMode === 'api' ? voiceCaptureState !== null : window.api.platform !== 'win32'}
            >
              <span className="flex items-center gap-2">
                <Mic size={13} />
                语音输入
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {settings.voiceInputMode === 'api' ? LOCAL_ASR_SHORTCUT_LABEL : 'Win+H'}
              </span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={settings.voiceInputMode === 'api' ? doSystemVoiceInput : startApiVoiceInput}
              disabled={settings.voiceInputMode === 'api' ? window.api.platform !== 'win32' : voiceCaptureState !== null}
            >
              <span className="flex items-center gap-2">
                <Mic size={13} />
                {settings.voiceInputMode === 'api' ? '系统语音输入' : '本地 ASR 语音输入'}
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {settings.voiceInputMode === 'api' ? 'Win+H' : LOCAL_ASR_SHORTCUT_LABEL}
              </span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={() => openSendPicker('send')}
              disabled={!contextMenu.hasSelection || targetSessions.length === 0}
            >
              <span className="flex items-center gap-2">
                <Send size={13} />
                发送到其他会话
              </span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={() => openSendPicker('insert')}
              disabled={!contextMenu.hasSelection || targetSessions.length === 0}
            >
              <span className="flex items-center gap-2">
                <ClipboardPaste size={13} />
                放到其他会话
              </span>
            </button>
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doSelectAll}
            >
              <span className="flex items-center gap-2">
                <ListChecks size={13} />
                全选
              </span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doFind}
            >
              <span className="flex items-center gap-2">
                <Search size={13} />
                查找
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+F</span>
            </button>
            {(contextMenu.questionNavigation.previousLine !== null || contextMenu.questionNavigation.nextLine !== null) && (
              <>
                {contextMenu.questionNavigation.previousLine !== null && (
                  <button
                    type="button"
                    className={CONTEXT_MENU_ITEM}
                    onClick={doJumpToPreviousQuestion}
                  >
                    <span className="flex items-center gap-2">
                      <ChevronUp size={13} />
                      跳到上一次提问
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+↑ / Ctrl+K</span>
                  </button>
                )}
                {contextMenu.questionNavigation.nextLine !== null && (
                  <button
                    type="button"
                    className={CONTEXT_MENU_ITEM}
                    onClick={doJumpToNextQuestion}
                  >
                    <span className="flex items-center gap-2">
                      <ChevronDown size={13} />
                      跳到下一次提问
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+↓ / Ctrl+J</span>
                  </button>
                )}
                <div className="my-1 h-px bg-[var(--color-border)]" />
              </>
            )}
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doScrollToLatest}
            >
              <span className="flex items-center gap-2">
                <ChevronDown size={13} />
                滚动到底部
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+End</span>
            </button>
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doClear}
            >
              <span className="flex items-center gap-2">
                <Eraser size={13} />
                清屏
              </span>
            </button>
          </div>
        </>,
        document.body,
      )}
      {sendPicker && sendPickerStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[119]"
            onMouseDown={() => setSendPicker(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setSendPicker(null)
            }}
          />
          <div
            className="no-drag fixed z-[120] w-[240px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/35"
            style={sendPickerStyle}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
              {sendPicker.mode === 'insert' ? '放到其他会话' : '发送到其他会话'}
            </div>
            {targetSessions.length === 0 ? (
              <div className="px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">没有可发送的其他运行会话</div>
            ) : (
              targetSessions.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => sendSelectionToSession(target)}
                  className="flex h-8 w-full items-center gap-2 px-3 text-left text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  <SessionIconView
                    fallbackSrc={getSessionIcon(target.type, isDarkTheme)}
                    icon={target.customSessionIcon}
                    className="h-4 w-4 shrink-0"
                    imageClassName="h-3.5 w-3.5 object-contain"
                  />
                  <span className="min-w-0 flex-1 truncate">{target.name}</span>
                </button>
              ))
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
