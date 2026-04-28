import { ArrowLeft, Check, ChevronRight, Clock3, ExternalLink, FileCode2, Folder, GitBranch, Layers, Plus, RefreshCw, Terminal } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistoricalSession, Project, Session, SessionType, Worktree } from '@shared/types'
import { switchProjectContext } from '@/lib/project-context'
import { createSessionWithPrompt } from '@/lib/createSession'
import { getSessionIcon } from '@/lib/sessionIcon'
import { resumeHistoricalSession } from '@/lib/resumeHistoricalSession'
import { cn } from '@/lib/utils'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { FILE_ICONS, type EditorTab, useEditorsStore } from '@/stores/editors'
import { useGitStore } from '@/stores/git'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'
import { SessionIconView } from '@/components/session/SessionIconView'

interface ProjectDetailPanelProps {
  projectId: string
  onBack: () => void
}

interface DetailWorktree {
  worktree: Worktree
  sessions: Session[]
  editors: EditorTab[]
  dirty: boolean
}

interface BranchView {
  sessions: Session[]
  editors: EditorTab[]
  dirty: boolean
}

const TREE_ROW = 'group/tree flex min-h-7 w-full items-center gap-2 rounded-[var(--radius-sm)] pr-2 text-left transition-colors'
const INPUT_CLS = 'w-full rounded-[var(--radius-md)] border border-white/[0.1] bg-black/20 px-3 py-1.5 text-[var(--ui-font-sm)] text-white outline-none transition-all duration-200 focus:border-[var(--color-accent)] focus:bg-black/40'
const MODAL_PANEL = 'fixed left-1/2 top-1/3 z-[210] -translate-x-1/2 rounded-[var(--radius-lg)] border border-white/[0.08] bg-[var(--color-bg-secondary)]/95 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-200'

const SESSION_CREATE_OPTIONS: Array<{ type: SessionType; label: string; title: string }> = [
  { type: 'terminal', label: '终端', title: '在当前项目范围新建终端' },
  { type: 'codex', label: 'Codex', title: '在当前项目范围新建 Codex' },
  { type: 'codex-yolo', label: 'Codex YOLO', title: '在当前项目范围新建 Codex YOLO' },
  { type: 'claude-code', label: 'Claude', title: '在当前项目范围新建 Claude Code' },
  { type: 'claude-code-yolo', label: 'Claude YOLO', title: '在当前项目范围新建 Claude Code YOLO' },
]

function matchesWorktree(worktree: Worktree, itemWorktreeId: string | undefined): boolean {
  return itemWorktreeId === worktree.id || (worktree.isMain && !itemWorktreeId)
}

function getWorktreeDisplayName(worktree: Worktree): string {
  return worktree.isMain ? '项目根目录' : worktree.path.replace(/\\/g, '/').split('/').pop() || worktree.branch
}

