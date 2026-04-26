import { AlertCircle, ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HistoricalSession, HistoricalSessionListResult, HistoricalSessionSource, Project, Session, Worktree } from '@shared/types'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { cn } from '@/lib/utils'
import { getSessionIcon } from '@/lib/sessionIcon'
import { resumeHistoricalSession } from '@/lib/resumeHistoricalSession'
import { UNGROUPED_PROJECT_GROUP_ID, isClaudeCodeType } from '@shared/types'
import { useGroupsStore } from '@/stores/groups'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DockActions } from '@/components/layout/DockActions'

type SourceFilter = 'all' | HistoricalSessionSource

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'claude-code', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
]

// ─── Module-level cache ──────────────────────────────────────────────────
// DockPanel unmounts inactive tabs, so every re-open of "历史会话" constructs
// a fresh panel component. Without this we'd trigger a full rescan each time
// and flash the loading placeholder. The cache persists across unmounts for
// the lifetime of the renderer process; mutations here mirror updates the
// user makes from this panel (delete, refresh) so the view is always in sync
// with what main actually has on disk.
let cachedHistory: HistoricalSessionListResult | null = null

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '未知时间'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '未知时间'
  const diff = Math.max(0, Date.now() - ts)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return `${Math.floor(diff / (30 * day))} 个月前`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Short wall-clock label. Within the same calendar year we drop the year so
 *  the line stays compact; older entries show the full date. */
function formatAbsoluteTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const month = pad2(d.getMonth() + 1)
  const day = pad2(d.getDate())
  const hh = pad2(d.getHours())
  const mm = pad2(d.getMinutes())
  if (d.getFullYear() === now.getFullYear()) {
    return `${month}-${day} ${hh}:${mm}`
  }
  return `${d.getFullYear()}-${month}-${day} ${hh}:${mm}`
}

function formatFullTimestamp(iso: string | null): string {
  if (!iso) return '未知时间'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '未知时间'
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase()
}

function shortCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return normalized || '未知目录'
  return `…/${parts.slice(-2).join('/')}`
}

function cwdBasename(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized || '未知目录'
}

interface ProjectGroup {
  key: string
  projectId: string | null   // null = unmatched to any registered project
  label: string
  /** Project root path for matched; representative cwd for unmatched. */
  pathHint: string | null
  sessions: HistoricalSession[]
  latestUpdatedAt: number
}

function findMatchingProjectId(cwd: string, projects: Project[]): string | null {
  if (!cwd) return null
  const target = normalizePath(cwd)
  let exact: string | null = null
  let prefix: { id: string; length: number } | null = null
  for (const p of projects) {
    const pp = normalizePath(p.path)
    if (!pp) continue
    if (pp === target) { exact = p.id; break }
    if (target.startsWith(`${pp}/`)) {
      if (!prefix || pp.length > prefix.length) prefix = { id: p.id, length: pp.length }
    }
  }
  return exact ?? prefix?.id ?? null
}

function isCodexType(type: Session['type']): boolean {
  return type === 'codex' || type === 'codex-yolo'
}

function parseTime(iso: string | null): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

function resolveSessionCwd(session: Session, projects: Project[], worktrees: Worktree[]): string {
  if (session.cwd) return session.cwd
  if (session.worktreeId) {
    const wt = worktrees.find((w) => w.id === session.worktreeId)
    if (wt?.path) return wt.path
  }
  const mainWorktree = worktrees.find((w) => w.projectId === session.projectId && w.isMain)
  if (mainWorktree?.path) return mainWorktree.path
  return projects.find((p) => p.id === session.projectId)?.path ?? ''
}

function inferCodexSessionIds(
  appSessions: Session[],
  historySessions: HistoricalSession[],
  projects: Project[],
  worktrees: Worktree[],
): Map<string, string> {
  const result = new Map<string, string>()
  const usedHistoryIds = new Set<string>()
  for (const s of appSessions) {
    if (isCodexType(s.type) && s.codexResumeId) usedHistoryIds.add(s.codexResumeId)
  }
  const candidates = historySessions
    .filter((s) => s.source === 'codex')
    .map((s) => ({
      session: s,
      cwd: normalizePath(s.cwd),
      startedAt: parseTime(s.startedAt),
      updatedAt: parseTime(s.updatedAt),
    }))
    .filter((s) => s.cwd && (s.startedAt > 0 || s.updatedAt > 0))

  for (const s of appSessions) {
    if (!isCodexType(s.type) || s.codexResumeId || s.status !== 'running') continue
    const cwd = normalizePath(resolveSessionCwd(s, projects, worktrees))
    if (!cwd) continue

    let best: { id: string; score: number } | null = null
    for (const candidate of candidates) {
      if (usedHistoryIds.has(candidate.session.id)) continue
      if (candidate.cwd !== cwd) continue

      const startedAt = candidate.startedAt || candidate.updatedAt
      // A freshly launched Codex rollout is created shortly after the
      // FastAgents tab. If it predates the tab by much, it is probably an older
      // transcript in the same project.
      if (startedAt < s.createdAt - 2 * 60_000) continue

      const score = Math.abs(startedAt - s.createdAt)
      if (!best || score < best.score) {
        best = { id: candidate.session.id, score }
      }
    }

    if (best) {
      result.set(s.id, best.id)
      usedHistoryIds.add(best.id)
    }
  }

  return result
}

