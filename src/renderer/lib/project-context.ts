import type { Worktree } from '@shared/types'
import { useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useWorktreesStore } from '@/stores/worktrees'

function resolveProjectWorktree(projectId: string, preferredWorktreeId?: string | null): Worktree | undefined {
  const wtStore = useWorktreesStore.getState()

  if (preferredWorktreeId === null) {
    return wtStore.getMainWorktree(projectId)
  }

  if (preferredWorktreeId) {
    const preferred = wtStore.worktrees.find((w) => w.id === preferredWorktreeId && w.projectId === projectId)
    if (preferred) return preferred
  }

  const selected = wtStore.selectedWorktreeId
    ? wtStore.worktrees.find((w) => w.id === wtStore.selectedWorktreeId && w.projectId === projectId)
    : undefined
  if (selected) return selected

  return wtStore.getMainWorktree(projectId)
}

function matchesContext(worktree: Worktree | undefined, tabWorktreeId: string | undefined): boolean {
  if (!worktree) return true
  return tabWorktreeId === worktree.id || (!tabWorktreeId && worktree.isMain)
}

function getContextTabIds(projectId: string, worktree?: Worktree): string[] {
  const sessionIds = useSessionsStore.getState().sessions
    .filter((session) => {
      if (session.projectId !== projectId) return false
      return matchesContext(worktree, session.worktreeId)
    })
    .map((session) => session.id)

  const editorIds = useEditorsStore.getState().tabs
    .filter((tab) => {
      if (tab.projectId !== projectId) return false
      return matchesContext(worktree, tab.worktreeId)
    })
    .map((tab) => tab.id)

  return [...sessionIds, ...editorIds]
}

export function getDefaultWorktreeIdForProject(projectId: string): string | undefined {
  const worktree = resolveProjectWorktree(projectId)
  if (!worktree || worktree.isMain) return undefined
  return worktree.id
}

export function switchProjectContext(
  projectId: string,
  preferredSessionId: string | null,
  preferredWorktreeId?: string | null,
): void {
  const projectStore = useProjectsStore.getState()
  const sessionStore = useSessionsStore.getState()
  const paneStore = usePanesStore.getState()
  const wtStore = useWorktreesStore.getState()

  const worktree = resolveProjectWorktree(projectId, preferredWorktreeId)
  const tabIds = getContextTabIds(projectId, worktree)
  const nextActiveSessionId = preferredSessionId && tabIds.includes(preferredSessionId)
    ? preferredSessionId
    : (tabIds[0] ?? null)

  projectStore.selectProject(projectId)
  wtStore.selectWorktree(worktree?.id ?? null)

  if (worktree) {
    paneStore.switchWorktree(worktree.id, tabIds, nextActiveSessionId)
  } else {
    paneStore.switchProject(projectId, tabIds, nextActiveSessionId)
  }

  if (nextActiveSessionId) {
    const refreshedPaneStore = usePanesStore.getState()
    const paneId = refreshedPaneStore.findPaneForSession(nextActiveSessionId)
    if (paneId) {
      refreshedPaneStore.setActivePaneId(paneId)
      refreshedPaneStore.setPaneActiveSession(paneId, nextActiveSessionId)
    }
  }

  if (nextActiveSessionId && !nextActiveSessionId.startsWith('editor-')) {
    sessionStore.setActive(nextActiveSessionId)
  }
}
