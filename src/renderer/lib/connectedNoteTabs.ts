import type { NoteImage, Session } from '@shared/types'
import { createNoteSyncId } from '@/lib/noteSync'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'

function hasPane(paneId: string | undefined, paneSessions: Record<string, string[]>): paneId is string {
  return Boolean(paneId && Object.prototype.hasOwnProperty.call(paneSessions, paneId))
}

function getConnectedNoteName(targetSession: Session, existingCount: number): string {
  const baseName = `便签 - ${targetSession.name}`
  return existingCount === 0 ? baseName : `${baseName} ${existingCount + 1}`
}

export interface CreateConnectedNoteTabOptions {
  activate?: boolean
  initialBody?: string
  initialImages?: NoteImage[]
  noteSyncId?: string
}

export function createConnectedNoteTabForSession(
  targetSession: Session,
  preferredPaneId?: string,
  options: CreateConnectedNoteTabOptions = {},
): string {
  const sessionsStore = useSessionsStore.getState()
  const panesStore = usePanesStore.getState()
  const noteSyncId = options.noteSyncId ?? createNoteSyncId()
  const existingNote = sessionsStore.sessions.find((session) => session.type === 'note' && session.noteSyncId === noteSyncId)
  const targetPaneId = hasPane(preferredPaneId, panesStore.paneSessions)
    ? preferredPaneId
    : panesStore.findPaneForSession(targetSession.id) ?? panesStore.activePaneId

  if (existingNote) {
    const updates: Partial<Omit<Session, 'id'>> = {
      connectedSessionId: targetSession.id,
      initialized: true,
    }
    if (options.initialBody !== undefined && (existingNote.noteBody ?? '') !== options.initialBody) {
      updates.noteBody = options.initialBody
    }
    if (options.initialImages !== undefined) {
      updates.noteImages = options.initialImages
    }
    sessionsStore.updateSession(existingNote.id, updates)
    if (!panesStore.paneSessions[targetPaneId]?.includes(existingNote.id)) {
      panesStore.addSessionToPane(targetPaneId, existingNote.id)
    }
    if (options.activate !== false) {
      panesStore.setActivePaneId(targetPaneId)
      panesStore.setPaneActiveSession(targetPaneId, existingNote.id)
      useSessionsStore.getState().setActive(existingNote.id)
    }
    return existingNote.id
  }

  const existingCount = sessionsStore.sessions.filter((session) =>
    session.type === 'note' && session.connectedSessionId === targetSession.id,
  ).length
  const previousActiveSessionId = sessionsStore.activeSessionId
  const noteId = sessionsStore.addSession(
    targetSession.projectId,
    'note',
    targetSession.worktreeId,
    getConnectedNoteName(targetSession, existingCount),
  )
  sessionsStore.updateSession(noteId, {
    noteBody: options.initialBody ?? '',
    noteImages: options.initialImages,
    connectedSessionId: targetSession.id,
    noteSyncId,
    initialized: true,
  })

  panesStore.addSessionToPane(targetPaneId, noteId)
  if (options.activate !== false) {
    panesStore.setActivePaneId(targetPaneId)
    panesStore.setPaneActiveSession(targetPaneId, noteId)
    useSessionsStore.getState().setActive(noteId)
  } else {
    useSessionsStore.getState().setActive(previousActiveSessionId)
  }
  return noteId
}
