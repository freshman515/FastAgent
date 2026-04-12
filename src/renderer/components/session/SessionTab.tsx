import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@shared/types'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { usePanesStore, type SplitPosition } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useGitStore } from '@/stores/git'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getTerminalPreviewText } from '@/hooks/useXterm'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/codex.png'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIconDark from '@/assets/icons/terminal_white.png'
import terminalIconLight from '@/assets/icons/terminal.png'

const TYPE_ICONS: Record<string, string> = {
  'claude-code': claudeIcon,
  'claude-code-yolo': claudeIcon,
  'claude-gui': claudeIcon,
  codex: codexIcon,
  'codex-yolo': codexIcon,
  opencode: opencodeIcon,
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
  { position: 'right', label: '向右分屏' },
  { position: 'down', label: '向下分屏' },
  { position: 'left', label: '向左分屏' },
  { position: 'up', label: '向上分屏' },
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
  const [preview, setPreview] = useState<{ lines: string[]; x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragTokenRef = useRef<string | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isDarkTheme = useIsDarkTheme()
  const terminalIcon = isDarkTheme ? terminalIconDark : terminalIconLight
  const iconSrc = session.type === 'terminal' ? terminalIcon : (TYPE_ICONS[session.type] ?? claudeIcon)
  const currentWindowId = window.api.detach.isDetached ? window.api.detach.getWindowId() : 'main'

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
  const isSplit = usePanesStore((s) => s.root.type === 'split')

  return (
    <>
      {dropSide === 'left' && (
        <div className="h-5 w-0.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
      )}

      <div
        draggable={!isRenaming}
        onDragStart={(e) => {
          const liveSession = useSessionsStore.getState().sessions.find((s) => s.id === session.id) ?? session
          const dragToken = `tabdrag-${session.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          dragTokenRef.current = dragToken
          e.dataTransfer.setData('session-tab-id', session.id)
          e.dataTransfer.setData('source-pane-id', paneId)
          e.dataTransfer.setData('source-window-id', currentWindowId)
          e.dataTransfer.setData('session-tab-drag-token', dragToken)
          e.dataTransfer.effectAllowed = 'move'
          window.api.detach.registerTabDrag(dragToken, {
            session: liveSession,
            sourcePaneId: paneId,
            sourceWindowId: currentWindowId,
          })
          onDragStart(session.id, e)
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(session.id, e) }}
        onDragLeave={onDragLeave}
        onDrop={() => onDrop(session.id)}
        onDragEnd={(e) => {
          onDragEnd()
          const dragToken = dragTokenRef.current
          dragTokenRef.current = null
          const dragResult = dragToken ? window.api.detach.finishTabDrag(dragToken) : null

          if (dragResult?.claimed && dragResult.targetWindowId && dragResult.targetWindowId !== currentWindowId) {
            removeSessionFromPane(paneId, session.id)
            return
          }

          // Detect if dropped outside the window → pop out
          const { clientX, clientY, screenX, screenY } = e
          const inWindow = clientX >= 0 && clientY >= 0
            && clientX <= window.innerWidth && clientY <= window.innerHeight
          if (!inWindow && !session.pinned) {
            const liveSession = useSessionsStore.getState().sessions.find((s) => s.id === session.id)
            const project = useProjectsStore.getState().projects.find((p) => p.id === session.projectId)
            const branch = useGitStore.getState().branchInfo[session.projectId]?.current
            const detachTitle = (project?.name ?? session.name) + (branch ? `|${branch}` : '')
            const { popoutPosition, popoutWidth, popoutHeight } = useUIStore.getState().settings
            const pos = popoutPosition === 'center' ? undefined : { x: screenX, y: screenY }
            removeSessionFromPane(paneId, session.id)
            window.api.detach.create(
              [session.id],
              detachTitle,
              liveSession ? [liveSession] : [],
              [],
              { projectId: session.projectId, worktreeId: session.worktreeId ?? null },
              pos,
              { width: popoutWidth, height: popoutHeight },
            )
          }
        }}
        onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); handleClose() } }}
        onMouseEnter={(e) => {
          if (isActive) return
          const rect = e.currentTarget.getBoundingClientRect()
          previewTimer.current = setTimeout(() => {
            const lines = getTerminalPreviewText(session.id)
            if (lines.length > 0) setPreview({ lines, x: rect.left, y: rect.bottom + 6 })
          }, 400)
        }}
        onMouseLeave={() => {
          if (previewTimer.current) { clearTimeout(previewTimer.current); previewTimer.current = null }
          setPreview(null)
        }}
        className={cn(
          'no-drag group flex h-[34px] cursor-pointer items-center gap-1.5 px-2.5',
          'max-w-[180px]',
          isActive
            ? 'tab-active text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] rounded-[var(--radius-sm)]',
          isDragging && 'opacity-40',
        )}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Color dot */}
        {session.color && (
          <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: session.color }} />
        )}
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

        {/* Label tag */}
        {session.label && (
          <span
            className="shrink-0 rounded px-1 py-px text-[8px] font-medium leading-tight"
            style={{
              backgroundColor: (session.color ?? 'var(--color-bg-surface)') + '25',
              color: session.color ?? 'var(--color-text-tertiary)',
            }}
          >
            {session.label}
          </span>
        )}

        {session.pinned ? (
          <div className="h-3 w-3 shrink-0 flex items-center justify-center text-[var(--color-accent)]" title="已固定">
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

      {preview && createPortal(
        <div
          style={{ top: preview.y, left: Math.min(preview.x, window.innerWidth - 410), zIndex: 9990 }}
          className="fixed w-[400px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#1a1a1e] shadow-xl shadow-black/50 overflow-hidden pointer-events-none"
        >
          <div className="px-2.5 py-1 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <div className="flex items-center gap-1.5">
              <img src={iconSrc} alt="" className="h-3.5 w-3.5" />
              <span className="text-[11px] font-medium text-[var(--color-text-secondary)] truncate">{session.name}</span>
            </div>
          </div>
          <pre className="px-2.5 py-2 text-[11px] leading-[16px] text-[#e8e8ec] overflow-hidden whitespace-pre" style={{ fontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', monospace" }}>
            {preview.lines.join('\n')}
          </pre>
        </div>,
        document.body,
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
              {session.pinned ? '取消固定' : '固定标签页'}
            </button>

            {/* Rename */}
            <button
              onClick={startRename}
              className="flex w-full items-center justify-between px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              <span>重命名</span>
              <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">F2</span>
            </button>

            {/* Color & Label */}
            <div className="h-px my-0.5 bg-[var(--color-border)]" />
            <div className="px-3 py-1.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">Color</span>
                {session.color && (
                  <button
                    onClick={() => updateSession(session.id, { color: undefined })}
                    className="text-[8px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                  >
                    清除
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {['#ef5757', '#f0a23b', '#3ecf7b', '#5fa0f5', '#7c6aef', '#c084fc', '#f472b6', '#45c8c8', '#8e8e96'].map((c) => (
                  <button
                    key={c}
                    onClick={() => updateSession(session.id, { color: c })}
                    className={cn(
                      'h-4 w-4 rounded-full border-2 transition-transform hover:scale-125',
                      session.color === c ? 'border-white' : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="px-3 pb-1.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">Label</span>
                {session.label && (
                  <button
                    onClick={() => updateSession(session.id, { label: undefined })}
                    className="text-[8px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                  >
                    清除
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {['前端', '后端', 'API', 'DB', 'Test', 'Dev', 'Bug'].map((l) => (
                  <button
                    key={l}
                    onClick={() => updateSession(session.id, { label: session.label === l ? undefined : l })}
                    className={cn(
                      'rounded px-2 py-0.5 text-[var(--ui-font-xs)] transition-colors',
                      session.label === l
                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                        : 'bg-[var(--color-bg-surface)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <input
                placeholder="自定义标签..."
                defaultValue={session.label && !['前端', '后端', 'API', 'DB', 'Test', 'Dev', 'Bug'].includes(session.label) ? session.label : ''}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim()
                    updateSession(session.id, { label: val || undefined })
                    setContextMenu(null)
                  }
                  if (e.key === 'Escape') setContextMenu(null)
                }}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)]"
              />
            </div>
            <div className="h-px my-0.5 bg-[var(--color-border)]" />

            {/* Pop Out */}
            <button
              onClick={() => {
                setContextMenu(null)
                const liveSession = useSessionsStore.getState().sessions.find((s) => s.id === session.id)
                const project = useProjectsStore.getState().projects.find((p) => p.id === session.projectId)
                const branch = useGitStore.getState().branchInfo[session.projectId]?.current
                const detachTitle = (project?.name ?? session.name) + (branch ? `|${branch}` : '')
                const { popoutPosition, popoutWidth, popoutHeight } = useUIStore.getState().settings
                const pos = popoutPosition === 'center' ? undefined
                  : { x: window.screenX + window.innerWidth / 2, y: window.screenY + window.innerHeight / 2 }
                removeSessionFromPane(paneId, session.id)
                window.api.detach.create(
                  [session.id],
                  detachTitle,
                  liveSession ? [liveSession] : [],
                  [],
                  { projectId: session.projectId, worktreeId: session.worktreeId ?? null },
                  pos,
                  { width: popoutWidth, height: popoutHeight },
                )
              }}
              className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              弹出为独立窗口
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

            {/* Merge All Panes */}
            {isSplit && (
              <button
                onClick={() => {
                  setContextMenu(null)
                  usePanesStore.getState().mergeAllPanes()
                }}
                className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
              >
                合并全部分屏
              </button>
            )}

            {/* Export */}
            {session.ptyId && (
              <>
                <div className="h-px my-0.5 bg-[var(--color-border)]" />
                <button
                  onClick={() => { setContextMenu(null); window.api.session.export(session.ptyId!, session.name) }}
                  className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                >
                  导出输出
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
                  关闭
                </button>
              </>
            )}
          </div>
        </>,
        document.body,
      )}

      {showCloseConfirm && (
        <ConfirmDialog
          title="关闭会话"
          message={`"${session.name}" 仍在运行，确认关闭吗？`}
          confirmLabel="关闭"
          danger
          onConfirm={doClose}
          onCancel={() => setShowCloseConfirm(false)}
        />
      )}
    </>
  )
}