function toggleSetValue(values: Set<string>, key: string): Set<string> {
  const next = new Set(values)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function formatRelativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsed < minute) return '刚刚'
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`
  return `${Math.floor(elapsed / day)} 天前`
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isHistoryInProject(session: HistoricalSession, project: Project): boolean {
  const cwd = normalizePath(session.cwd)
  const root = normalizePath(project.path)
  if (!cwd || !root) return false
  return cwd === root || cwd.startsWith(`${root}/`)
}

function getHistoryTime(session: HistoricalSession): number {
  const value = session.updatedAt ?? session.startedAt
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function getHistoryTitle(session: HistoricalSession): string {
  const label = session.source === 'codex' ? 'Codex' : 'Claude Code'
  const prompt = session.firstUserPrompt?.replace(/\s+/g, ' ').trim()
  if (!prompt) return label
  return `${label} · ${prompt}`
}

function NewBranchDialog({ project, onClose }: { project: Project; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const addToast = useUIStore((s) => s.addToast)
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { ref.current?.focus() }, [])

  const submit = async (): Promise<void> => {
    const name = value.trim()
    if (!name || submitting) return
    setSubmitting(true)
    try {
      await useGitStore.getState().createBranch(project.id, project.path, name)
      await useGitStore.getState().fetchStatus(project.id, project.path)
      addToast({ type: 'success', title: '已创建分支', body: name, projectId: project.id })
      onClose()
    } catch (error) {
      addToast({
        type: 'error',
        title: '创建分支失败',
        body: error instanceof Error ? error.message : String(error),
        projectId: project.id,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <>
      <button type="button" className="fixed inset-0 z-[209] cursor-default bg-black/45" onClick={onClose} />
      <div className={MODAL_PANEL} style={{ width: 300 }}>
        <p className="mb-2 text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">新建分支</p>
        <input
          ref={ref}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
            if (event.key === 'Escape') onClose()
          }}
          placeholder="分支名称"
          className={INPUT_CLS}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]">
            取消
          </button>
          <button type="button" onClick={() => { void submit() }} disabled={!value.trim() || submitting} className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-[var(--ui-font-sm)] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40">
            创建
          </button>
        </div>
      </div>
    </>, document.body,
  )
}

function NewWorktreeDialog({ project, onClose, onCreated }: { project: Project; onClose: () => void; onCreated: (branch: string) => void }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const addToast = useUIStore((s) => s.addToast)
  const [branch, setBranch] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { ref.current?.focus() }, [])

  const parentDir = project.path.replace(/[\\/][^\\/]+$/, '')
  const safeBranch = branch.trim().replace(/[/\\]/g, '-')
  const targetName = safeBranch ? `${project.name}-${safeBranch}` : ''
  const targetPath = targetName ? `${parentDir}/${targetName}` : ''

  const submit = async (): Promise<void> => {
    const name = branch.trim()
    if (!name || !targetPath || submitting) return
    setSubmitting(true)
    try {
      await window.api.git.addWorktree(project.path, targetPath, name)
      const wtStore = useWorktreesStore.getState()
      const wtId = wtStore.addWorktree(project.id, name, targetPath, false)
      wtStore.selectWorktree(wtId)
      useProjectsStore.getState().selectProject(project.id)
      switchProjectContext(project.id, null, wtId)
      await useGitStore.getState().fetchWorktrees(project.id, project.path)
      await useGitStore.getState().fetchStatus(wtId, targetPath)
      addToast({ type: 'success', title: '已创建 worktree', body: targetPath, projectId: project.id })
      onCreated(name)
      onClose()
    } catch (error) {
      addToast({
        type: 'error',
        title: '创建 worktree 失败',
        body: error instanceof Error ? error.message : String(error),
        projectId: project.id,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <>
      <button type="button" className="fixed inset-0 z-[209] cursor-default bg-black/45" onClick={onClose} />
      <div className={MODAL_PANEL} style={{ width: 360 }}>
        <p className="mb-2 text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">新建 worktree</p>
        <input
          ref={ref}
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
            if (event.key === 'Escape') onClose()
          }}
          placeholder="分支名称"
          className={cn(INPUT_CLS, 'mb-2')}
        />
        {targetPath && (
          <p className="mb-3 truncate text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{targetPath}</p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]">
            取消
          </button>
          <button type="button" onClick={() => { void submit() }} disabled={!branch.trim() || submitting} className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-[var(--ui-font-sm)] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40">
            创建
          </button>
        </div>
      </div>
    </>, document.body,
  )
}

export function ProjectDetailPanel({ projectId, onBack }: ProjectDetailPanelProps): JSX.Element {
  const project = useProjectsStore((s) => s.projects.find((item) => item.id === projectId))
  const sessions = useSessionsStore((s) => s.sessions)
  const outputStates = useSessionsStore((s) => s.outputStates)
  const editorTabs = useEditorsStore((s) => s.tabs)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const branchInfoMap = useGitStore((s) => s.branchInfo)
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const activeTabId = usePanesStore((s) => s.paneActiveSession[activePaneId] ?? null)
  const addToast = useUIStore((s) => s.addToast)
  const isDarkTheme = useIsDarkTheme()
  const [collapsedWorktrees, setCollapsedWorktrees] = useState<Set<string>>(new Set())
  const [selectedBranch, setSelectedBranch] = useState('')
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  const [confirmBranch, setConfirmBranch] = useState<string | null>(null)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [showNewWorktree, setShowNewWorktree] = useState(false)
  const [historySessions, setHistorySessions] = useState<HistoricalSession[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [resumingHistoryId, setResumingHistoryId] = useState<string | null>(null)

  const projectWorktrees = useMemo(
    () => worktrees.filter((worktree) => worktree.projectId === projectId),
    [projectId, worktrees],
  )
  const projectBranchInfo = project ? branchInfoMap[project.id] : undefined

  useEffect(() => {
    if (!project) return
    void useGitStore.getState().fetchStatus(project.id, project.path)
    void useGitStore.getState().fetchWorktrees(project.id, project.path)
  }, [project])

  useEffect(() => {
    if (!project || !projectBranchInfo) return
    useWorktreesStore.getState().ensureMainWorktree(project.id, project.path, projectBranchInfo.current)
  }, [project, projectBranchInfo])

  useEffect(() => {
    for (const worktree of projectWorktrees) {
      void useGitStore.getState().fetchStatus(worktree.isMain ? projectId : worktree.id, worktree.path)
    }
  }, [projectId, projectWorktrees])

  useEffect(() => {
    setSelectedBranch(projectBranchInfo?.current ?? '')
  }, [projectId, projectBranchInfo?.current])

  const refreshHistory = useCallback(async (): Promise<void> => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await window.api.sessionHistory.list()
      setHistorySessions(result.sessions)
      const errorMessage = Object.values(result.errors ?? {}).filter(Boolean).join('；')
      setHistoryError(errorMessage || null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setHistoryError(message)
      addToast({
        type: 'error',
        title: '加载历史会话失败',
        body: message,
        projectId,
      })
    } finally {
      setHistoryLoading(false)
    }
  }, [addToast, projectId])

  useEffect(() => {
    if (!project) return
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    void window.api.sessionHistory.list()
      .then((result) => {
        if (cancelled) return
        setHistorySessions(result.sessions)
        const errorMessage = Object.values(result.errors ?? {}).filter(Boolean).join('；')
        setHistoryError(errorMessage || null)
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setHistoryError(message)
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [project])

  const branchOptions = useMemo(() => {
    const names = new Set<string>()
    if (projectBranchInfo?.current) names.add(projectBranchInfo.current)
    for (const branch of projectBranchInfo?.branches ?? []) {
      if (branch) names.add(branch)
    }
    for (const worktree of projectWorktrees) {
      if (!worktree.isMain && worktree.branch) names.add(worktree.branch)
    }

    return Array.from(names).sort((a, b) => {
      if (a === projectBranchInfo?.current) return -1
      if (b === projectBranchInfo?.current) return 1
      return a.localeCompare(b)
    })
  }, [projectBranchInfo, projectWorktrees])

  const activeBranch = selectedBranch || projectBranchInfo?.current || branchOptions[0] || 'workspace'
  const projectSessions = useMemo(
    () => project ? sessions.filter((session) => session.projectId === project.id) : [],
    [project, sessions],
  )
  const projectEditors = useMemo(
    () => project ? editorTabs.filter((tab) => tab.projectId === project.id) : [],
    [editorTabs, project],
  )
  const projectHistorySessions = useMemo(
    () => project ? historySessions
      .filter((session) => isHistoryInProject(session, project))
      .sort((left, right) => getHistoryTime(right) - getHistoryTime(left))
      .slice(0, 8) : [],
    [historySessions, project],
  )
  const mainProjectWorktree = useMemo<Worktree | null>(() => {
    if (!project) return null
    return projectWorktrees.find((worktree) => worktree.isMain)
      ?? {
        id: `virtual-main:${project.id}`,
        projectId: project.id,
        branch: projectBranchInfo?.current || 'workspace',
        path: project.path,
        isMain: true,
      }
  }, [project, projectBranchInfo?.current, projectWorktrees])

  const branchView = useMemo((): BranchView & { worktrees: DetailWorktree[] } => {
    if (!project) return { sessions: [], editors: [], dirty: false, worktrees: [] }

    const mainWorktree = mainProjectWorktree
    if (!mainWorktree) return { sessions: [], editors: [], dirty: false, worktrees: [] }
    const nonMainWorktrees = projectWorktrees.filter((worktree) => !worktree.isMain)
    const mainBranchName = projectBranchInfo?.current || mainWorktree.branch || 'workspace'

    const worktreeNodes = nonMainWorktrees
      .filter((worktree) => worktree.branch === activeBranch)
      .sort((a, b) => a.branch.localeCompare(b.branch) || getWorktreeDisplayName(a).localeCompare(getWorktreeDisplayName(b)))
      .map((worktree) => ({
        worktree,
        sessions: projectSessions.filter((session) => matchesWorktree(worktree, session.worktreeId)),
        editors: projectEditors.filter((tab) => matchesWorktree(worktree, tab.worktreeId)),
        dirty: Boolean(branchInfoMap[worktree.id]?.isDirty),
      }))

    if (worktreeNodes.length > 0) {
      return { sessions: [], editors: [], dirty: false, worktrees: worktreeNodes }
    }

    const isMainBranch = activeBranch === mainBranchName
    return {
      sessions: isMainBranch
        ? projectSessions.filter((session) => matchesWorktree(mainWorktree, session.worktreeId))
        : [],
      editors: isMainBranch
        ? projectEditors.filter((tab) => matchesWorktree(mainWorktree, tab.worktreeId))
        : [],
      dirty: isMainBranch && Boolean(branchInfoMap[project.id]?.isDirty),
      worktrees: [],
    }
  }, [activeBranch, branchInfoMap, mainProjectWorktree, project, projectBranchInfo, projectEditors, projectSessions, projectWorktrees])

  const currentQuickWorktree = useMemo(() => {
    const selected = selectedWorktreeId
      ? projectWorktrees.find((worktree) => worktree.id === selectedWorktreeId)
      : undefined
    if (selected) return selected

    return projectWorktrees.find((worktree) => !worktree.isMain && worktree.branch === activeBranch)
      ?? mainProjectWorktree
      ?? null
  }, [activeBranch, mainProjectWorktree, projectWorktrees, selectedWorktreeId])
  const currentQuickWorktreeId = currentQuickWorktree && !currentQuickWorktree.isMain ? currentQuickWorktree.id : undefined

  const focusWorktree = useCallback((worktree: Worktree) => {
    if (!project) return
    switchProjectContext(project.id, null, worktree.isMain ? null : worktree.id)
  }, [project])

  const focusTab = useCallback((tabId: string, worktree?: Worktree) => {
    if (!project) return
    switchProjectContext(project.id, tabId, worktree && !worktree.isMain ? worktree.id : null)
  }, [project])

  const createQuickSession = useCallback((type: SessionType) => {
    if (!project) return
    setSessionMenuOpen(false)
    createSessionWithPrompt({
      projectId: project.id,
      type,
      worktreeId: currentQuickWorktreeId,
      skipPrompt: true,
    }, (sessionId) => {
      const panes = usePanesStore.getState()
      panes.addSessionToPane(activePaneId, sessionId)
      panes.setActivePaneId(activePaneId)
      panes.setPaneActiveSession(activePaneId, sessionId)
      useSessionsStore.getState().setActive(sessionId)
      switchProjectContext(project.id, sessionId, currentQuickWorktreeId ?? null)
    })
  }, [activePaneId, currentQuickWorktreeId, project])

  const resumeHistory = useCallback(async (session: HistoricalSession) => {
    if (resumingHistoryId) return
    setResumingHistoryId(session.id)
    try {
      const result = await resumeHistoricalSession(session)
      if (!result.reused) {
        addToast({
          type: 'success',
          title: '历史会话已打开',
          body: '已在标签页中恢复这个会话。',
          projectId: result.matchedProjectId ?? project?.id,
        })
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: '恢复历史会话失败',
        body: error instanceof Error ? error.message : String(error),
        projectId: project?.id,
      })
    } finally {
      setResumingHistoryId(null)
    }
  }, [addToast, project?.id, resumingHistoryId])

  const checkoutMainBranch = useCallback(async (branch: string) => {
    if (!project) return
    setBranchMenuOpen(false)
    setSelectedBranch(branch)
    setSwitchingBranch(branch)
    try {
      await useGitStore.getState().checkoutBranch(project.id, project.path, branch)
      await useGitStore.getState().fetchStatus(project.id, project.path)
      await useGitStore.getState().fetchWorktrees(project.id, project.path)
      switchProjectContext(project.id, null, null)
    } catch (error) {
      setSelectedBranch(projectBranchInfo?.current ?? '')
      addToast({
        type: 'error',
        title: '切换分支失败',
        body: error instanceof Error ? error.message : String(error),
        projectId: project.id,
      })
    } finally {
      setSwitchingBranch(null)
    }
  }, [addToast, project, projectBranchInfo?.current])

  const handleBranchChange = useCallback((branch: string) => {
    if (!project || branch === activeBranch || switchingBranch) return

    setBranchMenuOpen(false)
    const branchWorktree = projectWorktrees.find((worktree) => !worktree.isMain && worktree.branch === branch)
    if (branchWorktree) {
      setSelectedBranch(branch)
      switchProjectContext(project.id, null, branchWorktree.id)
      return
    }

    if (projectBranchInfo?.isDirty) {
      setConfirmBranch(branch)
      return
    }

    void checkoutMainBranch(branch)
  }, [activeBranch, checkoutMainBranch, project, projectBranchInfo?.isDirty, projectWorktrees, switchingBranch])

  const projectTabCount = useMemo(() => {
    return projectSessions.length + projectEditors.length
  }, [projectEditors, projectSessions])
  const activeBranchTabCount = branchView.worktrees.length > 0
    ? branchView.worktrees.reduce((count, item) => count + item.sessions.length + item.editors.length, 0)
    : branchView.sessions.length + branchView.editors.length

  const renderTabs = (tabSessions: Session[], tabs: EditorTab[], worktree?: Worktree): JSX.Element => (
    <>
      {tabSessions.map((session) => {
        const active = activeTabId === session.id
        const outputState = outputStates[session.id]
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => focusTab(session.id, worktree)}
            className={cn(
              TREE_ROW,
              'pl-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
              active && 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]',
            )}
          >
            <SessionIconView fallbackSrc={getSessionIcon(session.type, isDarkTheme)} icon={session.customSessionIcon} className="h-4 w-4" imageClassName="h-3.5 w-3.5 object-contain" />
            <span className="min-w-0 flex-1 truncate text-[12px]">{session.name}</span>
            {session.status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />}
            {outputState === 'outputting' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />}
            {outputState === 'unread' && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />}
          </button>
        )
      })}
      {tabs.map((tab) => {
        const iconInfo = FILE_ICONS[tab.language] ?? FILE_ICONS.plaintext
        const active = activeTabId === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => focusTab(tab.id, worktree)}
            className={cn(
              TREE_ROW,
              'pl-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
              active && 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]',
            )}
          >
            <span
              className="flex h-4 w-5 shrink-0 items-center justify-center rounded-[3px] text-[8px] font-bold"
              style={{ backgroundColor: `${iconInfo.color}22`, color: iconInfo.color }}
            >
              {iconInfo.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px]">{tab.fileName}</span>
            {tab.modified && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />}
            {tab.isDiff && <FileCode2 size={11} className="text-[var(--color-text-tertiary)]" />}
          </button>
        )
      })}
    </>
  )

  if (!project) {
    return (
      <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
        <div className="flex h-10 items-center gap-2 border-b border-[var(--color-border)]/50 px-2.5">
          <button onClick={onBack} className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]">
            <ArrowLeft size={15} />
          </button>
          <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">项目不存在</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="relative shrink-0 border-b border-[var(--color-border)]/50 px-3 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            title="返回项目列表"
          >
            <ArrowLeft size={15} />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-accent)]">
            <Folder size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{project.name}</span>
              <span className="max-w-24 shrink-0 truncate rounded bg-[var(--color-accent-muted)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-accent)]" title={activeBranch}>
                {activeBranch}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
              <span className="truncate" title={project.path}>{project.path}</span>
              {currentQuickWorktree && !currentQuickWorktree.isMain && (
                <>
                  <span className="h-2.5 w-px shrink-0 bg-[var(--color-border)]" />
                  <span className="max-w-24 shrink-0 truncate" title={currentQuickWorktree.path}>
                    {getWorktreeDisplayName(currentQuickWorktree)}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSessionMenuOpen((open) => !open)}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]',
                'text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                sessionMenuOpen && 'border-[var(--color-accent)] text-[var(--color-accent)]',
              )}
              title="新建会话"
              aria-expanded={sessionMenuOpen}
            >
              <Plus size={15} />
            </button>
            {sessionMenuOpen && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setSessionMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-1 shadow-lg shadow-black/30">
                  <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-tertiary)]">
                    新建会话 · {currentQuickWorktree && !currentQuickWorktree.isMain ? getWorktreeDisplayName(currentQuickWorktree) : activeBranch}
                  </div>
                  {SESSION_CREATE_OPTIONS.map((option) => (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => createQuickSession(option.type)}
                      className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                      title={option.title}
                    >
                      {option.type === 'terminal'
                        ? <Terminal size={13} className="shrink-0" />
                        : <SessionIconView fallbackSrc={getSessionIcon(option.type, isDarkTheme)} className="h-4 w-4" imageClassName="h-3.5 w-3.5 object-contain" />}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => window.api.shell.openPath(project.path)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            title="在资源管理器中打开"
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-[var(--color-border)]/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setBranchMenuOpen((open) => !open)}
              aria-expanded={branchMenuOpen}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5',
                'text-left text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none transition-colors',
                'hover:border-[var(--color-border-hover)] focus:border-[var(--color-accent)]',
              )}
            >
              <GitBranch size={13} className="shrink-0 text-[var(--color-accent)]" />
              <span className="min-w-0 flex-1 truncate font-medium">{activeBranch}</span>
              {activeBranch === projectBranchInfo?.current && (
                <span className="rounded bg-[var(--color-accent-muted)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-accent)]">current</span>
              )}
              <ChevronRight size={13} className={cn('shrink-0 text-[var(--color-text-tertiary)] transition-transform', branchMenuOpen && 'rotate-90')} />
            </button>

            {branchMenuOpen && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setBranchMenuOpen(false)}
                />
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-1 shadow-lg shadow-black/30">
                  {(branchOptions.length === 0 ? [activeBranch] : branchOptions).map((branch) => {
                    const active = branch === activeBranch
                    const current = branch === projectBranchInfo?.current
                    const worktreeCount = projectWorktrees.filter((worktree) => !worktree.isMain && worktree.branch === branch).length
                    return (
                      <button
                        key={branch}
                        type="button"
                        disabled={switchingBranch !== null}
                        onClick={() => {
                          setBranchMenuOpen(false)
                          if (branch !== activeBranch) void handleBranchChange(branch)
                        }}
                        className={cn(
                          'group/branch flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[var(--ui-font-sm)] transition-colors',
                          active
                            ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                          switchingBranch !== null && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <Check size={12} className={cn('shrink-0 text-[var(--color-accent)]', active ? 'opacity-100' : 'opacity-0')} />
                        <span className="min-w-0 flex-1 truncate">{branch}</span>
                        {switchingBranch === branch && <span className="text-[9px] text-[var(--color-text-tertiary)]">switching</span>}
                        {current && <span className="rounded bg-[var(--color-accent-muted)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-accent)]">current</span>}
                        {worktreeCount > 0 && (
                          <span className="rounded bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-tertiary)]">{worktreeCount} wt</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowNewBranch(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            title="新建分支"
          >
            <GitBranch size={13} />
          </button>
          <button
            type="button"
            onClick={() => setShowNewWorktree(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            title="新建 worktree"
          >
            <Layers size={13} />
          </button>
          {branchView.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" title="有未提交更改" />}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--color-text-tertiary)]">
          <span className="inline-flex items-center gap-1"><GitBranch size={11} /> {branchOptions.length} branches</span>
          <span className="h-3 w-px bg-[var(--color-border)]" />
          <span className="inline-flex items-center gap-1"><Layers size={11} /> {branchView.worktrees.length} worktrees</span>
          <span className="h-3 w-px bg-[var(--color-border)]" />
          <span className="inline-flex items-center gap-1"><Terminal size={11} /> {activeBranchTabCount} / {projectTabCount} tabs</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none px-2 py-2">
        {branchView.worktrees.length === 0 ? (
          <div className="pl-2">
            {activeBranchTabCount === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">这个分支没有打开的标签页</div>
            ) : renderTabs(branchView.sessions, branchView.editors)}
          </div>
        ) : branchView.worktrees.map(({ worktree, sessions: worktreeSessions, editors, dirty }) => {
          const worktreeKey = `worktree:${worktree.id}`
          const worktreeCollapsed = collapsedWorktrees.has(worktreeKey)
          const worktreeActive = selectedWorktreeId === worktree.id
          const tabCount = worktreeSessions.length + editors.length

          return (
            <div key={worktreeKey} className="mb-1">
              <div
                onDoubleClick={() => setCollapsedWorktrees((current) => toggleSetValue(current, worktreeKey))}
                className={cn(
                  TREE_ROW,
                  'pl-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                  worktreeActive && 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]',
                )}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setCollapsedWorktrees((current) => toggleSetValue(current, worktreeKey))
                  }}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                >
                  <ChevronRight size={11} className={cn('transition-transform', !worktreeCollapsed && 'rotate-90')} />
                </button>
                <button
                  type="button"
                  onClick={() => focusWorktree(worktree)}
                  className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
                >
                  <Layers size={13} className={cn('shrink-0', worktreeActive && 'text-[var(--color-accent)]')} />
                  <span className="min-w-0 flex-1 truncate text-[var(--ui-font-sm)] font-medium">{getWorktreeDisplayName(worktree)}</span>
                  {dirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" title="有未提交更改" />}
                  <span className="max-w-24 truncate rounded bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-tertiary)]" title={worktree.branch}>
                    {worktree.branch}
                  </span>
                  <span className="rounded bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-tertiary)]">{tabCount}</span>
                </button>
              </div>

              {!worktreeCollapsed && (
                <div className="ml-3 pl-2">
                  {tabCount === 0 ? (
                    <div className="px-2 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">没有标签页</div>
                  ) : renderTabs(worktreeSessions, editors, worktree)}
                </div>
              )}
            </div>
          )
        })}
        <div className="mt-3 border-t border-[var(--color-border)]/35 pt-2">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
              <Clock3 size={12} />
              历史会话
            </span>
            <div className="flex items-center gap-1">
              <span className="rounded bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-tertiary)]">
                {projectHistorySessions.length}
              </span>
              <button
                type="button"
                onClick={() => { void refreshHistory() }}
                className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                title="刷新历史会话"
              >
                <RefreshCw size={11} className={cn(historyLoading && 'animate-spin')} />
              </button>
            </div>
          </div>
          {historyError && (
            <div className="mb-1 px-2 py-1 text-[10px] text-[var(--color-warning)]" title={historyError}>
              部分历史加载失败
            </div>
          )}
          {historyLoading && projectHistorySessions.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">正在加载历史会话...</div>
          ) : projectHistorySessions.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">这个项目还没有历史会话</div>
          ) : (
            <div className="space-y-1">
              {projectHistorySessions.map((session) => {
                const iconType: SessionType = session.source === 'codex' ? 'codex' : 'claude-code'
                const time = getHistoryTime(session)
                const opened = projectSessions.some((openSession) => (
                  session.source === 'codex'
                    ? openSession.codexResumeId === session.id
                    : openSession.resumeUUID === session.id
                ))
                const resuming = resumingHistoryId === session.id

                return (
                  <button
                    key={`history:${session.source}:${session.id}`}
                    type="button"
                    disabled={resumingHistoryId !== null}
                    onClick={() => { void resumeHistory(session) }}
                    className={cn(
                      'group/history flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left transition-colors',
                      'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                      opened && 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]',
                      resumingHistoryId !== null && 'cursor-not-allowed opacity-70',
                    )}
                  >
                    <SessionIconView fallbackSrc={getSessionIcon(iconType, isDarkTheme)} className="h-4 w-4" imageClassName="h-3.5 w-3.5 object-contain" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium">{getHistoryTitle(session)}</div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px] text-[var(--color-text-tertiary)]">
                        <span className="truncate">{session.source === 'codex' ? 'Codex' : 'Claude'}</span>
                        <span className="h-2.5 w-px shrink-0 bg-[var(--color-border)]" />
                        <span className="shrink-0">{time > 0 ? formatRelativeTime(time) : '未知时间'}</span>
                        {session.userTurns > 0 && (
                          <>
                            <span className="h-2.5 w-px shrink-0 bg-[var(--color-border)]" />
                            <span className="shrink-0">{session.userTurns} 轮</span>
                          </>
                        )}
                      </div>
                    </div>
                    {resuming && <RefreshCw size={11} className="shrink-0 animate-spin text-[var(--color-accent)]" />}
                    {opened && !resuming && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-success)]" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {confirmBranch && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-4" onClick={() => setConfirmBranch(null)}>
          <div
            className="w-full max-w-[360px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4 shadow-2xl shadow-black/40"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--color-warning)]" />
              <h3 className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">当前分支有未提交更改</h3>
            </div>
            <p className="mb-4 text-[var(--ui-font-xs)] leading-5 text-[var(--color-text-secondary)]">
              从 <span className="font-medium text-[var(--color-text-primary)]">{projectBranchInfo?.current ?? '当前分支'}</span> 切换到{' '}
              <span className="font-medium text-[var(--color-text-primary)]">{confirmBranch}</span> 可能导致冲突，Git 也可能拒绝切换。请先确认是否继续。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmBranch(null)}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const branch = confirmBranch
                  setConfirmBranch(null)
                  void checkoutMainBranch(branch)
                }}
                className="rounded-[var(--radius-sm)] bg-[var(--color-warning)] px-3 py-1.5 text-[var(--ui-font-sm)] font-medium text-white transition-opacity hover:opacity-90"
              >
                仍然切换
              </button>
            </div>
          </div>
        </div>
      )}
      {showNewBranch && <NewBranchDialog project={project} onClose={() => setShowNewBranch(false)} />}
      {showNewWorktree && (
        <NewWorktreeDialog
          project={project}
          onClose={() => setShowNewWorktree(false)}
          onCreated={(branch) => setSelectedBranch(branch)}
        />
      )}
    </div>
  )
}
