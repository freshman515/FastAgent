import { ChevronRight, ExternalLink, File, FilePlus, Folder, FolderOpen, FolderPlus, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { usePanesStore } from '@/stores/panes'
import { detectLanguage, FILE_ICONS, useEditorsStore } from '@/stores/editors'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface TreeEntry {
  name: string
  isDir: boolean
}

interface TreeSelection {
  path: string
  isDir: boolean
}

interface DragPayload {
  path: string
  isDir: boolean
}

interface PendingCreation {
  kind: 'file' | 'folder'
  directoryPath: string
  afterPath: string | null
}

interface TreeNodeProps {
  name: string
  path: string
  isDir: boolean
  depth: number
  projectId: string | null
  worktreeId?: string
  selectedPath: string | null
  refreshToken: number
  pendingCreation: PendingCreation | null
  onSelect: (selection: TreeSelection) => void
  onBeginCreation: (kind: PendingCreation['kind'], selection?: TreeSelection | null) => void
  onSubmitPending: (name: string) => Promise<void>
  onCancelPending: () => void
  onMovePath: (payload: DragPayload, targetDirectory: string) => Promise<void>
  onRequestDelete: (selection: TreeSelection) => void
}

const IGNORED = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache',
  '__pycache__', '.vscode', '.idea', 'target', 'bin', 'obj',
  '.DS_Store', 'Thumbs.db',
])

const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]'
const ACTION_BUTTON = 'inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]'
const FILE_TREE_DRAG_MIME = 'application/x-fastagents-file-tree-node'

function joinPath(basePath: string, name: string): string {
  return `${basePath.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`
}

function getParentPath(path: string): string {
  return path.replace(/[/\\][^/\\]+$/, '') || path
}

function getBaseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isNestedPath(parentPath: string, childPath: string): boolean {
  const parent = normalizePath(parentPath)
  const child = normalizePath(childPath)
  return child === parent || child.startsWith(`${parent}/`)
}

function readDragPayload(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(FILE_TREE_DRAG_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DragPayload>
    if (typeof parsed.path !== 'string' || typeof parsed.isDir !== 'boolean') return null
    return { path: parsed.path, isDir: parsed.isDir }
  } catch {
    return null
  }
}