function buildProjectGroups(
  sessions: HistoricalSession[],
  projects: Project[],
  activeProjectId: string | null,
): ProjectGroup[] {
  const byProject = new Map<string, HistoricalSession[]>()
  const orphansByCwd = new Map<string, HistoricalSession[]>()

  for (const s of sessions) {
    const pid = findMatchingProjectId(s.cwd, projects)
    if (pid) {
      const arr = byProject.get(pid)
      if (arr) arr.push(s); else byProject.set(pid, [s])
    } else {
      const key = s.cwd || '(未知目录)'
      const arr = orphansByCwd.get(key)
      if (arr) arr.push(s); else orphansByCwd.set(key, [s])
    }
  }

  const latest = (list: HistoricalSession[]): number => {
    let max = 0
    for (const s of list) {
      const t = s.updatedAt ? Date.parse(s.updatedAt) : 0
      if (!Number.isNaN(t) && t > max) max = t
    }
    return max
  }

  const groups: ProjectGroup[] = []

  for (const [pid, list] of byProject) {
    const proj = projects.find((p) => p.id === pid)
    list.sort((a, b) => {
      const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
      const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
      return bt - at
    })
    groups.push({
      key: `proj:${pid}`,
      projectId: pid,
      label: proj?.name ?? '(已删除项目)',
      pathHint: proj?.path ?? null,
      sessions: list,
      latestUpdatedAt: latest(list),
    })
  }

  for (const [cwd, list] of orphansByCwd) {
    list.sort((a, b) => {
      const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
      const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
      return bt - at
    })
    groups.push({
      key: `cwd:${cwd}`,
      projectId: null,
      // Orphan group labels show just the basename — the full path is already
      // available in the tooltip and in the "添加到 FastAgents 项目" picker.
      label: cwdBasename(cwd),
      pathHint: cwd,
      sessions: list,
      latestUpdatedAt: latest(list),
    })
  }

  groups.sort((a, b) => {
    const aCurr = a.projectId === activeProjectId && activeProjectId != null
    const bCurr = b.projectId === activeProjectId && activeProjectId != null
    if (aCurr && !bCurr) return -1
    if (bCurr && !aCurr) return 1
    // Matched projects before orphans (all else equal)
    if (a.projectId && !b.projectId) return -1
    if (b.projectId && !a.projectId) return 1
    return b.latestUpdatedAt - a.latestUpdatedAt
  })

  return groups
}

function SourceIcon({ source, isDark }: { source: HistoricalSessionSource; isDark: boolean }): JSX.Element {
  const iconSrc = getSessionIcon(source === 'codex' ? 'codex' : 'claude-code', isDark)
  return <img src={iconSrc} alt="" className="h-3.5 w-3.5 shrink-0" />
}

interface HistoryItemProps {
  session: HistoricalSession
  onResume: (session: HistoricalSession) => void
  onContextMenu: (session: HistoricalSession, x: number, y: number) => void
  isDark: boolean
  /** Show the cwd tail below the preview — useful in orphan groups where
   *  sessions under the same header can come from different subdirs. */
  showCwd: boolean
  /** This transcript is currently open in some tab (maybe not focused). */
  isOpen: boolean
  /** This transcript is the one shown in the active pane. */
  isActive: boolean
}

