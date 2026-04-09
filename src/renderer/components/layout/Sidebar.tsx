import { FolderPlus, PanelLeftClose, Plus, Search, Settings } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useGroupsStore } from '@/stores/groups'
import { useUIStore } from '@/stores/ui'
import { GroupList } from '@/components/sidebar/GroupList'

export function Sidebar(): JSX.Element {
  const addGroup = useGroupsStore((s) => s.addGroup)
  const openSettings = useUIStore((s) => s.openSettings)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const committedRef = useRef(false)

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

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Projects
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleStartAdding}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
              'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              'transition-colors duration-100',
            )}
            title="New Group"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={toggleSidebar}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
              'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              'transition-colors duration-100',
            )}
            title="Collapse Sidebar"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>

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
              placeholder="Group name..."
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
      <div className="shrink-0 px-3 py-1.5">
        <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)] px-2 h-6">
          <Search size={11} className="shrink-0 text-[var(--color-text-tertiary)]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter..."
            className="h-full w-full bg-transparent text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none"
          />
        </div>
      </div>

      {/* Group list */}
      <div className="flex-1 overflow-y-auto py-1">
        <GroupList searchQuery={searchQuery} />
      </div>

      {/* Footer: settings */}
      <div className="shrink-0 border-t border-[var(--color-border)] px-3 py-2">
        <button
          onClick={openSettings}
          className={cn(
            'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5',
            'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
            'transition-colors duration-75',
          )}
        >
          <Settings size={13} />
          <span className="text-[var(--ui-font-sm)]">Settings</span>
        </button>
      </div>
    </div>
  )
}
