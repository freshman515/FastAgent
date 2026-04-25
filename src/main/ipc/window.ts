import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IPC } from '@shared/types'

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
}
