import { app, BrowserWindow, ipcMain, screen, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import WebSocket, { type RawData } from 'ws'
import {
  IPC,
  type EnsureEnglishInputModeResult,
  type RestoreInputModeResult,
  type VoiceLocalAsrServiceAction,
  type VoiceLocalAsrServiceRequest,
  type VoiceLocalAsrServiceResult,
  type VoiceStreamChunkPayload,
  type VoiceStreamEvent,
  type VoiceStreamStartRequest,
  type VoiceStreamStartResult,
  type VoiceStreamStopRequest,
  type VoiceStreamWarmupRequest,
  type VoiceStreamWarmupResult,
  type TitleBarCursorState,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
} from '@shared/types'

const execFileAsync = promisify(execFile)
const FUNASR_CHUNK_SIZE = [8, 8, 4] as const
const FUNASR_CHUNK_INTERVAL = 10
const FUNASR_FINAL_IDLE_MS = 1200
const FUNASR_STREAM_CLOSE_DELAY_MS = 2200
const TITLE_BAR_REVEAL_ZONE_PX = 8
const TITLE_BAR_HEIGHT_PX = 40

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

const WINDOWS_ENSURE_ENGLISH_INPUT_MODE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NativeInputMode {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint idThread);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hWnd);
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetContext(IntPtr hWnd);
  [DllImport("imm32.dll")] public static extern bool ImmGetOpenStatus(IntPtr hIMC);
  [DllImport("imm32.dll")] public static extern bool ImmSetOpenStatus(IntPtr hIMC, bool fOpen);
  [DllImport("imm32.dll")] public static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr hIMC);
}
"@

$VK_SHIFT = 0x10
$VK_MENU = 0x12
$VK_F = 0x46
$KEYEVENTF_KEYUP = 0x0002
$WM_IME_CONTROL = 0x0283
$IMC_GETOPENSTATUS = 0x0005

$hwnd = [NativeInputMode]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  [pscustomobject]@{ ok = $false; switched = $false; error = 'No foreground window.' } | ConvertTo-Json -Compress
  exit 0
}

[uint32]$processId = 0
$threadId = [NativeInputMode]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$hkl = [NativeInputMode]::GetKeyboardLayout($threadId).ToInt64()
$layoutLangId = [int]($hkl -band 0xffff)
$primaryLangId = [int]($layoutLangId -band 0x03ff)
$isEnglishLayout = $primaryLangId -eq 0x09

$imeOpen = $false
$imeWnd = [NativeInputMode]::ImmGetDefaultIMEWnd($hwnd)
if ($imeWnd -ne [IntPtr]::Zero) {
  $imeOpen = [NativeInputMode]::SendMessage($imeWnd, $WM_IME_CONTROL, [IntPtr]$IMC_GETOPENSTATUS, [IntPtr]::Zero).ToInt64() -ne 0
}

