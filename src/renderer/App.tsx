import { TitleBar } from '@/components/layout/TitleBar'
import { LeftPanel } from '@/components/layout/LeftPanel'
import { MainPanel } from '@/components/layout/MainPanel'
import { StatusBar } from '@/components/layout/StatusBar'
import { RightPanel } from '@/components/layout/RightPanel'
import { ToastContainer } from '@/components/notification/ToastContainer'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { QuickSwitcher } from '@/components/QuickSwitcher'
import { PermissionDialog } from '@/components/permission/PermissionDialog'
import { UpdateDialog } from '@/components/update/UpdateDialog'
import { DetachedApp } from '@/DetachedApp'
import { ensureAnonymousProject } from '@/lib/anonymous-project'
import { switchProjectContext } from '@/lib/project-context'
import { usePanesStore } from '@/stores/panes'
import { useUIStore } from '@/stores/ui'
import { useGroupsStore } from '@/stores/groups'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useTemplatesStore } from '@/stores/templates'
import { useTasksStore } from '@/stores/tasks'
import { useWorktreesStore } from '@/stores/worktrees'
import { detectLanguage, type EditorTab, sanitizeEditorTab, useEditorsStore } from '@/stores/editors'
import { useLaunchesStore } from '@/stores/launches'
import { useClaudeGuiStore } from '@/stores/claudeGui'
import { useActivityMonitor } from '@/hooks/useActivityMonitor'
import { updateAgentStatus } from '@/components/rightpanel/agentRuntime'
import { useCallback, useEffect, useState } from 'react'
import { ANONYMOUS_PROJECT_ID, isClaudeCodeType, type ClaudeGuiEvent } from '@shared/types'
import { toggleCurrentSessionFullscreen } from '@/lib/currentSessionFullscreen'
import { playTaskCompleteSound } from '@/lib/notificationSound'
import { cn } from '@/lib/utils'

interface EditorPathContext {
  projectId: string
  worktreeId?: string
  path: string
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function toRelativePath(filePath: string, rootPath: string): string {
  const normalizedFile = normalizePath(filePath)
  const normalizedRoot = normalizePath(rootPath)
  if (normalizedFile === normalizedRoot) return filePath.split(/[\\/]/).pop() ?? filePath
  if (!normalizedFile.startsWith(`${normalizedRoot}/`)) return filePath
  return filePath.slice(rootPath.length).replace(/^[/\\]/, '') || filePath
}

function isClaudeGuiFileMutatingTool(toolName: string | undefined): boolean {
  return toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'NotebookEdit'
}

function collectFilePaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') ? [value] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFilePaths(item))
  }

  if (!value || typeof value !== 'object') return []

  const record = value as Record<string, unknown>
  const directKeys = ['file_path', 'filePath', 'path']
  const nestedKeys = ['files', 'paths', 'edits', 'changes']

  const directMatches = directKeys.flatMap((key) => collectFilePaths(record[key]))
  const nestedMatches = nestedKeys.flatMap((key) => collectFilePaths(record[key]))

  return [...directMatches, ...nestedMatches]
}

function extractClaudeGuiEditedFiles(event: ClaudeGuiEvent, pendingEditedFiles: Map<string, string[]>): string[] {
  if (event.type === 'tool-use') {
    if (!isClaudeGuiFileMutatingTool(event.toolName)) return []
    const filePaths = Array.from(new Set(collectFilePaths(event.rawInput)))
    if (event.toolUseId && filePaths.length > 0) {
      pendingEditedFiles.set(event.toolUseId, filePaths)
    }
    return []
  }

  if (event.type !== 'tool-result' || !event.toolUseId) return []

  const filePaths = pendingEditedFiles.get(event.toolUseId) ?? []
  pendingEditedFiles.delete(event.toolUseId)
  return event.isError ? [] : filePaths
}

