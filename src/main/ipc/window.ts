import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import WebSocket, { type RawData } from 'ws'
import {
  IPC,
  type VoiceStreamChunkPayload,
  type VoiceStreamEvent,
  type VoiceStreamStartRequest,
  type VoiceStreamStartResult,
  type VoiceStreamStopRequest,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
} from '@shared/types'

const execFileAsync = promisify(execFile)
const FUNASR_CHUNK_SIZE = [8, 8, 4] as const
const FUNASR_CHUNK_INTERVAL = 10
const FUNASR_FINAL_IDLE_MS = 1200
const FUNASR_STREAM_CLOSE_DELAY_MS = 2200

interface ActiveVoiceStream {
  id: string
  sender: WebContents
  ws: WebSocket
  sentEnd: boolean
  closeTimer: ReturnType<typeof setTimeout> | null
  opened: boolean
}

const activeVoiceStreams = new Map<string, ActiveVoiceStream>()

const WINDOWS_VOICE_INPUT_SCRIPT = [
  'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class Keyboard { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }\'',
  '$keyUp = 0x0002',
  '[Keyboard]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)',
  'Start-Sleep -Milliseconds 30',
  '[Keyboard]::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)',
  'Start-Sleep -Milliseconds 30',
  '[Keyboard]::keybd_event(0x48, 0, $keyUp, [UIntPtr]::Zero)',
  'Start-Sleep -Milliseconds 30',
  '[Keyboard]::keybd_event(0x5B, 0, $keyUp, [UIntPtr]::Zero)',
].join('; ')

