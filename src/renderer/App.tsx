import { TitleBar } from '@/components/layout/TitleBar'
import { LeftPanel } from '@/components/layout/LeftPanel'
import { MainPanel } from '@/components/layout/MainPanel'
import { StatusBar } from '@/components/layout/StatusBar'
import { RightPanel } from '@/components/layout/RightPanel'
import { ToastContainer } from '@/components/notification/ToastContainer'
import { SessionNamePromptDialog } from '@/components/session/SessionNamePromptDialog'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { QuickSwitcher } from '@/components/QuickSwitcher'
import { PermissionDialog } from '@/components/permission/PermissionDialog'
import { UpdateDialog } from '@/components/update/UpdateDialog'
import { DetachedApp } from '@/DetachedApp'
import { ensureAnonymousProject } from '@/lib/anonymous-project'
import { switchProjectContext } from '@/lib/project-context'
import { getPaneElementRects, getPaneLeafIds, usePanesStore, type PaneElementRect } from '@/stores/panes'
import { useCanvasStore } from '@/stores/canvas'
import { useUIStore } from '@/stores/ui'
import { useGroupsStore } from '@/stores/groups'
import { useSessionGroupsStore } from '@/stores/sessionGroups'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useTemplatesStore } from '@/stores/templates'
import { useTasksStore } from '@/stores/tasks'
import { useWorktreesStore } from '@/stores/worktrees'
import { detectLanguage, type EditorTab, sanitizeEditorTab, useEditorsStore } from '@/stores/editors'
import { useLaunchesStore } from '@/stores/launches'
import { useClaudeGuiStore } from '@/stores/claudeGui'
import { useActivityMonitor } from '@/hooks/useActivityMonitor'
import { useMcpBridge } from '@/hooks/useMcpBridge'
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

type PaneCommandTabGroup = 'terminal' | 'claude' | 'codex' | 'gemini' | 'opencode' | 'browser' | 'file' | 'other'

const PANE_COMMAND_GROUP_ORDER: PaneCommandTabGroup[] = ['terminal', 'claude', 'codex', 'gemini', 'opencode', 'browser', 'file', 'other']

const PANE_COMMAND_SHORTCUTS: Array<{ key: string; label: string }> = [
  { key: 'h/j/k/l', label: '切换 pane' },
  { key: 'Alt+h/l/←/→', label: '切换标签' },
  { key: 'Ctrl+hjkl/方向', label: '调整大小' },
  { key: '1-9', label: '跳到 pane' },
  { key: 'z', label: '放大/恢复' },
  { key: 'e', label: '等分' },
  { key: 't', label: '按类型分屏' },
  { key: 'v/s', label: '右/下分屏' },
  { key: 'x', label: '关闭 pane' },
  { key: 'm', label: '合并全部' },
]

function getPaneCommandGroupForSession(type: string): PaneCommandTabGroup {
  if (type === 'terminal') return 'terminal'
  if (type === 'browser') return 'browser'
  if (type.startsWith('claude')) return 'claude'
  if (type.startsWith('codex')) return 'codex'
  if (type.startsWith('gemini')) return 'gemini'
  if (type.startsWith('opencode')) return 'opencode'
  return 'other'
}

function getPaneCommandSplitKey(tabId: string): string | null {
  if (tabId.startsWith('editor-')) return 'file'
  const session = useSessionsStore.getState().sessions.find((item) => item.id === tabId)
  if (!session) return null
  const group = getPaneCommandGroupForSession(session.type)
  return group === 'other' ? `session:${session.type}` : group
}

function smartSplitPanesByType(activeTabId: string | null): void {
  const paneStore = usePanesStore.getState()
  const orderedIds = getPaneLeafIds(paneStore.root).flatMap((paneId) => paneStore.paneSessions[paneId] ?? [])
  const groupRank = new Map(PANE_COMMAND_GROUP_ORDER.map((group, index) => [group, index]))
  const buckets = new Map<string, { group: PaneCommandTabGroup; firstIndex: number; ids: string[] }>()

  orderedIds.forEach((id, index) => {
    const key = getPaneCommandSplitKey(id)
    if (!key) return
    const group = id.startsWith('editor-')
      ? 'file'
      : getPaneCommandGroupForSession(useSessionsStore.getState().sessions.find((item) => item.id === id)?.type ?? '')
    const existing = buckets.get(key)
    if (existing) {
      existing.ids.push(id)
      return
    }
    buckets.set(key, { group, firstIndex: index, ids: [id] })
  })

  const groups = [...buckets.values()]
    .sort((a, b) => {
      const rankDiff = (groupRank.get(a.group) ?? PANE_COMMAND_GROUP_ORDER.length)
        - (groupRank.get(b.group) ?? PANE_COMMAND_GROUP_ORDER.length)
      return rankDiff || a.firstIndex - b.firstIndex
    })
    .map((bucket) => bucket.ids)

  if (groups.length > 0) paneStore.applyPaneGroups(groups, activeTabId)
}

