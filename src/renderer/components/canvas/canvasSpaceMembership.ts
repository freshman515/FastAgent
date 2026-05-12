import type { CanvasCard } from '@shared/types'
import { getDefaultCanvasCardSize, useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'

const SPACE_MEMBER_PADDING = 56

export function addCanvasCardToActiveSpace(cardId: string): void {
  addCanvasCardToSpace(cardId, useCanvasUiStore.getState().activeSpaceId)
}

export function addCanvasCardToSpace(cardId: string, spaceId: string | null | undefined): void {
  if (!spaceId || spaceId === cardId) return

  const store = useCanvasStore.getState()
  const space = store.getCard(spaceId)
  const card = store.getCard(cardId)
  if (!space || space.kind !== 'frame' || !card || card.kind === 'frame') return

  const memberIds = Array.from(new Set([...(space.frameMemberIds ?? []), cardId]))
  store.updateCard(spaceId, {
    ...getSpaceRectIncludingCard(space, card),
    collapsed: false,
    expandedWidth: undefined,
    expandedHeight: undefined,
    frameMemberIds: memberIds,
  })
}

function getSpaceRectIncludingCard(space: CanvasCard, card: CanvasCard): Pick<CanvasCard, 'x' | 'y' | 'width' | 'height'> {
  const frameSize = getDefaultCanvasCardSize('frame')
  const minX = Math.min(space.x, card.x - SPACE_MEMBER_PADDING)
  const minY = Math.min(space.y, card.y - SPACE_MEMBER_PADDING)
  const maxX = Math.max(space.x + space.width, card.x + card.width + SPACE_MEMBER_PADDING)
  const maxY = Math.max(space.y + space.height, card.y + card.height + SPACE_MEMBER_PADDING)

  return {
    x: minX,
    y: minY,
    width: Math.max(frameSize.width, maxX - minX),
    height: Math.max(frameSize.height, maxY - minY),
  }
}
