import { isCanvasCardHidden, resolveCanvasLayoutKey, useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { useWorktreesStore } from '@/stores/worktrees'
import { switchProjectContext } from '@/lib/project-context'
import { isTerminalSessionType } from '@shared/types'

function focusCanvasCardSoon(cardId: string): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      useCanvasStore.getState().focusOnCard(cardId)
    })
  })
}

export function focusCanvasSessionTarget(sessionId: string): boolean {
  const session = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
  if (!session) return false

  const panes = usePanesStore.getState()
  const canvas = useCanvasStore.getState()
  const layoutKey = resolveCanvasLayoutKey(panes.workspaceMode, panes.currentProjectId)
  canvas.setActiveLayout(layoutKey)

  const refreshedCanvas = useCanvasStore.getState()
  let card = refreshedCanvas.getCards().find((candidate) => candidate.refId === sessionId)
  let cardId = card?.id ?? null

  if (!cardId) {
    cardId = refreshedCanvas.attachSession(
      sessionId,
      isTerminalSessionType(session.type) ? 'terminal' : 'session',
    )
    card = useCanvasStore.getState().getCard(cardId)
  }

  if (!cardId) return false
  const latestCard = card ?? useCanvasStore.getState().getCard(cardId)
  if (latestCard && isCanvasCardHidden(latestCard)) {
    useCanvasStore.getState().updateCard(cardId, { hidden: false, hiddenByFrameId: undefined })
  }
  useCanvasStore.getState().clearMaximizedCard()
  useCanvasStore.getState().clearFocusReturn()
  focusCanvasCardSoon(cardId)
  return true
}

function getTargetWorktreeId(projectId: string, sessionWorktreeId?: string): string | null {
  const worktrees = useWorktreesStore.getState()
  if (sessionWorktreeId) return sessionWorktreeId
  return worktrees.getMainWorktree(projectId)?.id ?? null
}

export function focusSessionTarget(sessionId: string): boolean {
  const session = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
  if (!session) return false

  const projects = useProjectsStore.getState()
  const worktrees = useWorktreesStore.getState()
  const targetWorktreeId = getTargetWorktreeId(session.projectId, session.worktreeId)
  const selectedWorktreeId = worktrees.selectedWorktreeId ?? null
  const needsContextSwitch = projects.selectedProjectId !== session.projectId
    || selectedWorktreeId !== targetWorktreeId

  if (needsContextSwitch) {
    switchProjectContext(session.projectId, sessionId, session.worktreeId ?? null)
  }

  const paneStore = usePanesStore.getState()
  const paneId = paneStore.findPaneForSession(sessionId)
  if (paneId) {
    paneStore.setActivePaneId(paneId)
    paneStore.setPaneActiveSession(paneId, sessionId)
  }
  useSessionsStore.getState().setActive(sessionId)
  useSessionsStore.getState().markAsRead(sessionId)
  if (useUIStore.getState().settings.workspaceLayout === 'canvas') {
    useCanvasUiStore.getState().requestSessionFocus(sessionId)
    focusCanvasSessionTarget(sessionId)
  }
  return true
}
