import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@shared/types'
import { cn } from '@/lib/utils'
import { useXterm } from '@/hooks/useXterm'

interface TerminalViewProps {
  session: Session
  isActive: boolean
}

export function TerminalView({ session, isActive }: TerminalViewProps): JSX.Element {
  const { containerRef, searchAddonRef } = useXterm(session, isActive)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchText('')
    searchAddonRef.current?.clearDecorations()
  }, [searchAddonRef])

  const searchDecorations = {
    matchBackground: '#f0a23b55',
    matchBorder: '#f0a23b',
    matchOverviewRuler: '#f0a23b',
    activeMatchBackground: '#f0a23baa',
    activeMatchBorder: '#ffffff',
    activeMatchColorOverviewRuler: '#ffffff',
  }

  const findNext = useCallback(() => {
    if (searchText) searchAddonRef.current?.findNext(searchText, { decorations: searchDecorations })
  }, [searchText, searchAddonRef])

  const findPrev = useCallback(() => {
    if (searchText) searchAddonRef.current?.findPrevious(searchText, { decorations: searchDecorations })
  }, [searchText, searchAddonRef])

  // Ctrl+Shift+F to open search
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        openSearch()
      }
      if (e.key === 'Escape' && searchOpen) {
        closeSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive, searchOpen, openSearch, closeSearch])

  // Live search as user types
  useEffect(() => {
    if (searchText) {
      searchAddonRef.current?.findNext(searchText, { decorations: searchDecorations })
    } else {
      searchAddonRef.current?.clearDecorations()
    }
  }, [searchText, searchAddonRef])

  return (
    <div className="h-full w-full bg-[var(--color-terminal-bg)]">
      <div className="relative h-full w-full bg-[var(--color-terminal-bg)]">
      {/* Search bar */}
      {searchOpen && (
        <div className="terminal-search-bar absolute right-3 top-3 z-10 flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 shadow-lg">
          <input
            ref={inputRef}
            value={searchText}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? findPrev() : findNext()
              }
              if (e.key === 'Escape') closeSearch()
            }}
            placeholder="Search..."
            className="terminal-search-input w-40 bg-transparent text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none"
          />
          <button onClick={findPrev} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            <ChevronUp size={14} />
          </button>
          <button onClick={findNext} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            <ChevronDown size={14} />
          </button>
          <button onClick={closeSearch} className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            <X size={14} />
          </button>
        </div>
      )}

        <div className="absolute inset-0 bg-[var(--color-terminal-bg)] p-[10px]">
        <div
          ref={containerRef}
          className="h-full w-full bg-[var(--color-terminal-bg)]"
        />
      </div>
      </div>
    </div>
  )
}
