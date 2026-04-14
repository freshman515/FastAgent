import { FolderPlus, Plus, Search, Settings, Terminal, X } from 'lucide-react'
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

      <div className="shrink-0 px-2.5 py-2">
        <div className="group/search relative">
          {/* Leading search icon — always visible, tints to accent on focus */}
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center text-[var(--color-text-tertiary)] transition-colors group-focus-within/search:text-[var(--color-accent)]">
            <Search size={14} strokeWidth={2.25} />
          </div>

          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索项目…"
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

          {/* Trailing clear button — only shown when there's content */}
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

      <div className="flex-1 overflow-y-auto py-1">
        <GroupList searchQuery={searchQuery} />
      </div>

    </div>
  )
}
