import { Minus, Square, X, Zap, PanelLeftOpen, PanelLeftClose } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { MusicPlayer } from './MusicPlayer'

export function TitleBar(): JSX.Element | null {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
  }, [])

  const handleMinimize = useCallback(() => window.api.window.minimize(), [])
  const handleMaximize = useCallback(async () => {
    await window.api.window.maximize()
    setMaximized(await window.api.window.isMaximized())
  }, [])
  const handleClose = useCallback(() => window.api.window.close(), [])

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const showMusicPlayer = useUIStore((s) => s.settings.showMusicPlayer)

  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.selectedProjectId),
  )
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const selectedWorktree = useWorktreesStore((s) =>
    s.worktrees.find((w) => w.id === s.selectedWorktreeId),
  )

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
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">FastAgents</span>
      </div>

      {/* Center: Music player or Project name */}
      <div className="absolute inset-x-0 flex justify-center pointer-events-none">
        <div className="pointer-events-auto">
          {showMusicPlayer ? (
            <MusicPlayer />
          ) : (
            <div className="px-3">
              {selectedProject ? (
                <span className="max-w-[260px] truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {selectedProject.name}
                  {selectedWorktree && !selectedWorktree.isMain && (
                    <span className="ml-1.5 text-xs font-normal text-[var(--color-text-tertiary)]">
                      / {selectedWorktree.branch}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-xs text-[var(--color-text-tertiary)]">No project selected</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Window controls */}
      <div className="no-drag flex h-full">
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
