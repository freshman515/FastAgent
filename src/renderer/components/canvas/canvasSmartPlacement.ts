import type { RefObject } from 'react'
import type { CanvasCard } from '@shared/types'
import { isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'

const SMART_CARD_GAP = 24
const SPACE_INSET = 56

interface SmartPlacementResult {
  position: { x: number; y: number }
  activeSpaceId: string | null
  placeOptions: {
    forceFreePlacement: true
    forceAvoidOverlap: true
    ignoreOverlapCardIds?: string[]
  }
}

export function getSmartNewCardPlacement(
  viewportRef: RefObject<HTMLDivElement | null>,
  size: { width: number; height: number },
): SmartPlacementResult | null {
  const canvas = useCanvasStore.getState()
  const layout = canvas.getLayout()
  const cards = layout.cards
  const activeSpaceId = useCanvasUiStore.getState().activeSpaceId
  const activeSpace = activeSpaceId
    ? cards.find((card) => card.id === activeSpaceId && card.kind === 'frame') ?? null
    : null
  const activeMemberIds = new Set(activeSpace?.frameMemberIds ?? [])

  const anchor = getCurrentAnchorCard(cards, activeSpaceId, activeMemberIds)
  const position = anchor
    ? placeRightOf(anchor)
    : activeSpace
      ? placeInsideSpace(activeSpace, cards, activeMemberIds)
      : placeAtViewportCenter(viewportRef, size)

  if (!position) return null

  return {
    position,
    activeSpaceId,
    placeOptions: {
      forceFreePlacement: true,
      forceAvoidOverlap: true,
      ignoreOverlapCardIds: activeSpaceId ? [activeSpaceId] : undefined,
    },
  }
}

function getCurrentAnchorCard(
  cards: CanvasCard[],
  activeSpaceId: string | null,
  activeMemberIds: Set<string>,
): CanvasCard | null {
  const canvas = useCanvasStore.getState()
  const orderedIds = [
    canvas.focusReturn?.cardId ?? null,
    ...canvas.selectedCardIds,
  ].filter((id): id is string => Boolean(id))
  const seen = new Set<string>()

  for (const id of orderedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const card = cards.find((candidate) => candidate.id === id)
    if (!card || isCanvasCardHidden(card)) continue
    if (activeSpaceId && !activeMemberIds.has(card.id)) continue
    return card
  }

  return null
}

function placeRightOf(card: CanvasCard): { x: number; y: number } {
  return {
    x: card.x + card.width + SMART_CARD_GAP,
    y: card.y,
  }
}

function placeInsideSpace(
  space: CanvasCard,
  cards: CanvasCard[],
  memberIds: Set<string>,
): { x: number; y: number } {
  const layout = useCanvasStore.getState().getLayout()
  const memberCards = cards.filter((card) => memberIds.has(card.id) && card.kind !== 'frame' && !isCanvasCardHidden(card))
  const recentMember = (layout.recentCardIds ?? [])
    .map((id) => memberCards.find((card) => card.id === id) ?? null)
    .find((card): card is CanvasCard => Boolean(card))

  if (recentMember) return placeRightOf(recentMember)

  const rightmostMember = [...memberCards].sort((a, b) =>
    (b.x + b.width - (a.x + a.width)) || (a.y - b.y) || (a.createdAt - b.createdAt),
  )[0]
  if (rightmostMember) return placeRightOf(rightmostMember)

  return {
    x: space.x + SPACE_INSET,
    y: space.y + SPACE_INSET,
  }
}

function placeAtViewportCenter(
  viewportRef: RefObject<HTMLDivElement | null>,
  size: { width: number; height: number },
): { x: number; y: number } | null {
  const rect = viewportRef.current?.getBoundingClientRect()
  if (!rect) return null
  const { scale, offsetX, offsetY } = useCanvasStore.getState().getViewport()
  return {
    x: (rect.width / 2 - offsetX) / scale - size.width / 2,
    y: (rect.height / 2 - offsetY) / scale - size.height / 2,
  }
}
