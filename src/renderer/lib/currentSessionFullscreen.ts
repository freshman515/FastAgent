import { usePanesStore } from '@/stores/panes'
import { useUIStore } from '@/stores/ui'

// F11 behavior: hide window chrome (title bar / side panels / status bar) and
// let the entire MainPanel — including any splits — occupy the full window.
// We intentionally do NOT set fullscreenPaneId here, so split layouts stay
// intact in fullscreen mode.

export function canToggleCurrentSessionFullscreen(): boolean {
  // Fullscreen is always allowed; the check is kept for menu-visibility API
  // compatibility but no longer requires an active session.
  return true
}

export async function setCurrentSessionFullscreen(enabled: boolean): Promise<void> {
  const uiStore = useUIStore.getState()
  const paneStore = usePanesStore.getState()

  // Clean up any stale single-pane fullscreen state left over from previous
  // versions — F11 now always means "whole main panel fullscreen".
  if (paneStore.fullscreenPaneId) {
    paneStore.exitPaneFullscreen()
  }

  uiStore.setWindowFullscreen(enabled)
  const fullscreen = await window.api.window.setFullscreen(enabled)
  useUIStore.getState().setWindowFullscreen(fullscreen)
}

export async function toggleCurrentSessionFullscreen(): Promise<void> {
  const currentlyEnabled = useUIStore.getState().windowFullscreen
  await setCurrentSessionFullscreen(!currentlyEnabled)
}
