import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc'
import { ptyManager } from './services/PtyManager'
import { activityMonitor } from './services/ActivityMonitor'
import { readConfig, writeConfig } from './services/ConfigStore'
import { hookServer } from './services/HookServer'
import { registerHooks, unregisterHooks } from './services/HookInstaller'
import { mediaMonitor } from './services/MediaMonitor'
import { startIdeServer, stopIdeServer, registerIdeIPC } from './services/IdeServer'
import { opencodeService } from './services/OpencodeService'

let mainWindow: BrowserWindow | null = null
const detachedWindows = new Map<string, BrowserWindow>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1a1a1e',
    icon: join(__dirname, '../../assets/icons/fastagents-256.png'),
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

  // Start IDE bridge for Claude Code /ide integration (lock file + WebSocket)
  registerIdeIPC()
  startIdeServer().catch((err) => console.error('[IDE] failed to start:', err))

  // ─── Detached window IPC ───
  // Store live tab snapshots for detached windows to fetch and hand back on close
  const detachedSessionData = new Map<string, unknown[]>()
  const detachedEditorData = new Map<string, unknown[]>()
  const detachedContext = new Map<string, { projectId: string | null; worktreeId: string | null }>()
  // Track live tab IDs per detached window (updated by the detached renderer)
  const detachedTabIds = new Map<string, string[]>()
  const tabDragState = new Map<string, {
    payload: unknown
    targetWindowId: string | null
  }>()

  ipcMain.handle('detach:get-sessions', (_event, windowId: string) => {
    return detachedSessionData.get(windowId) ?? []
  })

  ipcMain.handle('detach:get-editors', (_event, windowId: string) => {
    return detachedEditorData.get(windowId) ?? []
  })

  ipcMain.handle('detach:update-session-ids', (_event, windowId: string, tabIds: string[]) => {
    detachedTabIds.set(windowId, tabIds)
  })

  ipcMain.handle('detach:update-sessions', (_event, windowId: string, sessions: unknown[]) => {
    detachedSessionData.set(windowId, sessions)
  })

  ipcMain.handle('detach:update-editors', (_event, windowId: string, editors: unknown[]) => {
    detachedEditorData.set(windowId, editors)
  })

  ipcMain.handle('detach:update-context', (_event, windowId: string, context: { projectId: string | null; worktreeId: string | null }) => {
    detachedContext.set(windowId, context)
  })

  ipcMain.on('detach:tab-drag-register', (event, token: string, payload: unknown) => {
    tabDragState.set(token, { payload, targetWindowId: null })
    event.returnValue = true
  })

  ipcMain.on('detach:tab-drag-claim', (event, token: string, targetWindowId: string) => {
    const entry = tabDragState.get(token)
    if (!entry) {
      event.returnValue = null
      return
    }
    entry.targetWindowId = targetWindowId
    tabDragState.set(token, entry)
    event.returnValue = entry.payload
  })

  ipcMain.on('detach:tab-drag-get-active', (event) => {
    // Return the most recently registered (unclaimed) drag token
    let activeToken: string | null = null
    for (const [token, entry] of tabDragState) {
      if (entry.targetWindowId === null) activeToken = token
    }
    event.returnValue = activeToken
  })

  ipcMain.on('detach:tab-drag-finish', (event, token: string) => {
    const entry = tabDragState.get(token)
    tabDragState.delete(token)
    event.returnValue = {
      claimed: entry?.targetWindowId !== null,
      targetWindowId: entry?.targetWindowId ?? null,
    }
  })

  ipcMain.handle(
    'detach:create',
    (
      _event,
      tabIds: string[],
      title: string,
      sessionData: unknown[],
      editorData: unknown[],
      context?: { projectId: string | null; worktreeId: string | null } | null,
      position?: { x: number; y: number },
      size?: { width: number; height: number },
    ) => {
    const id = `detach-${Date.now()}`
    const w = size?.width ?? 800
    const h = size?.height ?? 600
    const win = new BrowserWindow({
      width: w,
      height: h,
      ...(position ? { x: Math.round(position.x - w / 2), y: Math.round(position.y - h / 2) } : {}),
      minWidth: 400,
      minHeight: 300,
      frame: false,
      titleBarStyle: 'default',
      icon: join(__dirname, '../../assets/icons/fastagents-256.png'),
      backgroundColor: '#1a1a1e',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    detachedWindows.set(id, win)
    detachedSessionData.set(id, sessionData)
    detachedEditorData.set(id, editorData)
    detachedTabIds.set(id, tabIds)
    detachedContext.set(id, context ?? { projectId: null, worktreeId: null })

    win.on('closed', () => {
      // Use the latest tab list (includes newly added tabs)
      const liveIds = detachedTabIds.get(id) ?? tabIds
      const liveSessions = detachedSessionData.get(id) ?? sessionData
      const liveEditors = detachedEditorData.get(id) ?? editorData
      const liveContext = detachedContext.get(id) ?? context ?? { projectId: null, worktreeId: null }
      detachedWindows.delete(id)
      detachedSessionData.delete(id)
      detachedEditorData.delete(id)
      detachedTabIds.delete(id)
      detachedContext.delete(id)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('detach:closed', {
          id,
          tabIds: liveIds,
          sessions: liveSessions,
          editors: liveEditors,
          projectId: liveContext.projectId ?? null,
          worktreeId: liveContext.worktreeId ?? null,
        })
      }
    })

    const query = { detached: 'true', sessionIds: tabIds.join(','), windowId: id, title }
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const url = new URL(process.env['ELECTRON_RENDERER_URL'])
      Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v))
      win.loadURL(url.toString())
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { query })
    }

    return id
    },
  )

  ipcMain.handle('detach:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('detach:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize()
  })

  ipcMain.handle('detach:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('detach:set-position', (event, x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (win.isMaximized()) {
      win.unmaximize()
    }
    win.setPosition(Math.round(x), Math.round(y))
  })

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

  // Destroy all detached windows
  for (const [, win] of detachedWindows) {
    if (!win.isDestroyed()) win.destroy()
  }
  detachedWindows.clear()

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
  stopIdeServer()
  opencodeService.disposeAll()
  ptyManager.destroyAll()
  app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
