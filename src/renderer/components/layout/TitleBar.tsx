import { Check, ChevronDown, Columns2, Copy, ExternalLink, Eye, EyeOff, Focus, FolderOpen, GitBranch, HelpCircle, Info, LayoutGrid, ListTodo, Minus, PanelLeftOpen, PanelRightOpen, Play, Plus, Search, Settings, Square, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import appIcon from '@/assets/icons/pragma-desk.png'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { closeSessionsById } from '@/lib/closeSessions'
import { createSessionWithPrompt } from '@/lib/createSession'
import { runLaunchProfile } from '@/lib/runLaunchProfile'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { useLaunchesStore, type LaunchProfile } from '@/stores/launches'
import { MusicPlayer } from './MusicPlayer'
import { TitleBarSearch } from './TitleBarSearch'
import type { ExternalIdeOption } from '@shared/types'
import { toggleCurrentSessionFullscreen } from '@/lib/currentSessionFullscreen'

type TitleMenuId = 'file' | 'edit' | 'view' | 'help'

interface TitleMenuAction {
  icon: LucideIcon
  label: string
  onSelect: () => void | Promise<void>
  disabled?: boolean
  hint?: string
}

interface TitleMenuDefinition {
  id: TitleMenuId
  label: string
  items: TitleMenuAction[]
}

const TITLE_MENU_BUTTON =
  'flex h-7 items-center rounded-[var(--radius-sm)] px-2.5 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
const TITLE_MENU_ITEM =
  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'
const RUN_DIALOG_INPUT =
  'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)]'

type RunProfileFormData = Omit<LaunchProfile, 'id' | 'projectId'>

function getRunProfileCommand(profile: LaunchProfile | null): string {
  if (!profile) return ''
  return [profile.command, profile.args].filter((part) => part.trim()).join(' ')
}

function TitleBarRunDialog({
  projectName,
  initialProfile,
  onClose,
  onSave,
}: {
  projectName: string
  initialProfile: LaunchProfile | null
  onClose: () => void
  onSave: (data: RunProfileFormData) => void
}): JSX.Element {
  const initialCommand = getRunProfileCommand(initialProfile)
  const [name, setName] = useState(initialProfile?.name ?? '运行')
  const [command, setCommand] = useState(initialCommand)
  const [cwd, setCwd] = useState(initialProfile?.cwd ?? '')

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmedCommand = command.trim()
    if (!trimmedCommand) return
    onSave({
      name: name.trim() || trimmedCommand,
      command: trimmedCommand,
      args: '',
      cwd: cwd.trim(),
      env: initialProfile?.env ?? '',
      icon: initialProfile?.icon ?? '▶',
      color: initialProfile?.color ?? '#3ecf7b',
    })
  }

  return createPortal(
    <>
      <div className="no-drag fixed inset-0 z-[129] bg-black/45" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="no-drag fixed left-1/2 top-1/2 z-[130] w-[min(420px,calc(100vw_-_32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">运行命令</div>
            <div className="mt-0.5 truncate text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">{projectName}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-secondary)]">名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={RUN_DIALOG_INPUT}
              placeholder="运行"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-secondary)]">命令</span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className={RUN_DIALOG_INPUT}
              placeholder="pnpm dev"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-secondary)]">工作目录</span>
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              className={RUN_DIALOG_INPUT}
              placeholder="项目根目录"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-[var(--ui-font-xs)] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!command.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-[var(--ui-font-xs)] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check size={13} />
            保存
          </button>
        </div>
      </form>
    </>,
    document.body,
  )
}