function activatePaneAndSession(paneId: string): void {
  const paneStore = usePanesStore.getState()
  paneStore.setActivePaneId(paneId)
  const paneSessions = paneStore.paneSessions[paneId] ?? []
  const activeTabId = paneStore.paneActiveSession[paneId] && paneSessions.includes(paneStore.paneActiveSession[paneId]!)
    ? paneStore.paneActiveSession[paneId]
    : (paneSessions[0] ?? null)
  if (activeTabId && !activeTabId.startsWith('editor-')) {
    useSessionsStore.getState().setActive(activeTabId)
  }
}

function switchActivePaneTab(offset: -1 | 1): boolean {
  const paneStore = usePanesStore.getState()
  const paneId = paneStore.activePaneId
  const tabIds = paneStore.paneSessions[paneId] ?? []
  if (tabIds.length < 2) return false

  const activeTabId = paneStore.paneActiveSession[paneId]
  const activeIndex = activeTabId ? tabIds.indexOf(activeTabId) : -1
  const currentIndex = activeIndex >= 0 ? activeIndex : 0
  const nextIndex = (currentIndex + offset + tabIds.length) % tabIds.length
  paneStore.setPaneActiveSession(paneId, tabIds[nextIndex])
  return true
}

function isPlainTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.xterm')) return false
  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable
}

function PaneCommandOverlay({ rects, activePaneId }: { rects: PaneElementRect[]; activePaneId: string }): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 z-[9400]">
      <div className="absolute left-1/2 top-1 z-20 h-8 w-[min(780px,calc(100vw-48px))] -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--color-accent)]/30 bg-[var(--color-bg-tertiary)]/70 px-3 shadow-2xl shadow-black/35 backdrop-blur-md">
        <div className="flex h-full items-center gap-x-3 overflow-hidden whitespace-nowrap">
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-accent)]/16 px-2 py-1 text-[11px] font-bold text-[var(--color-accent)]">
            Pane Mode
          </span>
          <span className="text-[11px] text-[var(--color-text-secondary)]">Esc/q 退出</span>
          {PANE_COMMAND_SHORTCUTS.map((item) => (
            <span key={item.key} className="text-[11px] text-[var(--color-text-secondary)]">
              <span className="font-mono font-bold text-[var(--color-text-primary)]">{item.key}</span>
              <span className="ml-1">{item.label}</span>
            </span>
          ))}
        </div>
      </div>

      {rects.map((rect, index) => {
        const active = rect.paneId === activePaneId
        return (
          <div
            key={rect.paneId}
            className={cn(
              'fixed z-10 rounded-[var(--radius-md)] border-2',
              active
                ? 'border-transparent bg-[var(--color-accent)]/6 shadow-2xl shadow-black/45'
                : 'border-transparent bg-transparent shadow-none',
            )}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          >
            <div className={cn(
              'absolute left-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-sm)] px-2 text-[12px] font-bold shadow-lg',
              active
                ? 'bg-[var(--color-accent)]/80 text-white'
                : 'border border-[var(--color-accent)]/35 bg-[var(--color-bg-tertiary)]/90 text-[var(--color-accent)]',
            )}>
              {index + 1}
            </div>
          </div>
        )
      })}
    </div>
  )
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

  return <MainApp />
}

