import { useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'

export function createNoteSyncId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto)
  return `note-sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function syncCanvasNoteBodyToClassic(noteSyncId: string | undefined, noteBody: string): void {
  if (!noteSyncId) return

  const sessionsStore = useSessionsStore.getState()
  for (const session of sessionsStore.sessions) {
    if (session.type !== 'note' || session.noteSyncId !== noteSyncId) continue
    if ((session.noteBody ?? '') === noteBody) continue
    sessionsStore.updateSession(session.id, { noteBody })
  }
}

export function syncClassicNoteBodyToCanvas(noteSyncId: string | undefined, noteBody: string): void {
  if (!noteSyncId) return

  const now = Date.now()
  useCanvasStore.setState((state) => {
    let changed = false
    const layouts = Object.fromEntries(Object.entries(state.layouts).map(([layoutKey, layout]) => {
      let layoutChanged = false
      const cards = layout.cards.map((card) => {
        if (card.kind !== 'note' || card.noteSyncId !== noteSyncId || (card.noteBody ?? '') === noteBody) return card
        layoutChanged = true
        return { ...card, noteBody, updatedAt: now }
      })
      if (!layoutChanged) return [layoutKey, layout]
      changed = true
      return [layoutKey, { ...layout, cards }]
    }))

    return changed ? { layouts } : state
  })
}

export function removeClassicNotesBySyncId(noteSyncId: string | undefined): void {
  if (!noteSyncId) return

  const sessionsStore = useSessionsStore.getState()
  const panesStore = usePanesStore.getState()
  const noteIds = sessionsStore.sessions
    .filter((session) => session.type === 'note' && session.noteSyncId === noteSyncId)
    .map((session) => session.id)

  for (const noteId of noteIds) {
    for (const [paneId, sessionIds] of Object.entries(usePanesStore.getState().paneSessions)) {
      if (sessionIds.includes(noteId)) panesStore.removeSessionFromPane(paneId, noteId)
    }
    sessionsStore.removeSession(noteId)
  }
}

export function removeCanvasNotesBySyncId(noteSyncId: string | undefined): void {
  if (!noteSyncId) return

  useCanvasStore.setState((state) => {
    let changed = false
    const layouts = Object.fromEntries(Object.entries(state.layouts).map(([layoutKey, layout]) => {
      const removedIds = new Set(
        layout.cards
          .filter((card) => card.kind === 'note' && card.noteSyncId === noteSyncId)
          .map((card) => card.id),
      )
      if (removedIds.size === 0) return [layoutKey, layout]

      changed = true
      return [layoutKey, {
        ...layout,
        cards: layout.cards.filter((card) => !removedIds.has(card.id)),
        relations: layout.relations.filter((relation) => !removedIds.has(relation.fromCardId) && !removedIds.has(relation.toCardId)),
        recentCardIds: layout.recentCardIds?.filter((cardId) => !removedIds.has(cardId)),
      }]
    }))

    if (!changed) return state
    return {
      layouts,
      selectedCardIds: state.selectedCardIds.filter((cardId) =>
        Object.values(layouts).some((layout) => layout.cards.some((card) => card.id === cardId)),
      ),
      focusReturn: state.focusReturn && Object.values(layouts).some((layout) =>
        layout.cards.some((card) => card.id === state.focusReturn?.cardId),
      )
        ? state.focusReturn
        : null,
      maximizedCardId: state.maximizedCardId && Object.values(layouts).some((layout) =>
        layout.cards.some((card) => card.id === state.maximizedCardId),
      )
        ? state.maximizedCardId
        : null,
    }
  })
}
