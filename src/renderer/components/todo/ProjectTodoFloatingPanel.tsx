import { Check, GitBranch, Loader2, ListTodo, MessageSquare, Network, Play, Plus, Star, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SESSION_TYPE_CONFIG, type AgentSessionType, type Session, type SessionType } from '@shared/types'
import { useProjectTodos } from '@/hooks/useProjectTodos'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { filterSessionTypesForCurrentPlatform } from '@/lib/platformSessionTypes'
import {
  buildTodoPrompt,
  createTodoItem,
  getDefaultTodoAgentType,
  startTodoInNewSession,
  startTodoInSession,
  startTodoWorkflow,
} from '@/lib/todos'
import { cn } from '@/lib/utils'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { type TodoItem, useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'

const EMPTY_ROW_COUNT = 8
const PANEL_MARGIN = 20
const PANEL_WIDTH = 540
const PANEL_HEIGHT = 680

const SESSION_TYPE_OPTIONS: Array<{ id: AgentSessionType; label: string }> = [
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
]
const VISIBLE_SESSION_TYPE_OPTIONS = filterSessionTypesForCurrentPlatform(SESSION_TYPE_OPTIONS)

type LaunchMode = 'new-session' | 'current-session' | 'workflow'

interface PanelPosition {
  x: number
  y: number
}

function sortTodoItems(items: TodoItem[]): TodoItem[] {
  const statusRank: Record<string, number> = { active: 0, todo: 1, blocked: 2, done: 3 }
  return [...items].sort((a, b) => {
    const aStatus = a.completed ? 'done' : a.status
    const bStatus = b.completed ? 'done' : b.status
    const statusGap = (statusRank[aStatus] ?? 1) - (statusRank[bStatus] ?? 1)
    if (statusGap !== 0) return statusGap
    if (a.priority !== b.priority) return a.priority === 'high' ? -1 : b.priority === 'high' ? 1 : 0
    return b.updatedAt - a.updatedAt
  })
}

function statusLabel(item: TodoItem): string {
  if (item.completed || item.status === 'done') return '已完成'
  if (item.status === 'active') return '进行中'
  if (item.status === 'blocked') return '阻塞'
  return '待办'
}

function statusClass(item: TodoItem): string {
  if (item.completed || item.status === 'done') return 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
  if (item.status === 'active') return 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
  if (item.status === 'blocked') return 'bg-[var(--color-error)]/15 text-[var(--color-error)]'
  return 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]'
}

function getVisibleDefaultAgentType(defaultSessionType: SessionType): AgentSessionType {
  const preferred = getDefaultTodoAgentType(defaultSessionType)
  return VISIBLE_SESSION_TYPE_OPTIONS.find((option) => option.id === preferred)?.id
    ?? VISIBLE_SESSION_TYPE_OPTIONS[0]?.id
    ?? 'claude-code'
}

function getVisibleTodoLaunchAgentType(todo: TodoItem, defaultSessionType: SessionType): AgentSessionType {
  const saved = todo.todoLaunchSessionType
  return VISIBLE_SESSION_TYPE_OPTIONS.find((option) => option.id === saved)?.id
    ?? getVisibleDefaultAgentType(defaultSessionType)
}

