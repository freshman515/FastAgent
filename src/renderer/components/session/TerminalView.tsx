import { X, ChevronUp, ChevronDown, Copy, ClipboardPaste, ListChecks, Search, Eraser, Mic, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@shared/types'
import { scrollTerminalToLatest, useXterm } from '@/hooks/useXterm'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { getSessionIcon } from '@/lib/sessionIcon'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { SessionIconView } from './SessionIconView'

interface TerminalViewProps {
  session: Session
  isActive: boolean
}

const CONTEXT_MENU_ITEM =
  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]'
type SendPickerMode = 'send' | 'insert'
type VoiceCaptureState = 'recording' | 'transcribing'
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

const FUNASR_TARGET_SAMPLE_RATE = 16000
const FUNASR_STREAM_FINAL_IDLE_MS = 1600

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
  const { containerRef, searchAddonRef, terminalRef, pasteFromClipboardRef } = useXterm(session, isActive)
  const isDarkTheme = useIsDarkTheme()
  const allSessions = useSessionsStore((s) => s.sessions)
  const settings = useUIStore((s) => s.settings)
  const addToast = useUIStore((s) => s.addToast)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [sendPicker, setSendPicker] = useState<{ x: number; y: number; text: string; mode: SendPickerMode } | null>(null)
  const [voiceCaptureState, setVoiceCaptureState] = useState<VoiceCaptureState | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const voiceStreamIdRef = useRef<string | null>(null)
  const voiceStreamUnsubscribeRef = useRef<(() => void) | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const streamingVoiceRef = useRef<StreamingVoiceState | null>(null)
  const streamingFinishTimerRef = useRef<number | null>(null)
  const targetSessions = useMemo(
    () => allSessions.filter((item) =>
      item.id !== session.id
      && item.projectId === session.projectId
      && item.status === 'running'
      && Boolean(item.ptyId),
    ),
    [allSessions, session.id, session.projectId],
  )

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
    setContextMenu({ x: event.clientX, y: event.clientY, hasSelection })
  }, [terminalRef])

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
  }, [])

  const finishStreamingVoiceInput = useCallback((cancelRemote = true) => {
    cleanupStreamingAudio()

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
  }, [cleanupStreamingAudio])

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
    if (!state || nextText === state.insertedText) return

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
    setVoiceCaptureState('transcribing')

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

  const startStreamingVoiceInput = useCallback(async () => {
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
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
        const streamId = voiceStreamIdRef.current
        const state = streamingVoiceRef.current
        if (!streamId || !state || state.sentEnd) return

        const output = event.outputBuffer.getChannelData(0)
        output.fill(0)

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
  }, [addToast, finishStreamingVoiceInput, handleStreamingFunasrMessage, settings.voiceApiTimeoutMs, settings.voiceApiUrl, terminalRef])

  const startApiVoiceInput = useCallback(async () => {
    setContextMenu(null)
    terminalRef.current?.focus()

    if (!settings.voiceApiUrl.trim()) {
      addToast({ type: 'error', title: '本地 ASR 未配置', body: '请先在设置 > 终端 > 语音输入中配置本地 ASR 地址。' })
      return
    }

    if (isWebSocketVoiceEndpoint(settings.voiceApiUrl)) {
      await startStreamingVoiceInput()
      return
    }

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

      recorder.ondataavailable = (event): void => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      recorder.onerror = (): void => {
        addToast({ type: 'error', title: '录音失败', body: '录音过程中出现错误。' })
        setVoiceCaptureState(null)
        stream.getTracks().forEach((track) => track.stop())
      }

      recorder.onstop = (): void => {
        const chunks = audioChunksRef.current
        const mimeType = recorder.mimeType || 'audio/webm'
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
            terminalRef.current?.focus()
            terminalRef.current?.paste(result.text)
          })
          .catch((error) => {
            addToast({ type: 'error', title: '语音识别失败', body: error instanceof Error ? error.message : String(error) })
          })
          .finally(() => setVoiceCaptureState(null))
      }

      recorder.start()
      setVoiceCaptureState('recording')
    } catch (error) {
      addToast({ type: 'error', title: '无法开始录音', body: error instanceof Error ? error.message : String(error) })
      setVoiceCaptureState(null)
    }
  }, [addToast, settings, startStreamingVoiceInput, terminalRef])

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
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [finishStreamingVoiceInput])

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
  const menuHeight = 410
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
          title="滚动到最新位置 (Ctrl+End / Ctrl+↓ / Cmd+↓)"
          aria-label="滚动到最新位置"
        >
          <ChevronDown size={20} strokeWidth={2.4} />
        </button>
        {voiceCaptureState && (
          <div className="absolute bottom-16 right-4 z-30 flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/95 px-3 py-2 shadow-xl shadow-black/35 backdrop-blur-md">
            <Mic size={14} className={voiceCaptureState === 'recording' ? 'animate-pulse text-[var(--color-error)]' : 'text-[var(--color-accent)]'} />
            <span className="text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
              {voiceCaptureState === 'recording' ? '正在录音' : '正在识别'}
            </span>
            {voiceCaptureState === 'recording' && (
              <button
                type="button"
                onClick={stopApiVoiceInput}
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-1 text-[10px] text-white transition-opacity hover:opacity-90"
              >
                停止
              </button>
            )}
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
              onClick={doVoiceInput}
              disabled={settings.voiceInputMode === 'api' ? voiceCaptureState !== null : window.api.platform !== 'win32'}
            >
              <span className="flex items-center gap-2">
                <Mic size={13} />
                语音输入
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {settings.voiceInputMode === 'api' ? 'ASR' : 'Win+H'}
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
                {settings.voiceInputMode === 'api' ? 'Win+H' : 'ASR'}
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
