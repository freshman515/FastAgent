import { ArrowUpDown, Check, CheckCheck, ListTodo, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { cn, generateId } from '@/lib/utils'
import { type TodoItem, type TodoPriority, useUIStore } from '@/stores/ui'

type TodoFilter = 'all' | 'active' | 'completed'
type TodoSort = 'priority' | 'recent' | 'oldest'

const INPUT =
  'h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-colors focus:border-[var(--color-accent)]'
const TOOL_BUTTON =
  'flex h-8 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

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
      <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-3">
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            handleAdd()
          }}
        >
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="添加待办事项..."
              className={INPUT}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              title="添加待办"
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRIORITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPriority(option.id)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                  priority === option.id
                    ? PRIORITY_BADGE_STYLES[option.id]
                    : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </form>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={cn(
                'rounded-[var(--radius-md)] border px-2.5 py-2 text-left transition-colors',
                filter === option.id
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-border-hover)]',
              )}
            >
              <div className="text-[10px] text-[var(--color-text-tertiary)]">{option.label}</div>
              <div className="mt-1 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
                {counts[option.id]}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <label className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索待办..."
              className={cn(INPUT, 'pl-8')}
            />
          </label>

          <label className="relative w-[108px]">
            <ArrowUpDown size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as TodoSort)}
              className={cn(INPUT, 'appearance-none pl-8 pr-2')}
            >
              <option value="priority">优先级</option>
              <option value="recent">最近更新</option>
              <option value="oldest">最早创建</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleToggleAll}
            disabled={todoItems.length === 0}
            className={TOOL_BUTTON}
          >
            {activeCount > 0 ? <CheckCheck size={13} /> : <RotateCcw size={13} />}
            {activeCount > 0 ? '全部完成' : '全部恢复'}
          </button>
          <button
            type="button"
            onClick={handleClearCompleted}
            disabled={completedCount === 0}
            className={TOOL_BUTTON}
          >
            <Trash2 size={13} />
            清空已完成
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {visibleItems.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 text-center">
            <ListTodo size={20} className="mb-2 text-[var(--color-text-tertiary)]" />
            <div className="text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
              {getEmptyMessage(filter, query, todoItems.length)}
            </div>
            <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
              用优先级、搜索和筛选把临时事项管起来，不用只做一份纯文本列表。
            </div>
            {(filter !== 'all' || query.trim()) && (
              <button
                type="button"
                onClick={() => {
                  setFilter('all')
                  setQuery('')
                }}
                className="mt-3 rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-[10px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                查看全部
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleItems.map((item) => {
              const isEditing = editingId === item.id
              return (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-[var(--radius-md)] border bg-[var(--color-bg-primary)] p-2.5 transition-colors',
                    item.completed
                      ? 'border-[var(--color-border)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/35',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(item.id)}
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                        item.completed
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                          : 'border-[var(--color-border)] text-transparent hover:border-[var(--color-accent)]',
                      )}
                      title={item.completed ? '标记为未完成' : '标记为已完成'}
                    >
                      <Check size={12} />
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
                          className={cn(INPUT, 'h-8')}
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

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className={cn('rounded-full px-2 py-0.5 font-medium', PRIORITY_BADGE_STYLES[item.priority])}>
                          {PRIORITY_OPTIONS.find((option) => option.id === item.priority)?.label}
                        </span>
                        <span className="text-[var(--color-text-tertiary)]">
                          更新于 {formatRelativeTime(item.updatedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
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
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStartEdit(item)}
                            className={cn(TOOL_BUTTON, 'w-8 px-0')}
                            title="编辑"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            className={cn(TOOL_BUTTON, 'w-8 px-0 hover:text-[var(--color-error)]')}
                            title="删除"
                          >
                            <Trash2 size={13} />
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
