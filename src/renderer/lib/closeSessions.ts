import type { Session } from '@shared/types'
import { removeCanvasNotesBySyncId } from '@/lib/noteSync'
import { useCanvasStore } from '@/stores/canvas'
import { useLaunchesStore } from '@/stores/launches'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'

export function getClosableSessions(ids: string[]): Session[] {
  const uniqueIds = [...new Set(ids)]
  const sessions = useSessionsStore.getState().sessions
  return uniqueIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => Boolean(session) && !session.pinned)
}

export function closeSessionsById(ids: string[]): string[] {
  const targets = getClosableSessions(ids)
  if (targets.length === 0) return []

  const paneStore = usePanesStore.getState()
  const sessionStore = useSessionsStore.getState()
  const canvasStore = useCanvasStore.getState()

  for (const session of targets) {
    if (session.ptyId) {
      void window.api.session.kill(session.ptyId)
    }
    if (session.type === 'note') {
      removeCanvasNotesBySyncId(session.noteSyncId)
    }

    const paneIds = Object.entries(paneStore.paneSessions)
      .filter(([, sessionIds]) => sessionIds.includes(session.id))
      .map(([paneId]) => paneId)
    for (const paneId of paneIds) {
      paneStore.removeSessionFromPane(paneId, session.id)
    }

    canvasStore.detachSessionEverywhere(session.id)
    sessionStore.removeSession(session.id)
    useLaunchesStore.getState().clearRunningSession(session.id)
  }

  return targets.map((session) => session.id)
}