async function startWindowsVoiceInput(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows voice input is only available on Windows.' }
  }

  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WINDOWS_VOICE_INPUT_SCRIPT,
      ],
      { timeout: 5000, windowsHide: true },
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function readJsonPath(value: unknown, path: string): unknown {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean)
  let current = value
  for (const part of parts) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function extractTranscriptionText(raw: unknown, preferredPath: string): string {
  const candidates = [
    preferredPath,
    'text',
    'result',
    'transcript',
    'transcription',
    'data.text',
    'data.result',
    'data.transcript',
    'results.0.text',
    'results.0.transcript',
  ].filter(Boolean)

  for (const path of candidates) {
    const value = readJsonPath(raw, path)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  if (typeof raw === 'string') return raw.trim()
  return ''
}

function isWebSocketProtocol(protocol: string): boolean {
  return protocol === 'ws:' || protocol === 'wss:'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getFunasrChunkDurationMs(): number {
  return 60 * FUNASR_CHUNK_SIZE[1] / FUNASR_CHUNK_INTERVAL
}

function getFunasrChunkBytes(sampleRate: number): number {
  const samples = Math.max(1, Math.round(sampleRate * getFunasrChunkDurationMs() / 1000))
  return samples * 2
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return Buffer.from(raw).toString('utf8')
}

function parseFunasrMessage(raw: RawData): Record<string, unknown> | null {
  const payload = rawDataToString(raw).trim()
  if (!payload) return null

  try {
    const parsed = JSON.parse(payload) as unknown
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : { text: String(parsed) }
  } catch {
    return { text: payload }
  }
}

function sendWebSocketData(ws: WebSocket, data: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) {
      reject(new Error('FunASR WebSocket 连接已关闭。'))
      return
    }

    ws.send(data, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function createVoiceStreamId(): string {
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function sendVoiceStreamEvent(stream: ActiveVoiceStream, event: VoiceStreamEvent): void {
  if (stream.sender.isDestroyed()) return
  stream.sender.send(IPC.VOICE_STREAM_EVENT, event)
}

function getOwnedVoiceStream(streamId: string, sender: WebContents): ActiveVoiceStream | null {
  const stream = activeVoiceStreams.get(streamId)
  if (!stream || stream.sender.id !== sender.id) return null
  return stream
}

function closeVoiceStream(stream: ActiveVoiceStream, notify = true): void {
  if (!activeVoiceStreams.has(stream.id)) return
  activeVoiceStreams.delete(stream.id)

  if (stream.closeTimer) clearTimeout(stream.closeTimer)
  stream.closeTimer = null

  try {
    if (stream.ws.readyState === WebSocket.OPEN || stream.ws.readyState === WebSocket.CONNECTING) {
      stream.ws.close()
    }
  } catch {
    // Ignore close races while tearing down a stream.
  }

  if (notify) sendVoiceStreamEvent(stream, { streamId: stream.id, type: 'closed' })
}

function closeVoiceStreamsForSender(sender: WebContents): void {
  for (const stream of activeVoiceStreams.values()) {
    if (stream.sender.id === sender.id) closeVoiceStream(stream, false)
  }
}

async function startFunasrVoiceStream(
  sender: WebContents,
  options: VoiceStreamStartRequest,
): Promise<VoiceStreamStartResult> {
  const endpoint = options.endpoint.trim()
  if (!endpoint) return { ok: false, error: '未配置 FunASR WebSocket 地址。' }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, error: 'FunASR WebSocket 地址不是有效 URL。' }
  }

  if (!isWebSocketProtocol(url.protocol)) {
    return { ok: false, error: 'FunASR 实时语音输入只支持 ws/wss 地址。' }
  }

  const sampleRate = typeof options.sampleRate === 'number' && Number.isFinite(options.sampleRate)
    ? Math.max(8000, Math.min(48000, Math.round(options.sampleRate)))
    : 16000
  const timeoutMs = Math.max(1000, Math.min(30000, Math.round(options.timeoutMs || 10000)))
  const streamId = createVoiceStreamId()

  return new Promise((resolve) => {
    let settled = false
    const ws = new WebSocket(url.toString(), { perMessageDeflate: false })
    const stream: ActiveVoiceStream = {
      id: streamId,
      sender,
      ws,
      sentEnd: false,
      closeTimer: null,
      opened: false,
    }
    activeVoiceStreams.set(streamId, stream)

    const openTimer = setTimeout(() => {
      if (settled) return
      settled = true
      closeVoiceStream(stream, false)
      resolve({ ok: false, error: 'FunASR WebSocket 连接超时。' })
    }, timeoutMs)

    ws.once('open', () => {
      stream.opened = true
      const config = {
        mode: '2pass',
        wav_name: `fastagents-${Date.now()}`,
        wav_format: 'pcm',
        is_speaking: true,
        chunk_size: [...FUNASR_CHUNK_SIZE],
        chunk_interval: FUNASR_CHUNK_INTERVAL,
        audio_fs: sampleRate,
        itn: true,
      }

      sendWebSocketData(ws, JSON.stringify(config))
        .then(() => {
          if (settled) return
          settled = true
          clearTimeout(openTimer)
          resolve({ ok: true, streamId })
        })
        .catch((error) => {
          if (!settled) {
            settled = true
            clearTimeout(openTimer)
            closeVoiceStream(stream, false)
            resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
            return
          }
          sendVoiceStreamEvent(stream, {
            streamId,
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
          closeVoiceStream(stream)
        })
    })

    ws.on('message', (raw) => {
      const message = parseFunasrMessage(raw)
      if (!message || !activeVoiceStreams.has(streamId)) return
      sendVoiceStreamEvent(stream, { streamId, type: 'message', message })
    })

    ws.once('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(openTimer)
        closeVoiceStream(stream, false)
        resolve({ ok: false, error: error.message || 'FunASR WebSocket 连接失败。' })
        return
      }

      sendVoiceStreamEvent(stream, {
        streamId,
        type: 'error',
        error: error.message || 'FunASR WebSocket 连接失败。',
      })
      closeVoiceStream(stream)
    })

    ws.once('close', () => {
      clearTimeout(openTimer)
      if (!settled) {
        settled = true
        activeVoiceStreams.delete(streamId)
        resolve({ ok: false, error: 'FunASR WebSocket 连接已关闭。' })
        return
      }

      if (activeVoiceStreams.has(streamId)) closeVoiceStream(stream)
    })

    sender.once('destroyed', () => {
      closeVoiceStreamsForSender(sender)
    })
  })
}

function sendFunasrVoiceStreamChunk(sender: WebContents, payload: VoiceStreamChunkPayload): void {
  const stream = getOwnedVoiceStream(payload.streamId, sender)
  if (!stream || stream.sentEnd || stream.ws.readyState !== WebSocket.OPEN) return

  try {
    stream.ws.send(Buffer.from(new Uint8Array(payload.audio)))
  } catch (error) {
    sendVoiceStreamEvent(stream, {
      streamId: stream.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
    closeVoiceStream(stream)
  }
}

async function stopFunasrVoiceStream(
  sender: WebContents,
  payload: VoiceStreamStopRequest,
): Promise<{ ok: boolean; error?: string }> {
  const stream = getOwnedVoiceStream(payload.streamId, sender)
  if (!stream) return { ok: false, error: '语音流不存在或已经结束。' }

  stream.sentEnd = true
  if (stream.ws.readyState === WebSocket.OPEN) {
    await sendWebSocketData(stream.ws, JSON.stringify({ is_speaking: false }))
    stream.closeTimer = setTimeout(() => closeVoiceStream(stream), FUNASR_STREAM_CLOSE_DELAY_MS)
    return { ok: true }
  }

  closeVoiceStream(stream)
  return { ok: true }
}

async function sendFunasrPcmChunks(ws: WebSocket, audio: ArrayBuffer, sampleRate: number): Promise<void> {
  const bytes = new Uint8Array(audio)
  const chunkBytes = getFunasrChunkBytes(sampleRate)
  const chunkDelayMs = getFunasrChunkDurationMs()

  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    const end = Math.min(offset + chunkBytes, bytes.byteLength)
    await sendWebSocketData(ws, Buffer.from(bytes.subarray(offset, end)))
    if (end < bytes.byteLength) await delay(chunkDelayMs)
  }
}

async function transcribeFunasrWebSocket(
  options: VoiceTranscribeRequest,
  url: URL,
  timeoutMs: number,
): Promise<VoiceTranscribeResult> {
  if (options.audioFormat !== 'pcm_s16le') {
    return { ok: false, error: 'FunASR WebSocket 需要 PCM S16LE 音频，请重新录音后再试。' }
  }

  if (options.audio.byteLength === 0) {
    return { ok: false, error: '没有可发送到 FunASR 的音频数据。' }
  }

  const sampleRate = typeof options.sampleRate === 'number' && Number.isFinite(options.sampleRate)
    ? Math.max(8000, Math.min(48000, Math.round(options.sampleRate)))
    : 16000

  return new Promise((resolve) => {
    const messages: Record<string, unknown>[] = []
    const offlineSegments: string[] = []
    const genericSegments: string[] = []
    const seenSegments = new Set<string>()
    let latestOnlineText = ''
    let sentEnd = false
    let settled = false
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    let finishTimer: ReturnType<typeof setTimeout> | null = null
    const ws = new WebSocket(url.toString(), { perMessageDeflate: false })

    const appendSegment = (bucket: 'offline' | 'generic', text: string): void => {
      const normalized = text.trim()
      if (!normalized) return
      const key = `${bucket}:${normalized}`
      if (seenSegments.has(key)) return
      seenSegments.add(key)
      if (bucket === 'offline') offlineSegments.push(normalized)
      else genericSegments.push(normalized)
    }

    const handleMessage = (message: Record<string, unknown>): void => {
      messages.push(message)
      const text = typeof message.text === 'string' ? message.text.trim() : ''
      if (!text) return

      const mode = typeof message.mode === 'string' ? message.mode.toLowerCase() : ''
      if (mode.includes('offline') || message.is_final === true) {
        appendSegment('offline', text)
      } else if (mode.includes('online')) {
        latestOnlineText = text
      } else {
        appendSegment('generic', text)
      }
    }

    const currentTranscript = (): string => {
      const offline = offlineSegments.join('').trim()
      if (offline) return offline
      const generic = genericSegments.join('').trim()
      if (generic) return generic
      return latestOnlineText.trim()
    }

    const buildResult = (): VoiceTranscribeResult => {
      const text = currentTranscript()
      if (!text) return { ok: false, error: 'FunASR 没有返回可用文本。', raw: messages }
      return { ok: true, text, raw: messages }
    }

    const settle = (result: VoiceTranscribeResult): void => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (finishTimer) clearTimeout(finishTimer)
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      } catch {
        // Ignore close races; the recognition result is already settled.
      }
      resolve(result)
    }

    const scheduleFinish = (): void => {
      if (!sentEnd || settled) return
      if (finishTimer) clearTimeout(finishTimer)
      finishTimer = setTimeout(() => settle(buildResult()), FUNASR_FINAL_IDLE_MS)
    }

    timeoutTimer = setTimeout(() => {
      settle({ ok: false, error: 'FunASR WebSocket 请求超时。', raw: messages })
    }, timeoutMs)

    ws.once('open', () => {
      const config = {
        mode: '2pass',
        wav_name: `fastagents-${Date.now()}`,
        wav_format: 'pcm',
        is_speaking: true,
        chunk_size: [...FUNASR_CHUNK_SIZE],
        chunk_interval: FUNASR_CHUNK_INTERVAL,
        audio_fs: sampleRate,
        itn: true,
      }

      void (async () => {
        await sendWebSocketData(ws, JSON.stringify(config))
        await sendFunasrPcmChunks(ws, options.audio, sampleRate)
        sentEnd = true
        await sendWebSocketData(ws, JSON.stringify({ is_speaking: false }))
        scheduleFinish()
      })().catch((error) => {
        settle({ ok: false, error: error instanceof Error ? error.message : String(error), raw: messages })
      })
    })

    ws.on('message', (raw) => {
      const message = parseFunasrMessage(raw)
      if (!message) return
      handleMessage(message)
      scheduleFinish()
    })

    ws.once('error', (error) => {
      settle({ ok: false, error: error.message || 'FunASR WebSocket 连接失败。', raw: messages })
    })

    ws.once('close', () => {
      if (!settled) settle(buildResult())
    })
  })
}

async function transcribeVoiceInput(options: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
  const endpoint = options.endpoint.trim()
  if (!endpoint) return { ok: false, error: '未配置语音识别 API 地址。' }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, error: '语音识别 API 地址不是有效 URL。' }
  }

  const timeoutMs = Math.max(1000, Math.min(120000, Math.round(options.timeoutMs || 30000)))
  if (isWebSocketProtocol(url.protocol)) {
    return transcribeFunasrWebSocket(options, url, timeoutMs)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: '语音识别 API 只支持 http/https 或 ws/wss 地址。' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {}
    const authorization = options.authorization?.trim()
    if (authorization) headers.Authorization = authorization

    let body: BodyInit
    if (options.bodyMode === 'raw') {
      headers['Content-Type'] = options.mimeType || 'audio/webm'
      body = new Blob([options.audio], { type: options.mimeType || 'audio/webm' })
    } else {
      const form = new FormData()
      const fieldName = options.fileFieldName.trim() || 'file'
      const extension = options.mimeType.includes('wav') ? 'wav' : options.mimeType.includes('mpeg') ? 'mp3' : 'webm'
      form.append(fieldName, new Blob([options.audio], { type: options.mimeType || 'audio/webm' }), `voice-input.${extension}`)
      body = form
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    const contentType = response.headers.get('content-type') ?? ''
    const raw = contentType.includes('application/json') ? await response.json() as unknown : await response.text()

    if (!response.ok) {
      const message = typeof raw === 'string' ? raw : JSON.stringify(raw)
      return { ok: false, error: `语音识别 API 返回 ${response.status}: ${message}`, raw }
    }

    const text = extractTranscriptionText(raw, options.responseTextPath.trim() || 'text')
    if (!text) return { ok: false, error: '语音识别 API 没有返回可用文本。', raw }
    return { ok: true, text, raw }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? '语音识别 API 请求超时。'
      : error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}

export function registerWindowHandlers(): void {
  ipcMain.handle(IPC.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IPC.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    }
  })

  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    app.quit()
  })

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle(IPC.WINDOW_SET_FULLSCREEN, (event, fullscreen: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    win.setFullScreen(Boolean(fullscreen))
    return win.isFullScreen()
  })

  ipcMain.handle(IPC.WINDOW_IS_FULLSCREEN, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  })

  ipcMain.handle(IPC.WINDOW_START_VOICE_INPUT, async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.focus()
    return startWindowsVoiceInput()
  })

  ipcMain.handle(IPC.VOICE_TRANSCRIBE, async (_event, options: VoiceTranscribeRequest) => {
    return transcribeVoiceInput(options)
  })

  ipcMain.handle(IPC.VOICE_STREAM_START, async (event, options: VoiceStreamStartRequest) => {
    return startFunasrVoiceStream(event.sender, options)
  })

  ipcMain.on(IPC.VOICE_STREAM_CHUNK, (event, payload: VoiceStreamChunkPayload) => {
    sendFunasrVoiceStreamChunk(event.sender, payload)
  })

  ipcMain.handle(IPC.VOICE_STREAM_STOP, async (event, payload: VoiceStreamStopRequest) => {
    return stopFunasrVoiceStream(event.sender, payload)
  })

  ipcMain.handle(IPC.VOICE_STREAM_CANCEL, (event, payload: VoiceStreamStopRequest) => {
    const stream = getOwnedVoiceStream(payload.streamId, event.sender)
    if (!stream) return { ok: true }
    closeVoiceStream(stream, false)
    return { ok: true }
  })
}
