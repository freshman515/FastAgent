import { useEffect } from 'react'
import type { CanvasCard } from '@shared/types'
import { cancelViewportAnimation, isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'
import { useUIStore } from '@/stores/ui'

type CanvasNavigationDirection = 'left' | 'right' | 'up' | 'down'

interface CanvasNavigationRect {
  card: CanvasCard
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

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

function getAltArrowDirection(event: KeyboardEvent): CanvasNavigationDirection | null {
  if (
    !event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
  ) {
    return null
  }

  if (event.key === 'ArrowLeft') return 'left'
  if (event.key === 'ArrowRight') return 'right'
  if (event.key === 'ArrowUp') return 'up'
  if (event.key === 'ArrowDown') return 'down'

  const key = event.key.toLowerCase()
  if (key === 'h' || event.code === 'KeyH') return 'left'
  if (key === 'j' || event.code === 'KeyJ') return 'down'
  if (key === 'k' || event.code === 'KeyK') return 'up'
  if (key === 'l' || event.code === 'KeyL') return 'right'
  return null
}

function getCanvasNavigationRect(card: CanvasCard): CanvasNavigationRect {
  const width = Math.max(1, card.width)
  const height = Math.max(1, card.height)
  const left = card.x
  const top = card.y
  const right = left + width
  const bottom = top + height
  return {
    card,
    left,
    right,
    top,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  }
}

function getIntervalOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

function compareCanvasNavigationCandidate(
  a: { beamRank: number; primaryDistance: number; overlapRatio: number; crossGap: number; centerDistance: number },
  b: { beamRank: number; primaryDistance: number; overlapRatio: number; crossGap: number; centerDistance: number },
): number {
  if (a.beamRank !== b.beamRank) return a.beamRank - b.beamRank
  if (a.primaryDistance !== b.primaryDistance) return a.primaryDistance - b.primaryDistance
  if (a.overlapRatio !== b.overlapRatio) return b.overlapRatio - a.overlapRatio
  if (a.crossGap !== b.crossGap) return a.crossGap - b.crossGap
  return a.centerDistance - b.centerDistance
}

function findCanvasNavigationTarget(
  sourceCard: CanvasCard,
  cards: CanvasCard[],
  direction: CanvasNavigationDirection,
): CanvasCard | null {
  const source = getCanvasNavigationRect(sourceCard)
  let best: {
    card: CanvasCard
    beamRank: number
    primaryDistance: number
    overlapRatio: number
    crossGap: number
    centerDistance: number
  } | null = null

  for (const card of cards) {
    if (card.id === sourceCard.id || isCanvasCardHidden(card)) continue
    const candidate = getCanvasNavigationRect(card)
    let primaryDistance = 0
    let overlap = 0
    let overlapBasis = 1
    let crossGap = 0
    let centerDistance = 0

    if (direction === 'left' || direction === 'right') {
      if (direction === 'left' && candidate.centerX >= source.centerX) continue
      if (direction === 'right' && candidate.centerX <= source.centerX) continue
      primaryDistance = direction === 'left'
        ? Math.max(0, source.left - candidate.right)
        : Math.max(0, candidate.left - source.right)
      overlap = getIntervalOverlap(source.top, source.bottom, candidate.top, candidate.bottom)
      overlapBasis = source.height
      crossGap = overlap > 0
        ? 0
        : Math.min(Math.abs(candidate.bottom - source.top), Math.abs(candidate.top - source.bottom))
      centerDistance = Math.abs(candidate.centerX - source.centerX)
    } else {
      if (direction === 'up' && candidate.centerY >= source.centerY) continue
      if (direction === 'down' && candidate.centerY <= source.centerY) continue
      primaryDistance = direction === 'up'
        ? Math.max(0, source.top - candidate.bottom)
        : Math.max(0, candidate.top - source.bottom)
      overlap = getIntervalOverlap(source.left, source.right, candidate.left, candidate.right)
      overlapBasis = source.width
      crossGap = overlap > 0
        ? 0
        : Math.min(Math.abs(candidate.right - source.left), Math.abs(candidate.left - source.right))
      centerDistance = Math.abs(candidate.centerY - source.centerY)
    }

    const next = {
      card,
      beamRank: overlap > 0 ? 0 : 1,
      primaryDistance,
      overlapRatio: Math.min(1, overlap / Math.max(1, overlapBasis)),
      crossGap,
      centerDistance,
    }
    if (!best || compareCanvasNavigationCandidate(next, best) < 0) best = next
  }

  return best?.card ?? null
}

function focusCanvasCardInDirection(direction: CanvasNavigationDirection): boolean {
  const store = useCanvasStore.getState()
  const selection = store.selectedCardIds
  if (selection.length !== 1) return false

  const sourceCard = store.getCard(selection[0])
  if (!sourceCard || isCanvasCardHidden(sourceCard)) return false

  const targetCard = findCanvasNavigationTarget(sourceCard, store.getCards(), direction)
  if (!targetCard) return false

  store.clearFocusReturn()
  store.focusOnCard(targetCard.id)
  return true
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

      const altArrowDirection = getAltArrowDirection(event)
      if (altArrowDirection) {
        if (isEditableFocused()) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        focusCanvasCardInDirection(altArrowDirection)
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
      const layoutLocked = useUIStore.getState().settings.canvasLayoutLocked

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
        if (layoutLocked) return
        if (selection.length === 0) return
        event.preventDefault()
        store.removeCards(selection)
        return
      }

      // Duplicate (notes only)
      if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
        if (layoutLocked) return
        if (selection.length === 0) return
        event.preventDefault()
        store.duplicateCards(selection)
        return
      }

      // Arrow keys — nudge selection
      if (selection.length > 0 && event.key.startsWith('Arrow')) {
        if (layoutLocked) return
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
