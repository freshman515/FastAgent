export interface CurrentTabDragData {
  tabId: string
  sourcePaneId: string
  sourceWindowId: string
}

let active = false
let currentTabDragData: CurrentTabDragData | null = null

function stopGuardSoon(): void {
  window.setTimeout(() => endTabDragGuard(), 0)
}

export function beginTabDragGuard(data?: CurrentTabDragData): void {
  currentTabDragData = data ?? currentTabDragData
  if (active) return
  active = true
  document.body.classList.add('fastagents-tab-dragging')
  window.addEventListener('drop', stopGuardSoon, true)
  window.addEventListener('dragend', stopGuardSoon, true)
}

export function endTabDragGuard(): void {
  if (!active) return
  active = false
  currentTabDragData = null
  document.body.classList.remove('fastagents-tab-dragging')
  window.removeEventListener('drop', stopGuardSoon, true)
  window.removeEventListener('dragend', stopGuardSoon, true)
}

export function getCurrentTabDragData(): CurrentTabDragData | null {
  return currentTabDragData
}
