import { ChevronDown, ChevronRight, GitBranch, RefreshCw, Circle, FileText, Plus, Minus, Edit3, Undo2, Check, ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { useGitStore } from '@/stores/git'
import { useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'

interface GitFileStatus {
  path: string
  status: string
  staged: boolean
}

const STATUS_COLORS: Record<string, string> = {
  M: 'text-[var(--color-warning)]',
  A: 'text-[var(--color-success)]',
  D: 'text-[var(--color-error)]',
  '?': 'text-[var(--color-text-tertiary)]',
  R: 'text-[var(--color-info)]',
  U: 'text-[var(--color-error)]',
}

const STATUS_LABELS: Record<string, string> = {
  M: 'M', A: 'A', D: 'D', '?': 'U', R: 'R', U: 'U',
}

const HEADER_ICON_BUTTON = 'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-secondary)]'
const ROW_ICON_BUTTON = 'flex h-5.5 w-5.5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface)]'

export function GitChanges(): JSX.Element {
  const selectedProject = useProjectsStore((s) => s.projects.find((p) => p.id === s.selectedProjectId))
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedWorktree = useWorktreesStore((s) => s.worktrees.find((w) => w.id === s.selectedWorktreeId))
  const branchInfo = useGitStore((s) => selectedProjectId ? s.branchInfo[selectedProjectId] : undefined)
  const projectPath = selectedWorktree?.path ?? selectedProject?.path
  const editorWorktreeId = selectedWorktree && !selectedWorktree.isMain ? selectedWorktree.id : undefined

  const [files, setFiles] = useState<GitFileStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [stagedCollapsed, setStagedCollapsed] = useState(false)
  const [changesCollapsed, setChangesCollapsed] = useState(false)

  const fetchStatus = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const result: GitFileStatus[] = await window.api.git.status(projectPath)
      setFiles(result)
    } catch { setFiles([]) }
    setLoading(false)
  }, [projectPath])

  // Initial fetch + auto-refresh every 5 seconds
  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, 1500)
    const handleFocus = () => { void fetchStatus() }
    const handleFileSaved = () => { void fetchStatus() }
    window.addEventListener('focus', handleFocus)
    window.addEventListener('fastagents:file-saved', handleFileSaved as EventListener)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('fastagents:file-saved', handleFileSaved as EventListener)
    }
  }, [fetchStatus])

  const staged = useMemo(() => files.filter((f) => f.staged), [files])
  const unstaged = useMemo(() => files.filter((f) => !f.staged), [files])

  const handleOpenFile = useCallback((filePath: string) => {
    if (!projectPath) return
    const fullPath = `${projectPath}/${filePath}`
    const tabId = useEditorsStore.getState().openFile(fullPath, {
      projectId: selectedProjectId,
      worktreeId: editorWorktreeId,
    })
    const ps = usePanesStore.getState()
    ps.addSessionToPane(ps.activePaneId, tabId)
    ps.setPaneActiveSession(ps.activePaneId, tabId)
  }, [projectPath, selectedProjectId, editorWorktreeId])

  const handleOpenDiff = useCallback(async (filePath: string) => {
    if (!projectPath) return
    try {
      const original = await window.api.git.showHead(projectPath, filePath)
      const fullPath = `${projectPath}/${filePath}`
      const tabId = useEditorsStore.getState().openDiff(fullPath, original, {
        projectId: selectedProjectId, worktreeId: editorWorktreeId,
      })
      const ps = usePanesStore.getState()
      ps.addSessionToPane(ps.activePaneId, tabId)
      ps.setPaneActiveSession(ps.activePaneId, tabId)
    } catch {
      handleOpenFile(filePath)
    }
  }, [projectPath, selectedProjectId, editorWorktreeId, handleOpenFile])

  const handleStage = useCallback(async (filePath: string) => {
    if (!projectPath) return
    await window.api.git.stage(projectPath, filePath)
    fetchStatus()
  }, [projectPath, fetchStatus])

  const handleUnstage = useCallback(async (filePath: string) => {
    if (!projectPath) return
    await window.api.git.unstage(projectPath, filePath)
    fetchStatus()
  }, [projectPath, fetchStatus])

  const handleDiscard = useCallback(async (filePath: string) => {
    if (!projectPath) return
    await window.api.git.discard(projectPath, filePath)
    fetchStatus()
  }, [projectPath, fetchStatus])

  const handleStageAll = useCallback(async () => {
    if (!projectPath) return
    await window.api.git.stage(projectPath, '.')
    fetchStatus()
  }, [projectPath, fetchStatus])

  const handleUnstageAll = useCallback(async () => {
    if (!projectPath) return
    for (const f of staged) await window.api.git.unstage(projectPath, f.path)
    fetchStatus()
  }, [projectPath, staged, fetchStatus])

  const handleCommit = useCallback(async () => {
    if (!projectPath || !commitMsg.trim()) return
    setCommitting(true)
    try {
      await window.api.git.commit(projectPath, commitMsg.trim())
      setCommitMsg('')
      fetchStatus()
      if (selectedProjectId) useGitStore.getState().fetchStatus(selectedProjectId, projectPath)
    } catch { /* ignore */ }
    setCommitting(false)
  }, [projectPath, commitMsg, fetchStatus, selectedProjectId])

  const branch = branchInfo?.current
  const isDirty = branchInfo?.isDirty ?? false

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">No project selected</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Branch + refresh */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <GitBranch size={13} className="text-[var(--color-text-tertiary)]" />
            <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{branch ?? 'no branch'}</span>
            {isDirty && <Circle size={6} fill="var(--color-warning)" className="text-[var(--color-warning)]" />}
          </div>
          <button
            onClick={fetchStatus}
            className={cn(HEADER_ICON_BUTTON, loading && 'animate-spin')}
            title="刷新"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Commit input — always visible when there are staged files */}
      {staged.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]">
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && commitMsg.trim()) handleCommit() }}
            placeholder={`消息 (Ctrl+Enter 在"${branch}"提交)`}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)] mb-1.5"
          />
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || committing}
            className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-[var(--ui-font-xs)] text-white hover:opacity-90 disabled:opacity-40"
          >
            <Check size={12} /> {committing ? '提交中...' : '提交'}
          </button>
        </div>
      )}

      {/* File lists */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 && (
          <div className="text-center py-8 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
            {loading ? '加载中...' : '工作区干净'}
          </div>
        )}

        {/* Staged changes */}
        {staged.length > 0 && (
          <div>
            <button
              onClick={() => setStagedCollapsed(!stagedCollapsed)}
              className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[var(--color-bg-tertiary)] transition-colors"
            >
              <div className="flex items-center gap-1">
                {stagedCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">暂存的更改</span>
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-success)]/15 px-1 text-[9px] font-medium text-[var(--color-success)]">{staged.length}</span>
              </div>
              <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                <button onClick={handleUnstageAll} className={cn(HEADER_ICON_BUTTON, 'hover:text-[var(--color-warning)]')} title="全部取消暂存">
                  <Minus size={14} />
                </button>
              </div>
            </button>
            {!stagedCollapsed && staged.map((f) => (
              <FileRow
                key={`s-${f.path}`}
                file={f}
                onClick={() => handleOpenDiff(f.path)}
                actions={
                  <>
                    <button onClick={(e) => { e.stopPropagation(); handleOpenFile(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-text-secondary)]')} title="打开文件">
                      <ExternalLink size={13} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleUnstage(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-warning)]')} title="取消暂存">
                      <Minus size={13} />
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}

        {/* Unstaged changes */}
        {unstaged.length > 0 && (
          <div>
            <button
              onClick={() => setChangesCollapsed(!changesCollapsed)}
              className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[var(--color-bg-tertiary)] transition-colors"
            >
              <div className="flex items-center gap-1">
                {changesCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">更改</span>
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-bg-surface)] px-1 text-[9px] font-medium text-[var(--color-text-tertiary)]">{unstaged.length}</span>
              </div>
              <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { for (const f of unstaged) if (f.status !== '?') handleDiscard(f.path) }}
                  className={cn(HEADER_ICON_BUTTON, 'hover:text-[var(--color-error)]')} title="放弃所有更改">
                  <Undo2 size={14} />
                </button>
                <button onClick={handleStageAll} className={cn(HEADER_ICON_BUTTON, 'hover:text-[var(--color-success)]')} title="暂存所有更改">
                  <Plus size={14} />
                </button>
              </div>
            </button>
            {!changesCollapsed && unstaged.map((f) => (
              <FileRow
                key={`u-${f.path}`}
                file={f}
                onClick={() => handleOpenDiff(f.path)}
                actions={
                  <>
                    <button onClick={(e) => { e.stopPropagation(); handleOpenFile(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-text-secondary)]')} title="打开文件">
                      <ExternalLink size={13} />
                    </button>
                    {f.status !== '?' && (
                      <button onClick={(e) => { e.stopPropagation(); handleDiscard(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-error)]')} title="放弃更改">
                        <Undo2 size={13} />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleStage(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-success)]')} title="暂存更改">
                      <Plus size={13} />
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FileRow({ file, onClick, actions }: { file: GitFileStatus; onClick: () => void; actions?: React.ReactNode }): JSX.Element {
  const color = STATUS_COLORS[file.status] ?? 'text-[var(--color-text-tertiary)]'
  const label = STATUS_LABELS[file.status] ?? file.status
  const fileName = file.path.split(/[/\\]/).pop() ?? file.path
  const dirName = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''

  return (
    <div
      onClick={onClick}
      className="group flex w-full items-center gap-1.5 px-3 pl-7 py-[3px] text-[var(--ui-font-xs)] hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
    >
      <span className="flex-1 truncate text-[var(--color-text-secondary)] text-left">
        {fileName}
        {dirName && <span className="ml-1.5 text-[var(--color-text-tertiary)] text-[10px]">{dirName}</span>}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {actions}
      </div>
      <span className={cn('shrink-0 w-4 text-center text-[10px] font-mono font-bold', color)}>{label}</span>
    </div>
  )
}