function getEditorPathContexts(rawProjects: unknown[], rawWorktrees: unknown[]): EditorPathContext[] {
  const worktreeContexts = (Array.isArray(rawWorktrees) ? rawWorktrees : [])
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const worktree = entry as Record<string, unknown>
      if (typeof worktree.projectId !== 'string' || typeof worktree.path !== 'string') return []
      return [{
        projectId: worktree.projectId,
        worktreeId: worktree.isMain === true
          ? undefined
          : (typeof worktree.id === 'string' ? worktree.id : undefined),
        path: worktree.path,
      }]
    })

  const existingProjectIds = new Set(worktreeContexts.map((context) => context.projectId))
  const projectContexts = (Array.isArray(rawProjects) ? rawProjects : [])
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const project = entry as Record<string, unknown>
      if (typeof project.id !== 'string' || typeof project.path !== 'string') return []
      if (existingProjectIds.has(project.id)) return []
      return [{ projectId: project.id, path: project.path }]
    })

  return [...worktreeContexts, ...projectContexts]
    .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)
}

function inferEditorContext(filePath: string, contexts: EditorPathContext[]): { projectId: string; worktreeId?: string } | undefined {
  const normalizedFilePath = normalizePath(filePath)
  const match = contexts.find((context) => {
    const normalizedContextPath = normalizePath(context.path)
    return normalizedFilePath === normalizedContextPath || normalizedFilePath.startsWith(`${normalizedContextPath}/`)
  })

  return match ? { projectId: match.projectId, worktreeId: match.worktreeId } : undefined
}

async function filterExistingEditorTabs(
  raw: unknown[],
  rawProjects: unknown[],
  rawWorktrees: unknown[],
): Promise<{ tabs: EditorTab[]; changed: boolean }> {
  const pathContexts = getEditorPathContexts(rawProjects, rawWorktrees)
  let changed = false
  const sanitizedTabs = raw.flatMap((tab) => {
    if (!tab || typeof tab !== 'object') {
      changed = true
      return []
    }
    const filePath = typeof (tab as { filePath?: unknown }).filePath === 'string'
      ? (tab as { filePath: string }).filePath
      : null
    const sanitized = sanitizeEditorTab(
      tab,
      filePath ? inferEditorContext(filePath, pathContexts) : undefined,
    )
    if (!sanitized) {
      changed = true
      return []
    }
    const rawTab = tab as Record<string, unknown>
    if (
      rawTab.language !== sanitized.language
      || rawTab.projectId !== sanitized.projectId
      || rawTab.worktreeId !== sanitized.worktreeId
    ) {
      changed = true
    }
    return [sanitized]
  })

  const existingTabs = (await Promise.all(
    sanitizedTabs.map(async (tab) => {
      try {
        await window.api.fs.readFile(tab.filePath)
        return tab
      } catch {
        changed = true
        return null
      }
    }),
  )).filter((tab): tab is EditorTab => tab !== null)

  return {
    tabs: existingTabs,
    changed,
  }
}

function sanitizePaneSessions(
  rawPaneSessions: unknown,
  rawPaneActiveSession: unknown,
  validTabIds: Set<string>,
): {
  paneSessions: Record<string, string[]>
  paneActiveSession: Record<string, string | null>
  changed: boolean
} {
  const paneSessionsInput = rawPaneSessions && typeof rawPaneSessions === 'object'
    ? rawPaneSessions as Record<string, unknown>
    : {}
  const paneActiveInput = rawPaneActiveSession && typeof rawPaneActiveSession === 'object'
    ? rawPaneActiveSession as Record<string, unknown>
    : {}

  const paneSessions: Record<string, string[]> = {}
  const paneActiveSession: Record<string, string | null> = {}
  let changed = false

  for (const [paneId, value] of Object.entries(paneSessionsInput)) {
    const sessionIds = Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : []
    const validSessionIds = sessionIds.filter((id) => validTabIds.has(id))
    const rawActiveSession = paneActiveInput[paneId]
    const activeSession = typeof rawActiveSession === 'string' && validSessionIds.includes(rawActiveSession)
      ? rawActiveSession
      : (validSessionIds[0] ?? null)

    if (!Array.isArray(value) || sessionIds.length !== value.length || validSessionIds.length !== sessionIds.length) {
      changed = true
    }
    if (rawActiveSession !== activeSession) {
      changed = true
    }

    paneSessions[paneId] = validSessionIds
    paneActiveSession[paneId] = activeSession
  }

  return { paneSessions, paneActiveSession, changed }
}

