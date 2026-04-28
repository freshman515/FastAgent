import { Bell, Columns2, FileText, GitBranch, Layers, Circle, Clock, Palette, TreeDeciduous } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useGitStore } from '@/stores/git'
import { useWorktreesStore } from '@/stores/worktrees'
import { usePanesStore } from '@/stores/panes'
import { useEditorsStore, FILE_ICONS } from '@/stores/editors'
import { useUIStore } from '@/stores/ui'

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h${mins > 0 ? `${mins}m` : ''}`
}

function formatClock(timestamp: number): string {
  const d = new Date(timestamp)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

function countPaneLeaves(node: { type: string; first?: unknown; second?: unknown }): number {
  if (node.type === 'leaf') return 1
  return countPaneLeaves(node.first as { type: string; first?: unknown; second?: unknown })
    + countPaneLeaves(node.second as { type: string; first?: unknown; second?: unknown })
}

export function StatusBar(): JSX.Element {
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.selectedProjectId),
  )
  const allSessions = useSessionsStore((s) => s.sessions)
  const branchInfo = useGitStore((s) =>
    selectedProjectId ? s.branchInfo[selectedProjectId] : undefined,
  )
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const selectedWorktree = useWorktreesStore((s) =>
    s.worktrees.find((w) => w.id === s.selectedWorktreeId),
  )
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const activeSessionId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const activeSession = useSessionsStore((s) => s.sessions.find((x) => x.id === activeSessionId))
  const outputStates = useSessionsStore((s) => s.outputStates)
  const cursorInfo = useEditorsStore((s) => s.cursorInfo)
  const editorTabs = useEditorsStore((s) => s.tabs)
  const paneRoot = usePanesStore((s) => s.root)
  const openSettings = useUIStore((s) => s.openSettings)
  const terminalTheme = useUIStore((s) => s.settings.terminalTheme)
  const activeEditorTab = useEditorsStore((s) => activeSessionId?.startsWith('editor-') ? s.tabs.find((t) => t.id === activeSessionId) : undefined)

  // Project sessions
  const projectSessions = useMemo(
    () => (selectedProjectId ? allSessions.filter((s) => s.projectId === selectedProjectId) : []),
    [allSessions, selectedProjectId],
  )
  const runningSessions = useMemo(
    () => projectSessions.filter((s) => s.status === 'running'),
    [projectSessions],
  )

  // Session uptime
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const activeUptime = activeSession?.status === 'running' && activeSession.createdAt
    ? formatUptime(now - activeSession.createdAt)
    : null

  // Unread sessions — across current project
  const unreadCount = useMemo(
    () => projectSessions.filter((s) => outputStates[s.id] === 'unread').length,
    [projectSessions, outputStates],
  )
  const outputtingCount = useMemo(
    () => projectSessions.filter((s) => outputStates[s.id] === 'outputting').length,
    [projectSessions, outputStates],
  )

  // Open editor count — scoped to current project
  const projectEditorCount = useMemo(
    () => (selectedProjectId ? editorTabs.filter((t) => t.projectId === selectedProjectId).length : 0),
    [editorTabs, selectedProjectId],
  )

  // Split panes count
  const paneCount = useMemo(() => countPaneLeaves(paneRoot), [paneRoot])

  // Worktree marker — shown only when on a non-main worktree
  const worktreeName = selectedWorktree && !selectedWorktree.isMain ? selectedWorktree.branch : null

  const clockText = formatClock(now)

  // Branch display
  const branch = selectedWorktree && !selectedWorktree.isMain
    ? selectedWorktree.branch
    : branchInfo?.current
  const isDirty = branchInfo?.isDirty ?? false

  const ITEM = 'flex items-center gap-1.5 px-2 py-0.5 text-[var(--ui-font-sm)] transition-colors duration-75'

  return (
    <div className="status-bar-frame flex h-10 shrink-0 items-center justify-between rounded-[var(--radius-panel)] px-1 select-none">
      {/* Left section */}
      <div className="flex items-center gap-0 min-w-0">
        {/* Project name */}
        {selectedProject ? (
          <span className={cn(ITEM, 'font-medium text-[var(--color-text-secondary)]')}>
            {selectedProject.name}
          </span>
        ) : (
          <span className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}>无项目</span>
        )}

        {/* Git branch */}
        {branch && (
          <span className={cn(
            ITEM,
            isDirty ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-tertiary)]',
          )}>
            <GitBranch size={11} />
            <span className="max-w-[260px] truncate">{branch}</span>
            {isDirty && <Circle size={6} fill="currentColor" />}
          </span>
        )}

        {/* Worktree marker (non-main only) */}
        {worktreeName && (
          <span
            className={cn(ITEM, 'text-[var(--color-accent)]')}
            title={`当前工作树：${worktreeName}`}
          >
            <TreeDeciduous size={11} />
            <span className="max-w-[260px] truncate">{worktreeName}</span>
          </span>
        )}

        {/* Separator */}
        {selectedProject && (
          <div className="mx-0.5 h-3 w-px bg-[var(--color-border)]" />
        )}

        {/* Running / Total sessions */}
        <span className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}>
          <Layers size={11} />
          <span>
            {runningSessions.length > 0 && (
              <span className="text-[var(--color-success)]">{runningSessions.length} 运行中</span>
            )}
            {runningSessions.length > 0 && projectSessions.length > runningSessions.length && ' / '}
            {(runningSessions.length === 0 || projectSessions.length > runningSessions.length) && (
              <span>{projectSessions.length} 个会话</span>
            )}
          </span>
        </span>

        {/* Editor tabs count — only when current project has opened editors */}
        {selectedProject && projectEditorCount > 0 && (
          <span
            className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}
            title={`当前项目已打开 ${projectEditorCount} 个编辑器`}
          >
            <FileText size={11} />
            <span className="tabular-nums">{projectEditorCount}</span>
          </span>
        )}

        {/* Unread / outputting notifications */}
        {(unreadCount > 0 || outputtingCount > 0) && (
          <span
            className={cn(ITEM, unreadCount > 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-success)]')}
            title={
              unreadCount > 0 && outputtingCount > 0
                ? `${unreadCount} 个未读，${outputtingCount} 个输出中`
                : unreadCount > 0
                  ? `${unreadCount} 个会话有未读输出`
                  : `${outputtingCount} 个会话正在输出`
            }
          >
            <Bell size={11} />
            <span className="tabular-nums">
              {unreadCount > 0 && `${unreadCount}`}
              {unreadCount > 0 && outputtingCount > 0 && ' · '}
              {outputtingCount > 0 && `${outputtingCount}▸`}
            </span>
          </span>
        )}

        {/* Split panes count — only when in split view */}
        {paneCount > 1 && (
          <span
            className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}
            title={`当前有 ${paneCount} 个分屏`}
          >
            <Columns2 size={11} />
            <span className="tabular-nums">{paneCount}</span>
          </span>
        )}

      </div>

      {/* Right section */}
      <div className="flex items-center gap-0">
        {/* Editor cursor info */}
        {activeEditorTab && cursorInfo && (() => {
          const iconInfo = FILE_ICONS[activeEditorTab.language] ?? FILE_ICONS.plaintext
          return (
            <>
              <span className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}>
                <span className="rounded px-[3px] py-px text-[8px] font-bold leading-none" style={{ backgroundColor: iconInfo.color + '20', color: iconInfo.color }}>
                  {iconInfo.icon}
                </span>
                <span>{activeEditorTab.language}</span>
              </span>
              <div className="mx-0.5 h-3 w-px bg-[var(--color-border)]" />
              <span className={cn(ITEM, 'text-[var(--color-text-tertiary)] tabular-nums')}>
                行 {cursorInfo.line}, 列 {cursorInfo.column}
                {cursorInfo.selection && (
                  <span className="text-[var(--color-accent)] ml-1">
                    (已选 {cursorInfo.selection.chars} 字符)
                  </span>
                )}
              </span>
              <div className="mx-0.5 h-3 w-px bg-[var(--color-border)]" />
              <span className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}>UTF-8</span>
            </>
          )
        })()}

        {/* Active session status */}
        {activeSession && (
          <span className={cn(ITEM, 'text-[var(--color-text-tertiary)]')}>
            <Circle
              size={7}
              fill={activeSession.status === 'running' ? 'var(--color-success)' : 'var(--color-text-tertiary)'}
              className={cn(
                activeSession.status === 'running' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]',
                activeSession.status === 'running' && 'animate-pulse',
              )}
            />
            <span className="max-w-[140px] truncate">{activeSession.name}</span>
          </span>
        )}

        {/* Uptime */}
        {activeUptime && (
          <span className={cn(ITEM, 'text-[var(--color-text-tertiary)] tabular-nums')}>
            <Clock size={11} />
            {activeUptime}
          </span>
        )}

        {/* Theme (click to jump to theme settings) */}
        <button
          type="button"
          onClick={() => openSettings('appearance')}
          className={cn(
            ITEM,
            'cursor-pointer text-[var(--color-text-tertiary)] rounded-[var(--radius-sm)]',
            'hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
          )}
          title={`终端主题：${terminalTheme}（点击切换）`}
        >
          <Palette size={11} />
          <span className="max-w-[140px] truncate">{terminalTheme}</span>
        </button>

        {/* Wall clock */}
        <span
          className={cn(ITEM, 'text-[var(--color-text-tertiary)] tabular-nums')}
          title={new Date(now).toLocaleString()}
        >
          {clockText}
        </span>
      </div>
    </div>
  )
}
