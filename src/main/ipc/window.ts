import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IPC, type VoiceTranscribeRequest, type VoiceTranscribeResult } from '@shared/types'

const execFileAsync = promisify(execFile)

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

async function transcribeVoiceInput(options: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
  const endpoint = options.endpoint.trim()
  if (!endpoint) return { ok: false, error: '未配置语音识别 API 地址。' }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, error: '语音识别 API 地址不是有效 URL。' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: '语音识别 API 只支持 http/https 地址。' }
  }

  const timeoutMs = Math.max(1000, Math.min(120000, Math.round(options.timeoutMs || 30000)))
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
}
