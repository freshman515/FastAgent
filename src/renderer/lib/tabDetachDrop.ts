const PANE_WORKSPACE_ROOT_SELECTOR = '[data-pane-workspace-root="true"]'

export function shouldPopOutTabFromDrop(clientX: number, clientY: number): boolean {
  const inWindow = clientX >= 0 && clientY >= 0
    && clientX <= window.innerWidth && clientY <= window.innerHeight
  if (!inWindow) return true

  const workspaceRoots = document.querySelectorAll(PANE_WORKSPACE_ROOT_SELECTOR)
  if (workspaceRoots.length === 0) return false

  const target = document.elementFromPoint(clientX, clientY)
  return !target?.closest(PANE_WORKSPACE_ROOT_SELECTOR)
}
