import { useCallback, useEffect, useState } from 'react'
import { FileText, Folder, FolderOpen, FolderTree, Maximize2, Minimize2, RefreshCw } from 'lucide-react'
import type { CanvasCard } from '@shared/types'
import { useCanvasStore } from '@/stores/canvas'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { cn } from '@/lib/utils'
import { openWorkspaceFile } from '@/lib/openWorkspaceFile'
import { CardFrame, type CardCoordinateMode } from './CardFrame'
import { addCanvasCardToSpace } from '../canvasSpaceMembership'

interface DirectoryCardProps {
  card: CanvasCard
  coordinateMode?: CardCoordinateMode
}

interface DirectoryEntry {
  name: string
  isDir: boolean
}

export function DirectoryCard({ card, coordinateMode }: DirectoryCardProps): JSX.Element | null {
  const removeCard = useCanvasStore((state) => state.removeCard)
  const toggleMaximizedCard = useCanvasStore((state) => state.toggleMaximizedCard)
  const isMaximized = useCanvasStore((state) => state.maximizedCardId === card.id)
  const project = useProjectsStore((state) => state.projects.find((item) => item.id === card.refId))
  const worktree = useWorktreesStore((state) => state.worktrees.find((item) => item.projectId === card.refId && item.path === card.directoryPath))
  const [refreshToken, setRefreshToken] = useState(0)

  const rootPath = card.directoryPath ?? project?.path
  if (!rootPath) return null

  const titleText = card.directoryTitle?.trim() || project?.name || basename(rootPath)
  const title = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
        <FolderTree size={14} />
      </span>
      <span className="min-w-0 truncate font-semibold text-[var(--color-text-primary)]">{titleText}</span>
    </span>
  )

  const headerActions = (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setRefreshToken((value) => value + 1)
        }}
        className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        title="刷新目录"
      >
        <RefreshCw size={14} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          toggleMaximizedCard(card.id)
        }}
        className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        title={isMaximized ? '还原' : '最大化'}
      >
        {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  )

  return (
    <CardFrame
      card={card}
      title={title}
      headerActions={headerActions}
      onDelete={() => removeCard(card.id)}
      deleteTitle="关闭目录"
      minWidth={260}
      minHeight={360}
      borderless
      frameClassName="canvas-directory-frame"
      bodyClassName="bg-[var(--color-bg-primary)]"
      coordinateMode={coordinateMode}
      focusOnClick
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-[var(--color-border)] px-3 py-2">
          <div className="truncate font-mono text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]" title={rootPath}>
            {rootPath}
          </div>
        </div>
        <DirectoryTree
          rootPath={rootPath}
          projectId={card.refId}
          worktreeId={worktree?.id}
          sourceCard={card}
          refreshToken={refreshToken}
        />
      </div>
    </CardFrame>
  )
}

function DirectoryTree({
  rootPath,
  projectId,
  worktreeId,
  sourceCard,
  refreshToken,
}: {
  rootPath: string
  projectId: string | null
  worktreeId?: string
  sourceCard: CanvasCard
  refreshToken: number
}): JSX.Element {
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api.fs.readDir(rootPath)
      .then((items) => {
        if (cancelled) return
        setEntries(sortEntries(items))
      })
      .catch((err) => {
        if (cancelled) return
        setEntries([])
        setError(err instanceof Error ? err.message : '读取目录失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshToken, rootPath])

  if (loading) {
    return <div className="px-3 py-3 text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">读取中...</div>
  }
  if (error) {
    return <div className="px-3 py-3 text-[var(--ui-font-sm)] text-[var(--color-error)]">{error}</div>
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto py-2">
      {entries.map((entry) => (
        <DirectoryRow
          key={`${entry.isDir ? 'd' : 'f'}:${entry.name}`}
          entry={entry}
          path={joinPath(rootPath, entry.name)}
          depth={0}
          projectId={projectId}
          worktreeId={worktreeId}
          sourceCard={sourceCard}
          refreshToken={refreshToken}
        />
      ))}
    </div>
  )
}

function DirectoryRow({
  entry,
  path,
  depth,
  projectId,
  worktreeId,
  sourceCard,
  refreshToken,
}: {
  entry: DirectoryEntry
  path: string
  depth: number
  projectId: string | null
  worktreeId?: string
  sourceCard: CanvasCard
  refreshToken: number
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedToken, setLoadedToken] = useState<number | null>(null)

  const loadChildren = useCallback(() => {
    if (!entry.isDir) return
    setLoading(true)
    window.api.fs.readDir(path)
      .then((items) => {
        setChildren(sortEntries(items))
        setLoadedToken(refreshToken)
      })
      .catch(() => {
        setChildren([])
        setLoadedToken(refreshToken)
      })
      .finally(() => setLoading(false))
  }, [entry.isDir, path, refreshToken])

  useEffect(() => {
    if (!expanded || !entry.isDir) return
    loadChildren()
  }, [entry.isDir, expanded, loadChildren, refreshToken])

  const onClick = (): void => {
    if (entry.isDir) {
      setExpanded((value) => !value)
      if (!expanded && loadedToken !== refreshToken) loadChildren()
      return
    }
    openFileFromDirectoryCard(path, projectId, worktreeId, sourceCard)
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-2 px-3 text-left text-[var(--ui-font-sm)] transition-colors',
          'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
        )}
        style={{ paddingLeft: 12 + depth * 16 }}
        title={path}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">
          {entry.isDir ? (expanded ? <FolderOpen size={14} /> : <Folder size={14} />) : <FileText size={14} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {loading && <span className="shrink-0 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">...</span>}
      </button>
      {entry.isDir && expanded && children.map((child) => (
        <DirectoryRow
          key={`${child.isDir ? 'd' : 'f'}:${path}:${child.name}`}
          entry={child}
          path={joinPath(path, child.name)}
          depth={depth + 1}
          projectId={projectId}
          worktreeId={worktreeId}
          sourceCard={sourceCard}
          refreshToken={refreshToken}
        />
      ))}
    </>
  )
}

function openFileFromDirectoryCard(filePath: string, projectId: string | null, worktreeId: string | undefined, sourceCard: CanvasCard): void {
  const tabId = openWorkspaceFile(filePath, { context: { projectId, worktreeId } })
  if (!tabId) return

  const canvas = useCanvasStore.getState()
  const cardId = canvas.attachSession(tabId, 'editor', {
    x: sourceCard.x + sourceCard.width + 24,
    y: sourceCard.y,
  }, {
    forceFreePlacement: true,
    forceAvoidOverlap: true,
    ignoreOverlapCardIds: [sourceCard.id],
  })
  addCanvasCardToSpace(cardId, useCanvasUiStore.getState().activeSpaceId)
  requestAnimationFrame(() => canvas.focusOnCard(cardId, { allowReturn: false }))
}

function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
}

function joinPath(base: string, name: string): string {
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${name}`
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}