async function readVisibleEntries(dirPath: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = await window.api.fs.readDir(dirPath)
  return entries
    .filter((entry) => !IGNORED.has(entry.name) && !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function FileTypeIcon({ name }: { name: string }): JSX.Element {
  const iconInfo = FILE_ICONS[detectLanguage(name)]

  if (!iconInfo) {
    return <File size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
  }

  return (
    <span
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-semibold leading-none"
      style={{
        color: iconInfo.color,
        backgroundColor: `${iconInfo.color}18`,
        border: `1px solid ${iconInfo.color}33`,
      }}
    >
      {iconInfo.icon}
    </span>
  )
}

function PendingCreationRow({
  kind,
  depth,
  onSubmit,
  onCancel,
}: {
  kind: 'file' | 'folder'
  depth: number
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = useCallback(async () => {
    const nextValue = value.trim()
    if (!nextValue) {
      onCancel()
      return
    }

    committedRef.current = true
    setSubmitting(true)
    try {
      await onSubmit(nextValue)
    } finally {
      setSubmitting(false)
    }
  }, [onCancel, onSubmit, value])

  return (
    <div
      className="flex items-center gap-1 py-[3px] pr-2 text-[var(--ui-font-xs)]"
      style={{ paddingLeft: depth * 16 + 8 }}
    >
      {kind === 'folder' ? (
        <>
          <span className="w-3 shrink-0" />
          <Folder size={13} className="shrink-0 text-[var(--color-warning)]" />
        </>
      ) : (
        <>
          <span className="w-3 shrink-0" />
          {value.trim() ? <FileTypeIcon name={value.trim()} /> : <File size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />}
        </>
      )}
      <input
        ref={inputRef}
        value={value}
        disabled={submitting}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (!committedRef.current) onCancel()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        className="h-6 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-bg-primary)] px-2 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none"
      />
    </div>
  )
}

function TreeNode({
  name,
  path,
  isDir,
  depth,
  projectId,
  worktreeId,
  selectedPath,
  refreshToken,
  pendingCreation,
  onSelect,
  onBeginCreation,
  onSubmitPending,
  onCancelPending,
  onMovePath,
  onRequestDelete,
}: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<TreeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const hoverExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSelected = selectedPath === path
  const showPendingChild = Boolean(isDir && pendingCreation?.directoryPath === path && pendingCreation.afterPath === null)
  const showPendingSiblingAfter = pendingCreation?.afterPath === path

  const loadChildren = useCallback(async () => {
    if (!isDir) return
    setLoading(true)
    try {
      setChildren(await readVisibleEntries(path))
    } catch {
      setChildren([])
    } finally {
      setLoading(false)
    }
  }, [isDir, path])

  useEffect(() => {
    if (!expanded) return
    void loadChildren()
  }, [expanded, loadChildren, refreshToken])

  useEffect(() => {
    if (isDir && pendingCreation?.directoryPath === path) {
      setExpanded(true)
    }
  }, [isDir, path, pendingCreation])

  const handleClick = useCallback(() => {
    onSelect({ path, isDir })
    if (isDir) {
      setExpanded((current) => !current)
      return
    }

    const tabId = useEditorsStore.getState().openFile(path, { projectId, worktreeId })
    const paneStore = usePanesStore.getState()
    const paneId = paneStore.activePaneId
    paneStore.addSessionToPane(paneId, tabId)
    paneStore.setPaneActiveSession(paneId, tabId)
  }, [isDir, onSelect, path, projectId, worktreeId])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!isDir) return
    const payload = readDragPayload(event)
    if (!payload) return
    if (normalizePath(payload.path) === normalizePath(path)) return
    if (payload.isDir && isNestedPath(payload.path, path)) return
    if (normalizePath(getParentPath(payload.path)) === normalizePath(path)) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropActive(true)

    if (!expanded && hoverExpandTimer.current === null) {
      hoverExpandTimer.current = setTimeout(() => {
        setExpanded(true)
        hoverExpandTimer.current = null
      }, 400)
    }
  }, [expanded, isDir, path])

  const clearDropState = useCallback(() => {
    setDropActive(false)
    if (hoverExpandTimer.current) {
      clearTimeout(hoverExpandTimer.current)
      hoverExpandTimer.current = null
    }
  }, [])

  const handleDrop = useCallback((event: React.DragEvent) => {
    if (!isDir) return
    const payload = readDragPayload(event)
    clearDropState()
    if (!payload) return
    if (normalizePath(payload.path) === normalizePath(path)) return
    if (payload.isDir && isNestedPath(payload.path, path)) return
    if (normalizePath(getParentPath(payload.path)) === normalizePath(path)) return

    event.preventDefault()
    event.stopPropagation()
    void onMovePath(payload, path)
  }, [clearDropState, isDir, onMovePath, path])

  useEffect(() => () => {
    if (hoverExpandTimer.current) clearTimeout(hoverExpandTimer.current)
  }, [])

  return (
    <div>
      <div
        draggable
        onClick={handleClick}
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData(FILE_TREE_DRAG_MIME, JSON.stringify({ path, isDir } satisfies DragPayload))
          event.dataTransfer.setData('text/plain', path)
        }}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
          clearDropState()
        }}
        onDrop={handleDrop}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSelect({ path, isDir })
          setCtxMenu({ x: event.clientX, y: event.clientY })
        }}
        className={cn(
          'group flex items-center gap-1 py-[3px] pr-2 cursor-pointer text-[var(--ui-font-xs)] transition-colors',
          dropActive && isDir && 'bg-[var(--color-accent)]/18 ring-1 ring-inset ring-[var(--color-accent)]',
          isSelected
            ? 'bg-[var(--color-accent)]/14 text-[var(--color-text-primary)]'
            : 'hover:bg-[var(--color-bg-tertiary)]',
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {isDir ? (
          <>
            <ChevronRight
              size={12}
              className={cn('shrink-0 text-[var(--color-text-tertiary)] transition-transform', expanded && 'rotate-90')}
            />
            {expanded
              ? <FolderOpen size={13} className="shrink-0 text-[var(--color-warning)]" />
              : <Folder size={13} className="shrink-0 text-[var(--color-warning)]" />}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileTypeIcon name={name} />
          </>
        )}
        <span className={cn('flex-1 truncate', isSelected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]')}>
          {name}
        </span>
      </div>

      {ctxMenu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setCtxMenu(null)} />
          <div
            style={{ top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
            className="fixed w-48 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-lg shadow-black/30"
          >
            {isDir && (
              <>
                <button
                  className={MENU_ITEM}
                  onClick={() => {
                    onBeginCreation('file', { path, isDir: true })
                    setCtxMenu(null)
                  }}
                >
                  <FilePlus size={12} /> 新建文件
                </button>
                <button
                  className={MENU_ITEM}
                  onClick={() => {
                    onBeginCreation('folder', { path, isDir: true })
                    setCtxMenu(null)
                  }}
                >
                  <FolderPlus size={12} /> 新建文件夹
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
                  onClick={() => {
                    onRequestDelete({ path, isDir: true })
                    setCtxMenu(null)
                  }}
                >
                  <Trash2 size={12} /> 删除文件夹
                </button>
                <div className="my-0.5 h-px bg-[var(--color-border)]" />
              </>
            )}

            {!isDir && (
              <>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
                  onClick={() => {
                    onRequestDelete({ path, isDir: false })
                    setCtxMenu(null)
                  }}
                >
                  <Trash2 size={12} /> 删除文件
                </button>
                <div className="my-0.5 h-px bg-[var(--color-border)]" />
              </>
            )}

            <button
              className={MENU_ITEM}
              onClick={() => {
                window.api.shell.openPath(isDir ? path : getParentPath(path))
                setCtxMenu(null)
              }}
            >
              <ExternalLink size={12} /> Open in Explorer
            </button>
          </div>
        </>,
        document.body,
      )}

      {showPendingSiblingAfter && pendingCreation && (
        <PendingCreationRow
          kind={pendingCreation.kind}
          depth={depth}
          onSubmit={onSubmitPending}
          onCancel={onCancelPending}
        />
      )}

      {showPendingChild && pendingCreation && (
        <PendingCreationRow
          kind={pendingCreation.kind}
          depth={depth + 1}
          onSubmit={onSubmitPending}
          onCancel={onCancelPending}
        />
      )}

      {expanded && children.map((child) => (
        <TreeNode
          key={child.name}
          name={child.name}
          path={joinPath(path, child.name)}
          isDir={child.isDir}
          depth={depth + 1}
          projectId={projectId}
          worktreeId={worktreeId}
          selectedPath={selectedPath}
          refreshToken={refreshToken}
          pendingCreation={pendingCreation}
          onSelect={onSelect}
          onBeginCreation={onBeginCreation}
          onSubmitPending={onSubmitPending}
          onCancelPending={onCancelPending}
          onMovePath={onMovePath}
          onRequestDelete={onRequestDelete}
        />
      ))}

      {loading && (
        <div
          className="py-1 text-[10px] text-[var(--color-text-tertiary)]"
          style={{ paddingLeft: (depth + 1) * 16 + 8 }}
        >
          Loading...
        </div>
      )}
    </div>
  )
}

export function FileTree(): JSX.Element {
  const selectedProject = useProjectsStore((state) => state.projects.find((project) => project.id === state.selectedProjectId))
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const selectedWorktree = useWorktreesStore((state) => state.worktrees.find((worktree) => worktree.id === state.selectedWorktreeId))
  const addToast = useUIStore((state) => state.addToast)
  const projectPath = selectedWorktree?.path ?? selectedProject?.path
  const editorWorktreeId = selectedWorktree && !selectedWorktree.isMain ? selectedWorktree.id : undefined

  const [entries, setEntries] = useState<TreeEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<TreeSelection | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TreeSelection | null>(null)

  const refreshTree = useCallback(() => {
    setRefreshToken((value) => value + 1)
  }, [])

  useEffect(() => {
    setSelectedEntry(null)
  }, [projectPath])

  useEffect(() => {
    if (!projectPath) return
    void readVisibleEntries(projectPath)
      .then((items) => setEntries(items))
      .catch(() => setEntries([]))
  }, [projectPath, refreshToken])

  const targetDirectory = useMemo(() => {
    if (!projectPath) return null
    if (!selectedEntry) return projectPath
    return selectedEntry.isDir ? selectedEntry.path : getParentPath(selectedEntry.path)
  }, [projectPath, selectedEntry])

  const beginCreation = useCallback((kind: PendingCreation['kind'], selection?: TreeSelection | null) => {
    if (!projectPath) return
    const baseSelection = selection ?? selectedEntry
    const directoryPath = !baseSelection
      ? projectPath
      : (baseSelection.isDir ? baseSelection.path : getParentPath(baseSelection.path))
    setPendingCreation({
      kind,
      directoryPath,
      afterPath: baseSelection && !baseSelection.isDir ? baseSelection.path : null,
    })
    if (baseSelection) setSelectedEntry(baseSelection)
  }, [projectPath, selectedEntry])

  const handleSubmitPending = useCallback(async (name: string) => {
    if (!projectPath || !pendingCreation) return
    const targetPath = joinPath(pendingCreation.directoryPath, name)
    try {
      if (pendingCreation.kind === 'file') {
        await window.api.fs.createFile(targetPath)
      } else {
        await window.api.fs.createDir(targetPath)
      }
      setPendingCreation(null)
      refreshTree()
      setSelectedEntry({ path: targetPath, isDir: pendingCreation.kind === 'folder' })

      if (pendingCreation.kind === 'file') {
        const tabId = useEditorsStore.getState().openFile(targetPath, { projectId: selectedProjectId, worktreeId: editorWorktreeId })
        const paneStore = usePanesStore.getState()
        paneStore.addSessionToPane(paneStore.activePaneId, tabId)
        paneStore.setPaneActiveSession(paneStore.activePaneId, tabId)
      }

      addToast({
        type: 'success',
        title: pendingCreation.kind === 'file' ? '已创建文件' : '已创建文件夹',
        body: name,
      })
    } catch (error) {
      addToast({
        type: 'error',
        title: pendingCreation.kind === 'file' ? '创建文件失败' : '创建文件夹失败',
        body: error instanceof Error ? error.message : '创建失败。',
      })
    }
  }, [addToast, editorWorktreeId, pendingCreation, projectPath, refreshTree, selectedProjectId])

  const handleCancelPending = useCallback(() => {
    setPendingCreation(null)
  }, [])

  const handleRequestDelete = useCallback((selection: TreeSelection) => {
    setPendingDelete(selection)
  }, [])

  const handleMovePath = useCallback(async (payload: DragPayload, targetDirectory: string) => {
    const nextPath = joinPath(targetDirectory, getBaseName(payload.path))
    try {
      await window.api.fs.move(payload.path, nextPath)
      useEditorsStore.getState().relocatePath(payload.path, nextPath)
      setPendingCreation(null)
      setSelectedEntry({ path: nextPath, isDir: payload.isDir })
      refreshTree()
      addToast({
        type: 'success',
        title: '已移动',
        body: `${getBaseName(payload.path)} -> ${getBaseName(targetDirectory)}`,
      })
    } catch (error) {
      addToast({
        type: 'error',
        title: '移动失败',
        body: error instanceof Error ? error.message : '无法移动到目标文件夹。',
      })
    }
  }, [addToast, refreshTree])

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    try {
      const tabsToClose = useEditorsStore.getState().tabs
        .filter((tab) => {
          const normalizedTabPath = normalizePath(tab.filePath)
          const normalizedTarget = normalizePath(pendingDelete.path)
          return normalizedTabPath === normalizedTarget || normalizedTabPath.startsWith(`${normalizedTarget}/`)
        })
        .map((tab) => tab.id)

      for (const tabId of tabsToClose) {
        const paneId = usePanesStore.getState().findPaneForSession(tabId)
        if (paneId) usePanesStore.getState().removeSessionFromPane(paneId, tabId)
      }
      useEditorsStore.getState().removePath(pendingDelete.path)
      await window.api.fs.delete(pendingDelete.path)
      setPendingDelete(null)
      setPendingCreation(null)
      setSelectedEntry(null)
      refreshTree()
      addToast({
        type: 'success',
        title: pendingDelete.isDir ? '已删除文件夹' : '已删除文件',
        body: getBaseName(pendingDelete.path),
      })
    } catch (error) {
      addToast({
        type: 'error',
        title: pendingDelete.isDir ? '删除文件夹失败' : '删除文件失败',
        body: error instanceof Error ? error.message : '无法删除目标。',
      })
    }
  }, [addToast, pendingDelete, refreshTree])

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">未选择项目</span>
      </div>
    )
  }

  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)] truncate" title={projectPath}>
        {selectedProject?.name ?? projectPath.split(/[/\\]/).pop()}
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-2">
        <button type="button" onClick={() => beginCreation('file')} className={ACTION_BUTTON} title="在当前选中位置新建文件">
          <FilePlus size={12} /> 新建文件
        </button>
        <button type="button" onClick={() => beginCreation('folder')} className={ACTION_BUTTON} title="在当前选中位置新建文件夹">
          <FolderPlus size={12} /> 新建文件夹
        </button>
      </div>

      <div className="px-3 pb-2 text-[10px] text-[var(--color-text-tertiary)] truncate" title={targetDirectory ?? undefined}>
        目标位置：{targetDirectory ?? projectPath}
      </div>

      {pendingCreation?.directoryPath === projectPath && pendingCreation.afterPath === null && (
        <PendingCreationRow
          kind={pendingCreation.kind}
          depth={0}
          onSubmit={handleSubmitPending}
          onCancel={handleCancelPending}
        />
      )}

      {entries.map((entry) => (
        <TreeNode
          key={entry.name}
          name={entry.name}
          path={joinPath(projectPath, entry.name)}
          isDir={entry.isDir}
          depth={0}
          projectId={selectedProjectId}
          worktreeId={editorWorktreeId}
          selectedPath={selectedEntry?.path ?? null}
          refreshToken={refreshToken}
          pendingCreation={pendingCreation}
          onSelect={setSelectedEntry}
          onBeginCreation={beginCreation}
          onSubmitPending={handleSubmitPending}
          onCancelPending={handleCancelPending}
          onMovePath={handleMovePath}
          onRequestDelete={handleRequestDelete}
        />
      ))}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.isDir ? '删除文件夹' : '删除文件'}
          message={
            pendingDelete.isDir
              ? `确认删除文件夹“${getBaseName(pendingDelete.path)}”及其内容吗？`
              : `确认删除文件“${getBaseName(pendingDelete.path)}”吗？`
          }
          confirmLabel="删除"
          cancelLabel="取消"
          danger
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
