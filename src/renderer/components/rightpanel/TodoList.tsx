import { Check, CheckCheck, ListTodo, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { cn, generateId } from '@/lib/utils'
import { type TodoItem, type TodoPriority, useUIStore } from '@/stores/ui'

type TodoFilter = 'all' | 'active' | 'completed'
type TodoSort = 'priority' | 'recent' | 'oldest'

const INPUT =
  'h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-colors'
const TOOL_BUTTON =
  'flex h-7 items-center justify-center gap-1 rounded-[var(--radius-sm)] px-2 text-[10px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40'

const PRIORITY_OPTIONS: Array<{ id: TodoPriority; label: string }> = [
  { id: 'high', label: '高优先级' },
  { id: 'medium', label: '普通' },
  { id: 'low', label: '低优先级' },
]

const FILTER_OPTIONS: Array<{ id: TodoFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '待办' },
  { id: 'completed', label: '已完成' },
]

const PRIORITY_BADGE_STYLES: Record<TodoPriority, string> = {
  high: 'bg-[var(--color-error)]/15 text-[var(--color-error)]',
  medium: 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]',
  low: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]',
}

function getPriorityRank(priority: TodoPriority): number {
  if (priority === 'high') return 0
  if (priority === 'medium') return 1
  return 2
}

function sortItems(items: TodoItem[], sort: TodoSort): TodoItem[] {
  return [...items].sort((a, b) => {
    if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed)

    if (sort === 'priority') {
      const priorityGap = getPriorityRank(a.priority) - getPriorityRank(b.priority)
      if (priorityGap !== 0) return priorityGap
      return b.updatedAt - a.updatedAt
    }

    if (sort === 'oldest') return a.createdAt - b.createdAt
    return b.updatedAt - a.updatedAt
  })
}

function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  return `${Math.floor(diff / day)} 天前`
}

function getEmptyMessage(filter: TodoFilter, query: string, totalCount: number): string {
  if (query.trim()) return '没有匹配的待办事项'
  if (totalCount === 0) return '还没有待办事项'
  if (filter === 'completed') return '还没有已完成事项'
  if (filter === 'active') return '当前没有未完成事项'
  return '这个筛选下没有内容'
}

