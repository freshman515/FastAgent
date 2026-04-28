import {
  Bot,
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardCheck,
  ExternalLink,
  GitBranch,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  SendHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import type { DragEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { SESSION_TYPE_CONFIG } from '@shared/types'
import type { AgentBoardItem, AgentBoardPriority, AgentBoardStatus } from '@/stores/ui'
import { cn, generateId } from '@/lib/utils'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'
import { filterSessionTypesForCurrentPlatform } from '@/lib/platformSessionTypes'

type BoardSessionType = AgentBoardItem['sessionType']
type BoardScope = 'current' | 'all'

const INPUT =
  'w-full rounded-[var(--radius-md)] border border-[var(--color-border)]/80 bg-[var(--color-bg-primary)]/40 px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-all focus:border-[var(--color-accent)]/60 focus:bg-[var(--color-bg-primary)] focus:shadow-[0_0_0_2px_var(--color-accent-muted)]'
const BUTTON =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[10px] font-bold text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-accent)]/45 hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

const COLUMNS: Array<{
  id: AgentBoardStatus
  label: string
  icon: typeof Circle
  color: string
}> = [
  { id: 'todo', label: '待办', icon: Circle, color: 'var(--color-text-tertiary)' },
  { id: 'in_progress', label: '进行中', icon: CircleDot, color: 'var(--color-accent)' },
  { id: 'review', label: '验收', icon: ClipboardCheck, color: 'var(--color-warning)' },
  { id: 'done', label: '完成', icon: CheckCircle2, color: 'var(--color-success)' },
]

const PRIORITY_OPTIONS: Array<{ id: AgentBoardPriority; label: string }> = [
  { id: 'high', label: '高' },
  { id: 'medium', label: '中' },
  { id: 'low', label: '低' },
]

const SESSION_TYPE_OPTIONS: Array<{ id: BoardSessionType; label: string }> = [
  { id: 'claude-code', label: SESSION_TYPE_CONFIG['claude-code'].label },
  { id: 'claude-code-yolo', label: SESSION_TYPE_CONFIG['claude-code-yolo'].label },
  { id: 'claude-code-wsl', label: SESSION_TYPE_CONFIG['claude-code-wsl'].label },
  { id: 'claude-code-yolo-wsl', label: SESSION_TYPE_CONFIG['claude-code-yolo-wsl'].label },
  { id: 'codex', label: SESSION_TYPE_CONFIG.codex.label },
  { id: 'codex-yolo', label: SESSION_TYPE_CONFIG['codex-yolo'].label },
  { id: 'codex-wsl', label: SESSION_TYPE_CONFIG['codex-wsl'].label },
  { id: 'codex-yolo-wsl', label: SESSION_TYPE_CONFIG['codex-yolo-wsl'].label },
  { id: 'gemini', label: SESSION_TYPE_CONFIG.gemini.label },
  { id: 'gemini-yolo', label: SESSION_TYPE_CONFIG['gemini-yolo'].label },
  { id: 'opencode', label: SESSION_TYPE_CONFIG.opencode.label },
  { id: 'terminal', label: SESSION_TYPE_CONFIG.terminal.label },
  { id: 'terminal-wsl', label: SESSION_TYPE_CONFIG['terminal-wsl'].label },
]
const VISIBLE_SESSION_TYPE_OPTIONS = filterSessionTypesForCurrentPlatform(SESSION_TYPE_OPTIONS)

const PRIORITY_BADGE: Record<AgentBoardPriority, string> = {
  high: 'bg-[var(--color-error)]/15 text-[var(--color-error)]',
  medium: 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]',
  low: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]',
}

const COLUMN_ACCENT: Record<AgentBoardStatus, string> = {
  todo: 'border-[var(--color-border)]',
  in_progress: 'border-[var(--color-accent)]/45',
  review: 'border-[var(--color-warning)]/45',
  done: 'border-[var(--color-success)]/45',
}

function priorityRank(priority: AgentBoardPriority): number {
  if (priority === 'high') return 0
  if (priority === 'medium') return 1
  return 2
}

function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = minute * 60
  const day = hour * 24

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  return `${Math.floor(diff / day)} 天前`
}

function updateAgentBoardItems(updater: (items: AgentBoardItem[]) => AgentBoardItem[]): void {
  const ui = useUIStore.getState()
  ui.updateSettings({ agentBoardItems: updater(ui.settings.agentBoardItems) })
}

