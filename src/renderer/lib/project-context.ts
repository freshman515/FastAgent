import type { Worktree } from '@shared/types'
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

function getContextSessionIds(projectId: string, worktree?: Worktree): string[] {
  return useSessionsStore.getState().sessions
    .filter((session) => {
      if (session.projectId !== projectId) return false
      if (!worktree) return true
      return session.worktreeId === worktree.id || (!session.worktreeId && worktree.isMain)
    })
    .map((session) => session.id)
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
  const sessionIds = getContextSessionIds(projectId, worktree)
  const nextActiveSessionId = preferredSessionId && sessionIds.includes(preferredSessionId)
    ? preferredSessionId
    : (sessionIds[0] ?? null)

  projectStore.selectProject(projectId)
  wtStore.selectWorktree(worktree?.id ?? null)

  if (worktree) {
    paneStore.switchWorktree(worktree.id, sessionIds, nextActiveSessionId)
  } else {
    paneStore.switchProject(projectId, sessionIds, nextActiveSessionId)
  }

  if (nextActiveSessionId) {
    sessionStore.setActive(nextActiveSessionId)
  }
}