function sanitizePanesConfig(raw: unknown, validTabIds: Set<string>): { panes: Record<string, unknown> | null; changed: boolean } {
  if (!raw || typeof raw !== 'object') return { panes: null, changed: false }
  const panes = raw as Record<string, unknown>
  if (!panes.root || !panes.paneSessions) return { panes: null, changed: false }

  const { paneSessions, paneActiveSession, changed: currentChanged } = sanitizePaneSessions(
    panes.paneSessions,
    panes.paneActiveSession,
    validTabIds,
  )

  const rawProjectLayouts = panes.projectLayouts && typeof panes.projectLayouts === 'object'
    ? panes.projectLayouts as Record<string, unknown>
    : {}
  const projectLayouts: Record<string, unknown> = {}
  let changed = currentChanged

  for (const [layoutKey, layoutValue] of Object.entries(rawProjectLayouts)) {
    if (!layoutValue || typeof layoutValue !== 'object') {
      changed = true
      continue
    }

    const layout = layoutValue as Record<string, unknown>
    const { paneSessions: layoutPaneSessions, paneActiveSession: layoutActiveSession, changed: layoutChanged } = sanitizePaneSessions(
      layout.paneSessions,
      layout.paneActiveSession,
      validTabIds,
    )

    if (layoutChanged) {
      changed = true
    }

    projectLayouts[layoutKey] = {
      ...layout,
      paneSessions: layoutPaneSessions,
      paneActiveSession: layoutActiveSession,
    }
  }

  return {
    panes: {
      ...panes,
      paneSessions,
      paneActiveSession,
      projectLayouts,
    },
    changed,
  }
}

