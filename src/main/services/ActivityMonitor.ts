import pidusage from 'pidusage'
import pidtree from 'pidtree'
import { ptyManager } from './PtyManager'

interface MonitorEntry {
  ptyId: string
  consecutiveIdles: number
  interval: ReturnType<typeof setInterval> | null
  onIdle: (ptyId: string) => void
}

const POLL_INTERVAL_MS = 1000
const IDLE_THRESHOLD = 2 // consecutive idle polls to confirm

export class ActivityMonitor {
  private readonly monitors = new Map<string, MonitorEntry>()

  startMonitoring(ptyId: string, onIdle: (ptyId: string) => void): void {
    if (this.monitors.has(ptyId)) return

    const entry: MonitorEntry = {
      ptyId,
      consecutiveIdles: 0,
      interval: null,
      onIdle,
    }

    entry.interval = setInterval(() => {
      this.checkActivity(entry)
    }, POLL_INTERVAL_MS)

    this.monitors.set(ptyId, entry)
  }

  stopMonitoring(ptyId: string): void {
    const entry = this.monitors.get(ptyId)
    if (entry?.interval) {
      clearInterval(entry.interval)
    }
    this.monitors.delete(ptyId)
  }

  async isActive(ptyId: string): Promise<boolean> {
    const pid = ptyManager.getPid(ptyId)
    if (pid === undefined) return false

    try {
      const children = await pidtree(pid, { root: true })
      const stats = await pidusage(children)

      for (const stat of Object.values(stats)) {
        if (stat && stat.cpu > 0.5) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }

  private async checkActivity(entry: MonitorEntry): Promise<void> {
    if (!ptyManager.isAlive(entry.ptyId)) {
      this.stopMonitoring(entry.ptyId)
      entry.onIdle(entry.ptyId)
      return
    }

    const active = await this.isActive(entry.ptyId)

    if (active) {
      entry.consecutiveIdles = 0
    } else {
      entry.consecutiveIdles++
      if (entry.consecutiveIdles >= IDLE_THRESHOLD) {
        this.stopMonitoring(entry.ptyId)
        entry.onIdle(entry.ptyId)
      }
    }
  }

  stopAll(): void {
    for (const [id] of this.monitors) {
      this.stopMonitoring(id)
    }
  }
}

export const activityMonitor = new ActivityMonitor()
