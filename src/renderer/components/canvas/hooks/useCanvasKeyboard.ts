import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'

/**
 * Canvas-specific keyboard shortcuts. Attached to `window` but scoped to the
 * passed-in viewport element — listeners bail out when focus is inside an
 * editable region (note textarea, terminal xterm input, etc.).
 */
export function useCanvasKeyboard(viewportEl: HTMLDivElement | null): void {
  useEffect(() => {
    if (!viewportEl) return

    const isTextInputFocused = (): boolean => {
      const active = document.activeElement
      if (!active) return false
      if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return true
      if ((active as HTMLElement).isContentEditable) return true
      // xterm uses a hidden textarea under .xterm-helper-textarea for input.
      if (active.closest('.xterm')) return true
      return false
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextInputFocused()) return
      const store = useCanvasStore.getState()
      const selection = store.selectedCardIds

      // Select all
      if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        const all = store.getCards().map((c) => c.id)
        store.setSelection(all)
        return
      }

      // Clear selection
      if (event.key === 'Escape') {
        if (selection.length > 0) {
          event.preventDefault()
          store.clearSelection()
        }
        return
      }

      // Delete selected (note cards: silent; session cards: skipped — must use menu)
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.length === 0) return
        event.preventDefault()
        const cards = store.getCards()
        const removableIds = selection.filter((id) => {
          const card = cards.find((c) => c.id === id)
          return card?.kind === 'note'
        })
        if (removableIds.length > 0) store.removeCards(removableIds)
        return
      }

      // Duplicate (notes only)
      if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
        if (selection.length === 0) return
        event.preventDefault()
        store.duplicateCards(selection)
        return
      }

      // Arrow keys — nudge selection
      if (selection.length > 0 && event.key.startsWith('Arrow')) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        let dx = 0, dy = 0
        if (event.key === 'ArrowLeft') dx = -step
        if (event.key === 'ArrowRight') dx = step
        if (event.key === 'ArrowUp') dy = -step
        if (event.key === 'ArrowDown') dy = step
        store.moveCards(selection, dx, dy)
        return
      }

      // Zoom
      if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault()
        store.resetViewport()
        return
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === '+' || event.key === '=')) {
        event.preventDefault()
        const { scale, offsetX, offsetY } = store.getViewport()
        store.setViewport({ scale: scale * 1.15, offsetX, offsetY })
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '-') {
        event.preventDefault()
        const { scale, offsetX, offsetY } = store.getViewport()
        store.setViewport({ scale: scale / 1.15, offsetX, offsetY })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewportEl])
}
