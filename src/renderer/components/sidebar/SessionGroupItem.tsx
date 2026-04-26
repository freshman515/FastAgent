import { ChevronDown, ChevronRight, Edit3, MoreHorizontal, Palette, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Session, SessionGroup } from '@shared/types'
import { cn } from '@/lib/utils'
import { useSessionGroupsStore } from '@/stores/sessionGroups'
import { useSessionsStore } from '@/stores/sessions'
import {
  DRAG_MIME_SESSION_ID,
  DRAG_MIME_SESSION_SOURCE_GROUP,
  RecentSessionItem,
  UNGROUPED_MARKER,
} from './RecentSessionItem'

interface SessionGroupItemProps {
  group: SessionGroup
  searchQuery?: string
}

const GROUP_DRAG_MIME = 'recent-session-group-id'

export function SessionGroupItem({ group, searchQuery = '' }: SessionGroupItemProps): JSX.Element {
  const toggleCollapse = useSessionGroupsStore((s) => s.toggleCollapse)
  const removeGroup = useSessionGroupsStore((s) => s.removeGroup)
  const updateGroup = useSessionGroupsStore((s) => s.updateGroup)
  const reorderGroupById = useSessionGroupsStore((s) => s.reorderGroupById)
  const reorderSessionInGroup = useSessionGroupsStore((s) => s.reorderSessionInGroup)
  const moveSessionToGroupAt = useSessionGroupsStore((s) => s.moveSessionToGroupAt)
  const addSessionToGroup = useSessionGroupsStore((s) => s.addSessionToGroup)
  const allSessions = useSessionsStore((s) => s.sessions)

  const sessions = useMemo(() => {
    const map = new Map(allSessions.map((s) => [s.id, s]))
    const ordered = group.sessionIds.map((id) => map.get(id)).filter(Boolean) as Session[]
    if (!searchQuery.trim()) return ordered
    const q = searchQuery.toLowerCase()
    return ordered.filter((s) => s.name.toLowerCase().includes(q))
  }, [allSessions, group.sessionIds, searchQuery])

  const [showMenu, setShowMenu] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(group.name)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleRename = useCallback(() => {
    const name = editName.trim()
    if (name && name !== group.name) {
      updateGroup(group.id, { name })
    }
    setEditing(false)
    setShowMenu(false)
  }, [editName, group.id, group.name, updateGroup])

  const handleDelete = useCallback(() => {
    removeGroup(group.id)
    setShowMenu(false)
  }, [group.id, removeGroup])

  const handleSessionDrop = useCallback(
    (e: React.DragEvent, beforeSessionId: string | null) => {
      const sessionId = e.dataTransfer.getData(DRAG_MIME_SESSION_ID)
      const source = e.dataTransfer.getData(DRAG_MIME_SESSION_SOURCE_GROUP)
      if (!sessionId) return

      const fromGroupId = source && source !== UNGROUPED_MARKER ? source : null
      if (fromGroupId === group.id) {
        // Reorder within this group
        if (beforeSessionId && beforeSessionId !== sessionId) {
          reorderSessionInGroup(group.id, sessionId, beforeSessionId)
        }
        return
      }
      moveSessionToGroupAt(sessionId, fromGroupId, group.id, beforeSessionId)
    },
    [group.id, moveSessionToGroupAt, reorderSessionInGroup],
  )

  return (
    <div className="relative">
      {/* Group header */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(GROUP_DRAG_MIME, group.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        className={cn(
          'group relative flex h-8.5 cursor-pointer items-center gap-2.5 px-3 mt-1.5 mb-0.5',
          'transition-all duration-200 hover:bg-[var(--color-bg-surface)]/40 rounded-[var(--radius-sm)] mx-1',
          dragOver
            ? 'bg-[var(--color-accent-muted)] ring-1 ring-inset ring-[var(--color-accent)]/30'
            : '',
        )}
        onClick={() => toggleCollapse(group.id)}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes(DRAG_MIME_SESSION_ID)
            || e.dataTransfer.types.includes(GROUP_DRAG_MIME)
          ) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDragOver(true)
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false)
          const sessionId = e.dataTransfer.getData(DRAG_MIME_SESSION_ID)
          if (sessionId) {
            addSessionToGroup(group.id, sessionId)
            if (group.collapsed) toggleCollapse(group.id)
            return
          }
          const draggedGroupId = e.dataTransfer.getData(GROUP_DRAG_MIME)
          if (draggedGroupId && draggedGroupId !== group.id) {
            reorderGroupById(draggedGroupId, group.id)
          }
        }}
      >
        {/* Brand mark — subtle vertical pill with glow */}
        <div
          className="h-3.5 w-1 rounded-full transition-all duration-300 group-hover:h-4.5"
          style={{
            backgroundColor: group.color,
            boxShadow: `0 0 8px ${group.color}44`,
          }}
        />

        {editing ? (
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') setEditing(false)
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ outline: 'none' }}
            className={cn(
              'h-6.5 flex-1 rounded-[var(--radius-sm)] bg-[var(--color-bg-primary)] px-2 text-[var(--ui-font-sm)]',
              'text-[var(--color-text-primary)] border border-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-accent-muted)]',
            )}
          />
        ) : (
          <span
            className="flex-1 truncate text-[12.5px] font-bold tracking-tight transition-colors duration-200 group-hover:text-[var(--color-text-primary)]"
            style={{ color: group.color }}
          >
            {group.name}
          </span>
        )}

        {!editing && sessions.length > 0 && (
          <span
            className="flex h-4.5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold transition-all duration-200"
            style={{
              backgroundColor: `${group.color}18`,
              color: group.color,
              border: `1px solid ${group.color}22`,
            }}
          >
            {sessions.length}
          </span>
        )}

        {/* Collapse chevron — moved to end */}
        <div className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-all duration-200 hover:text-[var(--color-text-secondary)]">
          {group.collapsed ? (
            <ChevronRight size={12} strokeWidth={2.5} className="transition-transform duration-200" />
          ) : (
            <ChevronDown size={12} strokeWidth={2.5} className="transition-transform duration-200" />
          )}
        </div>
      </div>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div
            ref={menuRef}
            className={cn(
              'absolute right-2 top-7 z-50 min-w-[160px] rounded-[var(--radius-md)] py-1',
              'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
              'shadow-lg shadow-black/30 animate-[fade-in_0.1s_ease-out]',
            )}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
                setEditName(group.name)
                setShowMenu(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              <Edit3 size={12} /> 重命名
            </button>
            <div className="px-3 py-1.5 border-t border-[var(--color-border)]">
              <div className="flex items-center gap-1.5 mb-1">
                <Palette size={12} className="text-[var(--color-text-tertiary)]" />
                <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">颜色</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {['#7c6aef', '#5fa0f5', '#45c8c8', '#3ecf7b', '#f0a23b', '#ef5757', '#c084fc', '#f472b6', '#8e8e96'].map((c) => (
                  <button
                    key={c}
                    onClick={() => { updateGroup(group.id, { color: c }); setShowMenu(false) }}
                    className={cn(
                      'h-4 w-4 rounded-full border-2 transition-transform hover:scale-125',
                      group.color === c ? 'border-white' : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={handleDelete}
              className="flex w-full items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border)] text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
            >
              <Trash2 size={12} /> 删除分组
            </button>
          </div>
        </>
      )}

      {/* Session list */}
      {!group.collapsed && (
        <div
          className="flex flex-col gap-0.5 pb-1.5 pl-1.5"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_MIME_SESSION_ID)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(e) => {
            // Empty area drop → append
            if (e.dataTransfer.types.includes(DRAG_MIME_SESSION_ID)) {
              handleSessionDrop(e, null)
              setDropBeforeId(null)
            }
          }}
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_MIME_SESSION_ID)) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                setDropBeforeId(session.id)
              }}
              onDragLeave={() => setDropBeforeId((id) => (id === session.id ? null : id))}
              onDrop={(e) => {
                e.stopPropagation()
                handleSessionDrop(e, session.id)
                setDropBeforeId(null)
              }}
            >
              <RecentSessionItem
                session={session}
                sourceGroupId={group.id}
                dropBefore={dropBeforeId === session.id}
              />
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="mx-2 my-1 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)]/70 px-3 py-2 text-center text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
              拖放会话到此分组
            </div>
          )}
        </div>
      )}

      <div className="mx-3 border-b border-[var(--color-border)]/30" />
    </div>
  )
}
