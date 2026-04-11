import { FileCode2, Filter, LoaderCircle, Search, X } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import type { ProjectSearchMatch } from '@shared/types'
import { cn } from '@/lib/utils'
import { useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useProjectSearchStore } from '@/stores/search'
import { useWorktreesStore } from '@/stores/worktrees'

function renderLinePreview(match: ProjectSearchMatch): JSX.Element {
  const start = Math.max(0, match.column - 1)
  const end = Math.max(start, match.endColumn - 1)
  const before = match.lineText.slice(0, start)
  const hit = match.lineText.slice(start, end) || match.matchText
  const after = match.lineText.slice(end)

  return (
    <span className="block truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
      <span>{before}</span>
      <mark className="rounded bg-[var(--color-accent)]/20 px-0.5 text-[var(--color-text-primary)]">{hit}</mark>
      <span>{after}</span>
    </span>
  )
}

export function ProjectSearch(): JSX.Element {
  const query = useProjectSearchStore((state) => state.query)
  const fileFilter = useProjectSearchStore((state) => state.fileFilter)
  const results = useProjectSearchStore((state) => state.results)
  const loading = useProjectSearchStore((state) => state.loading)
  const error = useProjectSearchStore((state) => state.error)
  const lastRootPath = useProjectSearchStore((state) => state.lastRootPath)
  const lastSearchedQuery = useProjectSearchStore((state) => state.lastSearchedQuery)
  const lastFileFilter = useProjectSearchStore((state) => state.lastFileFilter)
  const setQuery = useProjectSearchStore((state) => state.setQuery)
  const setFileFilter = useProjectSearchStore((state) => state.setFileFilter)
  const clear = useProjectSearchStore((state) => state.clear)
  const searchInPath = useProjectSearchStore((state) => state.searchInPath)

  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const selectedProject = useProjectsStore((state) =>
    state.projects.find((project) => project.id === selectedProjectId),
  )
  const selectedWorktree = useWorktreesStore((state) =>
    state.worktrees.find((worktree) => worktree.id === state.selectedWorktreeId),
  )

  const rootPath = selectedWorktree?.path ?? selectedProject?.path ?? null
  const worktreeId = selectedWorktree && !selectedWorktree.isMain ? selectedWorktree.id : undefined
  const isScopeStale = Boolean(lastRootPath && rootPath && lastRootPath !== rootPath)

  const groupedResults = useMemo(() => {
    if (isScopeStale) return []
    const groups = new Map<string, ProjectSearchMatch[]>()
    for (const match of results) {
      const existing = groups.get(match.relativePath) ?? []
      existing.push(match)
      groups.set(match.relativePath, existing)
    }
    return [...groups.entries()]
  }, [isScopeStale, results])

  const handleSearch = useCallback(async () => {
    if (!rootPath) return
    await searchInPath(rootPath, query, { fileFilter, limit: 200 })
  }, [fileFilter, query, rootPath, searchInPath])

  const handleOpenResult = useCallback((match: ProjectSearchMatch) => {
    if (!selectedProjectId) return

    const tabId = useEditorsStore.getState().openFileAtLocation(
      match.filePath,
      {
        line: match.line,
        column: match.column,
        endLine: match.line,
        endColumn: match.endColumn,
      },
      { projectId: selectedProjectId, worktreeId },
    )

    const paneStore = usePanesStore.getState()
    paneStore.addSessionToPane(paneStore.activePaneId, tabId)
    paneStore.setPaneActiveSession(paneStore.activePaneId, tabId)
  }, [selectedProjectId, worktreeId])

  if (!rootPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Search size={28} className="text-[var(--color-text-tertiary)]" />
        <div className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">先选择一个项目</div>
        <div className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
          搜索会绑定当前项目或当前 worktree
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
            <Search size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
              Project Search
            </div>
            <div className="truncate text-[10px] text-[var(--color-text-tertiary)]" title={rootPath}>
              {rootPath}
            </div>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={query}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSearch()
              }
            }}
            placeholder="Search text in project..."
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]"
            autoFocus
          />
          <button
            onClick={() => { void handleSearch() }}
            disabled={!query.trim() || loading}
            className={cn(
              'flex h-8 items-center justify-center rounded-[var(--radius-sm)] border px-3 text-[var(--ui-font-xs)] font-medium transition-colors',
              'border-[var(--color-accent)] bg-[var(--color-accent)]/16 text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/24',
              'disabled:opacity-40',
            )}
          >
            {loading ? <LoaderCircle size={13} className="animate-spin" /> : 'Search'}
          </button>
          <button
            onClick={clear}
            disabled={!query && !fileFilter && results.length === 0}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-hover)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
            title="Clear"
          >
            <X size={13} />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5">
          <Filter size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
          <input
            value={fileFilter}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setFileFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSearch()
              }
            }}
            placeholder="File filter: .cs, *.cs, src/**/*.cs"
            className="min-w-0 flex-1 bg-transparent text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
        </div>
        <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
          可选文件范围，例如 <span className="font-mono">.cs</span>、<span className="font-mono">*.tsx</span>、<span className="font-mono">src/**/*.cs</span>
        </div>

        {(lastSearchedQuery || loading) && (
          <div className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
            {loading
              ? `Searching "${query.trim()}"${fileFilter.trim() ? ` in ${fileFilter.trim()}` : ''}...`
              : `${results.length} matches for "${lastSearchedQuery}"${lastFileFilter.trim() ? ` in ${lastFileFilter.trim()}` : ''}${lastRootPath && lastRootPath !== rootPath ? ' (previous scope)' : ''}`}
          </div>
        )}

        {error && (
          <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-error)]/30 bg-[var(--color-error)]/8 px-2.5 py-2 text-[11px] text-[var(--color-error)]">
            {error}
          </div>
        )}
        {isScopeStale && (
          <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-2.5 py-2 text-[11px] text-[var(--color-warning)]">
            当前结果属于上一个项目范围，请重新执行一次搜索。
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!query.trim() && results.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Search size={26} className="text-[var(--color-accent)]" />
            <div className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">输入关键字开始搜索</div>
            <div className="max-w-[260px] text-[var(--ui-font-xs)] leading-6 text-[var(--color-text-tertiary)]">
              当前支持项目内全文搜索，也支持用文件过滤缩小范围。编辑器里可用 <span className="font-mono">Ctrl+Shift+F</span> 或 <span className="font-mono">Shift+F12</span> 直接把选中文本送到这里。
            </div>
          </div>
        )}

        {!loading && query.trim() && groupedResults.length === 0 && !error && (
          <div className="py-8 text-center text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
            No matches found.
          </div>
        )}

        <div className="flex flex-col gap-3">
          {groupedResults.map(([relativePath, fileMatches]) => (
            <div key={relativePath} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
                <FileCode2 size={13} className="text-[var(--color-info)]" />
                <span className="min-w-0 flex-1 truncate text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">
                  {relativePath}
                </span>
                <span className="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                  {fileMatches.length}
                </span>
              </div>
              <div className="flex flex-col">
                {fileMatches.map((match) => (
                  <button
                    key={match.id}
                    onClick={() => handleOpenResult(match)}
                    className="flex items-start gap-3 border-t border-[var(--color-border)] px-3 py-2 text-left first:border-t-0 hover:bg-[var(--color-bg-secondary)]"
                  >
                    <span className="w-12 shrink-0 font-mono text-[10px] text-[var(--color-text-tertiary)]">
                      {match.line}:{match.column}
                    </span>
                    <div className="min-w-0 flex-1">
                      {renderLinePreview(match)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
