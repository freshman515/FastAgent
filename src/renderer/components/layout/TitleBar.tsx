import { Minus, Square, X, Zap, PanelLeftOpen, PanelLeftClose, ChevronDown, ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { MusicPlayer } from './MusicPlayer'
import { TitleBarSearch } from './TitleBarSearch'
import type { ExternalIdeOption } from '@shared/types'

export function TitleBar(): JSX.Element | null {
  const [maximized, setMaximized] = useState(false)
  const [ideMenuOpen, setIdeMenuOpen] = useState(false)
  const [availableIdes, setAvailableIdes] = useState<ExternalIdeOption[]>([])
  const ideMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    window.api.shell.listIdes().then(setAvailableIdes).catch(() => setAvailableIdes([]))
  }, [])

  useEffect(() => {
    if (!ideMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!ideMenuRef.current?.contains(event.target as Node)) {
        setIdeMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIdeMenuOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [ideMenuOpen])

  const handleMinimize = useCallback(() => window.api.window.minimize(), [])
  const handleMaximize = useCallback(async () => {
    await window.api.window.maximize()
    setMaximized(await window.api.window.isMaximized())
  }, [])
  const handleClose = useCallback(() => window.api.window.close(), [])

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const showMusicPlayer = useUIStore((s) => s.settings.showMusicPlayer)
  const showTitleBarSearch = useUIStore((s) => s.settings.showTitleBarSearch)
  const addToast = useUIStore((s) => s.addToast)

  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.selectedProjectId),
  )
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const selectedWorktree = useWorktreesStore((s) =>
    s.worktrees.find((w) => w.id === s.selectedWorktreeId),
  )
  const activeProjectPath = selectedWorktree?.path ?? selectedProject?.path ?? null

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

  // Only show custom titlebar on Windows/Linux
  if (window.api.platform === 'darwin') return null

  return (
    <div className="titlebar-fixed drag-region relative flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Left: App logo + name */}
      <div className="flex items-center gap-1 pl-2">
        <button
          onClick={toggleSidebar}
          className={cn(
            'no-drag flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
            'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
            'transition-colors duration-100',
          )}
          title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
        <Zap size={14} className="text-[var(--color-accent)]" />
        <span className="text-sm font-semibold text-[var(--color-text-secondary)]">FastAgents</span>
      </div>

      {/* Center: Search or Music player / Project name */}
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
                <span className="text-sm text-[var(--color-text-tertiary)]">No project selected</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Window controls */}
      <div className="no-drag flex h-full items-center">
        <div ref={ideMenuRef} className="relative mr-1">
          <button
            onClick={() => setIdeMenuOpen((open) => !open)}
            disabled={!activeProjectPath || availableIdes.length === 0}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[var(--ui-font-xs)]',
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
                  : '用其他 IDE 打开当前项目'
            }
          >
            <ExternalLink size={12} />
            <span>IDE 打开</span>
            <ChevronDown size={12} className={cn('transition-transform', ideMenuOpen && 'rotate-180')} />
          </button>

          {ideMenuOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-48 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/30">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                用其他 IDE 打开
              </div>
              {availableIdes.map((ide) => (
                <button
                  key={ide.id}
                  onClick={() => void handleOpenInIde(ide)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  <span>{ide.label}</span>
                  <ExternalLink size={12} className="text-[var(--color-text-tertiary)]" />
                </button>
              ))}
            </div>
          )}
        </div>
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
          <Square size={11} />
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
    </div>
  )
}
