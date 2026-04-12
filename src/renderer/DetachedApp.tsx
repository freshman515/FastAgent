import { useCallback, useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'
import { sanitizeEditorTab, useEditorsStore } from '@/stores/editors'
import { SplitContainer } from '@/components/split/SplitContainer'
import type { Session } from '@shared/types'

export function DetachedApp(): JSX.Element {
  const initialTabIds = useRef(window.api.detach.getTabIds()).current
  const windowId = useRef(window.api.detach.getWindowId()).current
  const [ready, setReady] = useState(false)
  const projectIdRef = useRef<string>('')
  const worktreeIdRef = useRef<string | null>(null)

  // Load UI settings, session data, and initialize pane store
  useEffect(() => {
    const init = async (): Promise<void> => {
      const data = await window.api.config.read()
      useUIStore.getState()._loadSettings(data.ui, (data as Record<string, unknown>).customThemes as Record<string, unknown> | undefined)
      useProjectsStore.getState()._loadFromConfig(data.projects)
      useWorktreesStore.getState()._loadFromConfig((data as Record<string, unknown>).worktrees as unknown[] ?? [])

      const sessionData = await window.api.detach.getSessions(windowId)
      for (const raw of sessionData) {
        const s = raw as Session
        if (s.id) {
          if (!projectIdRef.current && s.projectId) {
            projectIdRef.current = s.projectId
          }
          if (!worktreeIdRef.current && s.worktreeId) {
            worktreeIdRef.current = s.worktreeId
          }
          useSessionsStore.setState((state) => ({
            sessions: [...state.sessions.filter((x) => x.id !== s.id), s],
          }))
        }
      }

      const editorData = await window.api.detach.getEditors(windowId)
      const editors = editorData
        .map((raw) => sanitizeEditorTab(raw))
        .filter((tab): tab is NonNullable<ReturnType<typeof sanitizeEditorTab>> => tab !== null)
      if (editors.length > 0) {
        if (!projectIdRef.current && editors[0].projectId) {
          projectIdRef.current = editors[0].projectId
        }
        if (!worktreeIdRef.current && editors[0].worktreeId) {
          worktreeIdRef.current = editors[0].worktreeId
        }
        useEditorsStore.getState().upsertTabs(editors)
      }

      if (projectIdRef.current) {
        useProjectsStore.getState().selectProject(projectIdRef.current)
        const wtStore = useWorktreesStore.getState()
        wtStore.selectWorktree(
          worktreeIdRef.current ?? wtStore.getMainWorktree(projectIdRef.current)?.id ?? null,
        )
      }

      usePanesStore.getState().initPane(initialTabIds, initialTabIds[0] ?? null)
      setReady(true)
    }
    init()
  }, [windowId, initialTabIds])

  const sessions = useSessionsStore((s) => s.sessions)
  const editors = useEditorsStore((s) => s.tabs)

  // Sync live detached tabs to main process so newly created tabs can be restored.
  const paneSessions = usePanesStore((s) => s.paneSessions)
  useEffect(() => {
    if (!ready) return
    const allIds = Object.values(paneSessions).flat()
    const liveSessions = sessions.filter((session) => allIds.includes(session.id))
    const liveEditors = editors.filter((tab) => allIds.includes(tab.id))
    window.api.detach.updateSessionIds(windowId, allIds)
    window.api.detach.updateSessions(windowId, liveSessions)
    window.api.detach.updateEditors(windowId, liveEditors)
    window.api.detach.updateContext(windowId, {
      projectId: projectIdRef.current || liveSessions[0]?.projectId || liveEditors[0]?.projectId || null,
      worktreeId: worktreeIdRef.current ?? liveSessions[0]?.worktreeId ?? liveEditors[0]?.worktreeId ?? null,
    })
  }, [editors, paneSessions, sessions, windowId, ready])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-primary)]">
      <div className="flex-1 overflow-hidden">
        <SplitContainer projectId={projectIdRef.current} />
      </div>
    </div>
  )
}
