import { X, Zap, ChevronUp, ChevronDown, Copy, ClipboardPaste, FileText, Keyboard, ListChecks, Search, Eraser, Mic, Pause, Play, Send, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
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
  submittedText: string
  segments: string[]
  autoSubmitted: boolean
  lastAutoSubmittedText: string
  lastAutoSubmittedAt: number
  lastCommandKey: string
  sentEnd: boolean
}
type VoicePreview = {
  confirmed: string
  tentative: string
}
type VoiceReplacementCommand = {
  from?: string
  to: string
}
type TerminalContextFileLink = ParsedFileRef & {
  absolutePath: string
}

const FUNASR_TARGET_SAMPLE_RATE = 16000
const FUNASR_STREAM_FINAL_IDLE_MS = 1200
const LOCAL_ASR_READY_CACHE_MS = 5 * 60 * 1000
const LOCAL_ASR_SHORTCUT_LABEL = 'Ctrl+Alt+V'
const MEDIA_RECORDER_VOICE_TIMESLICE_MS = 250
const VOICE_AUTO_EXECUTE_DUPLICATE_MS = 1500
const VOICE_WAVE_BAR_COUNT = 24
const CONTEXT_MENU_VIEWPORT_MARGIN = 8
const VOICE_WAVE_BAR_INDICES = Array.from({ length: VOICE_WAVE_BAR_COUNT }, (_, index) => index)
type LocalAsrStartupAction = 'start' | 'restart'
type LocalAsrReadyCache = { containerName: string; checkedAt: number }
type LocalAsrReadyInFlight = {
  containerName: string
  action: LocalAsrStartupAction
  quiet: boolean
  promise: Promise<boolean>
}

let localAsrReadyCache: LocalAsrReadyCache | null = null
let localAsrReadyInFlight: LocalAsrReadyInFlight | null = null

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