function HistoryItem({
  session, onResume, onContextMenu, isDark, showCwd, isOpen, isActive,
}: HistoryItemProps): JSX.Element {
  const preview = session.firstUserPrompt ?? '（无用户消息）'
  const relTime = formatRelativeTime(session.updatedAt)
  const absTime = formatAbsoluteTime(session.updatedAt)
  const fullTime = formatFullTimestamp(session.updatedAt)

  return (
    <button
      type="button"
      onClick={() => onResume(session)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(session, e.clientX, e.clientY)
      }}
      className={cn(
        'group relative flex w-full flex-col gap-1 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-all duration-200 mx-1 w-[calc(100%-8px)]',
        isActive
          ? 'bg-[var(--color-accent)]/10 ring-1 ring-inset ring-[var(--color-accent)]/20 shadow-[inset_0_0_12px_var(--color-accent-muted)]'
          : 'hover:bg-[var(--color-bg-surface)]/40',
      )}
      title={`${session.source === 'codex' ? 'Codex' : 'Claude Code'} · ${session.id}\n最近更新：${fullTime}\n${session.cwd}\n${isActive ? '已激活，点击切回' : isOpen ? '已在其他标签页打开，点击切换' : '点击恢复'} · 右键删除`}
    >
      {/* Active marker */}
      {isActive && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent)]" />
      )}

      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity">
          <SourceIcon source={session.source} isDark={isDark} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(
              'truncate text-[12.5px] transition-colors duration-200 flex-1 font-medium',
              isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]'
            )}>
              {preview}
            </span>
            {isOpen && (
              <span className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium shadow-sm transition-all',
                isActive ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-bg-primary)] text-[var(--color-accent)] border border-[var(--color-accent)]/20'
              )}>
                打开中
              </span>
            )}
          </div>
          
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
            {absTime && <span className="tabular-nums">{absTime}</span>}
            <span className="opacity-30 text-[9px]">/</span>
            <span className="text-[var(--color-text-tertiary)]">{relTime}</span>
            <span className="opacity-30 text-[9px]">/</span>
            <span className="tabular-nums">{session.userTurns} 轮对话</span>
            {showCwd && (
              <>
                <span className="opacity-30 text-[9px]">/</span>
                <span className="truncate max-w-[140px] bg-[var(--color-bg-primary)] px-2 py-0.5 rounded border border-[var(--color-border)]/60 text-[10px] text-[var(--color-text-tertiary)]">
                  {shortCwd(session.cwd)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Context menu ─────────────────────────────────────────────────────
// Pattern mirrored from ProjectItem: backdrop overlay closes the menu, menu
// itself is positioned absolutely via a fixed-position wrapper. Portalled to
// <body> so it escapes the scrollable sidebar's clipping.

const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] whitespace-nowrap hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]'
const MENU_ITEM_DANGER = 'flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] whitespace-nowrap hover:bg-[var(--color-bg-surface)]'
const MENU_HEADER = 'px-3 py-1 text-[var(--ui-font-2xs)] font-medium uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]'

interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  children: React.ReactNode
}