export function TodoList(): JSX.Element {
  const todoItems = useUIStore((s) => s.settings.todoItems)
  const updateSettings = useUIStore((s) => s.updateSettings)

  const [draft, setDraft] = useState('')
  const [priority, setPriority] = useState<TodoPriority>('medium')
  const [filter, setFilter] = useState<TodoFilter>('all')
  const [sort, setSort] = useState<TodoSort>('priority')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const activeCount = useMemo(() => todoItems.filter((item) => !item.completed).length, [todoItems])
  const completedCount = todoItems.length - activeCount

  const counts: Record<TodoFilter, number> = {
    all: todoItems.length,
    active: activeCount,
    completed: completedCount,
  }

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = todoItems.filter((item) => {
      if (filter === 'active' && item.completed) return false
      if (filter === 'completed' && !item.completed) return false
      if (!normalizedQuery) return true
      return item.text.toLowerCase().includes(normalizedQuery)
    })
    return sortItems(filtered, sort)
  }, [filter, query, sort, todoItems])

  const saveItems = useCallback((nextItems: TodoItem[]) => {
    updateSettings({ todoItems: nextItems })
  }, [updateSettings])

  const handleAdd = useCallback(() => {
    const text = draft.trim()
    if (!text) return

    const now = Date.now()
    saveItems([
      {
        id: `todo-${generateId()}`,
        text,
        completed: false,
        createdAt: now,
        updatedAt: now,
        priority,
      },
      ...todoItems,
    ])
    setDraft('')
    setPriority('medium')
    setFilter('all')
  }, [draft, priority, saveItems, todoItems])

  const handleToggle = useCallback((id: string) => {
    const now = Date.now()
    saveItems(todoItems.map((item) => (
      item.id === id ? { ...item, completed: !item.completed, updatedAt: now } : item
    )))
  }, [saveItems, todoItems])

  const handleDelete = useCallback((id: string) => {
    saveItems(todoItems.filter((item) => item.id !== id))
    if (editingId === id) {
      setEditingId(null)
      setEditingText('')
    }
  }, [editingId, saveItems, todoItems])

  const handleClearCompleted = useCallback(() => {
    saveItems(todoItems.filter((item) => !item.completed))
  }, [saveItems, todoItems])

  const handleToggleAll = useCallback(() => {
    if (todoItems.length === 0) return
    const now = Date.now()
    const shouldCompleteAll = activeCount > 0
    saveItems(todoItems.map((item) => ({
      ...item,
      completed: shouldCompleteAll,
      updatedAt: now,
    })))
  }, [activeCount, saveItems, todoItems])

  const handleStartEdit = useCallback((item: TodoItem) => {
    setEditingId(item.id)
    setEditingText(item.text)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditingText('')
  }, [])

  const handleSaveEdit = useCallback((id: string) => {
    const text = editingText.trim()
    if (!text) return
    const now = Date.now()
    saveItems(todoItems.map((item) => (
      item.id === id ? { ...item, text, updatedAt: now } : item
    )))
    setEditingId(null)
    setEditingText('')
  }, [editingText, saveItems, todoItems])

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="shrink-0 space-y-3 border-b border-[var(--color-border)] px-3 py-3">
        {/* 输入行：优先级小圆点 + 输入框 + 添加按钮 */}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            handleAdd()
          }}
        >
          <div className="flex shrink-0 items-center gap-1">
            {PRIORITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPriority(option.id)}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border transition-all',
                  priority === option.id
                    ? option.id === 'high'
                      ? 'border-[var(--color-error)] bg-[var(--color-error)]/20'
                      : option.id === 'medium'
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
                        : 'border-[var(--color-border-hover)] bg-[var(--color-bg-tertiary)]'
                    : 'border-[var(--color-border)] bg-transparent hover:border-[var(--color-border-hover)]',
                )}
                title={option.label}
              >
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  priority === option.id
                    ? option.id === 'high'
                      ? 'bg-[var(--color-error)]'
                      : option.id === 'medium'
                        ? 'bg-[var(--color-accent)]'
                        : 'bg-[var(--color-text-tertiary)]'
                    : 'bg-[var(--color-text-tertiary)]/50',
                )} />
              </button>
            ))}
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="添加待办事项..."
            className={cn(INPUT, 'h-8 flex-1')}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            title="添加待办"
          >
            <Plus size={14} />
          </button>
        </form>

        {/* 筛选标签栏 */}
        <div className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-bg-primary)] p-0.5">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-1.5 text-[11px] font-medium transition-all',
                filter === option.id
                  ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <span>{option.label}</span>
              <span className={cn(
                'text-[10px] tabular-nums',
                filter === option.id ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]',
              )}>
                {counts[option.id]}
              </span>
            </button>
          ))}
        </div>

        {/* 搜索 + 排序 */}
        <div className="flex gap-1.5">
          <label className="relative flex-1">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索..."
              className={cn(INPUT, 'h-8 pl-7 text-[10px]')}
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as TodoSort)}
            className={cn(INPUT, 'h-8 w-auto appearance-none px-2 pr-5 text-[10px]')}
          >
            <option value="priority">优先级</option>
            <option value="recent">最近更新</option>
            <option value="oldest">最早创建</option>
          </select>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-3 border-t border-[var(--color-border)] pt-2">
          <button
            type="button"
            onClick={handleToggleAll}
            disabled={todoItems.length === 0}
            className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {activeCount > 0 ? <CheckCheck size={11} /> : <RotateCcw size={11} />}
            {activeCount > 0 ? '全部完成' : '全部恢复'}
          </button>
          <span className="text-[var(--color-border)]">·</span>
          <button
            type="button"
            onClick={handleClearCompleted}
            disabled={completedCount === 0}
            className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-error)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={11} />
            清空已完成
          </button>
          <span className="ml-auto text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
            {activeCount} 待办 / {completedCount} 已完成
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {visibleItems.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)]/50 px-4 text-center">
            <ListTodo size={18} className="mb-1.5 text-[var(--color-text-tertiary)]" />
            <div className="text-[11px] text-[var(--color-text-secondary)]">
              {getEmptyMessage(filter, query, todoItems.length)}
            </div>
            {(filter !== 'all' || query.trim()) && (
              <button
                type="button"
                onClick={() => {
                  setFilter('all')
                  setQuery('')
                }}
                className="mt-2 text-[10px] text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hover)]"
              >
                查看全部
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {visibleItems.map((item) => {
              const isEditing = editingId === item.id
              return (
                <div
                  key={item.id}
                  className={cn(
                    'group rounded-[var(--radius-sm)] bg-[var(--color-bg-primary)] px-2.5 py-2 transition-colors',
                    item.completed
                      ? 'opacity-60'
                      : 'hover:bg-[var(--color-bg-tertiary)]/50',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(item.id)}
                      className={cn(
                        'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors',
                        item.completed
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                          : 'border-[var(--color-border)] text-transparent hover:border-[var(--color-accent)]',
                      )}
                      title={item.completed ? '标记为未完成' : '标记为已完成'}
                    >
                      <Check size={10} />
                    </button>

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <input
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleSaveEdit(item.id)
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              handleCancelEdit()
                            }
                          }}
                          className={cn(INPUT, 'h-7 text-[11px]')}
                          autoFocus
                        />
                      ) : (
                        <div
                          className={cn(
                            'break-words text-[var(--ui-font-xs)] leading-5',
                            item.completed
                              ? 'text-[var(--color-text-tertiary)] line-through'
                              : 'text-[var(--color-text-primary)]',
                          )}
                        >
                          {item.text}
                        </div>
                      )}

                      <div className="mt-1 flex items-center gap-1.5 text-[9px]">
                        <span className={cn('rounded px-1 py-px font-medium', PRIORITY_BADGE_STYLES[item.priority])}>
                          {PRIORITY_OPTIONS.find((option) => option.id === item.priority)?.label}
                        </span>
                        <span className="text-[var(--color-text-tertiary)]">
                          {formatRelativeTime(item.updatedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(item.id)}
                            disabled={!editingText.trim()}
                            className={TOOL_BUTTON}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className={TOOL_BUTTON}
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStartEdit(item)}
                            className={cn(TOOL_BUTTON, 'px-1.5')}
                            title="编辑"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            className={cn(TOOL_BUTTON, 'px-1.5 hover:text-[var(--color-error)]')}
                            title="删除"
                          >
                            <Trash2 size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
