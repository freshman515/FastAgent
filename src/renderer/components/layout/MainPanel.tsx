import { useEffect } from 'react'
import { useEditorsStore } from '@/stores/editors'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useWorktreesStore } from '@/stores/worktrees'
import { SplitContainer } from '@/components/split/SplitContainer'
import { EmptyState } from '@/components/session/EmptyState'

export function MainPanel(): JSX.Element {
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const worktreesLoaded = useWorktreesStore((s) => s._loaded)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const sessions = useSessionsStore((s) => s.sessions)
  const editors = useEditorsStore((s) => s.tabs)
  const activeTabId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const currentLayoutKey = usePanesStore((s) => s.currentProjectId)

  // Keep panes in sync with the selected project/worktree without overwriting
  // an explicit switch that already restored the correct layout.
  useEffect(() => {
    if (!selectedProjectId) return
    if (!worktreesLoaded) return

    const projectWorktrees = worktrees.filter((w) => w.projectId === selectedProjectId)
    const mainWorktree = projectWorktrees.find((w) => w.isMain)
    const layoutWorktree = currentLayoutKey
      ? projectWorktrees.find((w) => w.id === currentLayoutKey)
      : undefined
    const selectedWorktree = selectedWorktreeId
      ? projectWorktrees.find((w) => w.id === selectedWorktreeId)
      : (layoutWorktree ?? mainWorktree)

    if (selectedWorktree) {
      const worktreeSessionIds = sessions
        .filter((s) =>
          s.projectId === selectedProjectId
          && (s.worktreeId === selectedWorktree.id || (!s.worktreeId && selectedWorktree.isMain)),
        )
        .map((s) => s.id)
      const worktreeEditorIds = editors
        .filter((tab) =>
          tab.projectId === selectedProjectId
          && (tab.worktreeId === selectedWorktree.id || (!tab.worktreeId && selectedWorktree.isMain)),
        )
        .map((tab) => tab.id)
      const worktreeTabIds = [...worktreeSessionIds, ...worktreeEditorIds]
      const nextActiveSessionId = activeTabId && worktreeTabIds.includes(activeTabId)
        ? activeTabId
        : (worktreeTabIds[0] ?? null)

      if (currentLayoutKey !== selectedWorktree.id) {
        usePanesStore.getState().switchWorktree(
          selectedWorktree.id,
          worktreeTabIds,
          nextActiveSessionId,
        )
      }
      return
    }

    const projectSessionIds = sessions
      .filter((s) => s.projectId === selectedProjectId)
      .map((s) => s.id)
    const projectEditorIds = editors
      .filter((tab) => tab.projectId === selectedProjectId)
      .map((tab) => tab.id)
    const projectTabIds = [...projectSessionIds, ...projectEditorIds]
    const nextActiveSessionId = activeTabId && projectTabIds.includes(activeTabId)
      ? activeTabId
      : (projectTabIds[0] ?? null)

    if (currentLayoutKey !== selectedProjectId) {
      usePanesStore.getState().switchProject(
        selectedProjectId,
        projectTabIds,
        nextActiveSessionId,
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on project/worktree switch, not on session changes
  }, [selectedProjectId, selectedWorktreeId, currentLayoutKey, worktreesLoaded, worktrees, editors])

  // Sync workspace folders to IDE bridge for Claude Code /ide
  const selectedProject = useProjectsStore((s) => s.projects.find((p) => p.id === s.selectedProjectId))
  useEffect(() => {
    if (selectedProject?.path) {
      window.api.ide.updateWorkspace([selectedProject.path])
    }
  }, [selectedProject?.path])

  // Dynamic window title
  const activeSession = sessions.find((s) => s.id === activeTabId)
  const activeEditor = editors.find((tab) => tab.id === activeTabId)
  useEffect(() => {
    if (activeSession) {
      document.title = `${activeSession.name} — FastAgents`
      return
    }
    if (activeEditor) {
      document.title = `${activeEditor.fileName} — FastAgents`
      return
    }
    document.title = 'FastAgents'
  }, [activeEditor?.fileName, activeEditor?.id, activeSession?.name, activeSession?.id])

  if (!selectedProjectId) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <EmptyState
          title="选择项目"
          description="从侧栏选择一个项目来管理其代理会话。"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-primary)]">
      <SplitContainer projectId={selectedProjectId} />
    </div>
  )
}
