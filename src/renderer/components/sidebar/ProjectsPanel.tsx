import { FolderPlus, Plus, Search, Settings, Terminal } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createAnonymousTerminal } from '@/lib/anonymous-project'
import { cn } from '@/lib/utils'
import { useGroupsStore } from '@/stores/groups'
import { useUIStore } from '@/stores/ui'
import { GroupList } from './GroupList'

export function ProjectsPanel(): JSX.Element {
  const addGroup = useGroupsStore((s) => s.addGroup)
  const openSettings = useUIStore((s) => s.openSettings)
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
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
        <div className="text-[var(--ui-font-xs)] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
          工作区
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => { void createAnonymousTerminal() }}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
              'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              'transition-colors duration-100',
            )}
            title="匿名终端"
          >
            <Terminal size={14} />
          </button>
          <button
            onClick={handleStartAdding}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
              'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              'transition-colors duration-100',
            )}
            title="新建分组"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

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

      <div className="shrink-0 px-3 py-2">
        <div className="relative">
          {!searchQuery && (
            <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center gap-1.5">
              <Search size={12} className="text-[var(--color-text-tertiary)]" />
              <span className="text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">搜索...</span>
            </div>
          )}
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ outline: 'none', boxShadow: 'none' }}
            className={cn(
              'h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5',
              'text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
              'transition-colors focus:border-[var(--color-accent)]/60 focus:bg-[var(--color-bg-tertiary)]',
            )}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <GroupList searchQuery={searchQuery} />
      </div>

      <div className="shrink-0 border-t border-[var(--color-border)] px-3 py-1.5">
        <button
          onClick={openSettings}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2',
            'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
            'transition-colors duration-100',
          )}
        >
          <Settings size={14} />
          <span className="text-[var(--ui-font-sm)] font-medium">设置</span>
        </button>
      </div>
    </div>
  )
}
