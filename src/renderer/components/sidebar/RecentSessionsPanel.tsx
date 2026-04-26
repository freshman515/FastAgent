import { ChevronRight, FolderPlus, Plus, Search, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useSessionGroupsStore } from '@/stores/sessionGroups'
import { DockActions } from '@/components/layout/DockActions'
import { SessionGroupItem } from './SessionGroupItem'
import {
  DRAG_MIME_SESSION_ID,
  DRAG_MIME_SESSION_SOURCE_GROUP,
  RecentSessionItem,
  UNGROUPED_MARKER,
} from './RecentSessionItem'
import { bucketRecentSessions, type TimeBucketKey } from './recentTimeBuckets'

export function RecentSessionsPanel(): JSX.Element {
  const addGroup = useSessionGroupsStore((s) => s.addGroup)
  const groups = useSessionGroupsStore((s) => s.groups)
  const removeSessionFromAllGroups = useSessionGroupsStore((s) => s.removeSessionFromAllGroups)
  const sessions = useSessionsStore((s) => s.sessions)

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [recentDragOver, setRecentDragOver] = useState(false)
  const [collapsedBuckets, setCollapsedBuckets] = useState<Partial<Record<TimeBucketKey, boolean>>>({})
  const committedRef = useRef(false)

  const toggleBucket = useCallback((key: TimeBucketKey) => {
    setCollapsedBuckets((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const groupedSessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of groups) {
      for (const sid of g.sessionIds) ids.add(sid)
    }
    return ids
  }, [groups])

  const recentSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const ungrouped = sessions.filter((s) => !groupedSessionIds.has(s.id))
    const sorted = [...ungrouped].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted
    return sorted.filter((s) => s.name.toLowerCase().includes(q))
  }, [sessions, groupedSessionIds, searchQuery])

  const timeBuckets = useMemo(() => bucketRecentSessions(recentSessions), [recentSessions])
  const searchActive = searchQuery.trim().length > 0
  const showTopHeader = groups.length > 0

  const handleCommit = useCallback(() => {
    if (committedRef.current) return
    const name = newName.trim()
    if (name) {
      committedRef.current = true
      addGroup(name)
    }
    setNewName('')
    setAdding(false)
  }, [newName, addGroup])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCommit()
      if (e.key === 'Escape') {
        committedRef.current = true
        setAdding(false)
        setNewName('')
      }
    },
    [handleCommit],
  )

  const handleStartAdding = useCallback(() => {
    committedRef.current = false
    setNewName('')
    setAdding(true)
  }, [])

  const handleRecentDrop = useCallback((e: React.DragEvent) => {
    setRecentDragOver(false)
    const sessionId = e.dataTransfer.getData(DRAG_MIME_SESSION_ID)
    const source = e.dataTransfer.getData(DRAG_MIME_SESSION_SOURCE_GROUP)
    if (!sessionId) return
    if (source && source !== UNGROUPED_MARKER) {
      removeSessionFromAllGroups(sessionId)
    }
  }, [removeSessionFromAllGroups])

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)]/50 px-2.5 py-1.5">
        <span className="pl-1 text-[11px] font-bold tracking-wider text-[var(--color-text-tertiary)] uppercase">Recent Sessions</span>
        <button
          onClick={handleStartAdding}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
            'transition-all duration-150',
          )}
          title="新建分组"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* New group input */}
      {adding && (
        <div className="border-b border-[var(--color-border)]/60 bg-[var(--color-bg-primary)]/30 px-3 py-2.5 animate-[fade-in_0.2s_ease-out]">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
              <FolderPlus size={12} />
            </div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleCommit}
              placeholder="分组名称..."
              className={cn(
                'h-7 w-full rounded-[var(--radius-sm)] bg-[var(--color-bg-surface)]/50 px-2.5 text-[var(--ui-font-sm)]',
                'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
                'border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none transition-all',
              )}
            />
          </div>
        </div>
      )}

      {/* Search */}
      <div className="shrink-0 px-3 py-3">
        <div className="group/search relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-[var(--color-text-tertiary)] transition-colors group-focus-within/search:text-[var(--color-accent)]">
            <Search size={14} strokeWidth={2.5} />
          </div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话…"
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-none pb-4">
        {/* Groups */}
        {groups.map((group) => (
          <SessionGroupItem key={group.id} group={group} searchQuery={searchQuery} />
        ))}

        {/* Ungrouped / Recent section */}
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_MIME_SESSION_ID)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setRecentDragOver(true)
            }
          }}
          onDragLeave={() => setRecentDragOver(false)}
          onDrop={handleRecentDrop}
          className={cn(
            'mx-1 mt-2 rounded-[var(--radius-md)] transition-all duration-200',
            recentDragOver && 'bg-[var(--color-accent-muted)] ring-1 ring-inset ring-[var(--color-accent)]/30',
          )}
        >
          {showTopHeader && (
            <div className="px-3.5 pt-3 pb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)]/70">
              <span>最近 · 未分组</span>
              {recentSessions.length > 0 && (
                <span className="tabular-nums rounded-full bg-[var(--color-bg-surface)]/60 px-2 py-0.5 text-[9px] font-bold text-[var(--color-text-tertiary)] shadow-inner">
                  {recentSessions.length}
                </span>
              )}
            </div>
          )}
          {timeBuckets.map((bucket) => {
            const collapsed = !searchActive && !!collapsedBuckets[bucket.key]
            return (
              <div key={bucket.key} className="pb-1">
                <button
                  type="button"
                  onClick={() => toggleBucket(bucket.key)}
                  className={cn(
                    'group/bucket flex w-full items-center gap-2 text-left',
                    'text-[var(--ui-font-sm)] font-medium tracking-tight text-[var(--color-text-secondary)]',
                    'transition-all duration-200 hover:bg-[var(--color-bg-surface)]/40 rounded-[var(--radius-sm)] mx-1 w-[calc(100%-8px)]',
                    'px-2 py-1.5',
                  )}
                >
                  <ChevronRight
                    size={12}
                    strokeWidth={2.5}
                    className={cn(
                      'shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-200',
                      !collapsed && 'rotate-90',
                    )}
                  />
                  <span className="flex-1 group-hover/bucket:text-[var(--color-text-primary)]">{bucket.label}</span>
                  <span className="tabular-nums rounded-full bg-[var(--color-bg-primary)]/60 px-2 py-0.5 text-[10px] font-bold text-[var(--color-text-tertiary)] group-hover/bucket:bg-[var(--color-accent-muted)] group-hover/bucket:text-[var(--color-accent)] transition-all">
                    {bucket.sessions.length}
                  </span>
                </button>
                {!collapsed && (
                  <div className="flex flex-col gap-0.5 pt-1">
                    {bucket.sessions.map((session) => (
                      <RecentSessionItem
                        key={session.id}
                        session={session}
                        sourceGroupId={null}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {recentSessions.length === 0 && (
            <div className="mx-3 my-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)]/50 bg-[var(--color-bg-primary)]/20 px-4 py-8 text-center animate-[fade-in_0.3s_ease-out]">
              <div className="mb-2 flex justify-center text-[var(--color-text-tertiary)] opacity-20">
                <Search size={24} />
              </div>
              <p className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-secondary)]">
                {searchQuery ? '无匹配会话' : '暂无最近会话'}
              </p>
              <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                {searchQuery ? '请尝试搜索其他内容' : '新启动的会话将显示在这里'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