function composePrompt(card: AgentBoardItem): string {
  const body = card.description.trim()
  return [
    `任务看板卡片：${card.title}`,
    `优先级：${PRIORITY_OPTIONS.find((option) => option.id === card.priority)?.label ?? card.priority}`,
    '',
    body || '请根据卡片标题完成任务。',
    '',
    '完成后请用简短报告说明：改了什么、涉及哪些文件、如何验证、是否还有阻塞。',
  ].join('\n')
}

function waitForPty(sessionId: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tick = () => {
      const session = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
      if (session?.ptyId) {
        resolve(session.ptyId)
        return
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('会话 PTY 启动超时'))
        return
      }

      window.setTimeout(tick, 400)
    }
    tick()
  })
}

function getDragCardId(event: DragEvent): string | null {
  const value = event.dataTransfer.getData('application/x-fastagents-agent-card')
    || event.dataTransfer.getData('text/plain')
  return value.startsWith('agent-card:') ? value.slice('agent-card:'.length) : value || null
}

export function AgentBoard(): JSX.Element {
  const boardItems = useUIStore((state) => state.settings.agentBoardItems)
  const addToast = useUIStore((state) => state.addToast)
  const projects = useProjectsStore((state) => state.projects)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const worktrees = useWorktreesStore((state) => state.worktrees)
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)
  const sessions = useSessionsStore((state) => state.sessions)

  const [titleDraft, setTitleDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [priorityDraft, setPriorityDraft] = useState<AgentBoardPriority>('medium')
  const [sessionTypeDraft, setSessionTypeDraft] = useState<BoardSessionType>('claude-code')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<BoardScope>('current')
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [launchingCardId, setLaunchingCardId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPriority, setEditPriority] = useState<AgentBoardPriority>('medium')
  const [editSessionType, setEditSessionType] = useState<BoardSessionType>('claude-code')

  const selectedWorktree = selectedWorktreeId
    ? worktrees.find((worktree) => worktree.id === selectedWorktreeId && worktree.projectId === selectedProjectId)
    : null

  const scopedItems = useMemo(() => {
    if (scope === 'current' && selectedProjectId) {
      return boardItems.filter((item) => item.projectId === selectedProjectId)
    }
    return boardItems
  }, [boardItems, scope, selectedProjectId])

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = scopedItems.filter((item) => {
      if (!normalizedQuery) return true
      return item.title.toLowerCase().includes(normalizedQuery)
        || item.description.toLowerCase().includes(normalizedQuery)
        || SESSION_TYPE_CONFIG[item.sessionType].label.toLowerCase().includes(normalizedQuery)
    })

    return [...filtered].sort((a, b) => {
      const priorityGap = priorityRank(a.priority) - priorityRank(b.priority)
      if (priorityGap !== 0) return priorityGap
      return b.updatedAt - a.updatedAt
    })
  }, [query, scopedItems])

  const counts = useMemo(() => {
    return Object.fromEntries(
      COLUMNS.map((column) => [
        column.id,
        scopedItems.filter((item) => item.status === column.id).length,
      ]),
    ) as Record<AgentBoardStatus, number>
  }, [scopedItems])

  const patchCard = useCallback((cardId: string, updates: Partial<AgentBoardItem>) => {
    updateAgentBoardItems((items) => items.map((item) => (
      item.id === cardId
        ? { ...item, ...updates, updatedAt: Date.now() }
        : item
    )))
  }, [])

  const activateSession = useCallback((sessionId: string) => {
    const panes = usePanesStore.getState()
    const paneId = panes.findPaneForSession(sessionId) ?? panes.activePaneId
    if (!panes.findPaneForSession(sessionId)) {
      panes.addSessionToPane(paneId, sessionId)
    }
    panes.setPaneActiveSession(paneId, sessionId)
    panes.setActivePaneId(paneId)
    useSessionsStore.getState().setActive(sessionId)
  }, [])

  const launchCard = useCallback(async (card: AgentBoardItem) => {
    if (!selectedProject || card.projectId !== selectedProject.id) {
      patchCard(card.id, { error: '先切换到这张卡片所属项目再启动。' })
      return
    }

    setLaunchingCardId(card.id)
    patchCard(card.id, { status: 'in_progress', error: undefined })

    try {
      let sessionId = card.sessionId
      if (!sessionId) {
        const fallbackWorktreeId = useWorktreesStore.getState().getMainWorktree(selectedProject.id)?.id
        const worktreeId = card.worktreeId ?? selectedWorktree?.id ?? fallbackWorktreeId
        sessionId = useSessionsStore.getState().addSession(selectedProject.id, card.sessionType, worktreeId)
        useSessionsStore.getState().updateSession(sessionId, {
          name: `Board · ${card.title}`,
          label: 'Board',
          color: '#60a5fa',
        })
        patchCard(card.id, {
          sessionId,
          worktreeId,
          status: 'in_progress',
          launchedAt: Date.now(),
          error: undefined,
        })
      }

      activateSession(sessionId)
      const ptyId = await waitForPty(sessionId)
      await window.api.session.submit(ptyId, composePrompt(card), true)
      addToast({ type: 'success', title: '已启动', body: card.title })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      patchCard(card.id, { error: message })
      addToast({ type: 'error', title: '启动失败', body: message })
    } finally {
      setLaunchingCardId(null)
    }
  }, [activateSession, addToast, patchCard, selectedProject, selectedWorktree])

  const moveCard = useCallback((card: AgentBoardItem, status: AgentBoardStatus) => {
    if (card.status === status) return

    patchCard(card.id, {
      status,
      completedAt: status === 'done' ? Date.now() : undefined,
      error: undefined,
    })

    if (status === 'in_progress') {
      void launchCard({ ...card, status })
    }
  }, [launchCard, patchCard])

  const handleAdd = useCallback(() => {
    const title = titleDraft.trim()
    if (!title || !selectedProject) return

    const now = Date.now()
    const card: AgentBoardItem = {
      id: `agent-card-${generateId()}`,
      projectId: selectedProject.id,
      worktreeId: selectedWorktree?.id,
      title,
      description: descriptionDraft.trim(),
      status: 'todo',
      priority: priorityDraft,
      sessionType: sessionTypeDraft,
      createdAt: now,
      updatedAt: now,
    }

    updateAgentBoardItems((items) => [card, ...items])
    setTitleDraft('')
    setDescriptionDraft('')
    setPriorityDraft('medium')
  }, [descriptionDraft, priorityDraft, selectedProject, selectedWorktree, sessionTypeDraft, titleDraft])

  const handleDelete = useCallback((cardId: string) => {
    if (!window.confirm('删除这张任务卡片？关联会话不会被删除。')) return
    updateAgentBoardItems((items) => items.filter((item) => item.id !== cardId))
  }, [])

  const startEdit = useCallback((card: AgentBoardItem) => {
    setEditingId(card.id)
    setEditTitle(card.title)
    setEditDescription(card.description)
    setEditPriority(card.priority)
    setEditSessionType(card.sessionType)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditTitle('')
    setEditDescription('')
  }, [])

  const saveEdit = useCallback((cardId: string) => {
    const title = editTitle.trim()
    if (!title) return
    patchCard(cardId, {
      title,
      description: editDescription.trim(),
      priority: editPriority,
      sessionType: editSessionType,
    })
    cancelEdit()
  }, [cancelEdit, editDescription, editPriority, editSessionType, editTitle, patchCard])

  const handleCardDragStart = useCallback((cardId: string, event: DragEvent) => {
    setDraggingCardId(cardId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-fastagents-agent-card', `agent-card:${cardId}`)
    event.dataTransfer.setData('text/plain', `agent-card:${cardId}`)
  }, [])

  const handleColumnDrop = useCallback((status: AgentBoardStatus, event: DragEvent) => {
    event.preventDefault()
    const cardId = getDragCardId(event)
    const card = boardItems.find((item) => item.id === cardId)
    if (card) moveCard(card, status)
    setDraggingCardId(null)
  }, [boardItems, moveCard])

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="shrink-0 border-b border-[var(--color-border)] p-3">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            handleAdd()
          }}
        >
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder={selectedProject ? '新增 agent 任务...' : '先选择一个项目'}
            disabled={!selectedProject}
            className={INPUT}
          />
          <textarea
            value={descriptionDraft}
            onChange={(event) => setDescriptionDraft(event.target.value)}
            placeholder="补充目标、边界、验证要求..."
            rows={3}
            disabled={!selectedProject}
            className={cn(INPUT, 'resize-none')}
          />
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <select
              value={sessionTypeDraft}
              onChange={(event) => setSessionTypeDraft(event.target.value as BoardSessionType)}
              disabled={!selectedProject}
              className={cn(INPUT, 'h-9 py-0')}
            >
              {VISIBLE_SESSION_TYPE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <select
              value={priorityDraft}
              onChange={(event) => setPriorityDraft(event.target.value as AgentBoardPriority)}
              disabled={!selectedProject}
              className={cn(INPUT, 'h-9 py-0')}
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}优先级</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!selectedProject || !titleDraft.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              title="新增任务卡片"
            >
              <Plus size={15} />
            </button>
          </div>
          {selectedProject && (
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
              <GitBranch size={11} />
              <span className="min-w-0 truncate">
                {selectedWorktree ? selectedWorktree.branch : selectedProject.name}
              </span>
            </div>
          )}
        </form>

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {COLUMNS.map((column) => (
            <div
              key={column.id}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5"
            >
              <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">{column.label}</div>
              <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">{counts[column.id]}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <label className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索卡片..."
              className={cn(INPUT, 'h-9 pl-8 py-0')}
            />
          </label>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as BoardScope)}
            className={cn(INPUT, 'h-9 w-[94px] py-0')}
          >
            <option value="current">当前项目</option>
            <option value="all">全部</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="flex min-h-full gap-2">
          {COLUMNS.map((column) => {
            const Icon = column.icon
            const columnItems = visibleItems.filter((item) => item.status === column.id)
            const isDropTarget = draggingCardId !== null

            return (
              <section
                key={column.id}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => handleColumnDrop(column.id, event)}
                className={cn(
                  'flex min-h-[400px] w-[280px] shrink-0 flex-col rounded-[var(--radius-lg)] border bg-[var(--color-bg-primary)]/30',
                  COLUMN_ACCENT[column.id],
                  isDropTarget && 'bg-[var(--color-accent)]/5 ring-2 ring-inset ring-[var(--color-accent)]/20',
                )}
              >
                <div className="flex shrink-0 items-center justify-between px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-bg-surface)]/50 shadow-sm"
                      style={{ color: column.color }}
                    >
                      <Icon size={13} strokeWidth={2.5} />
                    </div>
                    <span className="text-[13px] font-bold tracking-tight text-[var(--color-text-primary)]">
                      {column.label}
                    </span>
                  </div>
                  <span className="rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-text-secondary)] shadow-inner">
                    {columnItems.length}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2.5 p-2.5">
                  {columnItems.length === 0 ? (
                    <div className="flex min-h-[120px] flex-1 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)]/60 bg-[var(--color-bg-primary)]/20 px-4 text-center">
                      <div className="text-[var(--color-text-tertiary)] opacity-30">
                        <Plus size={24} strokeWidth={1.5} />
                      </div>
                      <div className="text-[10px] font-medium text-[var(--color-text-tertiary)]">拖入任务卡片</div>
                    </div>
                  ) : (
                    columnItems.map((card) => {
                      const isEditing = editingId === card.id
                      const linkedSession = card.sessionId
                        ? sessions.find((session) => session.id === card.sessionId)
                        : null
                      const cardProject = projects.find((project) => project.id === card.projectId)
                      const cardWorktree = card.worktreeId
                        ? worktrees.find((worktree) => worktree.id === card.worktreeId)
                        : null
                      const isLaunching = launchingCardId === card.id

                      return (
                        <article
                          key={card.id}
                          draggable={!isEditing}
                          onDragStart={(event) => handleCardDragStart(card.id, event)}
                          onDragEnd={() => setDraggingCardId(null)}
                          className={cn(
                            'group/card rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3.5 shadow-sm transition-all duration-200',
                            !isEditing && 'cursor-grab active:cursor-grabbing hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-bg-secondary)]/80 hover:shadow-md hover:shadow-black/20',
                            isLaunching && 'ring-1 ring-[var(--color-accent)]/30',
                          )}
                        >
                          {isEditing ? (
                            <div className="space-y-2">
                              <input
                                value={editTitle}
                                onChange={(event) => setEditTitle(event.target.value)}
                                className={cn(INPUT, 'h-8 py-0')}
                                autoFocus
                              />
                              <textarea
                                value={editDescription}
                                onChange={(event) => setEditDescription(event.target.value)}
                                rows={3}
                                className={cn(INPUT, 'resize-none')}
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <select
                                  value={editSessionType}
                                  onChange={(event) => setEditSessionType(event.target.value as BoardSessionType)}
                                  className={cn(INPUT, 'h-8 py-0')}
                                >
                                  {VISIBLE_SESSION_TYPE_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                  ))}
                                </select>
                                <select
                                  value={editPriority}
                                  onChange={(event) => setEditPriority(event.target.value as AgentBoardPriority)}
                                  className={cn(INPUT, 'h-8 py-0')}
                                >
                                  {PRIORITY_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex gap-1.5 pt-1">
                                <button
                                  type="button"
                                  onClick={() => saveEdit(card.id)}
                                  disabled={!editTitle.trim()}
                                  className={cn(BUTTON, 'bg-[var(--color-accent)] text-white border-transparent hover:bg-[var(--color-accent)] hover:opacity-90')}
                                >
                                  保存
                                </button>
                                <button type="button" onClick={cancelEdit} className={cn(BUTTON, 'w-8 px-0')} title="取消">
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start gap-2.5">
                                <div className="min-w-0 flex-1">
                                  <div className="break-words text-[13px] font-bold leading-tight tracking-tight text-[var(--color-text-primary)] group-hover/card:text-[var(--color-accent)] transition-colors">
                                    {card.title}
                                  </div>
                                  {card.description && (
                                    <div className="mt-1.5 line-clamp-3 break-words text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                                      {card.description}
                                    </div>
                                  )}
                                </div>
                                <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold shadow-sm', PRIORITY_BADGE[card.priority])}>
                                  {PRIORITY_OPTIONS.find((option) => option.id === card.priority)?.label}
                                </span>
                              </div>

                              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--color-bg-primary)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-secondary)] border border-[var(--color-border)]/50 transition-colors group-hover/card:border-[var(--color-accent)]/20">
                                  <Bot size={11} className="text-[var(--color-accent)]" />
                                  <span className="truncate">{SESSION_TYPE_CONFIG[card.sessionType].label}</span>
                                </span>
                                {cardProject && (
                                  <span className="max-w-full truncate rounded-md bg-[var(--color-bg-primary)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-tertiary)] border border-[var(--color-border)]/40 transition-colors group-hover/card:border-[var(--color-accent)]/10">
                                    {cardProject.name}
                                  </span>
                                )}
                                {cardWorktree && (
                                  <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--color-bg-primary)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-tertiary)] border border-[var(--color-border)]/40">
                                    <GitBranch size={11} className="opacity-60" />
                                    <span className="truncate">{cardWorktree.branch}</span>
                                  </span>
                                )}
                              </div>

                              {linkedSession && (
                                <button
                                  type="button"
                                  onClick={() => activateSession(linkedSession.id)}
                                  className="mt-3 flex w-full items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-primary)]/60 p-2 text-left text-[10px] text-[var(--color-text-secondary)] transition-all hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)]/40 group-hover/card:border-[var(--color-accent)]/20"
                                >
                                  <ExternalLink size={12} className="text-[var(--color-accent)] opacity-70" />
                                  <span className="min-w-0 flex-1 truncate font-medium">{linkedSession.name}</span>
                                  <span className="opacity-60 text-[9px] uppercase font-bold">{linkedSession.status}</span>
                                </button>
                              )}

                              {card.error && (
                                <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-error)]/20 bg-[var(--color-error)]/10 px-2.5 py-2 text-[10px] font-medium leading-relaxed text-[var(--color-error)] animate-[fade-in_0.2s_ease-out]">
                                  {card.error}
                                </div>
                              )}

                              <div className="mt-3.5 flex items-center justify-between">
                                <div className="text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                  {formatRelativeTime(card.updatedAt)}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/card:opacity-100">
                                  <button type="button" onClick={() => startEdit(card)} className="flex h-6.5 w-6.5 items-center justify-center rounded-md hover:bg-[var(--color-bg-primary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors" title="编辑">
                                    <Pencil size={11} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(card.id)}
                                    className="flex h-6.5 w-6.5 items-center justify-center rounded-md hover:bg-[var(--color-error)]/10 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] transition-colors"
                                    title="删除"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>

                              <div className="mt-2.5 flex flex-wrap gap-2 pt-2 border-t border-[var(--color-border)]/40">
                                <button
                                  type="button"
                                  onClick={() => void launchCard(card)}
                                  disabled={isLaunching || (card.projectId !== selectedProjectId)}
                                  className={cn(
                                    'flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-[11px] font-bold transition-all',
                                    'bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40 shadow-sm'
                                  )}
                                  title={card.projectId !== selectedProjectId ? '切换到卡片所属项目后再启动' : '启动或重新发送任务'}
                                >
                                  {isLaunching ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                                  启动
                                </button>
                                {linkedSession && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      activateSession(linkedSession.id)
                                      const ptyId = linkedSession.ptyId
                                      if (ptyId) {
                                        void window.api.session.submit(ptyId, composePrompt(card), false)
                                      }
                                    }}
                                    className={cn(BUTTON, 'h-8 px-2.5')}
                                    title="把任务内容写入已关联会话，不自动回车"
                                  >
                                    <SendHorizontal size={13} />
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </article>
                      )
                    })
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
