import { app, BrowserWindow, desktopCapturer, globalShortcut, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc'
import { ptyManager } from './services/PtyManager'
import { activityMonitor } from './services/ActivityMonitor'
import { readConfig, writeConfig } from './services/ConfigStore'
import { hookServer } from './services/HookServer'
import { registerHooks, unregisterHooks } from './services/HookInstaller'
import { mediaMonitor } from './services/MediaMonitor'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1a1a1e',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Auto-approve system audio capture for music visualizer (no picker dialog)
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      }
    },
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerAllHandlers()
  createWindow()
  mediaMonitor.start()

  // Start hook server and register Claude Code hooks
  hookServer.start().then((port) => {
    registerHooks(port)
  }).catch((err) => {
    console.error('[HookServer] failed to start:', err)
  })

  // Global hotkey: Alt+Space to toggle window
  globalShortcut.register('Alt+Space', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    if (mainWindow.isFocused()) {
      mainWindow.hide()
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Don't quit here — let before-quit handle graceful shutdown
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

let isQuitting = false
app.on('before-quit', async (e) => {
  if (isQuitting) return
  isQuitting = true
  e.preventDefault()

  activityMonitor.stopAll()

  try {
    // Snapshot sessions and panes BEFORE graceful shutdown
    // (because pty exit → renderer removeSession → config gets overwritten)
    const config = readConfig()
    const sessionsSnapshot = Array.isArray(config.sessions) ? [...config.sessions] : []
    const panesSnapshot = config.panes ?? {}

    // Gracefully shutdown Claude Code sessions and capture resume UUIDs
    const uuidMap = await ptyManager.gracefulShutdownClaudeSessions()

    // Write back the snapshot with UUIDs applied (ignoring any renderer-side deletions)
    const updated = sessionsSnapshot.map((s: Record<string, unknown>) => {
      const result = { ...s, status: 'stopped', ptyId: null }
      if (typeof s.id === 'string' && uuidMap.has(s.id)) {
        result.resumeUUID = uuidMap.get(s.id)
      }
      return result
    })
    writeConfig('sessions', updated)
    // Restore panes snapshot (renderer may have cleared it during shutdown)
    writeConfig('panes', panesSnapshot)
  } catch {
    // ignore errors during shutdown
  }

  hookServer.stop()
  unregisterHooks()
  mediaMonitor.stop()
  ptyManager.destroyAll()
  app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