export function ProjectTodoFloatingPanel(): JSX.Element | null {
  const open = useUIStore((s) => s.todoPopoverOpen)
  const setOpen = useUIStore((s) => s.setTodoPopoverOpen)
  const todoLaunchRequest = useUIStore((s) => s.todoLaunchRequest)
  const defaultSessionType = useUIStore((s) => s.settings.defaultSessionType)
  const addToast = useUIStore((s) => s.addToast)
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const { projectId, projectName, todoItems, saveTodoItems } = useProjectTodos()
  const sessions = useSessionsStore((s) => s.sessions)
  const activeSessionId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const activeSession = useSessionsStore((s) =>
    activeSessionId && !activeSessionId.startsWith('editor-')
      ? s.sessions.find((session) => session.id === activeSessionId)
      : undefined,
  )

  const [draft, setDraft] = useState('')
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const [launchTodoId, setLaunchTodoId] = useState<string | null>(null)
  const [launchPrompt, setLaunchPrompt] = useState('')
  const [launchMode, setLaunchMode] = useState<LaunchMode>('new-session')
  const [launchSessionType, setLaunchSessionType] = useState<AgentSessionType>(() =>
    getVisibleDefaultAgentType(useUIStore.getState().settings.defaultSessionType),
  )
  const [launching, setLaunching] = useState(false)

  const overlayRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const sortedItems = useMemo(() => sortTodoItems(todoItems), [todoItems])
  const launchTodo = useMemo(
    () => todoItems.find((item) => item.id === launchTodoId) ?? null,
    [launchTodoId, todoItems],
  )
  const activeCount = useMemo(() => todoItems.filter((item) => !item.completed).length, [todoItems])
  const emptyRows = Math.max(EMPTY_ROW_COUNT - sortedItems.length, 0)
  const canUseCurrentSession = Boolean(activeSession && projectId && activeSession.projectId === projectId)

  const clampPosition = useCallback((next: PanelPosition): PanelPosition => {
    const overlay = overlayRef.current
    const panel = panelRef.current
    if (!overlay || !panel) return next

    const maxX = Math.max(PANEL_MARGIN, overlay.clientWidth - panel.offsetWidth - PANEL_MARGIN)
    const maxY = Math.max(PANEL_MARGIN, overlay.clientHeight - panel.offsetHeight - PANEL_MARGIN)
    return {
      x: Math.max(PANEL_MARGIN, Math.min(next.x, maxX)),
      y: Math.max(PANEL_MARGIN, Math.min(next.y, maxY)),
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      const overlay = overlayRef.current
      const panel = panelRef.current
      if (overlay && panel) {
        setPosition(clampPosition({
          x: overlay.clientWidth - panel.offsetWidth - PANEL_MARGIN,
          y: PANEL_MARGIN,
        }))
      }
      inputRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [clampPosition, open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (launchTodoId) {
        setLaunchTodoId(null)
        return
      }
      setOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [launchTodoId, open, setOpen])

  useEffect(() => {
    if (!open) return

    const handleResize = (): void => {
      setPosition((current) => current ? clampPosition(current) : current)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampPosition, open])

  useEffect(() => {
    const defaultAgentType = getVisibleDefaultAgentType(defaultSessionType)
    setLaunchSessionType((current) =>
      VISIBLE_SESSION_TYPE_OPTIONS.some((option) => option.id === current) ? current : defaultAgentType,
    )
  }, [defaultSessionType])

  const saveItems = useCallback((items: TodoItem[]) => {
    saveTodoItems(items)
  }, [saveTodoItems])

  const handleHeaderPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('button')) return

    event.preventDefault()
    const panel = panelRef.current
    const origin = position ?? {
      x: panel?.offsetLeft ?? PANEL_MARGIN,
      y: panel?.offsetTop ?? PANEL_MARGIN,
    }
    const startX = event.clientX
    const startY = event.clientY
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      setPosition(clampPosition({
        x: origin.x + moveEvent.clientX - startX,
        y: origin.y + moveEvent.clientY - startY,
      }))
    }

    const handlePointerUp = (): void => {
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [clampPosition, position])

  const handleAdd = useCallback(() => {
    const text = draft.trim()
    if (!text || !projectId) return

    saveItems([
      createTodoItem(text),
      ...todoItems,
    ])
    setDraft('')
  }, [draft, projectId, saveItems, todoItems])

  const handleToggle = useCallback((id: string) => {
    const now = Date.now()
    saveItems(todoItems.map((item) => {
      if (item.id !== id) return item
      const completed = !item.completed
      return {
        ...item,
        completed,
        status: completed ? 'done' : 'todo',
        updatedAt: now,
        runs: completed
          ? item.runs?.map((run) => run.completedAt ? run : { ...run, completedAt: now })
          : item.runs,
      }
    }))
  }, [saveItems, todoItems])

  const handleToggleImportant = useCallback((id: string) => {
    const now = Date.now()
    saveItems(todoItems.map((item) => (
      item.id === id
        ? { ...item, priority: item.priority === 'high' ? 'medium' : 'high', updatedAt: now }
        : item
    )))
  }, [saveItems, todoItems])

  const handleDelete = useCallback((id: string) => {
    saveItems(todoItems.filter((item) => item.id !== id))
    if (launchTodoId === id) setLaunchTodoId(null)
  }, [launchTodoId, saveItems, todoItems])

  const openLaunchPanel = useCallback((item: TodoItem) => {
    setLaunchTodoId(item.id)
    setLaunchPrompt(buildTodoPrompt(item))
    setLaunchMode('new-session')
    setLaunchSessionType(getVisibleTodoLaunchAgentType(item, defaultSessionType))
  }, [defaultSessionType])

  const handleSaveLaunch = useCallback(() => {
    if (!projectId || !launchTodo) return
    const prompt = launchPrompt.trim()
    if (!prompt) return

    const now = Date.now()
    saveItems(todoItems.map((item) => (
      item.id === launchTodo.id
        ? {
            ...item,
            promptDraft: prompt,
            todoLaunchSessionType: launchSessionType,
            updatedAt: now,
          }
        : item
    )))
    addToast({ type: 'success', title: '已保存任务准备', body: launchTodo.text })
    setLaunchTodoId(null)
  }, [addToast, launchPrompt, launchSessionType, launchTodo, projectId, saveItems, todoItems])

  useEffect(() => {
    if (!todoLaunchRequest || !projectId || todoLaunchRequest.projectId !== projectId) return
    const item = todoItems.find((candidate) => candidate.id === todoLaunchRequest.todoId)
    if (!item) return
    setOpen(true)
    openLaunchPanel(item)
  }, [openLaunchPanel, projectId, setOpen, todoItems, todoLaunchRequest])

  const handleLaunch = useCallback(async () => {
    if (!projectId || !launchTodo || launching) return
    const prompt = launchPrompt.trim()
    if (!prompt) return

    setLaunching(true)
    setLaunchTodoId(null)
    setOpen(false)
    try {
      if (launchMode === 'current-session') {
        if (!activeSession || activeSession.projectId !== projectId) throw new Error('当前没有同项目会话')
        await startTodoInSession({
          projectId,
          todoId: launchTodo.id,
          sessionId: activeSession.id,
          prompt,
        })
        addToast({ type: 'success', title: '已填入当前会话', body: '确认无误后手动回车发送。' })
      } else if (launchMode === 'workflow') {
        startTodoWorkflow({ projectId, todoId: launchTodo.id, prompt })
        addToast({ type: 'success', title: '已创建工作流', body: launchTodo.text })
      } else {
        const session = await startTodoInNewSession({
          projectId,
          todoId: launchTodo.id,
          title: launchTodo.text,
          prompt,
          type: launchSessionType,
          worktreeId: selectedWorktreeId ?? undefined,
        })
        addToast({ type: 'success', title: '已创建会话并填入提示词', body: session.name })
      }
    } catch (err) {
      addToast({
        type: 'error',
        title: '启动 Todo 失败',
        body: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLaunching(false)
    }
  }, [
    activeSession,
    addToast,
    launchMode,
    launchPrompt,
    launchSessionType,
    launchTodo,
    launching,
    projectId,
    selectedWorktreeId,
    setOpen,
  ])

  if (!open) return null

  const launchPanel = launchTodo ? (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3">
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-sm shadow-black/20">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <Play size={13} className="shrink-0 text-[var(--color-accent)]" />
          <div className="min-w-0 flex-1 truncate text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">
            启动任务
          </div>
          <button
            type="button"
            disabled={launching}
            onClick={() => setLaunchTodoId(null)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 p-3">
          <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-1">
            {[
              { id: 'new-session' as const, label: '新会话', icon: Play, disabled: false },
              { id: 'current-session' as const, label: '当前会话', icon: MessageSquare, disabled: !canUseCurrentSession },
              { id: 'workflow' as const, label: '工作流', icon: Network, disabled: false },
            ].map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={option.disabled || launching}
                  onClick={() => setLaunchMode(option.id)}
                  className={cn(
                    'flex h-8 items-center justify-center gap-1 rounded-[var(--radius-sm)] text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                    launchMode === option.id
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  <Icon size={12} />
                  {option.label}
                </button>
              )
            })}
          </div>

          {launchMode === 'new-session' && (
            <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2">
              <GitBranch size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
              <select
                value={launchSessionType}
                disabled={launching}
                onChange={(event) => setLaunchSessionType(event.target.value as AgentSessionType)}
                className="todo-launch-session-select h-8 min-w-0 flex-1 bg-transparent text-[10px] text-[var(--color-text-secondary)] outline-none disabled:opacity-50"
              >
                {VISIBLE_SESSION_TYPE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          )}

          {launchMode === 'current-session' && (
            <div className="truncate rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-[10px] text-[var(--color-text-secondary)]">
              {canUseCurrentSession && activeSession ? activeSession.name : '当前没有同项目会话'}
            </div>
          )}

          <textarea
            value={launchPrompt}
            disabled={launching}
            onChange={(event) => setLaunchPrompt(event.target.value)}
            rows={5}
            className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[var(--ui-font-xs)] leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-60"
            placeholder="提示词"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={launching}
              onClick={() => setLaunchTodoId(null)}
              className="h-8 rounded-[var(--radius-sm)] px-3 text-[10px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="button"
              disabled={launching || !launchPrompt.trim()}
              onClick={handleSaveLaunch}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              保存
            </button>
            <button
              type="button"
              disabled={launching || !launchPrompt.trim() || (launchMode === 'current-session' && !canUseCurrentSession)}
              onClick={handleLaunch}
              className="flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-[10px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {launching ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              启动
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div
      ref={overlayRef}
      className="no-drag absolute inset-0 z-[80] bg-black/20 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <section
        ref={panelRef}
        className="absolute flex max-h-[calc(100%-40px)] max-w-[calc(100%-40px)] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-2xl shadow-black/45"
        style={{
          left: position?.x ?? PANEL_MARGIN,
          top: position?.y ?? PANEL_MARGIN,
          width: PANEL_WIDTH,
          height: PANEL_HEIGHT,
        }}
      >
        <header
          className="flex h-[60px] shrink-0 cursor-default items-center gap-3 border-b border-[var(--color-border)] px-5"
          title="拖动 Todo 面板"
          onPointerDown={handleHeaderPointerDown}
        >
          <ListTodo size={18} className="shrink-0 text-[var(--color-accent)]" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold tracking-normal text-[var(--color-accent)]">
              {projectName}
            </h2>
            <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
              {projectId ? `${activeCount} 个待办 / ${todoItems.length - activeCount} 个已完成` : '请选择项目后添加 Todo'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
            title="关闭"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            {sortedItems.length === 0 && (
              <div className="flex h-[52px] items-center gap-3 border-b border-[var(--color-border)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
                <span className="h-[18px] w-[18px] rounded-full border border-[var(--color-border)]" />
                {projectId ? '还没有待办事项' : '未选择项目'}
              </div>
            )}

            {sortedItems.map((item) => {
              const linkedSessions = (item.linkedSessionIds ?? [])
                .map((sessionId) => sessions.find((session) => session.id === sessionId))
                .filter((session): session is Session => Boolean(session))
              const primaryLinkedSession = linkedSessions[0]

              return (
                <div key={item.id}>
                  <div
                    className={cn(
                      'group flex min-h-[54px] items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 transition-colors hover:bg-[var(--color-bg-tertiary)]/60',
                      launchTodoId === item.id && 'bg-[var(--color-bg-tertiary)]/35',
                      item.completed && 'opacity-65',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggle(item.id)}
                      className={cn(
                        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
                        item.completed
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                          : 'border-[var(--color-text-secondary)] text-transparent hover:border-[var(--color-accent)]',
                      )}
                      title={item.completed ? '标记为未完成' : '标记为已完成'}
                    >
                      <Check size={11} />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className={cn(
                        'truncate text-[var(--ui-font-sm)] leading-5 text-[var(--color-text-primary)]',
                        item.completed && 'text-[var(--color-text-tertiary)] line-through',
                      )}>
                        {item.text}
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        <span className={cn('shrink-0 rounded px-1.5 py-px text-[9px] font-medium', statusClass(item))}>
                          {statusLabel(item)}
                        </span>
                        {item.promptDraft && (
                          <span className="truncate text-[9px] text-[var(--color-text-tertiary)]">已存提示词</span>
                        )}
                        {item.linkedWorkflowTaskId && (
                          <span className="flex shrink-0 items-center gap-1 text-[9px] text-[var(--color-text-tertiary)]">
                            <Network size={10} />
                            工作流
                          </span>
                        )}
                      </div>
                    </div>

                    {primaryLinkedSession && (
                      <button
                        type="button"
                        onClick={() => focusSessionTarget(primaryLinkedSession.id)}
                        className="flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-accent)]"
                        title={`打开关联会话：${primaryLinkedSession.name}`}
                      >
                        <MessageSquare size={14} />
                        {linkedSessions.length > 1 && (
                          <span className="text-[9px] font-semibold tabular-nums">{linkedSessions.length}</span>
                        )}
                      </button>
                    )}

                    {!item.completed && (
                      <button
                        type="button"
                        onClick={() => openLaunchPanel(item)}
                        className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-accent)]"
                        title="启动任务"
                      >
                        <Play size={12} />
                        {item.status === 'active' ? '继续' : '开始'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleToggleImportant(item.id)}
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors',
                        item.priority === 'high'
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-text-secondary)]',
                      )}
                      title={item.priority === 'high' ? '取消重要' : '标记为重要'}
                    >
                      <Star size={15} fill={item.priority === 'high' ? 'currentColor' : 'none'} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] opacity-0 transition-colors hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-error)] group-hover:opacity-100"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {launchTodoId === item.id && launchPanel}
                </div>
              )
            })}

            {Array.from({ length: emptyRows }).map((_, index) => (
              <div
                key={`empty-${index}`}
                className="h-[52px] border-b border-[var(--color-border)] last:border-b-0"
              />
            ))}
          </div>
        </div>

        <form
          className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-5 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            handleAdd()
          }}
        >
          <div className="flex h-11 items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3">
            <Plus size={17} className="shrink-0 text-[var(--color-accent)]" />
            <input
              ref={inputRef}
              value={draft}
              disabled={!projectId}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={projectId ? '添加任务，回车保存' : '请选择项目后添加 Todo'}
              className="h-full min-w-0 flex-1 bg-transparent text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed"
            />
          </div>
        </form>

      </section>
    </div>
  )
}