export function App(): JSX.Element {
  // If this window is a detached pop-out, render the detached UI instead
  if (window.api.detach.isDetached) {
    return <DetachedApp />
  }

  const [ready, setReady] = useState(false)

  // Load config from file on startup
  useEffect(() => {
    let disposed = false

    void (async () => {
      const data = await window.api.config.read()
      const rawWorktrees = (data as Record<string, unknown>).worktrees as unknown[] ?? []
      const validWorktreeIds = new Set(
        (Array.isArray(rawWorktrees) ? rawWorktrees : [])
          .map((worktree) => (worktree && typeof worktree === 'object' && typeof (worktree as { id?: unknown }).id === 'string')
            ? (worktree as { id: string }).id
            : null)
          .filter((id): id is string => id !== null),
      )

      const rawSessions = Array.isArray(data.sessions) ? data.sessions : []
      const sanitizedSessions = rawSessions.filter((session) => {
        if (!session || typeof session !== 'object') return true
        const worktreeId = (session as { worktreeId?: unknown }).worktreeId
        return typeof worktreeId !== 'string' || validWorktreeIds.has(worktreeId)
      })
      const removedInvalidSessions = sanitizedSessions.length !== rawSessions.length
      const rawEditors = Array.isArray((data as Record<string, unknown>).editors)
        ? (data as Record<string, unknown>).editors as unknown[]
        : []
      const { tabs: sanitizedEditors, changed: removedInvalidEditors } = await filterExistingEditorTabs(
        rawEditors,
        data.projects,
        rawWorktrees,
      )

      if (disposed) return

      useGroupsStore.getState()._loadFromConfig(data.groups)
      useProjectsStore.getState()._loadFromConfig(data.projects)
      useSessionsStore.getState()._loadFromConfig(sanitizedSessions)
      useEditorsStore.getState()._loadFromConfig(sanitizedEditors)
      useUIStore.getState()._loadSettings(data.ui, (data as Record<string, unknown>).customThemes as Record<string, unknown> | undefined)
      useTemplatesStore.getState()._loadFromConfig((data as Record<string, unknown>).templates as unknown[] ?? [])
      useTasksStore.getState()._loadFromConfig({ activeTasks: (data as Record<string, unknown>).activeTasks as unknown[] ?? [] })
      useWorktreesStore.getState()._loadFromConfig(rawWorktrees)
      useLaunchesStore.getState()._loadFromConfig((data as Record<string, unknown>).launches as unknown[] ?? [])
      useClaudeGuiStore.getState()._loadFromConfig((data as Record<string, unknown>).claudeGui as Record<string, unknown> ?? {})

      const hasAnonymousProjectData = sanitizedSessions.some((session) =>
        session && typeof session === 'object' && (session as { projectId?: unknown }).projectId === ANONYMOUS_PROJECT_ID,
      ) || (Array.isArray(data.projects) && data.projects.some((project) =>
        project && typeof project === 'object' && (project as { id?: unknown }).id === ANONYMOUS_PROJECT_ID,
      ))

      if (hasAnonymousProjectData) {
        await ensureAnonymousProject()
      }

      const validSessionIds = sanitizedSessions
        .map((session) => (session && typeof session === 'object' && typeof (session as { id?: unknown }).id === 'string')
          ? (session as { id: string }).id
          : null)
        .filter((id): id is string => id !== null)
      const validTabIds = new Set<string>([...validSessionIds, ...sanitizedEditors.map((tab) => tab.id)])
      const { panes: sanitizedPanes, changed: removedInvalidPaneTabs } = sanitizePanesConfig(data.panes, validTabIds)

      // Restore pane layout if saved
      if (!removedInvalidSessions && sanitizedPanes) {
        usePanesStore.getState().loadFromConfig(sanitizedPanes)
      }

      if (removedInvalidEditors) {
        window.api.config.write('editors', sanitizedEditors)
      }

      if (removedInvalidSessions) {
        window.api.config.write('sessions', sanitizedSessions)
        window.api.config.write('panes', {})
      } else if (removedInvalidPaneTabs && sanitizedPanes) {
        window.api.config.write('panes', sanitizedPanes)
      }

      // Restore the last visible context from the saved pane layout instead of
      // defaulting to the first session in the flat session list.
      const paneStore = usePanesStore.getState()
      const sessionStore = useSessionsStore.getState()
      const editorStore = useEditorsStore.getState()
      const projectStore = useProjectsStore.getState()
      const worktreeStore = useWorktreesStore.getState()

      const restoreCandidates = [
        paneStore.paneActiveSession[paneStore.activePaneId] ?? null,
        ...(paneStore.paneSessions[paneStore.activePaneId] ?? []),
        ...Object.values(paneStore.paneSessions).flat(),
        sessionStore.activeSessionId,
      ].filter((id): id is string => typeof id === 'string')

      const restoredSession = restoreCandidates
        .map((sessionId) => sessionStore.sessions.find((session) => session.id === sessionId))
        .find((session): session is NonNullable<typeof sessionStore.sessions[number]> => Boolean(session))
      const restoredEditor = restoreCandidates
        .map((tabId) => editorStore.tabs.find((tab) => tab.id === tabId))
        .find((tab): tab is NonNullable<typeof editorStore.tabs[number]> => Boolean(tab))

      if (restoredSession) {
        projectStore.selectProject(restoredSession.projectId)
        worktreeStore.selectWorktree(
          restoredSession.worktreeId
          ?? worktreeStore.getMainWorktree(restoredSession.projectId)?.id
          ?? null,
        )
        sessionStore.setActive(restoredSession.id)

        const paneId = paneStore.findPaneForSession(restoredSession.id)
        if (paneId) {
          paneStore.setActivePaneId(paneId)
          paneStore.setPaneActiveSession(paneId, restoredSession.id)
        }
      } else if (restoredEditor) {
        projectStore.selectProject(restoredEditor.projectId)
        worktreeStore.selectWorktree(
          restoredEditor.worktreeId
          ?? worktreeStore.getMainWorktree(restoredEditor.projectId)?.id
          ?? null,
        )

        const paneId = paneStore.findPaneForSession(restoredEditor.id)
        if (paneId) {
          paneStore.setActivePaneId(paneId)
          paneStore.setPaneActiveSession(paneId, restoredEditor.id)
        }
      }

      setReady(true)
    })()

    return () => {
      disposed = true
    }
  }, [])

  useActivityMonitor()
  const activePaneTabId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)

  useEffect(() => {
    const sessionStore = useSessionsStore.getState()

    if (!activePaneTabId || activePaneTabId.startsWith('editor-')) {
      if (sessionStore.activeSessionId !== null) {
        sessionStore.setActive(null)
      }
      return
    }

    if (sessionStore.activeSessionId !== activePaneTabId) {
      sessionStore.setActive(activePaneTabId)
    }
    sessionStore.markAsRead(activePaneTabId)
  }, [activePaneTabId])

  useEffect(() => {
    const pendingEditedFiles = new Map<string, string[]>()
    return window.api.claudeGui.onEvent((event) => {
      useClaudeGuiStore.getState().applyEvent(event)

      if (event.type === 'tool-use' && event.toolUseId && isClaudeGuiFileMutatingTool(event.toolName)) {
        const filePaths = Array.from(new Set(collectFilePaths(event.rawInput)))
        const conversation = useClaudeGuiStore.getState().conversations.find((item) => item.id === event.conversationId)
        if (conversation && filePaths.length > 0) {
          void Promise.all(
            filePaths.map(async (filePath) => {
              try {
                const beforeContent = await window.api.fs.readFile(filePath)
                return {
                  filePath,
                  relativePath: toRelativePath(filePath, conversation.cwd),
                  fileName: filePath.split(/[\\/]/).pop() ?? filePath,
                  language: detectLanguage(filePath.split(/[\\/]/).pop() ?? filePath),
                  beforeContent,
                }
              } catch {
                return null
              }
            }),
          ).then((files) => {
            const snapshotFiles = files.filter((item): item is NonNullable<typeof item> => item !== null)
            if (snapshotFiles.length === 0) return
            useClaudeGuiStore.getState().capturePatchSnapshot({
              conversationId: event.conversationId,
              requestId: event.requestId,
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              createdAt: Date.now(),
              files: snapshotFiles,
            })
          })
        }
      }

      if (event.type === 'tool-result' && event.toolUseId) {
        const snapshot = useClaudeGuiStore.getState().pendingPatchSnapshots[event.toolUseId]
        if (snapshot) {
          void Promise.all(
            snapshot.files.map(async (file) => {
              try {
                const afterContent = await window.api.fs.readFile(file.filePath)
                return {
                  filePath: file.filePath,
                  afterContent,
                }
              } catch {
                return null
              }
            }),
          ).then((files) => {
            useClaudeGuiStore.getState().finalizePatchSnapshot({
              conversationId: event.conversationId,
              requestId: event.requestId,
              toolUseId: event.toolUseId,
              isError: event.isError === true,
              files: files.filter((item): item is NonNullable<typeof item> => item !== null),
            })
          })
        }
      }

      const editedFiles = extractClaudeGuiEditedFiles(event, pendingEditedFiles)
      for (const filePath of editedFiles) {
        window.dispatchEvent(new CustomEvent('fastagents:file-saved', {
          detail: { filePath },
        }))
      }
    })
  }, [])

  // Listen for Claude Code status-line updates (model, context, cost)
  useEffect(() => {
    return window.api.session.onStatusUpdate((data) => {
      if (!data.sessionId) return
      updateAgentStatus(data.sessionId, {
        model: typeof data.model === 'string' ? data.model : null,
        contextWindow: data.contextWindow && typeof data.contextWindow === 'object'
          ? data.contextWindow as { used: number; total: number; percentage: number }
          : null,
        cost: data.cost && typeof data.cost === 'object'
          ? data.cost as { total: string; session: string }
          : null,
        workspace: data.workspace && typeof data.workspace === 'object'
          ? data.workspace as { current_dir: string }
          : null,
      })
    })
  }, [])

  // Keep session runtime state correct even when the owning TerminalView is
  // unmounted (for example during project/worktree switches).
  useEffect(() => {
    return window.api.session.onExit((event) => {
      const sessionStore = useSessionsStore.getState()
      const session = sessionStore.sessions.find((item) => item.ptyId === event.ptyId)
      if (!session) return
      sessionStore.updateSession(session.id, {
        ptyId: null,
        ...(isClaudeCodeType(session.type) && typeof event.resumeUUID === 'string' && event.resumeUUID
          ? { resumeUUID: event.resumeUUID }
          : {}),
      })
      sessionStore.updateStatus(session.id, 'stopped')
    })
  }, [])

  useEffect(() => {
    return window.api.session.onResumeUUIDs((uuids) => {
      const sessionStore = useSessionsStore.getState()
      for (const [sessionId, resumeUUID] of Object.entries(uuids)) {
        if (!resumeUUID) continue
        const session = sessionStore.sessions.find((item) => item.id === sessionId)
        if (!session || session.resumeUUID === resumeUUID) continue
        if (!isClaudeCodeType(session.type)) continue
        sessionStore.updateSession(sessionId, { resumeUUID })
      }
    })
  }, [])

  // Focus a specific session (navigate project + pane + tab)
  const focusSession = useCallback((sessionId: string) => {
    const session = useSessionsStore.getState().sessions.find((s) => s.id === sessionId)
    if (!session) return

    const projectsStore = useProjectsStore.getState()
    const paneStore = usePanesStore.getState()

    // Switch project (restores pane layout) if needed
    if (projectsStore.selectedProjectId !== session.projectId) {
      switchProjectContext(session.projectId, sessionId, session.worktreeId ?? null)
    }

    // Now find and activate the session in the restored pane layout
    const paneId = paneStore.findPaneForSession(sessionId)
    if (paneId) {
      paneStore.setActivePaneId(paneId)
      paneStore.setPaneActiveSession(paneId, sessionId)
    }
  }, [])

  // Listen for session focus requests (from notification click)
  useEffect(() => {
    return window.api.session.onFocus((event) => focusSession(event.sessionId))
  }, [focusSession])

  // Listen for overlay actions (e.g., "Jump to session" clicked in overlay)
  useEffect(() => {
    return window.api.overlay.onAction((raw) => {
      const action = raw as { type: string; sessionId?: string; projectId?: string }
      if (action.type === 'jump' && action.sessionId) {
        focusSession(action.sessionId)
      }
    })
  }, [focusSession])

  // Listen for Claude Code Stop hook — show completion toast
  useEffect(() => {
    return window.api.session.onIdleToast((event) => {
      // sessionId is already matched by HookServer via CWD + last user input
      const session = event.sessionId
        ? useSessionsStore.getState().sessions.find((s) => s.id === event.sessionId)
        : undefined
      const name = session?.name ?? 'Claude Code'
      const { notificationToastEnabled, notificationSoundEnabled, notificationSoundVolume } =
        useUIStore.getState().settings
      if (notificationToastEnabled) {
        useUIStore.getState().addToast({
          title: 'Task completed',
          body: name,
          type: 'success',
          sessionId: session?.id,
          projectId: session?.projectId,
          duration: 8000,
        })
      }
      if (notificationSoundEnabled) {
        playTaskCompleteSound(notificationSoundVolume)
      }
    })
  }, [])

  // Listen for detached window close — re-attach tabs to their original project
  useEffect(() => {
    return window.api.detach.onClosed(({ tabIds, sessions: detachedSessions, editors: detachedEditorsRaw, projectId, worktreeId }) => {
      if (tabIds.length === 0) return
      const detachedEditors = detachedEditorsRaw
        .map((editor) => sanitizeEditorTab(editor))
        .filter((editor): editor is EditorTab => editor !== null)
      useSessionsStore.getState().upsertSessions(detachedSessions)
      useEditorsStore.getState().upsertTabs(detachedEditors)
      const sessStore = useSessionsStore.getState()
      const editorStore = useEditorsStore.getState()
      const paneStore = usePanesStore.getState()
      const projectsStore = useProjectsStore.getState()
      const firstSession = detachedSessions.find((session) => tabIds.includes(session.id))
        ?? sessStore.sessions.find((session) => tabIds.includes(session.id))
      const firstEditor = detachedEditors.find((editor) => tabIds.includes(editor.id))
        ?? editorStore.tabs.find((editor) => tabIds.includes(editor.id))
      const targetProjectId = projectId ?? firstSession?.projectId ?? firstEditor?.projectId ?? null
      const targetWorktreeId = worktreeId ?? firstSession?.worktreeId ?? firstEditor?.worktreeId ?? null

      if (!targetProjectId) return

      const selectedWorktreeId = useWorktreesStore.getState().selectedWorktreeId
      const needsContextSwitch = projectsStore.selectedProjectId !== targetProjectId
        || (targetWorktreeId ?? null) !== (selectedWorktreeId ?? null)

      if (needsContextSwitch) {
        switchProjectContext(targetProjectId, tabIds[0] ?? null, targetWorktreeId)
      }

      // Always ensure returning tabs are in the active pane
      const fresh = usePanesStore.getState()
      const findLeaf = (node: { type: string; id: string; first?: unknown }): string =>
        node.type === 'leaf' ? node.id : findLeaf(node.first as typeof node)
      const paneId = findLeaf(fresh.root)
      for (const tabId of tabIds) {
        usePanesStore.getState().addSessionToPane(paneId, tabId)
      }
      usePanesStore.getState().setPaneActiveSession(paneId, tabIds[0] ?? null)
      if (tabIds[0] && !tabIds[0].startsWith('editor-')) {
        useSessionsStore.getState().setActive(tabIds[0])
      }
    })
  }, [])

  // Capture F11 before focused terminals/editors consume it.
  useEffect(() => {
    const handleF11 = (e: KeyboardEvent): void => {
      if (e.key !== 'F11') return
      e.preventDefault()
      e.stopPropagation()
      void toggleCurrentSessionFullscreen()
    }

    window.addEventListener('keydown', handleF11, true)
    return () => window.removeEventListener('keydown', handleF11, true)
  }, [])

  // Global keyboard shortcuts — operate on the active pane
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const sessStore = useSessionsStore.getState()
      const paneStore = usePanesStore.getState()
      const activePaneId = paneStore.activePaneId
      const paneSessions = paneStore.paneSessions[activePaneId] ?? []
      const activeSessionId = paneStore.paneActiveSession[activePaneId] ?? null

      // Ctrl+Shift+T — restore last closed
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        sessStore.restoreLastClosed()
        // Add restored session to active pane
        const restored = useSessionsStore.getState()
        const newest = restored.sessions[restored.sessions.length - 1]
        if (newest) paneStore.addSessionToPane(activePaneId, newest.id)
        return
      }

      // Ctrl+W — close active tab in active pane
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (activeSessionId) {
          if (activeSessionId.startsWith('editor-')) {
            const editorTab = useEditorsStore.getState().getTab(activeSessionId)
            if (editorTab?.modified) return
            paneStore.removeSessionFromPane(activePaneId, activeSessionId)
            useEditorsStore.getState().closeTab(activeSessionId)
            return
          }
          const session = sessStore.sessions.find((s) => s.id === activeSessionId)
          if (session?.pinned) return
          if (session?.ptyId) window.api.session.kill(session.ptyId)
          paneStore.removeSessionFromPane(activePaneId, activeSessionId)
          sessStore.removeSession(activeSessionId)
        }
        return
      }

      // Ctrl+Alt+Arrow — navigate between panes
      if (e.ctrlKey && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : 'down'
        paneStore.navigatePane(dir)
        return
      }

      // Ctrl+1~9 — jump to Nth tab in active pane
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = Number(e.key) - 1
        if (idx < paneSessions.length) {
          paneStore.setPaneActiveSession(activePaneId, paneSessions[idx])
        }
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    window.api.window.isFullscreen().then((fullscreen) => {
      useUIStore.getState().setWindowFullscreen(fullscreen)
    }).catch(() => {})
  }, [])

  const fullscreenPaneId = usePanesStore((s) => s.fullscreenPaneId)
  const windowFullscreen = useUIStore((s) => s.windowFullscreen)

  useEffect(() => {
    if (!windowFullscreen && fullscreenPaneId) {
      usePanesStore.getState().exitPaneFullscreen()
    }
  }, [fullscreenPaneId, windowFullscreen])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
      </div>
    )
  }

  // In fullscreen mode (F11 or OS fullscreen) AND when no single pane is
  // specifically maximized, we hide all chrome but keep the main panel —
  // including any splits — stretched to the whole window.
  const hideChrome = windowFullscreen || Boolean(fullscreenPaneId)

  return (
    <div className="flex h-full flex-col bg-[var(--color-titlebar-bg)]">
      {!hideChrome && <TitleBar />}
      <div className={cn(
        'flex flex-1 overflow-hidden',
        !hideChrome && 'gap-[var(--layout-gap)] p-[var(--layout-gap)]',
      )}>
        {!hideChrome && <LeftPanel />}

        {/* Main panel */}
        <div className={cn(
          'flex-1 overflow-hidden',
          !hideChrome && 'rounded-[var(--radius-panel)]',
        )}>
          <MainPanel />
        </div>

        {/* Right panel */}
        {!hideChrome && <RightPanel />}
      </div>

      {/* Status bar */}
      {!hideChrome && (
        <div className="px-[var(--layout-gap)] pb-[var(--layout-gap)]">
          <StatusBar />
        </div>
      )}

      {/* Settings dialog */}
      <SettingsDialog />

      {/* Quick switcher */}
      <QuickSwitcher />

      {/* Permission dialogs */}
      <PermissionDialog />

      {/* Auto-updater dialog */}
      <UpdateDialog />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}
