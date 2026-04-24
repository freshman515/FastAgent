import { FolderPlus, Plus, Search, X } from 'lucide-react'
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

export function RecentSessionsPanel(): JSX.Element {
  const addGroup = useSessionGroupsStore((s) => s.addGroup)
  const groups = useSessionGroupsStore((s) => s.groups)
  const removeSessionFromAllGroups = useSessionGroupsStore((s) => s.removeSessionFromAllGroups)
  const sessions = useSessionsStore((s) => s.sessions)

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [recentDragOver, setRecentDragOver] = useState(false)
  const committedRef = useRef(false)

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
      <DockActions>
        <button
          onClick={handleStartAdding}
          className={cn(
            'flex h-8 w-8 items-center justify-center self-center rounded-[var(--radius-sm)]',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
            'transition-colors duration-100',
          )}
          title="新建分组"
        >
          <Plus size={18} />
        </button>
      </DockActions>

      {/* New group input */}
      {adding && (
        <div className="border-b border-[var(--color-border)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <FolderPlus size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleCommit}
              placeholder="分组名称..."
              className={cn(
                'h-6 w-full rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)] px-2 text-[var(--ui-font-sm)]',
                'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
                'border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none',
              )}
            />
          </div>
        </div>
      )}

      {/* Search */}
      <div className="shrink-0 px-2.5 py-2">
        <div className="group/search relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center text-[var(--color-text-tertiary)] transition-colors group-focus-within/search:text-[var(--color-accent)]">
            <Search size={14} strokeWidth={2.25} />
          </div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话…"
            spellCheck={false}
            className={cn(
              'peer h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]/70 bg-[var(--color-bg-tertiary)]/45 pl-8 pr-8',
              'text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
              'outline-none transition-all duration-150',
              'hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-tertiary)]/70',
              'focus:border-[var(--color-accent)]/70 focus:bg-[var(--color-bg-primary)]',
              'focus:shadow-[0_0_0_3px_var(--color-accent-muted)]',
            )}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-1 my-auto flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
              title="清除搜索"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-1">
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
            'mx-1.5 mt-2 rounded-[var(--radius-md)] transition-colors duration-100',
            recentDragOver && 'bg-[var(--color-accent)]/8 ring-1 ring-inset ring-[var(--color-accent)]/40',
          )}
        >
          <div className="px-2.5 pt-1.5 pb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
            <span>最近 · 未分组</span>
            {recentSessions.length > 0 && (
              <span className="tabular-nums rounded-full bg-[var(--color-bg-tertiary)]/60 px-1.5 py-px text-[9px] text-[var(--color-text-tertiary)]">
                {recentSessions.length}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5 pb-1">
            {recentSessions.map((session) => (
              <RecentSessionItem
                key={session.id}
                session={session}
                sourceGroupId={null}
              />
            ))}
            {recentSessions.length === 0 && (
              <div className="mx-2 my-1 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)]/70 px-3 py-3 text-center text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
                {searchQuery ? '无匹配会话' : '这里会显示所有未归组的会话'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
