import { app, BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo, type ProgressInfo } from 'electron-updater'

const { autoUpdater } = electronUpdater
import { IPC, type UpdaterEvent } from '@shared/types'

/**
 * Wraps electron-updater with a small IPC surface so the renderer can:
 *  - show a "new version available" prompt when one is found
 *  - trigger the download and track progress
 *  - request "quit and install" after the download completes
 *
 * Wire-up: call `initUpdaterService()` once the first window is ready. The
 * service auto-checks on startup (skipped in dev) and exposes manual checks.
 */
export class UpdaterService {
  private initialized = false
  private lastInfo: UpdateInfo | null = null

  init(): void {
    if (this.initialized) return
    this.initialized = true

    // Control flow manually — don't auto-download until user approves.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.broadcast({ type: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      this.lastInfo = info
      this.broadcast({
        type: 'available',
        version: info.version,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        releaseDate: info.releaseDate,
      })
    })

    autoUpdater.on('update-not-available', (info) => {
      this.broadcast({ type: 'not-available', currentVersion: app.getVersion(), latestVersion: info.version })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.broadcast({
        type: 'progress',
        percent: Math.round(progress.percent ?? 0),
        bytesPerSecond: progress.bytesPerSecond ?? 0,
        transferred: progress.transferred ?? 0,
        total: progress.total ?? 0,
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.lastInfo = info
      this.broadcast({ type: 'downloaded', version: info.version })
    })

    autoUpdater.on('error', (err) => {
      this.broadcast({ type: 'error', error: err?.message ?? String(err) })
    })
  }

  /** Trigger a remote check. Safe to call multiple times. */
  async checkNow(): Promise<void> {
    // `electron-updater` refuses to run in a non-packaged app; short-circuit
    // with a synthetic "not-available" so the dev UI stays quiet.
    if (!app.isPackaged) {
      this.broadcast({ type: 'not-available', currentVersion: app.getVersion(), latestVersion: app.getVersion(), dev: true })
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.broadcast({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  async download(): Promise<void> {
    if (!app.isPackaged) return
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.broadcast({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  quitAndInstall(): void {
    if (!app.isPackaged) return
    // `isSilent=true, isForceRunAfter=true`: run installer silently (no NSIS
    // click-through) and auto-start the new version once it finishes.
    autoUpdater.quitAndInstall(true, true)
  }

  private broadcast(event: UpdaterEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.UPDATER_EVENT, event)
      }
    }
  }
}

function normalizeReleaseNotes(raw: UpdateInfo['releaseNotes']): string | null {
  if (!raw) return null
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw.map((item) => (typeof item === 'string' ? item : item?.note ?? '')).filter(Boolean).join('\n\n')
  }
  return null
}

export const updaterService = new UpdaterService()
