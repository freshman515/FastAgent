import { usePanesStore } from '@/stores/panes'
import { useUIStore } from '@/stores/ui'

export function canToggleCurrentSessionFullscreen(): boolean {
  const paneStore = usePanesStore.getState()
  const activePaneId = paneStore.activePaneId
  return Boolean(paneStore.paneActiveSession[activePaneId] ?? paneStore.fullscreenPaneId)
}

export async function setCurrentSessionFullscreen(enabled: boolean): Promise<void> {
  const paneStore = usePanesStore.getState()
  const activePaneId = paneStore.activePaneId
  const activeTabId = paneStore.paneActiveSession[activePaneId] ?? null

  if (enabled) {
    if (!activeTabId) return
    if (paneStore.fullscreenPaneId !== activePaneId) {
      paneStore.togglePaneFullscreen(activePaneId)
    }
    useUIStore.getState().setWindowFullscreen(true)
    const fullscreen = await window.api.window.setFullscreen(true)
    useUIStore.getState().setWindowFullscreen(fullscreen)
    return
  }

  if (paneStore.fullscreenPaneId) {
    paneStore.exitPaneFullscreen()
  }
  useUIStore.getState().setWindowFullscreen(false)
  const fullscreen = await window.api.window.setFullscreen(false)
  useUIStore.getState().setWindowFullscreen(fullscreen)
}

export async function toggleCurrentSessionFullscreen(): Promise<void> {
  const paneStore = usePanesStore.getState()
  const currentlyEnabled = Boolean(paneStore.fullscreenPaneId)
  if (!currentlyEnabled && !canToggleCurrentSessionFullscreen()) return
  await setCurrentSessionFullscreen(!currentlyEnabled)
}
