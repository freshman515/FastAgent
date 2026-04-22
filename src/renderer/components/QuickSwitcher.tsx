import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { switchProjectContext } from '@/lib/project-context'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { usePanesStore } from '@/stores/panes'
import { FILE_ICONS, useEditorsStore } from '@/stores/editors'
import { useWorktreesStore } from '@/stores/worktrees'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/codex_white.svg'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIcon from '@/assets/icons/terminal_white.png'

const TYPE_ICONS: Record<string, string> = {
  'claude-code': claudeIcon,
  'claude-code-yolo': claudeIcon,
  'claude-gui': claudeIcon,
  codex: codexIcon,
  'codex-yolo': codexIcon,
  opencode: opencodeIcon,
  terminal: terminalIcon,
}

type SwitcherMode = 'search' | 'mru'

interface SwitcherItem {
  id: string
  kind: 'session' | 'editor'
  projectId: string
  worktreeId?: string
  title: string
  subtitle: string
  searchText: string
  priority: number
  isCurrent: boolean
  sessionType?: string
  sessionStatus?: string
  outputState?: 'idle' | 'outputting' | 'unread'
  label?: string
  modified?: boolean
  language?: string
}

function getWorktreeLabel(
  worktreeId: string | undefined,
  projectId: string,
  worktrees: ReturnType<typeof useWorktreesStore.getState>['worktrees'],
): string {
  if (!worktreeId) return 'main'
  const worktree = worktrees.find((item) => item.id === worktreeId && item.projectId === projectId)
  return worktree?.branch ?? 'worktree'
}

