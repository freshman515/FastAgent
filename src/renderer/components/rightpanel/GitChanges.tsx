import { GitBranch, RefreshCw, Circle, FileText, Plus, Minus, Edit3, Undo2, Check } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { useGitStore } from '@/stores/git'

interface GitFileStatus {
  path: string
  status: string // 'M' | 'A' | 'D' | '?' | 'R' etc.
  staged: boolean
}

const STATUS_COLORS: Record<string, string> = {
  M: 'text-[var(--color-warning)]',
  A: 'text-[var(--color-success)]',
  D: 'text-[var(--color-error)]',
  '?': 'text-[var(--color-text-tertiary)]',
  R: 'text-[var(--color-info)]',
}

const STATUS_ICONS: Record<string, typeof Edit3> = {
  M: Edit3,
  A: Plus,
  D: Minus,
  '?': FileText,
}

export function GitChanges(): JSX.Element {
  const selectedProject = useProjectsStore((s) => s.projects.find((p) => p.id === s.selectedProjectId))
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedWorktree = useWorktreesStore((s) => s.worktrees.find((w) => w.id === s.selectedWorktreeId))
  const branchInfo = useGitStore((s) => selectedProjectId ? s.branchInfo[selectedProjectId] : undefined)
  const projectPath = selectedWorktree?.path ?? selectedProject?.path

  const [files, setFiles] = useState<GitFileStatus[]>([])
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)

  const fetchStatus = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const result: GitFileStatus[] = await window.api.git.status(projectPath)
      setFiles(result)
    } catch {
      setFiles([])
    }
    setLoading(false)
  }, [projectPath])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const handleFileClick = useCallback(async (filePath: string) => {
    if (!projectPath) return
    setSelectedFile(filePath)
    try {
      const diff: string = await window.api.git.diff(projectPath, filePath)
      setDiffContent(diff)
    } catch {
      setDiffContent(null)
    }
  }, [projectPath])

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
  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => !f.staged)

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">No project selected</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Branch info */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <GitBranch size={13} className="text-[var(--color-text-tertiary)]" />
            <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{branch ?? 'no branch'}</span>
            {isDirty && <Circle size={6} fill="var(--color-warning)" className="text-[var(--color-warning)]" />}
          </div>
          <button
            onClick={fetchStatus}
            className={cn(
              'p-1 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors',
              loading && 'animate-spin',
            )}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="text-center py-8 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
            {loading ? 'Loading...' : 'Working tree clean'}
          </div>
        ) : (
          <>
            {staged.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-success)]">Staged ({staged.length})</span>
                </div>
                {staged.map((f) => (
                  <FileRow key={`s-${f.path}`} file={f} selected={selectedFile === f.path} onClick={() => handleFileClick(f.path)}
                    actions={<button onClick={(e) => { e.stopPropagation(); handleUnstage(f.path) }} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-warning)]" title="Unstage"><Minus size={12} /></button>}
                  />
                ))}
              </div>
            )}
            {unstaged.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Changes ({unstaged.length})</span>
                  <button onClick={handleStageAll} className="text-[10px] text-[var(--color-accent)] hover:text-[var(--color-text-primary)]" title="Stage All">Stage All</button>
                </div>
                {unstaged.map((f) => (
                  <FileRow key={`u-${f.path}`} file={f} selected={selectedFile === f.path} onClick={() => handleFileClick(f.path)}
                    actions={
                      <div className="flex gap-0.5">
                        <button onClick={(e) => { e.stopPropagation(); handleStage(f.path) }} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-success)]" title="Stage"><Plus size={12} /></button>
                        {f.status !== '?' && <button onClick={(e) => { e.stopPropagation(); handleDiscard(f.path) }} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]" title="Discard"><Undo2 size={12} /></button>}
                      </div>
                    }
                  />
                ))}
              </div>
            )}

            {/* Commit */}
            {staged.length > 0 && (
              <div className="px-3 py-2 border-t border-[var(--color-border)]">
                <input
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && commitMsg.trim()) handleCommit() }}
                  placeholder="Commit message..."
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)] mb-1.5"
                />
                <button
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || committing}
                  className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1 text-[var(--ui-font-xs)] text-white hover:opacity-90 disabled:opacity-40"
                >
                  <Check size={12} /> {committing ? 'Committing...' : 'Commit'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Diff preview */}
      {diffContent && (
        <div className="shrink-0 max-h-[200px] overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
          <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--color-border)]">
            <span className="text-[10px] font-mono text-[var(--color-text-tertiary)] truncate">{selectedFile}</span>
            <button onClick={() => { setDiffContent(null); setSelectedFile(null) }} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] text-[10px]">close</button>
          </div>
          <pre className="px-3 py-1 text-[10px] leading-[14px] font-mono whitespace-pre overflow-x-auto">
            {diffContent.split('\n').map((line, i) => (
              <div
                key={i}
                className={cn(
                  line.startsWith('+') && !line.startsWith('+++') ? 'text-[var(--color-success)] bg-[var(--color-success)]/5' :
                  line.startsWith('-') && !line.startsWith('---') ? 'text-[var(--color-error)] bg-[var(--color-error)]/5' :
                  line.startsWith('@@') ? 'text-[var(--color-info)]' :
                  'text-[var(--color-text-tertiary)]',
                )}
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}

function FileRow({ file, selected, onClick, actions }: { file: GitFileStatus; selected: boolean; onClick: () => void; actions?: React.ReactNode }): JSX.Element {
  const Icon = STATUS_ICONS[file.status] ?? FileText
  const color = STATUS_COLORS[file.status] ?? 'text-[var(--color-text-tertiary)]'
  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2 px-3 py-1 text-[var(--ui-font-xs)] hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer',
        selected && 'bg-[var(--color-bg-tertiary)]',
      )}
    >
      <Icon size={12} className={color} />
      <span className="flex-1 truncate text-[var(--color-text-secondary)] text-left">{file.path}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {actions}
      </div>
      <span className={cn('shrink-0 text-[10px] font-mono', color)}>{file.status}</span>
    </div>
  )
}
