import { ChevronRight, File, Folder, FolderOpen, Copy, ExternalLink, Terminal } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'

interface TreeEntry {
  name: string
  isDir: boolean
}

interface TreeNodeProps {
  name: string
  path: string
  isDir: boolean
  depth: number
}

const IGNORED = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache',
  '__pycache__', '.vscode', '.idea', 'target', 'bin', 'obj',
  '.DS_Store', 'Thumbs.db',
])

const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]'

function TreeNode({ name, path, isDir, depth }: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<TreeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  const toggle = useCallback(async () => {
    if (!isDir) return
    if (expanded) { setExpanded(false); return }
    setLoading(true)
    try {
      const entries: TreeEntry[] = await window.api.fs.readDir(path)
      const filtered = entries.filter((e) => !IGNORED.has(e.name) && !e.name.startsWith('.'))
      filtered.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setChildren(filtered)
    } catch { setChildren([]) }
    setLoading(false)
    setExpanded(true)
  }, [isDir, expanded, path])

  return (
    <div>
      <div
        onClick={toggle}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
        className={cn(
          'group flex items-center gap-1 py-[3px] pr-2 cursor-pointer',
          'text-[var(--ui-font-xs)] hover:bg-[var(--color-bg-tertiary)] transition-colors',
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {isDir ? (
          <>
            <ChevronRight size={12} className={cn('shrink-0 text-[var(--color-text-tertiary)] transition-transform', expanded && 'rotate-90')} />
            {expanded ? <FolderOpen size={13} className="shrink-0 text-[var(--color-warning)]" /> : <Folder size={13} className="shrink-0 text-[var(--color-warning)]" />}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <File size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
          </>
        )}
        <span className="flex-1 truncate text-[var(--color-text-secondary)]">{name}</span>
      </div>

      {/* Right-click context menu */}
      {ctxMenu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setCtxMenu(null)} />
          <div style={{ top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
            className="fixed w-48 rounded-[var(--radius-md)] py-1 border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30">
            <button className={MENU_ITEM} onClick={() => { navigator.clipboard.writeText(path); setCtxMenu(null) }}>
              <Copy size={12} /> Copy Path
            </button>
            <button className={MENU_ITEM} onClick={() => {
              // Open parent folder for files, folder itself for dirs
              window.api.shell.openPath(isDir ? path : path.replace(/[/\\][^/\\]+$/, ''))
              setCtxMenu(null)
            }}>
              <ExternalLink size={12} /> Open in Explorer
            </button>
            <button className={MENU_ITEM} onClick={() => {
              const sid = usePanesStore.getState().paneActiveSession[usePanesStore.getState().activePaneId]
              if (!sid) { setCtxMenu(null); return }
              const session = useSessionsStore.getState().sessions.find((s) => s.id === sid)
              if (session?.ptyId) window.api.session.write(session.ptyId, path)
              setCtxMenu(null)
            }}>
              <Terminal size={12} /> Send to Session
            </button>
          </div>
        </>, document.body,
      )}
      {expanded && children.map((child) => (
        <TreeNode
          key={child.name}
          name={child.name}
          path={`${path}/${child.name}`}
          isDir={child.isDir}
          depth={depth + 1}
        />
      ))}
      {loading && (
        <div className="py-1 text-[10px] text-[var(--color-text-tertiary)]" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>Loading...</div>
      )}
    </div>
  )
}

export function FileTree(): JSX.Element {
  const selectedProject = useProjectsStore((s) => s.projects.find((p) => p.id === s.selectedProjectId))
  const selectedWorktree = useWorktreesStore((s) => s.worktrees.find((w) => w.id === s.selectedWorktreeId))
  const projectPath = selectedWorktree?.path ?? selectedProject?.path

  const [entries, setEntries] = useState<TreeEntry[]>([])

  useEffect(() => {
    if (!projectPath) return
    window.api.fs.readDir(projectPath).then((items: TreeEntry[]) => {
      const filtered = items.filter((e) => !IGNORED.has(e.name) && !e.name.startsWith('.'))
      filtered.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setEntries(filtered)
    }).catch(() => setEntries([]))
  }, [projectPath])

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">No project selected</span>
      </div>
    )
  }

  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)] truncate" title={projectPath}>
        {selectedProject?.name ?? projectPath.split(/[/\\]/).pop()}
      </div>
      {entries.map((entry) => (
        <TreeNode
          key={entry.name}
          name={entry.name}
          path={`${projectPath}/${entry.name}`}
          isDir={entry.isDir}
          depth={0}
        />
      ))}
    </div>
  )
}
