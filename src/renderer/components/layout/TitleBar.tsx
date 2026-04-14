import { ChevronDown, Copy, ExternalLink, FolderOpen, GitBranch, HelpCircle, Info, ListTodo, Minus, PanelLeftOpen, PanelRightOpen, Plus, Search, Settings, Square, X, Zap, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { MusicPlayer } from './MusicPlayer'
import { TitleBarSearch } from './TitleBarSearch'
import type { ExternalIdeOption } from '@shared/types'
import { setCurrentSessionFullscreen, toggleCurrentSessionFullscreen } from '@/lib/currentSessionFullscreen'

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

export function TitleBar(): JSX.Element | null {
  const [maximized, setMaximized] = useState(false)
  const [ideMenuOpen, setIdeMenuOpen] = useState(false)
  const [activeMenu, setActiveMenu] = useState<TitleMenuId | null>(null)
  const [menuAreaHovered, setMenuAreaHovered] = useState(false)
  const [availableIdes, setAvailableIdes] = useState<ExternalIdeOption[]>([])
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
  const updateSettings = useUIStore((s) => s.updateSettings)
  const openSettings = useUIStore((s) => s.openSettings)
  const toggleDockPanel = useUIStore((s) => s.toggleDockPanel)
  const activateDockPanel = useUIStore((s) => s.activateDockPanel)
  const addToast = useUIStore((s) => s.addToast)
  const activeTabId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const fullscreenPaneId = usePanesStore((s) => s.fullscreenPaneId)
  const windowFullscreen = useUIStore((s) => s.windowFullscreen)

  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.selectedProjectId),
  )
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const selectedWorktree = useWorktreesStore((s) =>
    s.worktrees.find((w) => w.id === s.selectedWorktreeId),
  )
  const activeProjectPath = selectedWorktree?.path ?? selectedProject?.path ?? null
  const menuVisible = titleBarMenuVisibility === 'always' || menuAreaHovered || activeMenu !== null

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

    const paneStore = usePanesStore.getState()
    const sessionStore = useSessionsStore.getState()
    const worktreeId = selectedWorktreeId ?? getDefaultWorktreeIdForProject(selectedProjectId)
    const sessionId = sessionStore.addSession(selectedProjectId, defaultSessionType, worktreeId)

    paneStore.addSessionToPane(paneStore.activePaneId, sessionId)
    paneStore.setPaneActiveSession(paneStore.activePaneId, sessionId)
    sessionStore.setActive(sessionId)
  }, [addToast, defaultSessionType, selectedProjectId, selectedWorktreeId])

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
      body: 'Ctrl+Tab 切换标签，Ctrl+W 关闭标签，Ctrl+Shift+T 恢复关闭，Ctrl+Alt+方向键切换分栏。',
      duration: 9000,
    })
  }, [addToast])

  const handleShowAbout = useCallback(() => {
    addToast({
      type: 'info',
      title: '关于 FastAgents',
      body: '一个面向多项目、多会话和多面板工作流的 Electron 桌面工作台。',
      duration: 9000,
    })
  }, [addToast])

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
            label: `新建${defaultSessionType === 'terminal' ? '终端' : '默认会话'}`,
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
            label: '关于 FastAgents',
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
    defaultSessionType,
    fullscreenPaneId,
    windowFullscreen,
    handleCopyText,
    handleCreateDefaultSession,
    handleOpenInIde,
    handleShowAbout,
    handleShowShortcuts,
    openSettings,
    selectedProject?.name,
    selectedProjectId,
    selectedWorktree?.branch,
    showTitleBarSearch,
    toggleDockPanel,
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
    <div className="titlebar-fixed drag-region relative flex h-10 shrink-0 items-center justify-between bg-[var(--color-titlebar-bg)]">
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
        <div className="flex items-center gap-1.5 pr-3">
          <Zap size={14} className="text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-secondary)]">FastAgents</span>
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

      <div className="absolute inset-x-0 flex justify-center pointer-events-none">
        <div className="pointer-events-auto">
          {showTitleBarSearch ? (
            <TitleBarSearch />
          ) : showMusicPlayer ? (
            <MusicPlayer />
          ) : (
            <div className="px-3">
              {selectedProject ? (
                <span className="max-w-[260px] truncate text-base font-semibold text-[var(--color-text-primary)]">
                  {selectedProject.name}
                  {selectedWorktree && !selectedWorktree.isMain && (
                    <span className="ml-1.5 text-sm font-normal text-[var(--color-text-tertiary)]">
                      / {selectedWorktree.branch}
                    </span>
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
          onClick={openSettings}
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
  )
}
