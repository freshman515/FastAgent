import { useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'

export function addCanvasCardToActiveSpace(cardId: string): void {
  addCanvasCardToSpace(cardId, useCanvasUiStore.getState().activeSpaceId)
}

export function addCanvasCardToSpace(cardId: string, spaceId: string | null | undefined): void {
  useCanvasStore.getState().addCardToFrame(cardId, spaceId)
}
