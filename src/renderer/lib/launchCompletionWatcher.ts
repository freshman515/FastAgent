import { closeSessionsById } from '@/lib/closeSessions'
import { useLaunchesStore } from '@/stores/launches'
import { useSessionsStore } from '@/stores/sessions'

const AUTO_CLOSE_DELAY_MS = 650
const STALE_CHECK_INTERVAL_MS = 3000
const MARKER_BUFFER_LIMIT = 4096

interface LaunchCompletionMonitor {
  stop: () => void
}

const monitors = new Map<string, LaunchCompletionMonitor>()

function hasRunningLaunchState(sessionId: string): boolean {
  return Object.values(useLaunchesStore.getState().runningByProject)
    .some((state) => state.sessionId === sessionId)
}

export function stopLaunchCompletionWatcher(sessionId: string): void {
  const monitor = monitors.get(sessionId)
  if (!monitor) return
  monitor.stop()
}

export function startLaunchCompletionWatcher(sessionId: string, completionMarker: string): void {
  stopLaunchCompletionWatcher(sessionId)

  let completed = false
  let closeTimer: ReturnType<typeof window.setTimeout> | null = null
  let outputBuffer = ''

  const getSession = () => useSessionsStore.getState().sessions.find((session) => session.id === sessionId)

  const cleanup = (): void => {
    offData()
    offExit()
    window.clearInterval(staleInterval)
    if (closeTimer) window.clearTimeout(closeTimer)
    monitors.delete(sessionId)
  }

  const scheduleClose = (): void => {
    if (completed) return
    completed = true
    closeTimer = window.setTimeout(() => {
      const session = getSession()
      if (!session) {
        cleanup()
        return
      }
      closeSessionsById([sessionId])
      cleanup()
    }, AUTO_CLOSE_DELAY_MS)
  }

  const offData = window.api.session.onData((event) => {
    const session = getSession()
    if (!session) {
      cleanup()
      return
    }
    if (session.ptyId !== event.ptyId) return
    outputBuffer = (outputBuffer + event.data).slice(-MARKER_BUFFER_LIMIT)
    if (outputBuffer.includes(completionMarker)) {
      scheduleClose()
    }
  })

  const offExit = window.api.session.onExit((event) => {
    const session = getSession()
    if (!session) {
      cleanup()
      return
    }
    if (session.ptyId === event.ptyId) {
      scheduleClose()
    }
  })

  const staleInterval = window.setInterval(() => {
    if (!getSession() || !hasRunningLaunchState(sessionId)) {
      cleanup()
    }
  }, STALE_CHECK_INTERVAL_MS)

  monitors.set(sessionId, { stop: cleanup })
}