export function TitleBar(): JSX.Element | null {
  const [maximized, setMaximized] = useState(false)
  const [ideMenuOpen, setIdeMenuOpen] = useState(false)
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [activeMenu, setActiveMenu] = useState<TitleMenuId | null>(null)
  const [menuAreaHovered, setMenuAreaHovered] = useState(false)
  const [titleBarRevealHovered, setTitleBarRevealHovered] = useState(false)
  const [availableIdes, setAvailableIdes] = useState<ExternalIdeOption[]>([])
  const titleBarRevealHoveredRef = useRef(false)
  const ideMenuRef = useRef<HTMLDivElement>(null)
  const titleMenuRef = useRef<HTMLDivElement>(null)
  const titleMenuPopupRef = useRef<HTMLDivElement>(null)
  const ideMenuPopupRef = useRef<HTMLDivElement>(null)
  const ideMenuButtonRef = useRef<HTMLButtonElement>(null)
  const menuButtonRefs = useRef<Record<TitleMenuId, HTMLButtonElement | null>>({
    file: null,
    edit: null,
    view: null,
    help: null,
  })
  const closeMenuTimerRef = useRef<number | null>(null)

  const clearMenuCloseTimer = useCallback(() => {
    if (closeMenuTimerRef.current === null) return
    window.clearTimeout(closeMenuTimerRef.current)
    closeMenuTimerRef.current = null
  }, [])

  const scheduleMenuClose = useCallback(() => {
    clearMenuCloseTimer()
    closeMenuTimerRef.current = window.setTimeout(() => {
      setActiveMenu(null)
    }, 140)
  }, [clearMenuCloseTimer])

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    window.api.shell.listIdes().then(setAvailableIdes).catch(() => setAvailableIdes([]))
  }, [])

  useEffect(() => clearMenuCloseTimer, [clearMenuCloseTimer])

  useEffect(() => {
    if (!ideMenuOpen && !activeMenu) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      const insideIdeMenu = ideMenuRef.current?.contains(target) || ideMenuPopupRef.current?.contains(target)
      const insideTitleMenu = titleMenuRef.current?.contains(target) || titleMenuPopupRef.current?.contains(target)
      if (insideIdeMenu || insideTitleMenu) return
      clearMenuCloseTimer()
      setIdeMenuOpen(false)
      setActiveMenu(null)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      clearMenuCloseTimer()
      setIdeMenuOpen(false)
      setActiveMenu(null)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [activeMenu, clearMenuCloseTimer, ideMenuOpen])

  const handleMinimize = useCallback(() => window.api.window.minimize(), [])
  const handleMaximize = useCallback(async () => {
    await window.api.window.maximize()
    setMaximized(await window.api.window.isMaximized())
  }, [])
  const handleClose = useCallback(() => window.api.window.close(), [])

  const showMusicPlayer = useUIStore((s) => s.settings.showMusicPlayer)
  const showTitleBarSearch = useUIStore((s) => s.settings.showTitleBarSearch)
  const titleBarMenuVisibility = useUIStore((s) => s.settings.titleBarMenuVisibility)
  const defaultSessionType = useUIStore((s) => s.settings.defaultSessionType)
  const defaultCustomSessionId = useUIStore((s) => s.settings.defaultCustomSessionId)
  const customSessionDefinitions = useUIStore((s) => s.settings.customSessionDefinitions)
  const workspaceLayout = useUIStore((s) => s.settings.workspaceLayout)
  const updateSettings = useUIStore((s) => s.updateSettings)
  const openSettings = useUIStore((s) => s.openSettings)
  const toggleDockPanel = useUIStore((s) => s.toggleDockPanel)
  const activateDockPanel = useUIStore((s) => s.activateDockPanel)
  const hideLeftPanel = useUIStore((s) => s.hideLeftPanel)
  const hideRightPanel = useUIStore((s) => s.hideRightPanel)
  const hideStatusBar = useUIStore((s) => s.hideStatusBar)
  const hideTitleBar = useUIStore((s) => s.hideTitleBar)
  const focusMode = useUIStore((s) => s.focusMode)
  const setFocusMode = useUIStore((s) => s.setFocusMode)
  const toggleHideLeftPanel = useUIStore((s) => s.toggleHideLeftPanel)
  const toggleHideRightPanel = useUIStore((s) => s.toggleHideRightPanel)
  const toggleHideStatusBar = useUIStore((s) => s.toggleHideStatusBar)
  const toggleHideTitleBar = useUIStore((s) => s.toggleHideTitleBar)
  const addToast = useUIStore((s) => s.addToast)
  const isDarkTheme = useIsDarkTheme()
  const activeTabId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const fullscreenPaneId = usePanesStore((s) => s.fullscreenPaneId)
  const windowFullscreen = useUIStore((s) => s.windowFullscreen)
  const sessions = useSessionsStore((s) => s.sessions)
  const launchProfiles = useLaunchesStore((s) => s.profiles)
  const runningLaunchesByProject = useLaunchesStore((s) => s.runningByProject)
  const addLaunchProfile = useLaunchesStore((s) => s.addProfile)
  const updateLaunchProfile = useLaunchesStore((s) => s.updateProfile)
  const clearProjectRunningSession = useLaunchesStore((s) => s.clearProjectRunningSession)

  useEffect(() => {
    titleBarRevealHoveredRef.current = titleBarRevealHovered
  }, [titleBarRevealHovered])

  useEffect(() => {
    const titleBarHidden = hideTitleBar || focusMode
    if (!titleBarHidden) {
      setTitleBarRevealHovered(false)
      return
    }

    let disposed = false
    let checking = false

    const syncCursorState = async () => {
      if (checking) return
      checking = true
      try {
        const cursorState = await window.api.window.getTitleBarCursorState()
        if (disposed) return

        if (cursorState.inRevealZone || (titleBarRevealHoveredRef.current && cursorState.inTitleBarZone)) {
          setTitleBarRevealHovered(true)
        } else if (activeMenu === null && !ideMenuOpen) {
          setTitleBarRevealHovered(false)
        }
      } finally {
        checking = false
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.clientY <= 8) {
        setTitleBarRevealHovered(true)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    void syncCursorState()
    const intervalId = window.setInterval(syncCursorState, 80)
    return () => {
      disposed = true
      window.clearInterval(intervalId)
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [activeMenu, focusMode, hideTitleBar, ideMenuOpen])

  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const projects = useProjectsStore((s) => s.projects)
  const selectedProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.selectedProjectId),
  )
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const selectedWorktree = useWorktreesStore((s) =>
    s.worktrees.find((w) => w.id === s.selectedWorktreeId),
  )
  const todoPopoverOpen = useUIStore((s) => s.todoPopoverOpen)
  const toggleTodoPopover = useUIStore((s) => s.toggleTodoPopover)
  const todoItemsByProject = useUIStore((s) => s.settings.todoItemsByProject)
  const legacyTodoItems = useUIStore((s) => s.settings.todoItems)
  const hasProjectTodoLists = Object.keys(todoItemsByProject).length > 0
  const currentProjectTodoItems = selectedProjectId
    ? (todoItemsByProject[selectedProjectId] ?? (hasProjectTodoLists ? [] : legacyTodoItems))
    : legacyTodoItems
  const activeTodoCount = useMemo(
    () => currentProjectTodoItems.filter((item) => !item.completed).length,
    [currentProjectTodoItems],
  )
  const activeProjectPath = selectedWorktree?.path ?? selectedProject?.path ?? null
  const titleRunProfile = useMemo(
    () => selectedProjectId
      ? launchProfiles.find((profile) => profile.projectId === selectedProjectId) ?? null
      : null,
    [launchProfiles, selectedProjectId],
  )
  const titleRunState = selectedProjectId
    ? runningLaunchesByProject[selectedProjectId] ?? null
    : null
  const titleRunSession = titleRunState
    ? sessions.find((session) => session.id === titleRunState.sessionId) ?? null
    : null
  const titleRunActive = Boolean(titleRunState && titleRunSession)
  const menuVisible = titleBarMenuVisibility === 'always' || menuAreaHovered || activeMenu !== null
  const titleBarHidden = hideTitleBar || focusMode
  const titleBarRevealed = !titleBarHidden || titleBarRevealHovered || activeMenu !== null || ideMenuOpen
  const focusModeActive = focusMode
  const activeSession = activeTabId && !activeTabId.startsWith('editor-')
    ? sessions.find((session) => session.id === activeTabId)
    : undefined
  const titleProject = activeSession
    ? projects.find((project) => project.id === activeSession.projectId) ?? selectedProject
    : selectedProject
  const runButtonTitle = !selectedProjectId
    ? '请先选择项目'
    : titleRunActive
      ? `停止运行：${titleRunProfile?.name ?? titleRunSession?.name ?? '运行会话'}`
      : titleRunProfile
      ? `运行：${titleRunProfile.name}（右键设置）`
      : '设置运行命令'
  const defaultCustomSession = defaultCustomSessionId
    ? customSessionDefinitions.find((definition) => definition.id === defaultCustomSessionId)
    : null

  useEffect(() => {
    if (!selectedProjectId || !titleRunState || titleRunSession) return
    clearProjectRunningSession(selectedProjectId, titleRunState.sessionId)
  }, [clearProjectRunningSession, selectedProjectId, titleRunSession, titleRunState])

  const handleOpenInIde = useCallback(async (ide: ExternalIdeOption) => {
    if (!activeProjectPath || !selectedProject) {
      addToast({
        type: 'warning',
        title: '未选择项目',
        body: '请先在侧边栏选择一个项目。',
      })
      return
    }

    const result = await window.api.shell.openInIde(ide.id, activeProjectPath)
    if (result.ok) {
      addToast({
        type: 'success',
        title: `已使用 ${ide.label} 打开`,
        body: selectedWorktree && !selectedWorktree.isMain
          ? `${selectedProject.name} / ${selectedWorktree.branch}`
          : selectedProject.name,
      })
    } else {
      addToast({
        type: 'error',
        title: `${ide.label} 打开失败`,
        body: result.error ?? '无法启动所选 IDE。',
      })
    }

    window.api.shell.listIdes().then(setAvailableIdes).catch(() => {})
    setIdeMenuOpen(false)
  }, [activeProjectPath, addToast, selectedProject, selectedWorktree])

  const handleCreateDefaultSession = useCallback(() => {
    if (!selectedProjectId) {
      addToast({
        type: 'warning',
        title: '未选择项目',
        body: '请选择一个项目后再创建会话。',
      })
      return
    }

    const worktreeId = selectedWorktreeId ?? getDefaultWorktreeIdForProject(selectedProjectId)
    createSessionWithPrompt(
      {
        projectId: selectedProjectId,
        type: defaultCustomSession ? undefined : defaultSessionType,
        customSessionDefinitionId: defaultCustomSession?.id,
        worktreeId,
      },
      (sessionId) => {
        const paneStore = usePanesStore.getState()
        paneStore.addSessionToPane(paneStore.activePaneId, sessionId)
        paneStore.setPaneActiveSession(paneStore.activePaneId, sessionId)
        useSessionsStore.getState().setActive(sessionId)
      },
    )
  }, [addToast, defaultCustomSession, defaultSessionType, selectedProjectId, selectedWorktreeId])

  const handleRunButtonClick = useCallback(() => {
    if (!selectedProjectId || !activeProjectPath) {
      addToast({
        type: 'warning',
        title: '未选择项目',
        body: '请选择一个项目后再运行命令。',
      })
      return
    }

    if (titleRunState) {
      const closedIds = closeSessionsById([titleRunState.sessionId])
      clearProjectRunningSession(selectedProjectId, titleRunState.sessionId)
      if (closedIds.length > 0) {
        addToast({
          type: 'success',
          title: '运行已停止',
          body: titleRunSession?.name ?? titleRunProfile?.name ?? '运行会话',
        })
      } else {
        addToast({
          type: 'warning',
          title: '运行状态已清理',
          body: '没有找到可关闭的运行会话。',
        })
      }
      return
    }

    if (!titleRunProfile) {
      setRunDialogOpen(true)
      return
    }

    runLaunchProfile({
      profile: titleRunProfile,
      projectPath: activeProjectPath,
      worktreeId: selectedWorktreeId,
    })
  }, [
    activeProjectPath,
    addToast,
    clearProjectRunningSession,
    selectedProjectId,
    selectedWorktreeId,
    titleRunProfile,
    titleRunSession?.name,
    titleRunState,
  ])

  const handleRunButtonContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (!selectedProjectId) {
      addToast({
        type: 'warning',
        title: '未选择项目',
        body: '请选择一个项目后再设置运行命令。',
      })
      return
    }
    setRunDialogOpen(true)
  }, [addToast, selectedProjectId])

  const handleSaveRunProfile = useCallback((data: RunProfileFormData) => {
    if (!selectedProjectId) return
    if (titleRunProfile) {
      updateLaunchProfile(titleRunProfile.id, data)
    } else {
      addLaunchProfile({ ...data, projectId: selectedProjectId })
    }
    setRunDialogOpen(false)
    addToast({
      type: 'success',
      title: '运行命令已保存',
      body: data.command,
    })
  }, [addLaunchProfile, addToast, selectedProjectId, titleRunProfile, updateLaunchProfile])

  const handleToggleWorkspaceLayout = useCallback(() => {
    const next = workspaceLayout === 'canvas' ? 'panes' : 'canvas'
    updateSettings({ workspaceLayout: next })
  }, [updateSettings, workspaceLayout])

  const handleToggleHideTitleBar = useCallback(() => {
    setTitleBarRevealHovered(false)
    setMenuAreaHovered(false)
    setIdeMenuOpen(false)
    setActiveMenu(null)
    toggleHideTitleBar()
  }, [toggleHideTitleBar])

  const handleToggleFocusMode = useCallback(() => {
    setTitleBarRevealHovered(false)
    setMenuAreaHovered(false)
    setIdeMenuOpen(false)
    setActiveMenu(null)
    setFocusMode(!focusMode)
  }, [focusMode, setFocusMode])

  const handleCopyText = useCallback(async (value: string, title: string) => {
    try {
      await navigator.clipboard.writeText(value)
      addToast({
        type: 'success',
        title,
        body: value,
      })
    } catch (error) {
      addToast({
        type: 'error',
        title: `${title}失败`,
        body: error instanceof Error ? error.message : '无法写入剪贴板。',
      })
    }
  }, [addToast])

  const handleShowShortcuts = useCallback(() => {
    addToast({
      type: 'info',
      title: '快捷键',
      body: 'Ctrl+Tab 切换标签，Ctrl+W 关闭标签，Ctrl+Shift+T 恢复关闭，Ctrl+Alt+方向键切换分栏，Alt+1~9 切换 pane。',
      duration: 9000,
    })
  }, [addToast])

  const handleShowAbout = useCallback(() => {
    openSettings('about')
  }, [openSettings])

  const titleMenus = useMemo<TitleMenuDefinition[]>(() => {
    const primaryIde = availableIdes[0]
    const branchName = selectedWorktree?.branch ?? null

    return [
      {
        id: 'file',
        label: '文件',
        items: [
          {
            icon: Plus,
            label: `新建${defaultCustomSession?.name ?? ((defaultSessionType === 'terminal' || defaultSessionType === 'terminal-wsl') ? '终端' : '默认会话')}`,
            onSelect: handleCreateDefaultSession,
            disabled: !selectedProjectId,
          },
          {
            icon: FolderOpen,
            label: '打开当前项目目录',
            onSelect: () => {
              if (activeProjectPath) void window.api.shell.openPath(activeProjectPath)
            },
            disabled: !activeProjectPath,
          },
          {
            icon: ExternalLink,
            label: primaryIde ? `用 ${primaryIde.label} 打开` : '用 IDE 打开',
            onSelect: () => {
              if (primaryIde) void handleOpenInIde(primaryIde)
            },
            disabled: !primaryIde || !activeProjectPath,
          },
          {
            icon: Settings,
            label: '设置',
            onSelect: openSettings,
          },
        ],
      },
      {
        id: 'edit',
        label: '编辑',
        items: [
          {
            icon: Copy,
            label: '复制项目路径',
            onSelect: () => {
              if (activeProjectPath) void handleCopyText(activeProjectPath, '已复制项目路径')
            },
            disabled: !activeProjectPath,
          },
          {
            icon: Copy,
            label: '复制项目名称',
            onSelect: () => {
              if (selectedProject?.name) void handleCopyText(selectedProject.name, '已复制项目名称')
            },
            disabled: !selectedProject?.name,
          },
          {
            icon: GitBranch,
            label: '复制当前分支名',
            onSelect: () => {
              if (branchName) void handleCopyText(branchName, '已复制分支名')
            },
            disabled: !branchName,
          },
        ],
      },
      {
        id: 'view',
        label: '查看',
        items: [
          {
            icon: PanelLeftOpen,
            label: '切换左侧面板',
            onSelect: () => toggleDockPanel('left'),
          },
          {
            icon: PanelRightOpen,
            label: '切换右侧面板',
            onSelect: () => toggleDockPanel('right'),
          },
          {
            icon: hideLeftPanel ? Eye : EyeOff,
            label: hideLeftPanel ? '显示左侧栏' : '隐藏左侧栏',
            onSelect: toggleHideLeftPanel,
          },
          {
            icon: hideRightPanel ? Eye : EyeOff,
            label: hideRightPanel ? '显示右侧栏' : '隐藏右侧栏',
            onSelect: toggleHideRightPanel,
          },
          {
            icon: hideStatusBar ? Eye : EyeOff,
            label: hideStatusBar ? '显示任务栏' : '隐藏任务栏',
            onSelect: toggleHideStatusBar,
          },
          {
            icon: hideTitleBar ? Eye : EyeOff,
            label: hideTitleBar ? '显示标题栏' : '隐藏标题栏',
            onSelect: handleToggleHideTitleBar,
          },
          {
            icon: Focus,
            label: focusModeActive ? '退出专注模式' : '进入专注模式',
            onSelect: handleToggleFocusMode,
          },
          {
            icon: Search,
            label: '打开搜索面板',
            onSelect: () => activateDockPanel('search'),
          },
          {
            icon: ListTodo,
            label: '打开 Todo 面板',
            onSelect: () => activateDockPanel('todo'),
          },
          {
            icon: Square,
            label: windowFullscreen ? '退出全屏' : '全屏',
            onSelect: () => void toggleCurrentSessionFullscreen(),
            hint: 'F11',
          },
          {
            icon: Search,
            label: showTitleBarSearch ? '关闭标题栏搜索' : '开启标题栏搜索',
            onSelect: () => updateSettings({ showTitleBarSearch: !showTitleBarSearch }),
          },
        ],
      },
      {
        id: 'help',
        label: '帮助',
        items: [
          {
            icon: HelpCircle,
            label: '快捷键提示',
            onSelect: handleShowShortcuts,
          },
          {
            icon: Info,
            label: '关于 Pragma Desk',
            onSelect: handleShowAbout,
          },
          {
            icon: Settings,
            label: '打开设置',
            onSelect: openSettings,
          },
        ],
      },
    ]
  }, [
    activateDockPanel,
    activeProjectPath,
    activeTabId,
    availableIdes,
    defaultCustomSession,
    defaultSessionType,
    fullscreenPaneId,
    focusModeActive,
    hideLeftPanel,
    hideRightPanel,
    hideStatusBar,
    hideTitleBar,
    windowFullscreen,
    handleCopyText,
    handleCreateDefaultSession,
    handleOpenInIde,
    handleShowAbout,
    handleShowShortcuts,
    handleToggleHideTitleBar,
    handleToggleFocusMode,
    openSettings,
    selectedProject?.name,
    selectedProjectId,
    selectedWorktree?.branch,
    showTitleBarSearch,
    toggleDockPanel,
    toggleHideLeftPanel,
    toggleHideRightPanel,
    toggleHideStatusBar,
    updateSettings,
  ])

  const activeMenuDefinition = activeMenu
    ? titleMenus.find((menu) => menu.id === activeMenu) ?? null
    : null
  const activeMenuRect = activeMenu
    ? menuButtonRefs.current[activeMenu]?.getBoundingClientRect() ?? null
    : null
  const ideMenuRect = ideMenuButtonRef.current?.getBoundingClientRect() ?? null

  // Only show custom titlebar on Windows/Linux
  if (window.api.platform === 'darwin') return null

  return (
    <>
    {titleBarHidden && (
      <div
        className="no-drag fixed inset-x-0 top-0 z-[119] h-2"
        onMouseEnter={() => setTitleBarRevealHovered(true)}
      />
    )}
    <div
      className={cn(
        'titlebar-fixed drag-region flex h-10 shrink-0 items-center justify-between bg-[var(--color-titlebar-bg)] transition-[transform,box-shadow] duration-200 ease-out',
        titleBarHidden
          ? 'fixed inset-x-0 top-0 z-[120] shadow-xl shadow-black/25'
          : 'relative',
        titleBarHidden && (titleBarRevealed ? 'translate-y-0' : '-translate-y-full shadow-none'),
      )}
      onMouseEnter={() => setTitleBarRevealHovered(true)}
    >
      <div
        ref={titleMenuRef}
        className="no-drag flex items-center pl-3"
        onMouseEnter={() => {
          clearMenuCloseTimer()
          setMenuAreaHovered(true)
        }}
        onMouseLeave={() => {
          setMenuAreaHovered(false)
          scheduleMenuClose()
        }}
      >
        <div className="flex items-center gap-2 pr-3">
          <img
            src={appIcon}
            alt=""
            className="h-5 w-5 shrink-0 rounded-[5px]"
            draggable={false}
          />
          <span className="text-sm font-semibold text-[var(--color-text-secondary)]">Pragma Desk</span>
        </div>

        <div
          className={cn(
            'flex min-w-[188px] items-center gap-0.5 transition-all duration-150',
            menuVisible ? 'translate-x-0 opacity-100' : 'translate-x-1 opacity-0 pointer-events-none',
          )}
        >
          {titleMenus.map((menu) => {
            const isOpen = activeMenu === menu.id
            return (
              <div key={menu.id} className="relative">
                <button
                  ref={(node) => {
                    menuButtonRefs.current[menu.id] = node
                  }}
                  type="button"
                  onMouseEnter={() => {
                    clearMenuCloseTimer()
                    setActiveMenu(menu.id)
                  }}
                  onClick={() => setActiveMenu((current) => current === menu.id ? null : menu.id)}
                  className={cn(
                    TITLE_MENU_BUTTON,
                    isOpen && 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]',
                  )}
                >
                  {menu.label}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div
        className={cn(
          showTitleBarSearch
            ? 'flex min-w-0 flex-1 justify-center px-3 pointer-events-none'
            : 'absolute inset-x-0 flex justify-center pointer-events-none',
        )}
      >
        <div className={cn('pointer-events-auto', showTitleBarSearch && 'w-full min-w-0 max-w-[520px]')}>
          {showTitleBarSearch ? (
            <TitleBarSearch />
          ) : showMusicPlayer ? (
            <MusicPlayer />
          ) : (
            <div className="px-3">
              {titleProject ? (
                <span className="flex max-w-[360px] items-baseline gap-1.5 truncate text-base font-semibold text-[var(--color-text-primary)]">
                  <span className="min-w-0 truncate">{titleProject.name}</span>
                  {selectedWorktree && !selectedWorktree.isMain && (
                    <span className="ml-1.5 text-sm font-normal text-[var(--color-text-tertiary)]">
                      / {selectedWorktree.branch}
                    </span>
                  )}
                  {activeSession && (
                    <>
                      <span className="shrink-0 text-sm font-normal text-[var(--color-text-tertiary)]">·</span>
                      <span className="min-w-0 truncate text-sm font-medium text-[var(--color-text-secondary)]">
                        {activeSession.name}
                      </span>
                    </>
                  )}
                </span>
              ) : (
                <span className="text-sm text-[var(--color-text-tertiary)]">未选择项目</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="no-drag flex h-full items-center">
        <button
          type="button"
          onClick={handleRunButtonClick}
          onContextMenu={handleRunButtonContextMenu}
          disabled={!selectedProjectId || !activeProjectPath}
          className={cn(
            'mr-2 inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-[var(--ui-font-xs)] font-semibold transition-colors duration-100',
            titleRunActive
              ? 'bg-[var(--color-error)]/14 text-[var(--color-error)] hover:bg-[var(--color-error)]/20'
              : titleRunProfile
                ? 'bg-[var(--color-accent)]/14 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
            (!selectedProjectId || !activeProjectPath) && 'cursor-not-allowed opacity-50 hover:bg-transparent',
          )}
          title={runButtonTitle}
        >
          {titleRunActive ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          <span>{titleRunActive ? '停止' : '运行'}</span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={todoPopoverOpen}
          aria-label={todoPopoverOpen ? '关闭项目 Todo' : '打开项目 Todo'}
          onClick={toggleTodoPopover}
          className={cn(
            'relative mr-2 flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] transition-colors duration-100',
            todoPopoverOpen
              ? 'bg-[var(--color-accent)]/18 text-[var(--color-accent)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
          )}
          title="项目 Todo"
        >
          <ListTodo size={14} />
          {activeTodoCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[9px] font-semibold leading-none text-white shadow-sm">
              {activeTodoCount > 99 ? '99+' : activeTodoCount}
            </span>
          )}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={focusModeActive}
          aria-label={focusModeActive ? '退出专注模式' : '进入专注模式'}
          onClick={handleToggleFocusMode}
          className={cn(
            'mr-2 flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] transition-colors duration-100',
            focusModeActive
              ? 'bg-[var(--color-accent)]/18 text-[var(--color-accent)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
          )}
          title={focusModeActive ? '退出专注模式' : '进入专注模式'}
        >
          <Focus size={14} />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={workspaceLayout === 'canvas'}
          aria-label={workspaceLayout === 'canvas' ? '当前为画布模式，点击切换为经典模式' : '当前为经典模式，点击切换为画布模式'}
          onClick={handleToggleWorkspaceLayout}
          className={cn(
            'group relative isolate mr-2 flex h-7.5 w-[142px] items-center rounded-full p-[3px] cursor-pointer',
            isDarkTheme
              ? 'bg-[#121214] ring-1 ring-inset ring-white/[0.05] shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]'
              : 'bg-[color-mix(in_srgb,var(--color-bg-tertiary)_82%,white)] ring-1 ring-inset ring-[var(--color-border)] shadow-[inset_0_1px_2px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.08)]',
            'transition-all duration-200 active:scale-[0.97]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/80',
          )}
          title={workspaceLayout === 'canvas' ? '点击切换为经典模式' : '点击切换为画布模式'}
        >
          {/* Ambient Glow tracking the active state */}
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 w-[calc(50%-3px)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
              workspaceLayout === 'canvas' ? 'translate-x-full' : 'translate-x-0'
            )}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-4 bg-[var(--color-accent)]/40 blur-[10px] rounded-full" />
          </div>

          {/* Sliding Glass Thumb */}
          <div
            className={cn(
              'absolute left-[3px] top-[3px] h-[calc(100%-6px)] w-[calc(50%-3px)] rounded-full',
              isDarkTheme
                ? 'bg-gradient-to-b from-white/[0.12] to-white/[0.04] ring-1 ring-inset ring-white/[0.15] shadow-[0_2px_8px_rgba(0,0,0,0.5),0_0_0_1px_rgba(0,0,0,0.3)]'
                : 'bg-white ring-1 ring-inset ring-[var(--color-border)] shadow-[0_1px_5px_rgba(15,23,42,0.16),0_0_0_1px_rgba(255,255,255,0.9)]',
              'backdrop-blur-md',
              'transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
              workspaceLayout === 'canvas' ? 'translate-x-full' : 'translate-x-0'
            )}
          >
            {/* Top highlight line for extra crispness */}
            <div className="absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          </div>

          {/* Label 1: Classic */}
          <div
            className={cn(
              'relative z-10 flex flex-1 items-center justify-center gap-1.5 text-[11px] font-bold tracking-wider transition-all duration-300',
              workspaceLayout === 'canvas'
                ? 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] scale-95'
                : cn(
                    'scale-100',
                    isDarkTheme
                      ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                      : 'text-[var(--color-text-primary)]'
                  )
            )}
          >
            <Columns2
              size={12}
              strokeWidth={workspaceLayout === 'canvas' ? 2 : 2.5}
              className={cn(
                'transition-colors duration-300',
                workspaceLayout === 'canvas' ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-accent)]'
              )}
            />
            经典
          </div>

          {/* Label 2: Canvas */}
          <div
            className={cn(
              'relative z-10 flex flex-1 items-center justify-center gap-1.5 text-[11px] font-bold tracking-wider transition-all duration-300',
              workspaceLayout === 'canvas'
                ? cn(
                    'scale-100',
                    isDarkTheme
                      ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                      : 'text-[var(--color-text-primary)]'
                  )
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] scale-95'
            )}
          >
            <LayoutGrid
              size={12}
              strokeWidth={workspaceLayout === 'canvas' ? 2.5 : 2}
              className={cn(
                'transition-colors duration-300',
                workspaceLayout === 'canvas' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)]'
              )}
            />
            画布
          </div>
        </button>
        <div ref={ideMenuRef} className="relative mr-1 flex h-7 items-center">
          <button
            onClick={() => {
              const primaryIde = availableIdes[0]
              if (primaryIde) void handleOpenInIde(primaryIde)
            }}
            disabled={!activeProjectPath || availableIdes.length === 0}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-l-[var(--radius-md)] border border-r-0 pl-2.5 pr-2 text-[var(--ui-font-xs)]',
              'transition-colors duration-100',
              activeProjectPath && availableIdes.length > 0
                ? 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-tertiary)]'
                : 'cursor-not-allowed border-[var(--color-border)]/60 text-[var(--color-text-tertiary)] opacity-60',
            )}
            title={
              !activeProjectPath
                ? '请先选择项目'
                : availableIdes.length === 0
                  ? '未检测到已安装的 IDE'
                  : `用 ${availableIdes[0]?.label ?? 'IDE'} 打开`
            }
          >
            <ExternalLink size={12} />
            <span>{availableIdes[0]?.label ?? 'IDE 打开'}</span>
          </button>
          <button
            ref={ideMenuButtonRef}
            onClick={() => setIdeMenuOpen((open) => !open)}
            disabled={!activeProjectPath || availableIdes.length === 0}
            className={cn(
              'flex h-7 items-center rounded-r-[var(--radius-md)] border border-l-0 px-1.5 text-[var(--ui-font-xs)]',
              'transition-colors duration-100',
              activeProjectPath && availableIdes.length > 0
                ? 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-tertiary)]'
                : 'cursor-not-allowed border-[var(--color-border)]/60 text-[var(--color-text-tertiary)] opacity-60',
            )}
            title="选择其他 IDE"
          >
            <ChevronDown size={12} className={cn('transition-transform', ideMenuOpen && 'rotate-180')} />
          </button>
        </div>

        <button
          onClick={() => openSettings()}
          className={cn(
            'flex h-full w-11 items-center justify-center',
            'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
            'transition-colors duration-100',
          )}
          title="设置"
        >
          <Settings size={14} />
        </button>
        <button
          onClick={handleMinimize}
          className={cn(
            'flex h-full w-11 items-center justify-center',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]',
            'transition-colors duration-100',
          )}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className={cn(
            'flex h-full w-11 items-center justify-center',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]',
            'transition-colors duration-100',
          )}
        >
          <Square size={maximized ? 10 : 11} />
        </button>
        <button
          onClick={handleClose}
          className={cn(
            'flex h-full w-11 items-center justify-center',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-error)] hover:text-white',
            'transition-colors duration-100',
          )}
        >
          <X size={14} />
        </button>
      </div>

      {activeMenuDefinition && activeMenuRect && createPortal(
        <div
          ref={titleMenuPopupRef}
          className="no-drag fixed z-[120] min-w-[210px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/35"
          style={{
            top: activeMenuRect.bottom + 6,
            left: Math.min(activeMenuRect.left, window.innerWidth - 226),
          }}
          onMouseEnter={clearMenuCloseTimer}
          onMouseLeave={scheduleMenuClose}
        >
          {activeMenuDefinition.items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                clearMenuCloseTimer()
                setActiveMenu(null)
                void item.onSelect()
              }}
              disabled={item.disabled}
              className={cn(TITLE_MENU_ITEM, 'no-drag')}
            >
              <span className="flex items-center gap-2">
                <item.icon size={13} />
                {item.label}
              </span>
              {item.hint && (
                <span className="text-[10px] text-[var(--color-text-tertiary)]">{item.hint}</span>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {runDialogOpen && selectedProject && (
        <TitleBarRunDialog
          projectName={selectedProject.name}
          initialProfile={titleRunProfile}
          onClose={() => setRunDialogOpen(false)}
          onSave={handleSaveRunProfile}
        />
      )}

      {ideMenuOpen && ideMenuRect && createPortal(
        <>
          <div className="no-drag fixed inset-0 z-[119]" onClick={() => setIdeMenuOpen(false)} />
          <div
            ref={ideMenuPopupRef}
            className="no-drag fixed z-[120] w-48 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/35"
            style={{
              top: ideMenuRect.bottom + 6,
              left: Math.min(ideMenuRect.right - 192, window.innerWidth - 200),
            }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
              用其他 IDE 打开
            </div>
            {availableIdes.map((ide) => (
              <button
                key={ide.id}
                onClick={() => void handleOpenInIde(ide)}
                className="no-drag flex w-full items-center justify-between px-3 py-2 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                <span>{ide.label}</span>
                <ExternalLink size={12} className="text-[var(--color-text-tertiary)]" />
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
    </>
  )
}
