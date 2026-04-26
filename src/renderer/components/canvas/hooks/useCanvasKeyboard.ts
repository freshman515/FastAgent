import { useEffect } from 'react'
import { cancelViewportAnimation, useCanvasStore } from '@/stores/canvas'

function getAltBookmarkIndex(event: KeyboardEvent): number | null {
  if (
    !event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
  ) {
    return null
  }

  if (/^[1-9]$/.test(event.key)) return Number(event.key) - 1

  const digitMatch = event.code.match(/^Digit([1-9])$/)
  if (digitMatch) return Number(digitMatch[1]) - 1

  const numpadMatch = event.code.match(/^Numpad([1-9])$/)
  if (numpadMatch) return Number(numpadMatch[1]) - 1

  return null
}

function isAltFitAllShortcut(event: KeyboardEvent): boolean {
  return (
    event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && (event.key.toLowerCase() === 'a' || event.code === 'KeyA')
  )
}

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

    const isEditableFocused = (): boolean => {
      const active = document.activeElement
      if (!active) return false
      const activeElement = active as HTMLElement
      if (activeElement.closest('.xterm')) return false
      if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return true
      if (activeElement.isContentEditable) return true
      return false
    }

    const fitAllToViewport = (): void => {
      const rect = viewportEl.getBoundingClientRect()
      if (!rect) return
      cancelViewportAnimation()
      useCanvasStore.getState().fitAll(rect.width, rect.height)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const store = useCanvasStore.getState()
      const bookmarkIndex = getAltBookmarkIndex(event)

      if (bookmarkIndex !== null) {
        if (isEditableFocused()) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        cancelViewportAnimation()
        const bookmark = store.getLayout().bookmarks[bookmarkIndex]
        if (bookmark) store.goToBookmark(bookmark.id)
        return
      }

      if (isAltFitAllShortcut(event)) {
        if (isEditableFocused()) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        fitAllToViewport()
        return
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (!store.canUndo() || isEditableFocused()) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        store.undo()
        return
      }

      if (isTextInputFocused()) return
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

      // Delete selected cards from the canvas. Session cards are detached from
      // the canvas only; ending a running session still goes through the menu.
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.length === 0) return
        event.preventDefault()
        store.removeCards(selection)
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

    window.api.shortcuts.setCanvasBookmarkShortcutsActive(true)
    const unsubscribeCanvasBookmarkShortcut = window.api.shortcuts.onCanvasBookmarkShortcut((bookmarkIndex) => {
      if (isEditableFocused()) return
      const store = useCanvasStore.getState()
      const bookmark = store.getLayout().bookmarks[bookmarkIndex]
      if (bookmark) {
        cancelViewportAnimation()
        store.goToBookmark(bookmark.id)
      }
    })
    const unsubscribeCanvasFitAllShortcut = window.api.shortcuts.onCanvasFitAllShortcut(() => {
      if (isEditableFocused()) return
      fitAllToViewport()
    })

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.api.shortcuts.setCanvasBookmarkShortcutsActive(false)
      unsubscribeCanvasBookmarkShortcut()
      unsubscribeCanvasFitAllShortcut()
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [viewportEl])
}
