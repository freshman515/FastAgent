import type { CanvasCard, NoteImage } from '@shared/types'
import { createConnectedNoteTabForSession } from '@/lib/connectedNoteTabs'
import { createNoteSyncId } from '@/lib/noteSync'
import { getDefaultCanvasCardSize, useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { useSessionsStore } from '@/stores/sessions'
import { addCanvasCardToSpace } from './canvasSpaceMembership'

const CONNECTED_NOTE_GAP = 24

interface CreateConnectedNoteForCardOptions {
  createClassicTab?: boolean
  focus?: boolean
  noteBody?: string
  noteImages?: NoteImage[]
  noteSyncId?: string
}

export function createConnectedNoteForCard(targetCard: CanvasCard, options: CreateConnectedNoteForCardOptions = {}): string | null {
  if (targetCard.kind !== 'session' && targetCard.kind !== 'terminal') return null

  const canvasStore = useCanvasStore.getState()
  const noteSyncId = options.noteSyncId ?? createNoteSyncId()
  const noteBody = options.noteBody ?? ''
  const noteImages = options.noteImages
  const existingNote = canvasStore.getLayout().cards.find((card) => card.kind === 'note' && card.noteSyncId === noteSyncId)
  if (existingNote) {
    if ((existingNote.noteBody ?? '') !== noteBody || (noteImages !== undefined && !sameNoteImages(existingNote.noteImages, noteImages))) {
      canvasStore.updateCard(existingNote.id, {
        noteBody,
        ...(noteImages !== undefined ? { noteImages } : {}),
      })
    }
    canvasStore.addRelation(targetCard.id, existingNote.id, { kind: 'related', direction: 'none' })
    if (options.createClassicTab !== false) createClassicNoteTab(targetCard, noteSyncId, noteBody, noteImages ?? existingNote.noteImages ?? [])
    if (options.focus !== false) focusNoteCard(existingNote.id)
    return existingNote.id
  }

  const noteSize = getDefaultCanvasCardSize('note')
  const targetSpaceId = getContainingFrameId(targetCard.id)
  const position = getNearestConnectedNotePosition(targetCard, noteSize)
  const cardId = canvasStore.addCard({
    kind: 'note',
    refId: null,
    x: position.x,
    y: position.y,
    noteBody,
    noteImages: noteImages ?? [],
    noteColor: 'yellow',
    noteSyncId,
  }, {
    forceFreePlacement: true,
    forceAvoidOverlap: true,
    ignoreOverlapCardIds: targetSpaceId ? [targetSpaceId] : undefined,
  })
  addCanvasCardToSpace(cardId, targetSpaceId)
  canvasStore.addRelation(targetCard.id, cardId, { kind: 'related', direction: 'none' })
  if (options.createClassicTab !== false) createClassicNoteTab(targetCard, noteSyncId, noteBody, noteImages ?? [])
  if (options.focus !== false) focusNoteCard(cardId)
  return cardId
}

function createClassicNoteTab(targetCard: CanvasCard, noteSyncId: string, noteBody: string, noteImages: NoteImage[]): void {
  if (!targetCard.refId) return
  const targetSession = useSessionsStore.getState().sessions.find((session) => session.id === targetCard.refId)
  if (!targetSession) return
  createConnectedNoteTabForSession(targetSession, undefined, {
    activate: false,
    initialBody: noteBody,
    initialImages: noteImages,
    noteSyncId,
  })
}

function sameNoteImages(a: NoteImage[] | undefined, b: NoteImage[] | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  return left.every((image, index) => (
    image.id === right[index].id
    && image.dataUrl === right[index].dataUrl
    && image.displayIndex === right[index].displayIndex
  ))
}

function focusNoteCard(cardId: string): void {
  requestAnimationFrame(() => {
    const canvas = useCanvasStore.getState()
    canvas.clearMaximizedCard()
    canvas.clearFocusReturn()
    canvas.focusOnCard(cardId, { allowReturn: false })
  })
}

function getContainingFrameId(cardId: string): string | null {
  const layout = useCanvasStore.getState().getLayout()
  const activeSpaceId = useCanvasUiStore.getState().activeSpaceId
  const activeSpace = activeSpaceId
    ? layout.cards.find((card) => card.id === activeSpaceId && card.kind === 'frame') ?? null
    : null
  if (activeSpace?.frameMemberIds?.includes(cardId)) return activeSpace.id

  return layout.cards.find((card) => card.kind === 'frame' && card.frameMemberIds?.includes(cardId))?.id ?? null
}

function getNearestConnectedNotePosition(targetCard: CanvasCard, noteSize: { width: number; height: number }): { x: number; y: number } {
  const layout = useCanvasStore.getState().getLayout()
  const containingFrameId = getContainingFrameId(targetCard.id)
  const obstacles = layout.cards.filter((card) =>
    card.id !== targetCard.id
    && card.id !== containingFrameId
    && !card.hidden
    && !card.hiddenByFrameId
  )
  const targetCenter = {
    x: targetCard.x + targetCard.width / 2,
    y: targetCard.y + targetCard.height / 2,
  }
  const candidatePositions = [
    { x: targetCard.x + targetCard.width + CONNECTED_NOTE_GAP, y: targetCard.y },
    { x: targetCard.x + targetCard.width + CONNECTED_NOTE_GAP, y: targetCenter.y - noteSize.height / 2 },
    { x: targetCard.x - noteSize.width - CONNECTED_NOTE_GAP, y: targetCard.y },
    { x: targetCard.x - noteSize.width - CONNECTED_NOTE_GAP, y: targetCenter.y - noteSize.height / 2 },
    { x: targetCard.x, y: targetCard.y + targetCard.height + CONNECTED_NOTE_GAP },
    { x: targetCenter.x - noteSize.width / 2, y: targetCard.y + targetCard.height + CONNECTED_NOTE_GAP },
    { x: targetCard.x, y: targetCard.y - noteSize.height - CONNECTED_NOTE_GAP },
    { x: targetCenter.x - noteSize.width / 2, y: targetCard.y - noteSize.height - CONNECTED_NOTE_GAP },
  ]

  const sortedCandidates = candidatePositions.sort((a, b) =>
    getNoteDistanceFromTarget(a, noteSize, targetCenter) - getNoteDistanceFromTarget(b, noteSize, targetCenter),
  )
  return sortedCandidates.find((candidate) => !noteOverlapsAny(candidate, noteSize, obstacles)) ?? sortedCandidates[0]
}

function getNoteDistanceFromTarget(
  position: { x: number; y: number },
  noteSize: { width: number; height: number },
  targetCenter: { x: number; y: number },
): number {
  return Math.hypot(
    position.x + noteSize.width / 2 - targetCenter.x,
    position.y + noteSize.height / 2 - targetCenter.y,
  )
}

function noteOverlapsAny(position: { x: number; y: number }, size: { width: number; height: number }, cards: CanvasCard[]): boolean {
  return cards.some((card) =>
    position.x < card.x + card.width + CONNECTED_NOTE_GAP
    && position.x + size.width + CONNECTED_NOTE_GAP > card.x
    && position.y < card.y + card.height + CONNECTED_NOTE_GAP
    && position.y + size.height + CONNECTED_NOTE_GAP > card.y,
  )
}