function invalidateLocalAsrReady(containerName?: string): void {
  if (!containerName || localAsrReadyCache?.containerName === containerName) {
    localAsrReadyCache = null
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

function mergeVoiceSegments(segments: string[]): string {
  return segments.reduce((current, segment) => mergeRecognizedText(current, segment), '')
}

function appendVoiceSegment(segments: string[], text: string): string[] {
  const value = text.trim()
  if (!value) return segments
  const currentText = mergeVoiceSegments(segments)
  if (currentText && value.startsWith(currentText)) {
    const delta = value.slice(currentText.length).trim()
    return delta ? [...segments, delta] : segments
  }
  if (currentText && currentText.endsWith(value)) return segments
  const last = segments.at(-1) ?? ''
  if (last === value || last.endsWith(value)) return segments
  if (value.startsWith(last) && last) return [...segments.slice(0, -1), value]
  return [...segments, value]
}

function stripSubmittedVoiceText(text: string, submittedText: string): string {
  const value = text.trim()
  const submitted = submittedText.trim()
  if (!value || !submitted) return value
  if (value === submitted) return ''
  if (value.startsWith(submitted)) return value.slice(submitted.length).trimStart()
  if (submitted.startsWith(value) || submitted.endsWith(value)) return ''
  return value
}

function getStreamingVoiceText(state: StreamingVoiceState): string {
  const recognizedText = state.liveText
    ? mergeRecognizedText(state.committedText, state.liveText)
    : state.committedText
  return stripSubmittedVoiceText(recognizedText, state.submittedText) || state.insertedText
}

function getVoicePreviewParts(state: StreamingVoiceState): VoicePreview {
  const text = getStreamingVoiceText(state)
  if (!text) return { confirmed: '', tentative: '' }

  const confirmed = stripSubmittedVoiceText(state.committedText, state.submittedText)
  if (!state.liveText) return { confirmed: text, tentative: '' }
  if (confirmed && text.startsWith(confirmed)) {
    return { confirmed, tentative: text.slice(confirmed.length).trimStart() }
  }
  return { confirmed: '', tentative: text }
}

function normalizeVoiceCommandText(text: string): string {
  return text
    .trim()
    .replace(/[，。！？、,.!?;；:：\s]/g, '')
    .toLowerCase()
}

function isVoiceUndoCommand(text: string): boolean {
  const value = normalizeVoiceCommandText(text)
  return ['不对', '错了', '撤销', '重来', '上一句不对', '这句不对'].includes(value)
}

function parseVoiceReplacementCommand(text: string): VoiceReplacementCommand | null {
  const value = text.trim().replace(/\s+/g, '')
  const replaceLast = value.match(/^(?:改成|改为|修改为|换成|替换为)(.+)$/)
  if (replaceLast?.[1]) return { to: replaceLast[1] }

  const replaceSpecific = value.match(/^(?:把|将)(.+?)(?:改成|改为|修改为|换成|替换为)(.+)$/)
  if (replaceSpecific?.[1] && replaceSpecific[2]) {
    return { from: replaceSpecific[1], to: replaceSpecific[2] }
  }

  return null
}

function isClearScreenVoiceCommand(text: string): boolean {
  const value = normalizeVoiceCommandText(text)
  return ['清屏', '清空屏幕', '清除屏幕', 'clear'].includes(value)
}

function applyVoiceShortcutCommand(text: string): string {
  const value = text.trim()
  if (!value || value.startsWith('/')) return value
  const compact = normalizeVoiceCommandText(value)
  if (
    compact.includes('检查这段代码')
    || compact.includes('检查代码')
    || compact.includes('审查这段代码')
    || compact.includes('review这段代码')
  ) {
    return `/review ${value.replace(/^(帮我|请帮我|请)\s*/u, '').trim()}`
  }
  return value
}

function consumeVoiceCommand(state: StreamingVoiceState, key: string): boolean {
  if (state.lastCommandKey === key) return false
  state.lastCommandKey = key
  return true
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

function getVoiceCaptureCopy(state: VoiceCaptureState, acceptsInput: boolean, paused: boolean, processing: boolean): { title: string; subtitle: string } {
  if (state === 'recording' && paused) return { title: '已暂停', subtitle: '点击继续' }
  if (state === 'recording' && processing) return { title: '正在处理', subtitle: '等待识别' }
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
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const [contextMenuMeasuredHeight, setContextMenuMeasuredHeight] = useState(0)
  const [sendPicker, setSendPicker] = useState<{ x: number; y: number; text: string; mode: SendPickerMode } | null>(null)
  const [voiceCaptureState, setVoiceCaptureState] = useState<VoiceCaptureState | null>(null)
  const [voiceInputPaused, setVoiceInputPaused] = useState(false)
  const [voiceAutoExecute, setVoiceAutoExecute] = useState(false)
  const [voiceAsrProcessing, setVoiceAsrProcessing] = useState(false)
  const [, setVoicePreview] = useState<VoicePreview>({ confirmed: '', tentative: '' })
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
  const voiceInputPausedRef = useRef(false)
  const voiceAutoExecuteRef = useRef(false)
  const autoExecuteStreamingVoiceRef = useRef<((state: StreamingVoiceState) => boolean) | null>(null)
  useEffect(() => {
    voiceAcceptsInputRef.current = isActive
  }, [isActive])
  useEffect(() => {
    voiceInputPausedRef.current = voiceInputPaused
  }, [voiceInputPaused])
  useEffect(() => {
    voiceAutoExecuteRef.current = voiceAutoExecute
  }, [voiceAutoExecute])
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
    const level = voiceCaptureState === 'recording' && isActive && !voiceInputPaused
      ? Math.max(voiceLevel, 0.05)
      : 0.08
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
  }, [isActive, voiceCaptureState, voiceInputPaused, voiceLevel])
  const voiceCaptureCopy = voiceCaptureState ? getVoiceCaptureCopy(voiceCaptureState, isActive, voiceInputPaused, voiceAsrProcessing) : null
  const showVoiceSendButton = voiceCaptureState === 'recording' && streamingVoiceRef.current !== null
  const showVoicePauseButton = voiceCaptureState === 'recording' && streamingVoiceRef.current !== null

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

  useLayoutEffect(() => {
    if (!contextMenu) {
      setContextMenuMeasuredHeight(0)
      return
    }

    const menu = contextMenuRef.current
    if (!menu) return

    const measureMenu = (): void => {
      setContextMenuMeasuredHeight(Math.ceil(menu.getBoundingClientRect().height))
    }

    measureMenu()
    const resizeObserver = new ResizeObserver(measureMenu)
    resizeObserver.observe(menu)
    window.addEventListener('resize', measureMenu)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', measureMenu)
    }
  }, [contextMenu])

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

  const doCopyCwd = useCallback(() => {
    setContextMenu(null)
    if (!sessionCwd) return
    void navigator.clipboard.writeText(sessionCwd)
      .then(() => addToast({ type: 'success', title: '已复制工作目录', body: sessionCwd }))
      .catch((error) => {
        addToast({ type: 'error', title: '复制失败', body: error instanceof Error ? error.message : String(error) })
      })
  }, [addToast, sessionCwd])

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

  const clearTerminalInput = useCallback(() => {
    terminalRef.current?.focus()
    const clearCurrentLine = '\x15\x0b'
    if (session.ptyId) {
      window.api.session.write(session.ptyId, clearCurrentLine)
    } else {
      terminalRef.current?.paste(clearCurrentLine)
    }
  }, [session.ptyId, terminalRef])

  const doClearInput = useCallback(() => {
    setContextMenu(null)
    clearTerminalInput()
  }, [clearTerminalInput])

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
    const state = streamingVoiceRef.current
    if (state?.sentEnd && voiceAutoExecuteRef.current) {
      autoExecuteStreamingVoiceRef.current?.(state)
    }

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
    voiceInputPausedRef.current = false
    setVoiceInputPaused(false)
    setVoiceAsrProcessing(false)
    setVoicePreview({ confirmed: '', tentative: '' })
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

  const writeTerminalData = useCallback((payload: string) => {
    if (!payload) return
    if (session.ptyId) {
      window.api.session.write(session.ptyId, payload)
    } else {
      terminalRef.current?.paste(payload)
    }
  }, [session.ptyId, terminalRef])

  const updateVoicePreviewFromState = useCallback((state: StreamingVoiceState) => {
    setVoicePreview(getVoicePreviewParts(state))
  }, [])

  const writeStreamingVoiceText = useCallback((nextText: string) => {
    const state = streamingVoiceRef.current
    if (!state || !voiceAcceptsInputRef.current || nextText === state.insertedText) return

    terminalRef.current?.focus()
    const prefixLength = commonPrefixLength(state.insertedText, nextText)
    const deleteCount = Array.from(state.insertedText.slice(prefixLength)).length
    const addition = nextText.slice(prefixLength)
    const payload = `${'\x7f'.repeat(deleteCount)}${addition}`

    if (payload) writeTerminalData(payload)

    state.insertedText = nextText
    updateVoicePreviewFromState(state)
  }, [terminalRef, updateVoicePreviewFromState, writeTerminalData])

  const markStreamingVoiceTextHandled = useCallback((state: StreamingVoiceState, text: string) => {
    if (!text.trim()) return
    state.submittedText = mergeRecognizedText(state.submittedText, text)
    state.liveText = ''
    updateVoicePreviewFromState(state)
  }, [updateVoicePreviewFromState])

  const undoLastVoiceSegment = useCallback((suppressedText = '') => {
    const state = streamingVoiceRef.current
    if (!state) return false

    const liveText = state.liveText.trim()
    if (liveText && !suppressedText.trim()) {
      state.submittedText = mergeRecognizedText(state.submittedText, liveText)
      state.liveText = ''
      writeStreamingVoiceText(stripSubmittedVoiceText(state.committedText, state.submittedText))
      updateVoicePreviewFromState(state)
      return true
    }

    const suppressed = mergeRecognizedText(state.liveText, suppressedText)
    state.liveText = ''
    const removed = state.segments.pop() ?? ''
    if (removed || suppressed) {
      state.submittedText = mergeRecognizedText(state.submittedText, mergeRecognizedText(removed, suppressed))
    }

    if (state.segments.length > 0) {
      state.committedText = mergeVoiceSegments(state.segments)
    } else {
      state.committedText = ''
    }

    if (!removed && state.insertedText) {
      state.submittedText = mergeRecognizedText(state.submittedText, state.insertedText)
    }

    const nextText = state.committedText
      ? stripSubmittedVoiceText(state.committedText, state.submittedText)
      : ''
    writeStreamingVoiceText(nextText)
    updateVoicePreviewFromState(state)
    return true
  }, [updateVoicePreviewFromState, writeStreamingVoiceText])

  const replaceStreamingVoiceText = useCallback((command: VoiceReplacementCommand, suppressedText = '') => {
    const state = streamingVoiceRef.current
    if (!state || !command.to.trim()) return false

    const currentText = getStreamingVoiceText(state)
    let nextText = currentText
    if (command.from && currentText.includes(command.from)) {
      nextText = currentText.replace(command.from, command.to)
      state.segments = [nextText]
    } else if (state.segments.length > 0) {
      state.segments[state.segments.length - 1] = command.to
      nextText = mergeVoiceSegments(state.segments)
    } else {
      nextText = command.to
      state.segments = [nextText]
    }

    state.liveText = ''
    state.committedText = nextText
    if (suppressedText && !suppressedText.includes(command.to)) {
      markStreamingVoiceTextHandled(state, suppressedText)
    }
    writeStreamingVoiceText(getStreamingVoiceText(state))
    updateVoicePreviewFromState(state)
    return true
  }, [markStreamingVoiceTextHandled, updateVoicePreviewFromState, writeStreamingVoiceText])

  const executeVoiceTerminalCommand = useCallback((command: string, state: StreamingVoiceState, suppressedText: string) => {
    markStreamingVoiceTextHandled(state, mergeRecognizedText(getStreamingVoiceText(state), suppressedText))
    if (state.insertedText) {
      writeStreamingVoiceText('')
    }
    writeTerminalData(`${command}\r`)
    setVoiceAsrProcessing(false)
  }, [markStreamingVoiceTextHandled, writeStreamingVoiceText, writeTerminalData])

  const handleStreamingFunasrMessage = useCallback((message: Record<string, unknown>) => {
    const state = streamingVoiceRef.current
    if (!state) return
    if (!voiceAcceptsInputRef.current) {
      if (state.sentEnd) scheduleStreamingFinish()
      return
    }

    const text = typeof message.text === 'string' ? message.text.trim() : ''
    const isFinalMessage = isOfflineFunasrMessage(message)
    if (text) {
      setVoiceAsrProcessing(false)

      if (isVoiceUndoCommand(text)) {
        if (consumeVoiceCommand(state, `undo:${normalizeVoiceCommandText(text)}`)) {
          undoLastVoiceSegment(text)
        }
        return
      }

      const replacementCommand = parseVoiceReplacementCommand(text)
      if (replacementCommand) {
        if (consumeVoiceCommand(state, `replace:${normalizeVoiceCommandText(text)}`)) {
          replaceStreamingVoiceText(replacementCommand, text)
        }
        return
      }

      if (isClearScreenVoiceCommand(text)) {
        if (consumeVoiceCommand(state, `command:${normalizeVoiceCommandText(text)}`)) {
          executeVoiceTerminalCommand('clear', state, text)
        }
        return
      }

      const inputText = applyVoiceShortcutCommand(text)
      state.lastCommandKey = ''
      if (isFinalMessage) {
        state.segments = appendVoiceSegment(state.segments, inputText)
        state.committedText = mergeVoiceSegments(state.segments)
        state.liveText = ''
      } else {
        state.liveText = inputText.startsWith('/')
          ? inputText
          : mergeRecognizedText(state.liveText, inputText)
      }
    }

    const nextText = getStreamingVoiceText(state)
    const normalizedNextText = nextText.trim()
    const isDuplicateAutoFinal = isFinalMessage
      && voiceAutoExecuteRef.current
      && normalizedNextText
      && normalizedNextText === state.lastAutoSubmittedText
      && Date.now() - state.lastAutoSubmittedAt < VOICE_AUTO_EXECUTE_DUPLICATE_MS
    if (isDuplicateAutoFinal) {
      if (state.insertedText) {
        writeStreamingVoiceText('')
      }
      state.committedText = ''
      state.liveText = ''
      state.submittedText = ''
      state.segments = []
      state.lastCommandKey = ''
      updateVoicePreviewFromState(state)
      return
    }

    writeStreamingVoiceText(nextText)
    updateVoicePreviewFromState(state)

    if (isFinalMessage && voiceAutoExecuteRef.current && normalizedNextText) {
      autoExecuteStreamingVoiceRef.current?.(state)
      return
    }

    if (state.sentEnd) scheduleStreamingFinish()
  }, [
    executeVoiceTerminalCommand,
    replaceStreamingVoiceText,
    scheduleStreamingFinish,
    undoLastVoiceSegment,
    updateVoicePreviewFromState,
    writeStreamingVoiceText,
  ])

  const stopStreamingVoiceInput = useCallback(() => {
    const state = streamingVoiceRef.current
    if (!state) return

    state.sentEnd = true
    cleanupStreamingAudio()
    setVoiceAsrProcessing(true)
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

  const submitVoiceInput = useCallback((options?: { state?: StreamingVoiceState; auto?: boolean }) => {
    setContextMenu(null)
    terminalRef.current?.focus()

    const state = options?.state ?? streamingVoiceRef.current
    if (state) {
      const recognizedText = getStreamingVoiceText(state)
      const submittedText = recognizedText || state.insertedText
      if (options?.auto && !submittedText) return false
      const normalizedSubmittedText = submittedText.trim()
      if (
        options?.auto
        && normalizedSubmittedText
        && normalizedSubmittedText === state.lastAutoSubmittedText
        && Date.now() - state.lastAutoSubmittedAt < VOICE_AUTO_EXECUTE_DUPLICATE_MS
      ) {
        return false
      }
      if (submittedText) {
        state.submittedText = mergeRecognizedText(state.submittedText, submittedText)
      }
      if (options?.auto && normalizedSubmittedText) {
        state.lastAutoSubmittedText = normalizedSubmittedText
        state.lastAutoSubmittedAt = Date.now()
      }
      state.committedText = ''
      state.insertedText = ''
      state.liveText = ''
      state.submittedText = ''
      state.segments = []
      state.lastCommandKey = ''
      state.autoSubmitted = options?.auto === true || state.autoSubmitted
      updateVoicePreviewFromState(state)
    } else if (options?.auto) {
      return false
    }

    writeTerminalData('\r')
    return true
  }, [terminalRef, updateVoicePreviewFromState, writeTerminalData])

  useEffect(() => {
    autoExecuteStreamingVoiceRef.current = (state) => submitVoiceInput({ state, auto: true })
    return () => {
      autoExecuteStreamingVoiceRef.current = null
    }
  }, [submitVoiceInput])

  const sendCurrentVoiceInput = useCallback(() => {
    submitVoiceInput()
  }, [submitVoiceInput])

  const clearCurrentVoiceInput = useCallback(() => {
    setContextMenu(null)
    clearTerminalInput()

    const state = streamingVoiceRef.current
    if (!state) return

    state.committedText = ''
    state.liveText = ''
    state.insertedText = ''
    state.submittedText = ''
    state.segments = []
    state.lastAutoSubmittedText = ''
    state.lastAutoSubmittedAt = 0
    state.lastCommandKey = ''
    updateVoicePreviewFromState(state)
  }, [clearTerminalInput, updateVoicePreviewFromState])

  const sendVoiceEscape = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.focus()

    writeTerminalData('\x1b')
  }, [terminalRef, writeTerminalData])

  const toggleVoiceInputPaused = useCallback(() => {
    if (!streamingVoiceRef.current || voiceCaptureState !== 'recording') return
    setContextMenu(null)
    setVoiceInputPaused((current) => {
      const next = !current
      voiceInputPausedRef.current = next
      if (next) {
        setVoiceLevel(0)
      } else {
        terminalRef.current?.focus()
      }
      return next
    })
  }, [terminalRef, voiceCaptureState])

  const startStreamingVoiceInput = useCallback(async (serviceReadyPromise?: Promise<boolean>) => {
    setContextMenu(null)
    terminalRef.current?.focus()
    setVoicePreview({ confirmed: '', tentative: '' })
    setVoiceAsrProcessing(true)

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceAsrProcessing(false)
      addToast({ type: 'error', title: '无法录音', body: '当前环境不支持浏览器录音 API。' })
      return
    }

    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) {
      setVoiceAsrProcessing(false)
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
        setVoiceAsrProcessing(false)
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
        submittedText: '',
        segments: [],
        autoSubmitted: false,
        lastAutoSubmittedText: '',
        lastAutoSubmittedAt: 0,
        lastCommandKey: '',
        sentEnd: false,
      }

      processor.onaudioprocess = (event): void => {
        const output = event.outputBuffer.getChannelData(0)
        output.fill(0)

        const streamId = voiceStreamIdRef.current
        const state = streamingVoiceRef.current
        if (!streamId || !state || state.sentEnd) return

        if (!voiceAcceptsInputRef.current || voiceInputPausedRef.current) {
          setVoiceLevel((current) => current * (voiceInputPausedRef.current ? 0.55 : 0.82))
          const silence = createSilentPcmS16le(event.inputBuffer, FUNASR_TARGET_SAMPLE_RATE)
          window.api.window.sendVoiceInputStreamChunk({ streamId, audio: silence })
          return
        }

        const nextVoiceLevel = audioBufferToVoiceLevel(event.inputBuffer)
        setVoiceLevel((current) => current * 0.62 + nextVoiceLevel * 0.38)
        if (nextVoiceLevel > 0.14) setVoiceAsrProcessing(true)

        const pcm = audioBufferToPcmS16le(event.inputBuffer, FUNASR_TARGET_SAMPLE_RATE)
        if (pcm.byteLength > 0) {
          window.api.window.sendVoiceInputStreamChunk({ streamId, audio: pcm })
        }
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
      voiceInputPausedRef.current = false
      setVoiceInputPaused(false)
      setVoiceCaptureState('recording')
    } catch (error) {
      finishStreamingVoiceInput()
      setVoiceAsrProcessing(false)
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
            if (voiceAutoExecuteRef.current) writeTerminalData('\r')
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
  }, [addToast, ensureLocalAsrServiceReady, settings, startStreamingVoiceInput, startVoiceLevelMeter, stopVoiceLevelMeter, terminalRef, writeTerminalData])

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
  const estimatedContextMenuHeight = (contextMenu?.fileLink ? 590 : 548)
    + (questionMenuItemCount > 0 ? 8 + questionMenuItemCount * 34 : 0)
  const contextMenuMaxHeight = Math.max(160, window.innerHeight - CONTEXT_MENU_VIEWPORT_MARGIN * 2)
  const menuHeight = Math.min(contextMenuMeasuredHeight || estimatedContextMenuHeight, contextMenuMaxHeight)
  const contextMenuStyle = contextMenu
    ? {
        left: Math.max(CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(contextMenu.x, window.innerWidth - menuWidth - CONTEXT_MENU_VIEWPORT_MARGIN)),
        top: Math.max(CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(contextMenu.y, window.innerHeight - menuHeight - CONTEXT_MENU_VIEWPORT_MARGIN)),
        maxHeight: contextMenuMaxHeight,
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
          <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-30 flex flex-wrap items-end justify-center gap-2 text-white sm:left-1/2 sm:right-auto sm:w-[min(900px,calc(100%-32px))] sm:-translate-x-1/2 sm:flex-nowrap">
            <div className="pointer-events-auto inline-flex min-h-14 max-w-[calc(100vw-32px)] items-center gap-3 rounded-[var(--radius-lg)] border border-white/[0.14] bg-[linear-gradient(135deg,rgba(16,18,24,0.94),rgba(36,28,42,0.94))] px-3 py-2.5 shadow-[0_16px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl">
              <div
                className={cn(
                  'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border shadow-[0_0_24px_rgba(244,63,94,0.30)]',
                  voiceCaptureState === 'recording' && voiceInputPaused
                    ? 'border-amber-200/30 bg-amber-500/20 text-amber-100'
                    : voiceCaptureState === 'recording'
                    ? 'border-rose-200/30 bg-rose-500/20 text-rose-100'
                    : 'border-cyan-200/25 bg-cyan-500/20 text-cyan-100',
                )}
              >
                {voiceCaptureState === 'recording' && !voiceInputPaused && <span className="absolute inset-0 rounded-[var(--radius-lg)] bg-rose-400/20 animate-ping" />}
                <Mic size={18} strokeWidth={2.4} className="relative" />
              </div>
              <div className="min-w-[64px]">
                <span className="block truncate text-sm font-semibold leading-5 text-white">
                  {voiceCaptureCopy?.title}
                </span>
                <span className="block text-[10px] leading-4 text-white/48">
                  {voiceCaptureCopy?.subtitle}
                </span>
              </div>
              <div className="relative flex h-7 min-w-[140px] max-w-[32vw] w-[230px] shrink items-center justify-between px-1" aria-hidden="true">
                {voiceAsrProcessing && <span className="absolute inset-x-1 top-1/2 h-6 -translate-y-1/2 rounded-full bg-cyan-300/10 blur-sm animate-pulse" />}
                {voiceWaveBars.map((bar, index) => (
                  <span
                    key={index}
                    className={cn(
                      'relative w-[3px] rounded-full bg-gradient-to-t from-rose-500 via-fuchsia-300 to-cyan-200 shadow-[0_0_10px_rgba(244,114,182,0.36)] transition-[height,opacity] duration-75 ease-out',
                      (voiceCaptureState === 'transcribing' || voiceAsrProcessing) && 'animate-pulse',
                    )}
                    style={{ height: `${Math.min(30, bar.height)}px`, opacity: bar.opacity }}
                  />
                ))}
              </div>
              {voiceCaptureState === 'recording' && (
                <button
                  type="button"
                  onClick={stopApiVoiceInput}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-rose-500 px-2.5 text-[11px] font-semibold text-white shadow-[0_8px_20px_rgba(244,63,94,0.28)] transition-colors hover:bg-rose-400 active:bg-rose-600"
                  title="停止录音"
                  aria-label="停止录音"
                >
                  <X size={13} strokeWidth={2.4} />
                  停止
                </button>
              )}
            </div>
            <div className="pointer-events-auto flex min-h-14 shrink-0 flex-wrap items-center justify-end gap-1.5 rounded-[var(--radius-lg)] border border-white/[0.14] bg-[rgba(18,18,25,0.94)] px-2 py-2 shadow-[0_16px_48px_rgba(0,0,0,0.36)] backdrop-blur-xl">
              {showVoicePauseButton && (
                <button
                  type="button"
                  onClick={toggleVoiceInputPaused}
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-white shadow-[0_8px_20px_rgba(245,158,11,0.22)] transition-colors',
                    voiceInputPaused
                      ? 'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600'
                      : 'bg-amber-500 hover:bg-amber-400 active:bg-amber-600',
                  )}
                  title={voiceInputPaused ? '继续语音输入' : '暂停语音输入'}
                  aria-label={voiceInputPaused ? '继续语音输入' : '暂停语音输入'}
                >
                  {voiceInputPaused
                    ? <Play size={13} strokeWidth={2.4} />
                    : <Pause size={13} strokeWidth={2.4} />}
                </button>
              )}
              {showVoiceSendButton && (
                <button
                  type="button"
                  onClick={() => undoLastVoiceSegment()}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-white/10 bg-white/8 text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)] transition-colors hover:bg-white/14 active:bg-white/6"
                  title="撤销上一段语音"
                  aria-label="撤销上一段语音"
                >
                  <Undo2 size={13} strokeWidth={2.4} />
                </button>
              )}
              {showVoiceSendButton && (
                <button
                  type="button"
                  onClick={sendVoiceEscape}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/10 bg-white/8 px-2.5 text-[11px] font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)] transition-colors hover:bg-white/14 active:bg-white/6"
                  title="发送 Esc 到终端"
                  aria-label="发送 Esc 到终端"
                >
                  <Keyboard size={13} strokeWidth={2.4} />
                  Esc
                </button>
              )}
              {showVoiceSendButton && (
                <button
                  type="button"
                  onClick={clearCurrentVoiceInput}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-white/10 bg-white/8 text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)] transition-colors hover:bg-white/14 active:bg-white/6"
                  title="清空当前语音输入"
                  aria-label="清空当前语音输入"
                >
                  <Eraser size={13} strokeWidth={2.4} />
                </button>
              )}
              {showVoiceSendButton && (
                <button
                  type="button"
                  onClick={() => setVoiceAutoExecute((current) => !current)}
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-white shadow-[0_8px_20px_rgba(250,204,21,0.18)] transition-colors',
                    voiceAutoExecute
                      ? 'bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600'
                      : 'border border-white/10 bg-white/8 hover:bg-white/14 active:bg-white/6',
                  )}
                  title={voiceAutoExecute ? '自动执行已开启' : '自动执行已关闭'}
                  aria-label={voiceAutoExecute ? '自动执行已开启' : '自动执行已关闭'}
                >
                  <Zap size={13} strokeWidth={2.4} />
                </button>
              )}
              {showVoiceSendButton && (
                <button
                  type="button"
                  onClick={sendCurrentVoiceInput}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-cyan-500 text-white shadow-[0_8px_20px_rgba(6,182,212,0.24)] transition-colors hover:bg-cyan-400 active:bg-cyan-600"
                  title="发送当前输入并继续录音"
                  aria-label="发送当前输入并继续录音"
                >
                  <Send size={13} strokeWidth={2.4} />
                </button>
              )}
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
            ref={contextMenuRef}
            className="no-drag fixed z-[120] w-[200px] overflow-y-auto overscroll-contain rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/35"
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
