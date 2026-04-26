import { X, ChevronUp, ChevronDown, Copy, ClipboardPaste, ListChecks, Search, Eraser, Mic } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@shared/types'
import { useXterm } from '@/hooks/useXterm'

interface TerminalViewProps {
  session: Session
  isActive: boolean
}

const CONTEXT_MENU_ITEM =
  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]'

export function TerminalView({ session, isActive }: TerminalViewProps): JSX.Element {
  const { containerRef, searchAddonRef, terminalRef, pasteFromClipboardRef } = useXterm(session, isActive)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)

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

  // Ctrl+F to open search. Shift does not change the behavior.
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
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

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contextMenu])

  const openContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const term = terminalRef.current
    const hasSelection = Boolean(term?.getSelection())
    setContextMenu({ x: event.clientX, y: event.clientY, hasSelection })
  }, [terminalRef])

  const doCopy = useCallback(() => {
    setContextMenu(null)
    const term = terminalRef.current
    if (!term) return
    const selection = term.getSelection()
    if (!selection) return
    void navigator.clipboard.writeText(selection)
    term.clearSelection()
  }, [terminalRef])

  const doPaste = useCallback(async () => {
    setContextMenu(null)
    await pasteFromClipboardRef.current?.()
  }, [pasteFromClipboardRef])

  const doVoiceInput = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.focus()

    if (window.api.platform !== 'win32') return

    window.setTimeout(() => {
      terminalRef.current?.focus()
      void window.api.window.startVoiceInput().then((result) => {
        if (!result.ok && result.error) {
          console.warn('[voice-input] failed to start:', result.error)
        }
      })
    }, 80)
  }, [terminalRef])

  const doSelectAll = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.selectAll()
  }, [terminalRef])

  const doFind = useCallback(() => {
    setContextMenu(null)
    openSearch()
  }, [openSearch])

  const doClear = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.clear()
  }, [terminalRef])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.dataTransfer.files.length === 0) return
      event.preventDefault()
      const term = terminalRef.current
      if (!term) return
      const paths: string[] = []
      for (const file of Array.from(event.dataTransfer.files)) {
        const path = window.api.files.getPathForFile(file)
        if (!path) continue
        paths.push(/\s/.test(path) ? `"${path}"` : path)
      }
      if (paths.length === 0) return
      term.focus()
      term.paste(paths.join(' '))
    },
    [terminalRef],
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const menuWidth = 200
  const menuHeight = 274
  const contextMenuStyle = contextMenu
    ? {
        left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - menuWidth - 8)),
        top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuHeight - 8)),
      }
    : undefined

  return (
    <div className="terminal-view h-full w-full bg-[var(--color-terminal-bg)]">
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

        <div
          className="absolute inset-0 bg-[var(--color-terminal-bg)] p-[10px]"
          onContextMenu={openContextMenu}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
        <div
          ref={containerRef}
          className="h-full w-full bg-[var(--color-terminal-bg)]"
        />
      </div>
      </div>
      {contextMenu && contextMenuStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[119]"
            onMouseDown={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu(null)
            }}
          />
          <div
            className="no-drag fixed z-[120] w-[200px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/35"
            style={contextMenuStyle}
          >
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doCopy}
              disabled={!contextMenu.hasSelection}
            >
              <span className="flex items-center gap-2">
                <Copy size={13} />
                复制
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+C</span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doPaste}
            >
              <span className="flex items-center gap-2">
                <ClipboardPaste size={13} />
                粘贴
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+V</span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doVoiceInput}
              disabled={window.api.platform !== 'win32'}
            >
              <span className="flex items-center gap-2">
                <Mic size={13} />
                语音输入
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Win+H</span>
            </button>
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doSelectAll}
            >
              <span className="flex items-center gap-2">
                <ListChecks size={13} />
                全选
              </span>
            </button>
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doFind}
            >
              <span className="flex items-center gap-2">
                <Search size={13} />
                查找
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Ctrl+F</span>
            </button>
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <button
              type="button"
              className={CONTEXT_MENU_ITEM}
              onClick={doClear}
            >
              <span className="flex items-center gap-2">
                <Eraser size={13} />
                清屏
              </span>
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