$switched = $false
if ((-not $isEnglishLayout) -and $imeOpen) {
  for ($i = 0; $i -lt 20; $i++) {
    $altDown = ([NativeInputMode]::GetAsyncKeyState($VK_MENU) -band 0x8000) -ne 0
    $fDown = ([NativeInputMode]::GetAsyncKeyState($VK_F) -band 0x8000) -ne 0
    if ((-not $altDown) -and (-not $fDown)) { break }
    Start-Sleep -Milliseconds 10
  }

  [NativeInputMode]::keybd_event($VK_SHIFT, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [NativeInputMode]::keybd_event($VK_SHIFT, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  $switched = $true
}

[pscustomobject]@{
  ok = $true
  switched = $switched
  layoutLangId = $layoutLangId
  primaryLangId = $primaryLangId
  imeOpen = $imeOpen
} | ConvertTo-Json -Compress
`.trim()

const WINDOWS_RESTORE_INPUT_MODE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NativeInputModeRestore {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint idThread);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hWnd);
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetContext(IntPtr hWnd);
  [DllImport("imm32.dll")] public static extern bool ImmGetOpenStatus(IntPtr hIMC);
  [DllImport("imm32.dll")] public static extern bool ImmSetOpenStatus(IntPtr hIMC, bool fOpen);
  [DllImport("imm32.dll")] public static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr hIMC);
}
"@

$VK_SHIFT = 0x10
$VK_MENU = 0x12
$VK_F = 0x46
$VK_I = 0x49
$VK_ESCAPE = 0x1B
$VK_RETURN = 0x0D
$KEYEVENTF_KEYUP = 0x0002
$WM_IME_CONTROL = 0x0283
$IMC_GETOPENSTATUS = 0x0005

for ($i = 0; $i -lt 20; $i++) {
  $keyDown = $false
  foreach ($vk in @($VK_MENU, $VK_F, $VK_I, $VK_ESCAPE, $VK_RETURN)) {
    if (([NativeInputModeRestore]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) {
      $keyDown = $true
      break
    }
  }
  if (-not $keyDown) { break }
  Start-Sleep -Milliseconds 10
}

$hwnd = [NativeInputModeRestore]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  [pscustomobject]@{ ok = $false; restored = $false; error = 'No foreground window.' } | ConvertTo-Json -Compress
  exit 0
}

[uint32]$processId = 0
$threadId = [NativeInputModeRestore]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$hkl = [NativeInputModeRestore]::GetKeyboardLayout($threadId).ToInt64()
$layoutLangId = [int]($hkl -band 0xffff)
$primaryLangId = [int]($layoutLangId -band 0x03ff)
$isEnglishLayout = $primaryLangId -eq 0x09

function Get-ImeOpen([IntPtr]$targetHwnd) {
  $context = [NativeInputModeRestore]::ImmGetContext($targetHwnd)
  if ($context -ne [IntPtr]::Zero) {
    try {
      return [NativeInputModeRestore]::ImmGetOpenStatus($context)
    } finally {
      [void][NativeInputModeRestore]::ImmReleaseContext($targetHwnd, $context)
    }
  }

  $imeWnd = [NativeInputModeRestore]::ImmGetDefaultIMEWnd($targetHwnd)
  if ($imeWnd -ne [IntPtr]::Zero) {
    return [NativeInputModeRestore]::SendMessage($imeWnd, $WM_IME_CONTROL, [IntPtr]$IMC_GETOPENSTATUS, [IntPtr]::Zero).ToInt64() -ne 0
  }

  return $false
}

function Set-ImeOpen([IntPtr]$targetHwnd, [bool]$open) {
  $context = [NativeInputModeRestore]::ImmGetContext($targetHwnd)
  if ($context -eq [IntPtr]::Zero) { return $false }
  try {
    return [NativeInputModeRestore]::ImmSetOpenStatus($context, $open)
  } finally {
    [void][NativeInputModeRestore]::ImmReleaseContext($targetHwnd, $context)
  }
}

$imeOpen = Get-ImeOpen $hwnd
$restored = $false
if ((-not $isEnglishLayout) -and (-not $imeOpen)) {
  $restored = Set-ImeOpen $hwnd $true
  Start-Sleep -Milliseconds 30
  $imeOpen = Get-ImeOpen $hwnd
  if (-not $imeOpen) {
    [NativeInputModeRestore]::keybd_event($VK_SHIFT, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [NativeInputModeRestore]::keybd_event($VK_SHIFT, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 30
    $imeOpen = Get-ImeOpen $hwnd
    $restored = $true
  }
}

[pscustomobject]@{
  ok = $true
  restored = $restored
  layoutLangId = $layoutLangId
  primaryLangId = $primaryLangId
  imeOpen = $imeOpen
} | ConvertTo-Json -Compress
`.trim()

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

async function ensureWindowsEnglishInputMode(): Promise<EnsureEnglishInputModeResult> {
  if (process.platform !== 'win32') {
    return { ok: true, switched: false, reason: 'unsupported-platform' }
  }

  try {
    const result = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WINDOWS_ENSURE_ENGLISH_INPUT_MODE_SCRIPT,
      ],
      { timeout: 3000, windowsHide: true },
    )
    const raw = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!raw) return { ok: false, switched: false, error: 'No input mode result.' }
    const parsed = JSON.parse(raw) as Partial<EnsureEnglishInputModeResult>
    return {
      ok: parsed.ok === true,
      switched: parsed.switched === true,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      layoutLangId: typeof parsed.layoutLangId === 'number' ? parsed.layoutLangId : undefined,
      primaryLangId: typeof parsed.primaryLangId === 'number' ? parsed.primaryLangId : undefined,
      imeOpen: typeof parsed.imeOpen === 'boolean' ? parsed.imeOpen : undefined,
    }
  } catch (error) {
    return { ok: false, switched: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function restoreWindowsInputMode(): Promise<RestoreInputModeResult> {
  if (process.platform !== 'win32') {
    return { ok: true, restored: false, reason: 'unsupported-platform' }
  }

  try {
    const result = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WINDOWS_RESTORE_INPUT_MODE_SCRIPT,
      ],
      { timeout: 3000, windowsHide: true },
    )
    const raw = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!raw) return { ok: false, restored: false, error: 'No input mode restore result.' }
    const parsed = JSON.parse(raw) as Partial<RestoreInputModeResult>
    return {
      ok: parsed.ok === true,
      restored: parsed.restored === true,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      layoutLangId: typeof parsed.layoutLangId === 'number' ? parsed.layoutLangId : undefined,
      primaryLangId: typeof parsed.primaryLangId === 'number' ? parsed.primaryLangId : undefined,
      imeOpen: typeof parsed.imeOpen === 'boolean' ? parsed.imeOpen : undefined,
    }
  } catch (error) {
    return { ok: false, restored: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function normalizeCommandOutput(stdout?: string, stderr?: string): string {
  return [stdout, stderr]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n')
}

function commandErrorMessage(error: unknown): string {
  const maybe = error as { message?: string; stdout?: string; stderr?: string }
  const output = normalizeCommandOutput(maybe.stdout, maybe.stderr)
  return output || maybe.message || String(error)
}

function validateDockerContainerName(containerName: string): string | null {
  const trimmed = containerName.trim()
  if (!trimmed) return null
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(trimmed) ? trimmed : null
}

async function runDockerContainerAction(
  action: VoiceLocalAsrServiceAction,
  containerName: string,
): Promise<VoiceLocalAsrServiceResult> {
  const normalizedContainerName = validateDockerContainerName(containerName)
  if (!normalizedContainerName) {
    return {
      ok: false,
      action,
      containerName: containerName.trim(),
      error: 'Docker 容器名无效。请只使用字母、数字、点、下划线或短横线。',
    }
  }

  try {
    if (action === 'status' || action === 'start') {
      const inspect = await execFileAsync(
        'docker',
        ['inspect', '--format', '{{.State.Running}}', normalizedContainerName],
        { timeout: 15000, windowsHide: true },
      )
      const running = inspect.stdout.trim() === 'true'
      if (action === 'status') {
        return { ok: true, action, containerName: normalizedContainerName, running }
      }
      if (running) {
        return { ok: true, action, containerName: normalizedContainerName, running: true, alreadyRunning: true }
      }
    }

    const result = await execFileAsync(
      'docker',
      [action, normalizedContainerName],
      { timeout: 60000, windowsHide: true },
    )
    return {
      ok: true,
      action,
      containerName: normalizedContainerName,
      running: true,
      output: normalizeCommandOutput(result.stdout, result.stderr),
    }
  } catch (error) {
    return {
      ok: false,
      action,
      containerName: normalizedContainerName,
      error: commandErrorMessage(error),
    }
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
        wav_name: `pragma-desk-${Date.now()}`,
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

async function warmupFunasrVoiceStream(options: VoiceStreamWarmupRequest): Promise<VoiceStreamWarmupResult> {
  const endpoint = options.endpoint.trim()
  if (!endpoint) return { ok: false, error: '未配置 FunASR WebSocket 地址。' }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, error: 'FunASR WebSocket 地址不是有效 URL。' }
  }

  if (!isWebSocketProtocol(url.protocol)) {
    return { ok: false, error: 'FunASR 预热只支持 ws/wss 地址。' }
  }

  const sampleRate = typeof options.sampleRate === 'number' && Number.isFinite(options.sampleRate)
    ? Math.max(8000, Math.min(48000, Math.round(options.sampleRate)))
    : 16000
  const timeoutMs = Math.max(1000, Math.min(30000, Math.round(options.timeoutMs || 10000)))

  return new Promise((resolve) => {
    let settled = false
    const ws = new WebSocket(url.toString(), { perMessageDeflate: false })
    let timer: ReturnType<typeof setTimeout> | null = null

    const settle = (result: VoiceStreamWarmupResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      } catch {
        // Ignore close races while tearing down a warmup stream.
      }
      resolve(result)
    }

    timer = setTimeout(() => {
      settle({ ok: false, error: 'FunASR WebSocket 预热超时。' })
    }, timeoutMs)

    ws.once('open', () => {
      const config = {
        mode: '2pass',
        wav_name: `pragma-desk-warmup-${Date.now()}`,
        wav_format: 'pcm',
        is_speaking: true,
        chunk_size: [...FUNASR_CHUNK_SIZE],
        chunk_interval: FUNASR_CHUNK_INTERVAL,
        audio_fs: sampleRate,
        itn: true,
      }

      const silence = Buffer.alloc(getFunasrChunkBytes(sampleRate) * 2)
      sendWebSocketData(ws, JSON.stringify(config))
        .then(() => sendWebSocketData(ws, silence))
        .then(() => delay(Math.min(240, getFunasrChunkDurationMs())))
        .then(() => sendWebSocketData(ws, JSON.stringify({ is_speaking: false })))
        .then(() => settle({ ok: true }))
        .catch((error) => {
          settle({ ok: false, error: error instanceof Error ? error.message : String(error) })
        })
    })

    ws.on('message', () => {
      // Warmup responses are intentionally ignored; the connection only primes the ASR runtime.
    })

    ws.once('error', (error) => {
      settle({ ok: false, error: error.message || 'FunASR WebSocket 预热失败。' })
    })

    ws.once('close', () => {
      settle({ ok: false, error: 'FunASR WebSocket 预热连接已关闭。' })
    })
  })
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
        wav_name: `pragma-desk-${Date.now()}`,
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

  ipcMain.handle(IPC.WINDOW_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.close()
    } else {
      app.quit()
    }
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

  ipcMain.handle(IPC.WINDOW_TITLE_BAR_CURSOR_STATE, (event): TitleBarCursorState => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { inRevealZone: false, inTitleBarZone: false }

    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    const relativeY = cursor.y - bounds.y
    const withinX = cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width
    const nearWindowTop = relativeY >= -2

    return {
      inRevealZone: withinX && nearWindowTop && relativeY <= TITLE_BAR_REVEAL_ZONE_PX,
      inTitleBarZone: withinX && nearWindowTop && relativeY <= TITLE_BAR_HEIGHT_PX,
    }
  })

  ipcMain.handle(IPC.WINDOW_START_VOICE_INPUT, async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.focus()
    return startWindowsVoiceInput()
  })

  ipcMain.handle(IPC.WINDOW_ENSURE_ENGLISH_INPUT_MODE, async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.focus()
    return ensureWindowsEnglishInputMode()
  })

  ipcMain.handle(IPC.WINDOW_RESTORE_INPUT_MODE, async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.focus()
    return restoreWindowsInputMode()
  })

  ipcMain.handle(IPC.VOICE_LOCAL_ASR_SERVICE, async (_event, options: VoiceLocalAsrServiceRequest) => {
    const action = options.action === 'status' || options.action === 'restart' ? options.action : 'start'
    return runDockerContainerAction(action, options.containerName)
  })

  ipcMain.handle(IPC.VOICE_TRANSCRIBE, async (_event, options: VoiceTranscribeRequest) => {
    return transcribeVoiceInput(options)
  })

  ipcMain.handle(IPC.VOICE_STREAM_START, async (event, options: VoiceStreamStartRequest) => {
    return startFunasrVoiceStream(event.sender, options)
  })

  ipcMain.handle(IPC.VOICE_STREAM_WARMUP, async (_event, options: VoiceStreamWarmupRequest) => {
    return warmupFunasrVoiceStream(options)
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
