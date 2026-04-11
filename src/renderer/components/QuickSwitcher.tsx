import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { switchProjectContext } from '@/lib/project-context'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/codex.png'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIcon from '@/assets/icons/terminal_white.png'

const TYPE_ICONS: Record<string, string> = {
  'claude-code': claudeIcon,
  'claude-code-yolo': claudeIcon,
  codex: codexIcon,
  'codex-yolo': codexIcon,
  opencode: opencodeIcon,
  terminal: terminalIcon,
}

export function QuickSwitcher(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const sessions = useSessionsStore((s) => s.sessions)
  const projects = useProjectsStore((s) => s.projects)

  const items = useMemo(() => {
    return sessions.map((s) => {
      const proj = projects.find((p) => p.id === s.projectId)
      return { session: s, projectName: proj?.name ?? '' }
    })
  }, [sessions, projects])

  const filtered = useMemo(() => {
    if (!query) return items
    const q = query.toLowerCase()
    return items.filter(
      (it) => it.session.name.toLowerCase().includes(q) || it.projectName.toLowerCase().includes(q),
    )
  }, [items, query])

  // Ctrl+P to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault()
        setOpen((o) => {
          if (!o) {
            setQuery('')
            setSelectedIdx(0)
            setTimeout(() => inputRef.current?.focus(), 0)
          }
          return !o
        })
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const handleSelect = useCallback(
    (idx: number) => {
      const item = filtered[idx]
      if (!item) return
      switchProjectContext(item.session.projectId, item.session.id, item.session.worktreeId ?? null)
      setOpen(false)
    },
    [filtered],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleSelect(selectedIdx)
      }
    },
    [filtered.length, selectedIdx, handleSelect],
  )

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/30" onClick={() => setOpen(false)} />
      <div
        className={cn(
          'fixed left-1/2 top-[60px] z-[201] w-[400px] -translate-x-1/2',
          'rounded-[var(--radius-xl)] border border-[var(--color-border)]',
          'bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/50 overflow-hidden',
        )}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0) }}
          onKeyDown={handleKeyDown}
          placeholder="Switch to session..."
          className="w-full bg-transparent px-4 py-3 text-[var(--ui-font-base)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none border-b border-[var(--color-border)]"
          autoFocus
        />
        <div className="max-h-[300px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">No sessions found</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.session.id}
              onClick={() => handleSelect(i)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={cn(
                'flex w-full items-center gap-2.5 px-4 py-2 text-left',
                i === selectedIdx
                  ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)]',
              )}
            >
              <img src={TYPE_ICONS[item.session.type] ?? claudeIcon} alt="" className="h-4 w-4 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-[var(--ui-font-sm)] font-medium truncate">{item.session.name}</span>
                <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)] truncate">{item.projectName}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
