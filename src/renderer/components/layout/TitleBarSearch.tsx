import { File, LoaderCircle } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { FileSearchResult, Session } from '@shared/types'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/codex_white.svg'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIcon from '@/assets/icons/terminal_white.png'
import { geminiIcon } from '@/lib/geminiIcon'
import { browserIcon } from '@/lib/browserIcon'
import { cn } from '@/lib/utils'
import { switchProjectContext } from '@/lib/project-context'
import { detectLanguage, FILE_ICONS, useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'

interface SearchRoot {
  rootPath: string
  projectId: string
  projectName: string
  worktreeId: string | null
  scopeLabel: string
}

interface FileResultItem extends FileSearchResult {
  kind: 'file'
  projectId: string
  projectName: string
  worktreeId: string | null
  scopeLabel: string
  score: number
}

interface SessionResultItem {
  kind: 'session'
  session: Session
  projectName: string
  scopeLabel: string
  score: number
}

const TYPE_ICONS: Record<string, string> = {
  browser: browserIcon,
  'claude-code': claudeIcon,
  'claude-code-yolo': claudeIcon,
  'claude-code-wsl': claudeIcon,
  'claude-code-yolo-wsl': claudeIcon,
  'claude-gui': claudeIcon,
  codex: codexIcon,
  'codex-yolo': codexIcon,
  'codex-wsl': codexIcon,
  'codex-yolo-wsl': codexIcon,
  gemini: geminiIcon,
  'gemini-yolo': geminiIcon,
  opencode: opencodeIcon,
  terminal: terminalIcon,
  'terminal-wsl': terminalIcon,
}

function getSearchIndex(text: string, query: string): number {
  const caseSensitive = /[A-Z]/.test(query)
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  return haystack.indexOf(needle)
}

function SessionTypeIcon({ type }: { type: Session['type'] }): JSX.Element {
  const iconSrc = TYPE_ICONS[type] ?? claudeIcon
  return <img src={iconSrc} alt="" className="h-3.5 w-3.5 shrink-0" draggable={false} />
}

function FileTypeIcon({ fileName }: { fileName: string }): JSX.Element {
  const iconInfo = FILE_ICONS[detectLanguage(fileName)]

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

function buildSearchRoots(
  scope: 'project' | 'all-projects',
  selectedProjectId: string | null,
  selectedWorktreeId: string | null,
  projects: ReturnType<typeof useProjectsStore.getState>['projects'],
  worktrees: ReturnType<typeof useWorktreesStore.getState>['worktrees'],
): SearchRoot[] {
  if (scope === 'project') {
    const selectedProject = projects.find((project) => project.id === selectedProjectId)
    if (!selectedProject) return []

    const selectedWorktree = worktrees.find((worktree) => worktree.id === selectedWorktreeId && worktree.projectId === selectedProject.id)
    if (selectedWorktree && !selectedWorktree.isMain) {
      return [{
        rootPath: selectedWorktree.path,
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        worktreeId: selectedWorktree.id,
        scopeLabel: `${selectedProject.name} / ${selectedWorktree.branch}`,
      }]
    }

    return [{
      rootPath: selectedProject.path,
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      worktreeId: null,
      scopeLabel: selectedProject.name,
    }]
  }

  return projects.map((project) => ({
    rootPath: project.path,
    projectId: project.id,
    projectName: project.name,
    worktreeId: null,
    scopeLabel: project.name,
  }))
}

function buildSessionResults(
  query: string,
  scope: 'project' | 'all-projects',
  selectedProjectId: string | null,
  sessions: ReturnType<typeof useSessionsStore.getState>['sessions'],
  projects: ReturnType<typeof useProjectsStore.getState>['projects'],
  worktrees: ReturnType<typeof useWorktreesStore.getState>['worktrees'],
): SessionResultItem[] {
  const visibleSessions = sessions.filter((session) => {
    if (scope === 'all-projects') return true
    return session.projectId === selectedProjectId
  })

  const results = visibleSessions.flatMap((session) => {
    const project = projects.find((item) => item.id === session.projectId)
    if (!project) return []

    const worktree = session.worktreeId
      ? worktrees.find((item) => item.id === session.worktreeId)
      : null
    const indexes = [
      getSearchIndex(session.name, query),
      session.label ? getSearchIndex(session.label, query) : -1,
      getSearchIndex(project.name, query),
      worktree ? getSearchIndex(worktree.branch, query) : -1,
      getSearchIndex(session.type, query),
    ].filter((index) => index !== -1)

    if (indexes.length === 0) return []

    let score = Math.min(...indexes)
    if (getSearchIndex(session.name, query) === 0) score -= 40
    if (session.name.length === query.length) score -= 60

    return [{
      kind: 'session' as const,
      session,
      projectName: project.name,
      scopeLabel: worktree ? `${project.name} / ${worktree.branch}` : project.name,
      score,
    }]
  })

  return results.sort((left, right) => left.score - right.score).slice(0, 10)
}

function scoreFileResult(result: FileSearchResult, query: string): number {
  const fileNameIndex = getSearchIndex(result.fileName, query)
  const pathIndex = getSearchIndex(result.relativePath, query)
  let score = fileNameIndex !== -1 ? fileNameIndex : 160 + Math.max(pathIndex, 0)

  if (fileNameIndex === 0) score -= 40
  if (result.fileName.length === query.length) score -= 60

  return score + result.relativePath.length * 0.01
}

export function TitleBarSearch(): JSX.Element {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileResults, setFileResults] = useState<FileResultItem[]>([])
  const [sessionResults, setSessionResults] = useState<SessionResultItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRunRef = useRef(0)

  const scope = useUIStore((state) => state.settings.titleBarSearchScope)
  const updateSettings = useUIStore((state) => state.updateSettings)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const projects = useProjectsStore((state) => state.projects)
  const sessions = useSessionsStore((state) => state.sessions)
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)
  const worktrees = useWorktreesStore((state) => state.worktrees)

  const roots = useMemo(
    () => buildSearchRoots(scope, selectedProjectId, selectedWorktreeId, projects, worktrees),
    [scope, selectedProjectId, selectedWorktreeId, projects, worktrees],
  )
  const totalResults = fileResults.length + sessionResults.length
  const canSearch = scope === 'all-projects' ? roots.length > 0 : Boolean(selectedProjectId && roots.length > 0)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useEffect(() => {
    if (selectedIndex < totalResults) return
    setSelectedIndex(totalResults > 0 ? totalResults - 1 : 0)
  }, [selectedIndex, totalResults])

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim()
    const currentSessions = buildSessionResults(trimmedQuery, scope, selectedProjectId, sessions, projects, worktrees)
    setSessionResults(currentSessions)

    if (!trimmedQuery) {
      setLoading(false)
      setError(null)
      setFileResults([])
      return
    }

    if (!canSearch) {
      setLoading(false)
      setError(scope === 'project' ? '先选择一个项目再搜索。' : '当前没有可搜索的项目。')
      setFileResults([])
      return
    }

    const searchId = searchRunRef.current + 1
    searchRunRef.current = searchId
    setLoading(true)
    setError(null)

    void Promise.all(
      roots.map(async (root) => {
        const results = await window.api.search.findFiles(root.rootPath, trimmedQuery, {
          limit: scope === 'all-projects' ? 18 : 30,
        })

        return results.map((result) => ({
          ...result,
          kind: 'file' as const,
          projectId: root.projectId,
          projectName: root.projectName,
          worktreeId: root.worktreeId,
          scopeLabel: root.scopeLabel,
          score: scoreFileResult(result, trimmedQuery),
        }))
      }),
    )
      .then((groups) => {
        if (searchRunRef.current !== searchId) return
        const nextResults = groups
          .flat()
          .sort((left, right) => left.score - right.score)
          .slice(0, 18)

        setFileResults(nextResults)
        setLoading(false)
      })
      .catch((searchError) => {
        if (searchRunRef.current !== searchId) return
        setFileResults([])
        setLoading(false)
        setError(searchError instanceof Error ? searchError.message : String(searchError))
      })
  }, [canSearch, deferredQuery, projects, roots, scope, selectedProjectId, sessions, worktrees, selectedWorktreeId])

  const combinedResults = [...sessionResults, ...fileResults]

  const handleOpenFile = (result: FileResultItem) => {
    switchProjectContext(result.projectId, null, result.worktreeId)

    const tabId = useEditorsStore.getState().openFile(result.filePath, {
      projectId: result.projectId,
      worktreeId: result.worktreeId,
    })

    const paneStore = usePanesStore.getState()
    paneStore.addSessionToPane(paneStore.activePaneId, tabId)
    paneStore.setPaneActiveSession(paneStore.activePaneId, tabId)
    setOpen(false)
  }

  const handleOpenSession = (result: SessionResultItem) => {
    switchProjectContext(result.session.projectId, result.session.id, result.session.worktreeId ?? null)
    setOpen(false)
  }

  const handleSelectResult = (index: number) => {
    const result = combinedResults[index]
    if (!result) return

    if (result.kind === 'file') {
      handleOpenFile(result)
      return
    }

    handleOpenSession(result)
  }

  return (
    <div ref={containerRef} className="no-drag relative w-full min-w-0">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setSelectedIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (combinedResults.length === 0) return
              setOpen(true)
              setSelectedIndex((current) => (current + 1) % combinedResults.length)
              return
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (combinedResults.length === 0) return
              setOpen(true)
              setSelectedIndex((current) => (current - 1 + combinedResults.length) % combinedResults.length)
              return
            }

            if (event.key === 'Enter') {
              if (!open || combinedResults.length === 0) return
              event.preventDefault()
              handleSelectResult(selectedIndex)
              return
            }

            if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={canSearch ? 'Search files and sessions...' : 'Select a project to search...'}
          disabled={!canSearch}
          className={cn(
            'h-[30px] min-w-0 flex-1 rounded-[calc(var(--radius-md)+2px)] border bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none focus:outline-none focus-visible:outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed disabled:opacity-60',
            open
              ? 'border-[var(--color-border-hover)]'
              : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]',
          )}
        />
        <button
          type="button"
          onClick={() => updateSettings({ titleBarSearchScope: scope === 'project' ? 'all-projects' : 'project' })}
          className="flex h-[30px] cursor-pointer items-center rounded-[calc(var(--radius-md)+2px)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          title={scope === 'project' ? '当前搜索范围：当前项目，点击切换为全部项目' : '当前搜索范围：全部项目，点击切换为当前项目'}
        >
          {scope === 'all-projects' ? 'All Projects' : 'Project'}
        </button>
        {loading && <LoaderCircle size={13} className="shrink-0 animate-spin text-[var(--color-accent)]" />}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/35">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
              Search Everywhere
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)]">
              {scope === 'all-projects' ? `${roots.length} projects` : roots[0]?.scopeLabel ?? 'No project'}
            </span>
          </div>

          {!query.trim() && (
            <div className="px-4 py-4 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
              搜文件名、路径和会话名。范围由设置中的标题栏搜索选项控制。
            </div>
          )}

          {query.trim() && error && (
            <div className="px-4 py-4 text-[var(--ui-font-xs)] text-[var(--color-error)]">
              {error}
            </div>
          )}

          {query.trim() && !error && totalResults === 0 && !loading && (
            <div className="px-4 py-4 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
              No files or sessions found.
            </div>
          )}

          <div className="max-h-[420px] overflow-y-auto">
            {sessionResults.length > 0 && (
              <div className="border-b border-[var(--color-border)]">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                  Sessions
                </div>
                {sessionResults.map((result, sessionIndex) => {
                  const globalIndex = sessionIndex
                  return (
                    <button
                      key={result.session.id}
                      onClick={() => handleOpenSession(result)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      className={cn(
                        'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
                        globalIndex === selectedIndex
                          ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]/60',
                      )}
                    >
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center">
                        <SessionTypeIcon type={result.session.type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">
                          {result.session.name}
                        </div>
                        <div className="truncate text-[11px] text-[var(--color-text-secondary)]">
                          {result.scopeLabel}
                          {result.session.label ? ` · ${result.session.label}` : ''}
                        </div>
                      </div>
                      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                        {result.session.type}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {fileResults.length > 0 && (
              <div>
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                  Files
                </div>
                {fileResults.map((result, fileIndex) => {
                  const globalIndex = sessionResults.length + fileIndex
                  return (
                    <button
                      key={`${result.rootPath}:${result.filePath}`}
                      onClick={() => handleOpenFile(result)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      className={cn(
                        'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
                        globalIndex === selectedIndex
                          ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]/60',
                      )}
                    >
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center">
                        <FileTypeIcon fileName={result.fileName} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">
                          {result.fileName}
                        </div>
                        <div className="truncate text-[11px] text-[var(--color-text-secondary)]">
                          {result.relativePath}
                        </div>
                      </div>
                      <div className="max-w-[180px] truncate text-[11px] font-medium text-[var(--color-text-secondary)]">
                        {result.scopeLabel}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