function buildSearchScore(searchText: string, query: string): number {
  const haystack = searchText.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return 0

  if (haystack === normalizedQuery) return 160
  if (haystack.startsWith(normalizedQuery)) return 120

  const directIndex = haystack.indexOf(normalizedQuery)
  if (directIndex !== -1) {
    return 100 - Math.min(directIndex, 40)
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 0

  let score = 0
  for (const token of tokens) {
    const tokenIndex = haystack.indexOf(token)
    if (tokenIndex === -1) return -1
    score += 40 - Math.min(tokenIndex, 20)
  }
  return score
}

function getRelativePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function activateItem(item: SwitcherItem): void {
  switchProjectContext(item.projectId, item.id, item.worktreeId ?? null)
  if (item.kind === 'session') {
    useSessionsStore.getState().setActive(item.id)
    useSessionsStore.getState().markAsRead(item.id)
  }
}

function buildMruIds(paneSessions: string[], paneRecentSessions: string[], activeTabId: string | null): string[] {
  const orderedRecent = paneRecentSessions.filter((id) => id !== activeTabId && paneSessions.includes(id))
  const fallback = paneSessions.filter((id) => id !== activeTabId && !orderedRecent.includes(id))
  return [...orderedRecent, ...fallback]
}

function renderStatusBadge(item: SwitcherItem): JSX.Element | null {
  if (item.kind === 'editor' && item.modified) {
    return (
      <span className="rounded-full bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-warning)]">
        已修改
      </span>
    )
  }

  if (item.kind === 'session') {
    if (item.outputState === 'unread') {
      return (
        <span className="rounded-full bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-warning)]">
          未读
        </span>
      )
    }
    if (item.outputState === 'outputting') {
      return (
        <span className="rounded-full bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">
          输出中
        </span>
      )
    }
  }

  return null
}

export function QuickSwitcher(): JSX.Element | null {
  const [mode, setMode] = useState<SwitcherMode | null>(null)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedIdxRef = useRef(0)
  const mruItemsRef = useRef<SwitcherItem[]>([])

  const sessions = useSessionsStore((s) => s.sessions)
  const outputStates = useSessionsStore((s) => s.outputStates)
  const editors = useEditorsStore((s) => s.tabs)
  const projects = useProjectsStore((s) => s.projects)
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const activeTabId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const paneSessions = usePanesStore((s) => s.paneSessions[activePaneId] ?? [])
  const paneRecentSessions = usePanesStore((s) => s.paneRecentSessions[activePaneId] ?? [])

  selectedIdxRef.current = selectedIdx

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )
  const activePaneRank = useMemo(
    () => new Map(
      [activeTabId, ...paneRecentSessions, ...paneSessions]
        .filter((id): id is string => Boolean(id))
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .map((id, index) => [id, index]),
    ),
    [activeTabId, paneRecentSessions, paneSessions],
  )

  const itemsById = useMemo(() => {
    const items = new Map<string, SwitcherItem>()

    for (const session of sessions) {
      const projectName = projectNameById.get(session.projectId) ?? ''
      const worktreeLabel = getWorktreeLabel(session.worktreeId, session.projectId, worktrees)
      const outputState = outputStates[session.id] ?? 'idle'
      const paneRank = activePaneRank.get(session.id)
      const priority = (session.id === activeTabId ? 1000 : 0)
        + (paneRank !== undefined ? 500 - paneRank * 10 : 0)
        + (outputState === 'unread' ? 240 : outputState === 'outputting' ? 200 : 0)
        + (session.status === 'running' ? 120 : 0)
        + (selectedProjectId === session.projectId ? 30 : 0)
      const typeLabel = session.type.replace(/-/g, ' ')
      const subtitle = [projectName, worktreeLabel, typeLabel].filter(Boolean).join(' • ')

      items.set(session.id, {
        id: session.id,
        kind: 'session',
        projectId: session.projectId,
        worktreeId: session.worktreeId,
        title: session.name,
        subtitle,
        searchText: [
          session.name,
          projectName,
          worktreeLabel,
          session.type,
          session.label,
          outputState,
          session.status,
        ].filter(Boolean).join(' '),
        priority,
        isCurrent: session.id === activeTabId,
        sessionType: session.type,
        sessionStatus: session.status,
        outputState,
        label: session.label,
      })
    }

    for (const editor of editors) {
      const projectName = projectNameById.get(editor.projectId) ?? ''
      const worktreeLabel = getWorktreeLabel(editor.worktreeId, editor.projectId, worktrees)
      const paneRank = activePaneRank.get(editor.id)
      const relativePath = getRelativePath(editor.filePath)
      const priority = (editor.id === activeTabId ? 1000 : 0)
        + (paneRank !== undefined ? 500 - paneRank * 10 : 0)
        + (editor.modified ? 220 : 0)
        + (selectedProjectId === editor.projectId ? 30 : 0)

      items.set(editor.id, {
        id: editor.id,
        kind: 'editor',
        projectId: editor.projectId,
        worktreeId: editor.worktreeId,
        title: editor.fileName,
        subtitle: [projectName, worktreeLabel, relativePath].filter(Boolean).join(' • '),
        searchText: [
          editor.fileName,
          relativePath,
          editor.filePath,
          projectName,
          worktreeLabel,
          editor.language,
          editor.modified ? 'modified dirty unsaved' : '',
        ].filter(Boolean).join(' '),
        priority,
        isCurrent: editor.id === activeTabId,
        modified: editor.modified,
        language: editor.language,
      })
    }

    return items
  }, [activePaneRank, activeTabId, editors, outputStates, projectNameById, selectedProjectId, sessions, worktrees])

  const searchableItems = useMemo(() => {
    const allItems = Array.from(itemsById.values())
    const normalizedQuery = query.trim()

    if (!normalizedQuery) {
      return allItems.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
    }

    return allItems
      .map((item) => ({
        item,
        score: buildSearchScore(item.searchText, normalizedQuery),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => (b.score + b.item.priority) - (a.score + a.item.priority) || a.item.title.localeCompare(b.item.title))
      .map((entry) => entry.item)
  }, [itemsById, query])

  const mruItems = useMemo(() => {
    const mruIds = buildMruIds(paneSessions, paneRecentSessions, activeTabId)
    return mruIds
      .map((id) => itemsById.get(id))
      .filter((item): item is SwitcherItem => Boolean(item))
  }, [activeTabId, itemsById, paneRecentSessions, paneSessions])

  mruItemsRef.current = mruItems

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setMode((currentMode) => {
          if (currentMode === 'search') return null
          setQuery('')
          setSelectedIdx(0)
          setTimeout(() => inputRef.current?.focus(), 0)
          return 'search'
        })
        return
      }

      if (event.key === 'Escape') {
        if (mode === 'search') {
          event.preventDefault()
          setMode(null)
          return
        }
        if (mode === 'mru') {
          event.preventDefault()
          setMode(null)
        }
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [mode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (mode === 'search' || !event.ctrlKey || event.key !== 'Tab') return

      const items = mruItemsRef.current
      if (items.length === 0) return

      event.preventDefault()
      event.stopPropagation()

      setMode('mru')
      setSelectedIdx((currentIdx) => {
        if (mode !== 'mru') {
          return event.shiftKey ? items.length - 1 : 0
        }
        const direction = event.shiftKey ? -1 : 1
        return (currentIdx + direction + items.length) % items.length
      })
    }

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (mode !== 'mru') return
      if (event.key !== 'Control') return

      event.preventDefault()
      const item = mruItemsRef.current[selectedIdxRef.current]
      if (item) activateItem(item)
      setMode(null)
    }

    const handleBlur = (): void => {
      if (mode === 'mru') setMode(null)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [mode])

  useEffect(() => {
    if (!mode) {
      setQuery('')
      setSelectedIdx(0)
    }
  }, [mode])

  const visibleItems = mode === 'mru' ? mruItems : searchableItems

  useEffect(() => {
    if (visibleItems.length === 0) {
      if (selectedIdx !== 0) setSelectedIdx(0)
      return
    }
    if (selectedIdx >= visibleItems.length) {
      setSelectedIdx(visibleItems.length - 1)
    }
  }, [selectedIdx, visibleItems])

  const close = useCallback(() => setMode(null), [])

  const handleSelect = useCallback((idx: number) => {
    const item = visibleItems[idx]
    if (!item) return
    activateItem(item)
    close()
  }, [close, visibleItems])

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIdx((currentIdx) => Math.min(currentIdx + 1, Math.max(visibleItems.length - 1, 0)))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIdx((currentIdx) => Math.max(currentIdx - 1, 0))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      handleSelect(selectedIdx)
    }
  }, [handleSelect, selectedIdx, visibleItems.length])

  if (!mode) return null

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/35" onClick={close} />
      <div
        className={cn(
          'fixed left-1/2 top-[56px] z-[201] w-[560px] -translate-x-1/2 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)]',
          'bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45',
        )}
      >
        {mode === 'search' ? (
          <div className="border-b border-[var(--color-border)] p-3">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedIdx(0)
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="切换到会话、文件、项目或工作树..."
              className={cn(
                'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2.5',
                'text-[var(--ui-font-base)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
                'outline-none transition-colors focus:border-[var(--color-accent)] focus-visible:outline-none',
              )}
              autoFocus
            />
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                窗格最近标签
              </div>
              <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                释放 <span className="font-semibold text-[var(--color-text-primary)]">Ctrl</span> 切换到高亮标签
              </div>
            </div>
            <div className="rounded-full bg-[var(--color-bg-tertiary)] px-2.5 py-1 text-[11px] text-[var(--color-text-tertiary)]">
              {visibleItems.length} 个标签
            </div>
          </div>
        )}

        <div className="max-h-[420px] overflow-y-auto py-1.5">
          {visibleItems.length === 0 && (
            <div className="px-4 py-5 text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              {mode === 'search' ? '没有匹配的会话或文件。' : '此窗格无最近标签。'}
            </div>
          )}

          {visibleItems.map((item, index) => {
            const isSelected = index === selectedIdx
            const editorIcon = item.language ? (FILE_ICONS[item.language] ?? FILE_ICONS.plaintext) : null

            return (
              <button
                key={item.id}
                onClick={() => handleSelect(index)}
                onMouseEnter={() => setSelectedIdx(index)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors',
                  isSelected
                    ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]/65',
                )}
              >
                {item.kind === 'session' ? (
                  <img src={TYPE_ICONS[item.sessionType ?? 'terminal'] ?? claudeIcon} alt="" className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <span
                    className="mt-0.5 shrink-0 rounded px-[4px] py-[2px] text-[8px] font-bold leading-none"
                    style={{
                      backgroundColor: (editorIcon?.color ?? FILE_ICONS.plaintext.color) + '20',
                      color: editorIcon?.color ?? FILE_ICONS.plaintext.color,
                    }}
                  >
                    {editorIcon?.icon ?? FILE_ICONS.plaintext.icon}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{item.title}</span>
                    {item.isCurrent && (
                      <span className="rounded-full bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">
                        当前
                      </span>
                    )}
                    {renderStatusBadge(item)}
                    {item.label && (
                      <span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                        {item.label}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">
                    {item.subtitle}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