function ContextMenu({ x, y, onClose, children }: ContextMenuProps): JSX.Element {
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={(el) => {
          if (!el) return
          // Nudge the menu back into the viewport when it spills off the edge
          const rect = el.getBoundingClientRect()
          const vh = window.innerHeight
          const vw = window.innerWidth
          if (rect.bottom > vh) el.style.top = `${Math.max(4, vh - rect.height - 4)}px`
          if (rect.right > vw) el.style.left = `${Math.max(4, vw - rect.width - 4)}px`
        }}
        style={{ top: y, left: x }}
        className={cn(
          'fixed z-50 min-w-[14rem] max-w-[22rem] rounded-[var(--radius-md)] py-1',
          'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30',
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

interface SessionMenuState { session: HistoricalSession; x: number; y: number }
interface GroupMenuState { group: ProjectGroup; x: number; y: number }
interface AddProjectPickerState { group: ProjectGroup; x: number; y: number }
interface PendingDelete {
  entries: HistoricalSession[]
  title: string
  message: string
}

export function SessionHistoryPanel(): JSX.Element {
  const addToast = useUIStore((s) => s.addToast)
  const sourceFilter = useUIStore((s) => s.settings.sessionHistorySourceFilter)
  const onlyCurrentProject = useUIStore((s) => s.settings.sessionHistoryOnlyCurrentProject)
  const updateSettings = useUIStore((s) => s.updateSettings)
  const isDark = useIsDarkTheme()
  const projects = useProjectsStore((s) => s.projects)
  const activeProjectId = useProjectsStore((s) => s.selectedProjectId)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  // Live set of currently-open transcripts keyed by their resume id. Re-derived
  // on every store change so opening/closing a tab immediately restyles the
  // matching history row. The active one is pulled from the focused pane so
  // switching between two open agent tabs also updates the highlight.
  const openSessions = useSessionsStore((s) => s.sessions)
  const activePaneSessionId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)

  const setSourceFilter = useCallback((next: SourceFilter) => {
    updateSettings({ sessionHistorySourceFilter: next })
  }, [updateSettings])

  const toggleOnlyCurrentProject = useCallback(() => {
    updateSettings({ sessionHistoryOnlyCurrentProject: !onlyCurrentProject })
  }, [updateSettings, onlyCurrentProject])

  // Seed from the module-level cache so remounting the panel shows the list
  // instantly — only the first open in a session shows the loading state.
  const [loading, setLoading] = useState(cachedHistory === null)
  const [sessions, setSessions] = useState<HistoricalSession[]>(() => cachedHistory?.sessions ?? [])
  const [errors, setErrors] = useState<Partial<Record<HistoricalSessionSource, string>>>(() => cachedHistory?.errors ?? {})
  const [searchQuery, setSearchQuery] = useState('')
  /** Per-group expand state. `undefined` = use default (current project expanded, others collapsed). */
  const [expandOverride, setExpandOverride] = useState<Record<string, boolean>>({})
  const [resumingId, setResumingId] = useState<string | null>(null)
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null)
  const [groupMenu, setGroupMenu] = useState<GroupMenuState | null>(null)
  const [addProjectPicker, setAddProjectPicker] = useState<AddProjectPickerState | null>(null)
  const [newGroupDraft, setNewGroupDraft] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)

  const userGroups = useGroupsStore((s) => s.groups)

  const inferredCodexSessionIds = useMemo(
    () => inferCodexSessionIds(openSessions, sessions, projects, worktrees),
    [openSessions, sessions, projects, worktrees],
  )

  useEffect(() => {
    if (inferredCodexSessionIds.size === 0) return
    const store = useSessionsStore.getState()
    for (const [sessionId, codexResumeId] of inferredCodexSessionIds) {
      const current = store.sessions.find((s) => s.id === sessionId)
      if (!current || !isCodexType(current.type) || current.codexResumeId) continue
      store.updateSession(sessionId, { codexResumeId })
    }
  }, [inferredCodexSessionIds])

  const { openClaudeIds, openCodexIds, activeClaudeId, activeCodexId } = useMemo(() => {
    const claudeIds = new Set<string>()
    const codexIds = new Set<string>()
    let activeClaude: string | null = null
    let activeCodex: string | null = null
    for (const s of openSessions) {
      if (isClaudeCodeType(s.type) && s.resumeUUID) {
        claudeIds.add(s.resumeUUID)
        if (s.id === activePaneSessionId) activeClaude = s.resumeUUID
      } else if (isCodexType(s.type)) {
        const codexId = s.codexResumeId ?? inferredCodexSessionIds.get(s.id) ?? null
        if (!codexId) continue
        codexIds.add(codexId)
        if (s.id === activePaneSessionId) activeCodex = codexId
      }
    }
    return { openClaudeIds: claudeIds, openCodexIds: codexIds, activeClaudeId: activeClaude, activeCodexId: activeCodex }
  }, [openSessions, activePaneSessionId, inferredCodexSessionIds])

  const refresh = useCallback(async (options: { background?: boolean } = {}): Promise<void> => {
    // Background refreshes piggyback on a cached render — no loading spinner,
    // no empty list flash. Foreground (first load / manual click) shows the
    // placeholder so the user understands something is happening.
    if (!options.background) setLoading(true)
    try {
      const result = await window.api.sessionHistory.list()
      cachedHistory = result
      setSessions(result.sessions)
      setErrors(result.errors ?? {})
    } catch (err) {
      addToast({
        title: '加载历史会话失败',
        body: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    void refresh({ background: cachedHistory !== null })
  }, [refresh])

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return sessions.filter((s) => {
      if (sourceFilter !== 'all' && s.source !== sourceFilter) return false
      if (!q) return true
      const haystack = `${s.firstUserPrompt ?? ''} ${s.cwd}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [sessions, searchQuery, sourceFilter])

  const allGroups = useMemo(
    () => buildProjectGroups(filteredSessions, projects, activeProjectId),
    [filteredSessions, projects, activeProjectId],
  )

  const visibleGroups = useMemo(() => {
    if (!onlyCurrentProject) return allGroups
    return allGroups.filter((g) => g.projectId === activeProjectId)
  }, [allGroups, onlyCurrentProject, activeProjectId])

  const isSearching = searchQuery.trim().length > 0

  const isGroupExpanded = useCallback((group: ProjectGroup): boolean => {
    const override = expandOverride[group.key]
    if (override !== undefined) return override
    // Search mode: auto-expand everything so matches are visible
    if (isSearching) return true
    // Default: current project expanded, everything else collapsed
    return group.projectId === activeProjectId && activeProjectId != null
  }, [expandOverride, isSearching, activeProjectId])

  const toggleGroup = useCallback((group: ProjectGroup) => {
    setExpandOverride((prev) => ({
      ...prev,
      [group.key]: !isGroupExpanded(group),
    }))
  }, [isGroupExpanded])

  const handleResume = useCallback(async (entry: HistoricalSession) => {
    if (resumingId) return
    setResumingId(entry.id)
    try {
      const result = await resumeHistoricalSession(entry)
      if (result.reused) {
        // Silent focus — no toast when the user just clicked the same entry
        // twice. Showing a success message every time would be noisy.
      } else if (result.anonymous) {
        addToast({
          title: '已在匿名工作区恢复会话',
          body: `未找到与 ${entry.cwd} 匹配的项目，已在匿名工作区打开。`,
          type: 'warning',
        })
      } else {
        addToast({
          title: '会话已恢复',
          body: '已在新标签页中打开，正在加载历史上下文…',
          type: 'success',
        })
      }
    } catch (err) {
      addToast({
        title: '恢复会话失败',
        body: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
    } finally {
      setResumingId(null)
    }
  }, [addToast, resumingId])

  const openSessionContextMenu = useCallback((session: HistoricalSession, x: number, y: number) => {
    setGroupMenu(null)
    setSessionMenu({ session, x, y })
  }, [])

  const openGroupContextMenu = useCallback((group: ProjectGroup, x: number, y: number) => {
    setSessionMenu(null)
    setGroupMenu({ group, x, y })
  }, [])

  const handleAddOrphanAsProject = useCallback((group: ProjectGroup, targetGroupId: string) => {
    if (!group.pathHint) return
    // Reject duplicates up-front — `addProject` doesn't deduplicate, so
    // without this the user could stack several clones of the same path in
    // their project list if they clicked quickly.
    const existing = useProjectsStore.getState().projects.find((p) => {
      return p.path.replace(/\\/g, '/').toLowerCase() === group.pathHint!.replace(/\\/g, '/').toLowerCase()
    })
    if (existing) {
      addToast({
        title: '项目已存在',
        body: `${existing.name} 已在项目列表中。`,
        type: 'info',
      })
      setAddProjectPicker(null)
      return
    }
    const projectId = useProjectsStore.getState().addProject(group.pathHint, targetGroupId)
    if (targetGroupId !== UNGROUPED_PROJECT_GROUP_ID) {
      useGroupsStore.getState().addProjectToGroup(targetGroupId, projectId)
    }
    setAddProjectPicker(null)
    addToast({
      title: '已添加项目',
      body: `${group.pathHint} 已加入 FastAgents，历史记录已重新归类。`,
      type: 'success',
    })
    // No IPC call needed — the project list change triggers a re-render of the
    // grouped view, and the sessions themselves are already in state. We just
    // need React to rerun buildProjectGroups, which happens automatically
    // because it reads from the projects store.
  }, [addToast])

  const handleCreateGroupAndAdd = useCallback((group: ProjectGroup, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const newGroupId = useGroupsStore.getState().addGroup(trimmed)
    handleAddOrphanAsProject(group, newGroupId)
  }, [handleAddOrphanAsProject])

  const countOpenTabs = useCallback((entries: HistoricalSession[]): number => {
    const store = useSessionsStore.getState().sessions
    let n = 0
    for (const entry of entries) {
      const match = store.find((s) => (
        entry.source === 'claude-code'
          ? isClaudeCodeType(s.type) && s.resumeUUID === entry.id
          : (s.type === 'codex' || s.type === 'codex-yolo') && s.codexResumeId === entry.id
      ))
      if (match) n += 1
    }
    return n
  }, [])

  const requestDeleteSession = useCallback((entry: HistoricalSession) => {
    const preview = entry.firstUserPrompt?.slice(0, 60) ?? '（无用户消息）'
    const openTabs = countOpenTabs([entry])
    const openHint = openTabs > 0 ? '\n\n此会话当前已在标签页中打开，删除时会一并关闭该标签页。' : ''
    setPendingDelete({
      entries: [entry],
      title: '删除此历史会话？',
      message: `将删除磁盘上的会话记录，此操作无法撤销。\n\n预览：${preview}${openHint}`,
    })
  }, [countOpenTabs])

  const requestDeleteGroup = useCallback((group: ProjectGroup) => {
    const openTabs = countOpenTabs(group.sessions)
    const openHint = openTabs > 0 ? `\n\n其中 ${openTabs} 个当前已打开的标签页也会一并关闭。` : ''
    setPendingDelete({
      entries: group.sessions,
      title: `删除 ${group.label} 的全部历史会话？`,
      message: `将删除磁盘上的 ${group.sessions.length} 条会话记录，此操作无法撤销。${openHint}`,
    })
  }, [countOpenTabs])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    try {
      // Close any live tabs backed by one of the transcripts we're about to
      // delete. If we didn't, the PTY would keep writing (Claude recreates the
      // jsonl file on its next write), and the user would see orphan tabs
      // pointing at a session that now appears to "not exist" in history.
      const sessionStore = useSessionsStore.getState()
      const paneStore = usePanesStore.getState()
      const sessionsToClose = sessionStore.sessions.filter((s) => {
        for (const entry of pendingDelete.entries) {
          if (entry.source === 'claude-code') {
            if (isClaudeCodeType(s.type) && s.resumeUUID === entry.id) return true
          } else {
            if ((s.type === 'codex' || s.type === 'codex-yolo') && s.codexResumeId === entry.id) return true
          }
        }
        return false
      })
      for (const s of sessionsToClose) {
        if (s.ptyId) {
          try { await window.api.session.kill(s.ptyId) } catch { /* ignore — we're removing it anyway */ }
        }
        const paneId = paneStore.findPaneForSession(s.id)
        if (paneId) paneStore.removeSessionFromPane(paneId, s.id)
        // Clear pinned so removeSession doesn't refuse; the user explicitly
        // chose to wipe this session, a pin should not block the operation.
        if (s.pinned) sessionStore.updateSession(s.id, { pinned: false })
        sessionStore.removeSession(s.id)
      }

      const paths = pendingDelete.entries.map((e) => e.filePath)
      const result = await window.api.sessionHistory.delete(paths)

      // Optimistic local removal — drops anything we asked to delete, regardless
      // of the per-file result. If main couldn't delete a file, it stays on
      // disk but we also surface the error via toast so the user can retry.
      const deletedSet = new Set(paths)
      setSessions((prev) => {
        const next = prev.filter((s) => !deletedSet.has(s.filePath))
        // Keep the module-level cache consistent with what the UI now shows,
        // so the next panel remount doesn't flash the deleted entries back in
        // before the background refresh completes.
        if (cachedHistory) {
          cachedHistory = { ...cachedHistory, sessions: next }
        }
        return next
      })

      if (result.errors.length > 0) {
        addToast({
          title: `部分会话删除失败（${result.errors.length} 条）`,
          body: result.errors.slice(0, 3).map((e) => e.error).join('；'),
          type: 'warning',
        })
      } else {
        const closedHint = sessionsToClose.length > 0 ? `，已关闭 ${sessionsToClose.length} 个标签页` : ''
        addToast({
          title: '已删除',
          body: `已删除 ${result.deleted} 条历史会话${closedHint}。`,
          type: 'success',
        })
      }
    } catch (err) {
      addToast({
        title: '删除失败',
        body: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }, [pendingDelete, deleting, addToast])

  const errorList = useMemo(() => {
    const out: Array<{ source: HistoricalSessionSource; message: string }> = []
    for (const [key, message] of Object.entries(errors)) {
      if (message) out.push({ source: key as HistoricalSessionSource, message })
    }
    return out
  }, [errors])

  const totalCount = sessions.length
  const shownCount = filteredSessions.length
  const hasFilter = isSearching || sourceFilter !== 'all' || onlyCurrentProject

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)]/50 px-2.5 py-1.5">
        <span className="pl-1 text-[11px] font-bold tracking-wider text-[var(--color-text-tertiary)] uppercase">Session History</span>
        <button
          onClick={() => { void refresh() }}
          disabled={loading}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
            'transition-all duration-150',
            loading && 'cursor-not-allowed opacity-50',
          )}
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-3">
        <div className="group/search relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-[var(--color-text-tertiary)] transition-colors group-focus-within/search:text-[var(--color-accent)]">
            <Search size={14} strokeWidth={2.5} />
          </div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索首句或目录…"
            spellCheck={false}
            className={cn(
              'peer h-8.5 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]/80 bg-[var(--color-bg-primary)]/40 pl-9 pr-8',
              'text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
              'outline-none transition-all duration-200',
              'hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-primary)]/60',
              'focus:border-[var(--color-accent)]/60 focus:bg-[var(--color-bg-primary)]',
              'focus:shadow-[0_0_0_3px_var(--color-accent-muted)]',
            )}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-1.5 my-auto flex h-5.5 w-5.5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
              title="清除搜索"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Filter row */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-3">
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSourceFilter(f.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-bold transition-all duration-200 border',
              sourceFilter === f.id
                ? 'bg-[var(--color-accent)] text-white border-transparent shadow-sm'
                : 'bg-[var(--color-bg-primary)]/40 border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text-secondary)]',
            )}
          >
            {f.label}
          </button>
        ))}
        {activeProjectId && (
          <button
            type="button"
            onClick={toggleOnlyCurrentProject}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-bold transition-all duration-200 border',
              onlyCurrentProject
                ? 'bg-[var(--color-accent)] text-white border-transparent shadow-sm'
                : 'bg-[var(--color-bg-primary)]/40 border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text-secondary)]',
            )}
            title="仅显示与当前项目匹配的会话"
          >
            仅当前项目
          </button>
        )}
        <div className="ml-auto text-[10px] font-bold tabular-nums text-[var(--color-text-tertiary)]/70 uppercase tracking-wider">
          {hasFilter ? `${shownCount} / ${totalCount}` : totalCount}
        </div>
      </div>

      {/* Errors */}
      {errorList.length > 0 && (
        <div className="shrink-0 space-y-1 px-2.5 pb-2">
          {errorList.map((e) => (
            <div
              key={e.source}
              className="flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)]/60 px-2 py-1.5 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]"
            >
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span className="break-all">{e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto pb-2">
        {loading && sessions.length === 0 && (
          <div className="px-4 py-8 text-center text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
            正在扫描本地会话…
          </div>
        )}

        {!loading && visibleGroups.length === 0 && (
          <div className="mx-2 my-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)]/70 px-3 py-6 text-center text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
            {hasFilter ? '无匹配会话' : '还没有历史会话'}
          </div>
        )}

        {visibleGroups.map((group) => {
          const expanded = isGroupExpanded(group)
          const isCurrentProject = group.projectId === activeProjectId && activeProjectId != null
          const isOrphan = group.projectId == null
          return (
            <div key={group.key} className="mt-1.5">
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openGroupContextMenu(group, e.clientX, e.clientY)
                }}
                className={cn(
                  'sticky top-0 z-[1] flex w-full items-center gap-2 px-3 py-2.5',
                  'bg-[var(--color-bg-secondary)]/95 backdrop-blur-md',
                  'text-[var(--ui-font-sm)] font-medium tracking-tight text-[var(--color-text-primary)]',
                  'hover:bg-[var(--color-bg-surface)]/40 transition-all duration-200',
                  'border-y border-[var(--color-border)]/40',
                )}
                title={`${group.pathHint ?? group.label}\n右键删除该组全部历史`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-md transition-colors',
                    isCurrentProject ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-bg-primary)] text-[var(--color-text-tertiary)]'
                  )}>
                    {expanded ? <FolderOpen size={12} strokeWidth={2.5} /> : <Folder size={12} strokeWidth={2.5} />}
                  </div>
                  <span className="truncate">
                    {group.label}
                    {isOrphan && (
                      <span className="ml-1.5 text-[10px] font-bold text-[var(--color-text-tertiary)]/60 uppercase tracking-wider">
                        · 未归类
                      </span>
                    )}
                  </span>
                  {isCurrentProject && (
                    <span className="shrink-0 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[9px] font-medium text-white shadow-[0_0_8px_var(--color-accent-muted)]">
                      当前项目
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  <span className="tabular-nums text-[10px] font-medium text-[var(--color-text-tertiary)] bg-[var(--color-bg-primary)] px-2 py-0.5 rounded-full shadow-inner">
                    {group.sessions.length}
                  </span>
                  <div className="text-[var(--color-text-tertiary)]/40 group-hover:text-[var(--color-text-tertiary)] transition-colors">
                    {expanded ? <ChevronDown size={14} strokeWidth={2.5} /> : <ChevronRight size={14} strokeWidth={2.5} />}
                  </div>
                </div>
              </button>
              {expanded && (
                <div className="flex flex-col gap-0.5 px-1 pt-0.5">
                  {group.sessions.map((s) => {
                    const openSet = s.source === 'codex' ? openCodexIds : openClaudeIds
                    const activeId = s.source === 'codex' ? activeCodexId : activeClaudeId
                    return (
                      <HistoryItem
                        key={`${s.source}:${s.id}`}
                        session={s}
                        onResume={handleResume}
                        onContextMenu={openSessionContextMenu}
                        isDark={isDark}
                        showCwd={!isOrphan && s.cwd !== (group.pathHint ?? '')}
                        isOpen={openSet.has(s.id)}
                        isActive={activeId === s.id}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Right-click menus */}
      {sessionMenu && (
        <ContextMenu x={sessionMenu.x} y={sessionMenu.y} onClose={() => setSessionMenu(null)}>
          <button
            className={MENU_ITEM_DANGER}
            onClick={() => {
              requestDeleteSession(sessionMenu.session)
              setSessionMenu(null)
            }}
          >
            <Trash2 size={12} /> 删除此历史会话
          </button>
        </ContextMenu>
      )}

      {groupMenu && (
        <ContextMenu x={groupMenu.x} y={groupMenu.y} onClose={() => setGroupMenu(null)}>
          {groupMenu.group.projectId === null && groupMenu.group.pathHint && (
            <>
              <button
                className={MENU_ITEM}
                onClick={() => {
                  const pos = { group: groupMenu.group, x: groupMenu.x, y: groupMenu.y }
                  setGroupMenu(null)
                  setNewGroupDraft(null)
                  setAddProjectPicker(pos)
                }}
              >
                <FolderPlus size={12} /> 添加到 FastAgents 项目…
              </button>
              <div className="my-0.5 h-px bg-[var(--color-border)]" />
            </>
          )}
          <button
            className={MENU_ITEM_DANGER}
            onClick={() => {
              requestDeleteGroup(groupMenu.group)
              setGroupMenu(null)
            }}
          >
            <Trash2 size={12} /> 删除该组 {groupMenu.group.sessions.length} 条历史
          </button>
        </ContextMenu>
      )}

      {addProjectPicker && (
        <ContextMenu
          x={addProjectPicker.x}
          y={addProjectPicker.y}
          onClose={() => {
            setAddProjectPicker(null)
            setNewGroupDraft(null)
          }}
        >
          <div className={MENU_HEADER}>选择要加入的分组</div>
          <div className="px-3 pb-1 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)] break-all">
            {addProjectPicker.group.pathHint}
          </div>
          <div className="my-0.5 h-px bg-[var(--color-border)]" />
          {userGroups.map((g) => (
            <button
              key={g.id}
              className={MENU_ITEM}
              onClick={() => handleAddOrphanAsProject(addProjectPicker.group, g.id)}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: g.color }}
              />
              <span className="truncate">{g.name}</span>
            </button>
          ))}
          {userGroups.length > 0 && <div className="my-0.5 h-px bg-[var(--color-border)]" />}
          <button
            className={MENU_ITEM}
            onClick={() => handleAddOrphanAsProject(addProjectPicker.group, UNGROUPED_PROJECT_GROUP_ID)}
          >
            <Folder size={12} /> 未分组
          </button>
          <div className="my-0.5 h-px bg-[var(--color-border)]" />
          {newGroupDraft === null ? (
            <button
              className={MENU_ITEM}
              onClick={() => setNewGroupDraft('')}
            >
              <FolderPlus size={12} /> 新建分组…
            </button>
          ) : (
            // Stop propagation — the ContextMenu backdrop listens for clicks
            // and would otherwise close the menu as soon as the input is
            // clicked or keys are pressed.
            <div
              className="flex items-center gap-1.5 px-3 py-1.5"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <FolderPlus size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
              <input
                autoFocus
                value={newGroupDraft}
                onChange={(e) => setNewGroupDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreateGroupAndAdd(addProjectPicker.group, newGroupDraft)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setNewGroupDraft(null)
                  }
                }}
                placeholder="分组名称 · 回车确认"
                className={cn(
                  'h-6 w-full rounded-[var(--radius-sm)] bg-[var(--color-bg-surface)] px-2 text-[var(--ui-font-sm)]',
                  'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
                  'border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none',
                )}
              />
            </div>
          )}
        </ContextMenu>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.title}
          message={pendingDelete.message}
          confirmLabel={deleting ? '删除中…' : '删除'}
          cancelLabel="取消"
          danger
          onConfirm={() => { void confirmDelete() }}
          onCancel={() => { if (!deleting) setPendingDelete(null) }}
        />
      )}
    </div>
  )
}
