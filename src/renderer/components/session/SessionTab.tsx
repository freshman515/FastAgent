import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@shared/types'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore, type SplitPosition } from '@/stores/panes'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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

interface SessionTabProps {
  session: Session
  isActive: boolean
  paneId: string
  isDragging: boolean
  dropSide: 'left' | 'right' | null
  onDragStart: (id: string, e: React.DragEvent) => void
  onDragOver: (id: string, e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (id: string) => void
  onDragEnd: () => void
}

const SPLIT_OPTIONS: Array<{ position: SplitPosition; label: string }> = [
  { position: 'right', label: 'Split Right' },
  { position: 'down', label: 'Split Down' },
  { position: 'left', label: 'Split Left' },
  { position: 'up', label: 'Split Up' },
]

export function SessionTab({
  session, isActive, paneId, isDragging, dropSide,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}: SessionTabProps): JSX.Element {
  const removeSession = useSessionsStore((s) => s.removeSession)
  const updateSession = useSessionsStore((s) => s.updateSession)
  const setPaneActiveSession = usePanesStore((s) => s.setPaneActiveSession)
  const setActivePaneId = usePanesStore((s) => s.setActivePaneId)
  const splitPane = usePanesStore((s) => s.splitPane)
  const removeSessionFromPane = usePanesStore((s) => s.removeSessionFromPane)

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(session.name)
  const inputRef = useRef<HTMLInputElement>(null)

  const iconSrc = TYPE_ICONS[session.type] ?? claudeIcon

  const handleClick = useCallback(() => {
    if (isRenaming) return
    setPaneActiveSession(paneId, session.id)
    setActivePaneId(paneId)
  }, [session.id, paneId, setPaneActiveSession, setActivePaneId, isRenaming])

  const doClose = useCallback(() => {
    if (session.ptyId) window.api.session.kill(session.ptyId)
    removeSessionFromPane(paneId, session.id)
    removeSession(session.id)
    setShowCloseConfirm(false)
  }, [session.id, session.ptyId, paneId, removeSession, removeSessionFromPane])

  const handleClose = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation()
      if (session.pinned) return
      if (session.ptyId && session.type !== 'terminal' && session.status === 'running') {
        setShowCloseConfirm(true)
        return
      }
      doClose()
    },
    [session.pinned, session.ptyId, session.type, session.status, doClose],
  )

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const startRename = useCallback(() => {
    setContextMenu(null)
    setRenameValue(session.name)
    setIsRenaming(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }, [session.name])

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== session.name) {
      updateSession(session.id, { name: trimmed })
    }
    setIsRenaming(false)
  }, [renameValue, session.id, session.name, updateSession])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter') commitRename()
      if (e.key === 'Escape') setIsRenaming(false)
    },
    [commitRename],
  )

  // F2 to rename active tab
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'F2') { e.preventDefault(); startRename() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive, startRename])

  const paneSessions = usePanesStore((s) => s.paneSessions[paneId] ?? [])
  const canSplit = paneSessions.length >= 2

  return (
    <>
      {dropSide === 'left' && (
        <div className="h-5 w-0.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
      )}

      <div
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.setData('session-tab-id', session.id)
          e.dataTransfer.setData('source-pane-id', paneId)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart(session.id, e)
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(session.id, e) }}
        onDragLeave={onDragLeave}
        onDrop={() => onDrop(session.id)}
        onDragEnd={onDragEnd}
        onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); handleClose() } }}
        className={cn(
          'group flex h-7 cursor-pointer items-center gap-1.5 px-2.5',
          'max-w-[180px]',
          isActive
            ? 'tab-active text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] rounded-[var(--radius-sm)]',
          isDragging && 'opacity-40',
        )}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <img src={iconSrc} alt="" className="h-3.5 w-3.5 shrink-0" draggable={false} />

        {isRenaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none border-b border-[var(--color-accent)] w-12"
            autoFocus
          />
        ) : (
          <span className="flex-1 truncate text-[var(--ui-font-xs)]" onDoubleClick={(e) => { e.stopPropagation(); startRename() }}>{session.name}</span>
        )}

        {session.pinned ? (
          <div className="h-3 w-3 shrink-0 flex items-center justify-center text-[var(--color-accent)]" title="Pinned">
            <svg viewBox="0 0 16 16" width={10} height={10} fill="currentColor"><path d="M9.828.722a.5.5 0 01.354.146l4.95 4.95a.5.5 0 010 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.93 5.93 0 01.16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 01-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 010-.707c.688-.688 1.673-.767 2.375-.72a5.93 5.93 0 011.013.16l3.134-3.133a2.77 2.77 0 01-.04-.461c0-.43.109-1.022.589-1.503a.5.5 0 01.353-.146z"/></svg>
          </div>
        ) : (
          <button
            onClick={handleClose}
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded-sm',
              'text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100',
              'hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
              'transition-all duration-75',
            )}
          >
            <X size={10} />
          </button>
        )}
      </div>

      {dropSide === 'right' && (
        <div className="h-5 w-0.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
      )}

      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setContextMenu(null)} />
          <div
            style={{ top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
            className={cn(
              'fixed w-44 rounded-[var(--radius-md)] py-1',
              'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
              'shadow-lg shadow-black/30',
            )}
          >
            {/* Pin/Unpin */}
            <button
              onClick={() => { setContextMenu(null); updateSession(session.id, { pinned: !session.pinned }) }}
              className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              {session.pinned ? 'Unpin' : 'Pin'}
            </button>

            {/* Rename */}
            <button
              onClick={startRename}
              className="flex w-full items-center justify-between px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              <span>Rename</span>
              <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">F2</span>
            </button>

            {/* Split options */}
            {canSplit && (
              <>
                <div className="h-px my-0.5 bg-[var(--color-border)]" />
                {SPLIT_OPTIONS.map((opt) => (
                  <button
                    key={opt.position}
                    onClick={() => {
                      setContextMenu(null)
                      splitPane(paneId, opt.position, session.id)
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                  >
                    {opt.label}
                  </button>
                ))}
              </>
            )}

            {/* Export */}
            {session.ptyId && (
              <>
                <div className="h-px my-0.5 bg-[var(--color-border)]" />
                <button
                  onClick={() => { setContextMenu(null); window.api.session.export(session.ptyId!, session.name) }}
                  className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                >
                  Export Output
                </button>
              </>
            )}

            {/* Close */}
            {!session.pinned && (
              <>
                <div className="h-px my-0.5 bg-[var(--color-border)]" />
                <button
                  onClick={() => { setContextMenu(null); handleClose() }}
                  className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </>,
        document.body,
      )}

      {showCloseConfirm && (
        <ConfirmDialog
          title="Close Session"
          message={`"${session.name}" is still running. Are you sure?`}
          confirmLabel="Close"
          danger
          onConfirm={doClose}
          onCancel={() => setShowCloseConfirm(false)}
        />
      )}
    </>
  )
}
