import type { Session } from '@shared/types'
import { useSessionsStore } from '@/stores/sessions'

export function includeConnectedNoteTargets(baseSessions: Session[], allSessions: Session[]): Session[] {
  const sessionsById = new Map(allSessions.map((session) => [session.id, session]))
  const result = new Map<string, Session>()

  for (const session of baseSessions) {
    result.set(session.id, session)
    if (session.type !== 'note' || !session.connectedSessionId) continue
    const target = sessionsById.get(session.connectedSessionId)
    if (target) result.set(target.id, target)
  }

  return Array.from(result.values())
}

export function buildDetachedSessionPayload(tabIds: string[], fallbackSessions: Session[] = []): Session[] {
  const sessions = useSessionsStore.getState().sessions
  const sessionCandidates = new Map(sessions.map((session) => [session.id, session]))
  for (const session of fallbackSessions) {
    if (!sessionCandidates.has(session.id)) sessionCandidates.set(session.id, session)
  }
  const fallbackById = new Map(fallbackSessions.map((session) => [session.id, session]))
  const baseSessions = tabIds
    .map((tabId) => sessions.find((session) => session.id === tabId) ?? fallbackById.get(tabId) ?? null)
    .filter((session): session is Session => session !== null)

  return includeConnectedNoteTargets(baseSessions, Array.from(sessionCandidates.values()))
}