function MainApp(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [paneCommandMode, setPaneCommandMode] = useState(false)
  const [paneCommandRects, setPaneCommandRects] = useState<PaneElementRect[]>([])
  const paneCommandActivePaneId = usePanesStore((s) => s.activePaneId)
  const paneCommandRoot = usePanesStore((s) => s.root)
  const refreshPaneCommandRects = useCallback(() => {
    const paneStore = usePanesStore.getState()
    setPaneCommandRects(getPaneElementRects(getPaneLeafIds(paneStore.root)))
  }, [])

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
      useSessionGroupsStore.getState()._loadFromConfig((data as Record<string, unknown>).sessionGroups as unknown[] ?? [])
      useProjectsStore.getState()._loadFromConfig(data.projects)
      useSessionsStore.getState()._loadFromConfig(sanitizedSessions)
      useEditorsStore.getState()._loadFromConfig(sanitizedEditors)
      useUIStore.getState()._loadSettings(data.ui, (data as Record<string, unknown>).customThemes as Record<string, unknown> | undefined)
      useTemplatesStore.getState()._loadFromConfig((data as Record<string, unknown>).templates as unknown[] ?? [])
      useTasksStore.getState()._loadFromConfig({ activeTasks: (data as Record<string, unknown>).activeTasks as unknown[] ?? [] })
      useWorktreesStore.getState()._loadFromConfig(rawWorktrees)
      useLaunchesStore.getState()._loadFromConfig((data as Record<string, unknown>).launches as unknown[] ?? [])
      useClaudeGuiStore.getState()._loadFromConfig((data as Record<string, unknown>).claudeGui as Record<string, unknown> ?? {})
      useCanvasStore.getState().loadFromConfig((data as Record<string, unknown>).canvas as Record<string, unknown> ?? {})

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
    const unsubscribe = window.api.claudeGui.onEvent((event) => {
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
        const toolUseId = event.toolUseId
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
              toolUseId,
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

    return () => {
      unsubscribe()
    }
  }, [])

  // Listen for Claude Code status-line updates (model, context, cost)
  useEffect(() => {
    const unsubscribe = window.api.session.onStatusUpdate((data) => {
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

    return () => {
      unsubscribe()
    }
  }, [])

  // Keep session runtime state correct even when the owning TerminalView is
  // unmounted (for example during project/worktree switches).
  useEffect(() => {
    const unsubscribe = window.api.session.onExit((event) => {
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

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.session.onResumeUUIDs((uuids) => {
      const sessionStore = useSessionsStore.getState()
      for (const [sessionId, resumeUUID] of Object.entries(uuids)) {
        if (!resumeUUID) continue
        const session = sessionStore.sessions.find((item) => item.id === sessionId)
        if (!session || session.resumeUUID === resumeUUID) continue
        if (!isClaudeCodeType(session.type)) continue
        sessionStore.updateSession(sessionId, { resumeUUID })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // FastAgents MCP bridge: handle list-sessions and create-session requests
  // coming from the orchestrator HTTP server (Meta-Agent tools).
  useMcpBridge()

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
    const unsubscribe = window.api.session.onFocus((event) => focusSession(event.sessionId))
    return () => {
      unsubscribe()
    }
  }, [focusSession])

  // Listen for overlay actions (e.g., "Jump to session" clicked in overlay)
  useEffect(() => {
    const unsubscribe = window.api.overlay.onAction((raw) => {
      const action = raw as { type: string; sessionId?: string; projectId?: string }
      if (action.type === 'jump' && action.sessionId) {
        focusSession(action.sessionId)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [focusSession])

  // Listen for agent activity events — drive SessionTab status indicator
  useEffect(() => {
    const completionTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const unsubscribe = window.api.session.onActivityStatus((event) => {
      const { setActivity, clearActivity } = useSessionsStore.getState()
      setActivity(event.sessionId, {
        status: event.activity,
        source: event.source,
        ts: event.ts,
      })

      const existingTimer = completionTimers.get(event.sessionId)
      if (existingTimer) {
        clearTimeout(existingTimer)
        completionTimers.delete(event.sessionId)
      }

      if (event.activity === 'completed') {
        // Decay the highlighted completed state back to idle after ~10s
        const timer = setTimeout(() => {
          const current = useSessionsStore.getState().activityStates[event.sessionId]
          if (current?.status === 'completed' && current.ts === event.ts) {
            setActivity(event.sessionId, { status: 'idle', source: event.source, ts: Date.now() })
          }
          completionTimers.delete(event.sessionId)
        }, 10000)
        completionTimers.set(event.sessionId, timer)
      }

      // When session is removed elsewhere we don't know; clearActivity is a safety net
      void clearActivity
    })

    return () => {
      unsubscribe()
      for (const timer of completionTimers.values()) clearTimeout(timer)
      completionTimers.clear()
    }
  }, [])

  // Listen for agent Stop hooks — show completion toast
  useEffect(() => {
    const unsubscribe = window.api.session.onIdleToast((event) => {
      // sessionId is already matched by HookServer via CWD + last user input
      const session = event.sessionId
        ? useSessionsStore.getState().sessions.find((s) => s.id === event.sessionId)
        : undefined
      const name = session?.name ?? 'Agent'
      const project = session
        ? useProjectsStore.getState().projects.find((p) => p.id === session.projectId)
        : undefined
      const body = project ? `${project.name}\n${name}` : name
      const { notificationToastEnabled, notificationSoundEnabled, notificationSoundVolume } =
        useUIStore.getState().settings
      if (notificationToastEnabled) {
        useUIStore.getState().addToast({
          title: 'Task completed',
          body,
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

    return () => {
      unsubscribe()
    }
  }, [])

  // Listen for detached window close — re-attach tabs to their original project
  useEffect(() => {
    const unsubscribe = window.api.detach.onClosed(({ tabIds, sessions: detachedSessions, editors: detachedEditorsRaw, projectId, worktreeId }) => {
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

    return () => {
      unsubscribe()
    }
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

  // Capture Alt+1~9 before terminals/editors consume it.
  useEffect(() => {
    const handlePaneNumberShortcut = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key < '1' || e.key > '9') return
      if (useUIStore.getState().settings.workspaceLayout === 'canvas') return

      const paneStore = usePanesStore.getState()
      const paneId = getPaneLeafIds(paneStore.root)[Number(e.key) - 1]
      if (!paneId) return

      e.preventDefault()
      e.stopPropagation()
      paneStore.setActivePaneId(paneId)

      const targetPaneSessions = paneStore.paneSessions[paneId] ?? []
      const activeTabId = paneStore.paneActiveSession[paneId] && targetPaneSessions.includes(paneStore.paneActiveSession[paneId]!)
        ? paneStore.paneActiveSession[paneId]
        : (targetPaneSessions[0] ?? null)
      if (activeTabId && !activeTabId.startsWith('editor-')) {
        useSessionsStore.getState().setActive(activeTabId)
      }
    }

    window.addEventListener('keydown', handlePaneNumberShortcut, true)
    return () => window.removeEventListener('keydown', handlePaneNumberShortcut, true)
  }, [])

  useEffect(() => {
    if (!paneCommandMode) {
      setPaneCommandRects([])
      return
    }

    refreshPaneCommandRects()
    window.addEventListener('resize', refreshPaneCommandRects)
    return () => window.removeEventListener('resize', refreshPaneCommandRects)
  }, [paneCommandMode, refreshPaneCommandRects])

  useEffect(() => {
    if (!paneCommandMode) return
    const frame = window.requestAnimationFrame(refreshPaneCommandRects)
    return () => window.cancelAnimationFrame(frame)
  }, [paneCommandMode, paneCommandRoot, refreshPaneCommandRects])

  // Alt+F enters a tmux-style pane command mode. While active, single keys
  // operate on panes before terminal/editor content can consume them.
  useEffect(() => {
    let pendingFrame: number | null = null

    const refreshAfterLayout = (): void => {
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame)
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null
        refreshPaneCommandRects()
      })
    }

    const getActiveTab = (): { paneId: string; tabId: string | null; tabIds: string[] } => {
      const paneStore = usePanesStore.getState()
      const paneId = paneStore.activePaneId
      const tabIds = paneStore.paneSessions[paneId] ?? []
      const tabId = paneStore.paneActiveSession[paneId] && tabIds.includes(paneStore.paneActiveSession[paneId]!)
        ? paneStore.paneActiveSession[paneId]
        : (tabIds[0] ?? null)
      return { paneId, tabId, tabIds }
    }

    const runPaneCommand = (key: string): boolean => {
      const paneStore = usePanesStore.getState()
      const normalized = key.length === 1 ? key.toLowerCase() : key

      if (normalized === 'Escape' || normalized === 'q') {
        setPaneCommandMode(false)
        return true
      }

      if (normalized >= '1' && normalized <= '9') {
        const targetPaneId = getPaneLeafIds(paneStore.root)[Number(normalized) - 1]
        if (targetPaneId) {
          activatePaneAndSession(targetPaneId)
          refreshAfterLayout()
        }
        return true
      }

      const direction = normalized === 'h' || normalized === 'ArrowLeft'
        ? 'left'
        : normalized === 'l' || normalized === 'ArrowRight'
          ? 'right'
          : normalized === 'k' || normalized === 'ArrowUp'
            ? 'up'
            : normalized === 'j' || normalized === 'ArrowDown'
              ? 'down'
              : null
      if (direction) {
        paneStore.navigatePane(direction)
        activatePaneAndSession(usePanesStore.getState().activePaneId)
        refreshAfterLayout()
        return true
      }

      if (normalized === 'z') {
        paneStore.togglePaneFullscreen()
        refreshAfterLayout()
        return true
      }

      if (normalized === 'e') {
        paneStore.balanceSplits()
        refreshAfterLayout()
        return true
      }

      if (normalized === 't') {
        const { tabId } = getActiveTab()
        smartSplitPanesByType(tabId)
        refreshAfterLayout()
        return true
      }

      if (normalized === 'm') {
        paneStore.mergeAllPanes()
        activatePaneAndSession(usePanesStore.getState().activePaneId)
        refreshAfterLayout()
        return true
      }

      if (normalized === 'x') {
        const leafIds = getPaneLeafIds(paneStore.root)
        if (leafIds.length > 1) {
          paneStore.mergePane(paneStore.activePaneId)
          activatePaneAndSession(usePanesStore.getState().activePaneId)
          refreshAfterLayout()
        }
        return true
      }

      if (normalized === 'v' || normalized === 's') {
        const { paneId, tabId, tabIds } = getActiveTab()
        if (tabId && tabIds.length > 1) {
          paneStore.splitPane(paneId, normalized === 'v' ? 'right' : 'down', tabId)
          activatePaneAndSession(usePanesStore.getState().activePaneId)
          refreshAfterLayout()
        }
        return true
      }

      return false
    }

    const handlePaneCommandMode = (e: KeyboardEvent): void => {
      const isPrefix = e.altKey
        && !e.ctrlKey
        && !e.metaKey
        && !e.shiftKey
        && (e.key.toLowerCase() === 'f' || e.code === 'KeyF')
      const ui = useUIStore.getState()

      if (isPrefix) {
        if (ui.settings.workspaceLayout === 'canvas' || ui.settingsOpen) return
        e.preventDefault()
        e.stopPropagation()
        setPaneCommandMode((active) => !active)
        refreshAfterLayout()
        return
      }

      if (!paneCommandMode) return

      e.preventDefault()
      e.stopPropagation()
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
        const direction = key === 'ArrowLeft' || key === 'h'
          ? 'left'
          : key === 'ArrowRight' || key === 'l'
            ? 'right'
            : key === 'ArrowUp' || key === 'k'
              ? 'up'
              : key === 'ArrowDown' || key === 'j'
                ? 'down'
                : null
        if (direction) {
          usePanesStore.getState().resizeActivePane(direction)
          refreshAfterLayout()
          return
        }
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
        const offset = key === 'ArrowLeft' || key === 'h'
          ? -1
          : key === 'ArrowRight' || key === 'l'
            ? 1
            : null
        if (offset !== null) {
          switchActivePaneTab(offset)
          return
        }
      }
      runPaneCommand(e.key)
    }

    window.addEventListener('keydown', handlePaneCommandMode, true)
    return () => {
      window.removeEventListener('keydown', handlePaneCommandMode, true)
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame)
    }
  }, [paneCommandMode, refreshPaneCommandRects])

  useEffect(() => {
    const handlePaneTabSwitch = (e: KeyboardEvent): void => {
      if (paneCommandMode) return
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (useUIStore.getState().settings.workspaceLayout === 'canvas' || useUIStore.getState().settingsOpen) return
      if (isPlainTextEditingTarget(e.target)) return

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const offset = key === 'ArrowLeft' || key === 'h'
        ? -1
        : key === 'ArrowRight' || key === 'l'
          ? 1
          : null
      if (offset === null) return
      if (!switchActivePaneTab(offset)) return

      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('keydown', handlePaneTabSwitch, true)
    return () => window.removeEventListener('keydown', handlePaneTabSwitch, true)
  }, [paneCommandMode])

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

      // Ctrl+Shift+M — toggle workspace layout (panes ⇄ canvas)
      if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault()
        const ui = useUIStore.getState()
        const next = ui.settings.workspaceLayout === 'canvas' ? 'panes' : 'canvas'
        ui.updateSettings({ workspaceLayout: next })
        ui.addToast({
          title: next === 'canvas' ? '已切换到画布模式' : '已切换到分屏模式',
          body: next === 'canvas' ? '滚轮缩放，空格 + 拖拽平移' : '分屏布局已恢复',
          type: 'info',
          duration: 3000,
        })
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

  const windowFullscreen = useUIStore((s) => s.windowFullscreen)

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
      </div>
    )
  }

  // Window fullscreen hides chrome. Pane fullscreen is handled inside
  // SplitContainer so it only expands within the central workspace.
  const hideChrome = windowFullscreen
  const showPaneCommandPaneNumbers = paneCommandMode && getPaneLeafIds(paneCommandRoot).length > 1

  return (
    <div className={cn(
      'flex h-full flex-col bg-[var(--color-titlebar-bg)]',
      showPaneCommandPaneNumbers && 'pane-command-mode',
    )}>
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

      {paneCommandMode && (
        <PaneCommandOverlay
          rects={showPaneCommandPaneNumbers ? paneCommandRects : []}
          activePaneId={paneCommandActivePaneId}
        />
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

      {/* Session name prompt */}
      <SessionNamePromptDialog />
    </div>
  )
}
