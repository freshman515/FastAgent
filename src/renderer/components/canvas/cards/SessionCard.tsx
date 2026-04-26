import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import type { CanvasCard } from '@shared/types'
import { TerminalView } from '@/components/session/TerminalView'
import { BrowserSessionView } from '@/components/session/BrowserSessionView'
import { ClaudeCodePanel } from '@/components/rightpanel/ClaudeCodePanel'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getTerminalPreviewText } from '@/hooks/useXterm'
import { formatSessionCardTitle, normalizeSessionRemark } from '@/lib/canvasSessionLabel'
import { getSessionIcon } from '@/lib/sessionIcon'
import { CardFrame, type CardCoordinateMode } from './CardFrame'

interface SessionCardProps {
  card: CanvasCard
  coordinateMode?: CardCoordinateMode
}

export function SessionCard({ card, coordinateMode }: SessionCardProps): JSX.Element | null {
  const session = useSessionsStore((state) =>
    card.refId ? state.sessions.find((s) => s.id === card.refId) ?? null : null,
  )
  const selected = useCanvasStore((state) => state.selectedCardIds.includes(card.id))
  const isMaximized = useCanvasStore((state) => state.maximizedCardId === card.id)
  const removeCard = useCanvasStore((state) => state.removeCard)
  const setCardCollapsed = useCanvasStore((state) => state.setCardCollapsed)
  const updateCard = useCanvasStore((state) => state.updateCard)
  const removeSession = useSessionsStore((state) => state.removeSession)
  const updateSession = useSessionsStore((state) => state.updateSession)
  const theme = useUIStore((state) => state.settings.theme)
  const [confirmClose, setConfirmClose] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [remarkDialogOpen, setRemarkDialogOpen] = useState(false)
  const [remarkValue, setRemarkValue] = useState('')
  const [titleMenu, setTitleMenu] = useState<{ x: number; y: number } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const remarkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renaming) return
    requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }, [renaming])

  useEffect(() => {
    if (!titleMenu) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setTitleMenu(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [titleMenu])

  useEffect(() => {
    if (!remarkDialogOpen) return
    setRemarkValue(card.sessionRemark ?? '')
    requestAnimationFrame(() => {
      remarkInputRef.current?.focus()
      remarkInputRef.current?.select()
    })
  }, [card.sessionRemark, remarkDialogOpen])

  if (!session) return null
  const frameCoordinateMode =
    coordinateMode === 'screen' && session.type !== 'claude-gui' && session.type !== 'browser'
      ? 'screen-transform'
      : coordinateMode
  const sessionIcon = getSessionIcon(session.type, theme !== 'light')
  const displayTitle = formatSessionCardTitle(session.name, card.sessionRemark)

  const startRename = (): void => {
    setTitleMenu(null)
    setRenameValue(session.name)
    setRenaming(true)
  }

  const commitRename = (): void => {
    const nextName = renameValue.trim()
    if (nextName && nextName !== session.name) {
      updateSession(session.id, { name: nextName })
    }
    setRenaming(false)
  }

  const openRemarkDialog = (): void => {
    setTitleMenu(null)
    setRemarkValue(card.sessionRemark ?? '')
    setRemarkDialogOpen(true)
  }

  const commitRemark = (): void => {
    updateCard(card.id, { sessionRemark: normalizeSessionRemark(remarkValue) })
    setRemarkDialogOpen(false)
  }

  const title = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-surface)]/65">
        <img src={sessionIcon} alt="" className="h-[18px] w-[18px] object-contain" />
      </span>
      {renaming ? (
        <input
          ref={renameInputRef}
          data-card-control
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') commitRename()
            if (event.key === 'Escape') setRenaming(false)
          }}
          onClick={(event) => event.stopPropagation()}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)] outline-none"
        />
      ) : (
        <span className="truncate font-medium text-[var(--color-text-primary)]">{displayTitle}</span>
      )}
    </span>
  )

  const requestCloseSession = (): void => {
    if (session.pinned) return
    setTitleMenu(null)
    setConfirmClose(true)
  }

  const bringCardToFront = (): void => {
    setTitleMenu(null)
    useCanvasStore.getState().bringToFront(card.id)
  }

  const restoreCard = (): void => {
    setTitleMenu(null)
    useCanvasStore.getState().clearMaximizedCard()
  }

  const maximizeCard = (): void => {
    setTitleMenu(null)
    useCanvasStore.getState().toggleMaximizedCard(card.id)
  }

  const detachCardFromCanvas = (): void => {
    setTitleMenu(null)
    removeCard(card.id)
  }

  const toggleCollapsed = (): void => {
    const previewLines = card.refId
      ? getTerminalPreviewText(card.refId, 8).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0)
      : []
    setCardCollapsed(card.id, !card.collapsed, previewLines)
  }

  const handleCloseSession = (): void => {
    if (session.pinned) return
    if (session.ptyId) {
      void window.api.session.kill(session.ptyId)
    }
    const paneStore = usePanesStore.getState()
    const paneIds = Object.entries(paneStore.paneSessions)
      .filter(([, sessionIds]) => sessionIds.includes(session.id))
      .map(([paneId]) => paneId)
    for (const paneId of paneIds) {
      paneStore.removeSessionFromPane(paneId, session.id)
    }
    removeSession(session.id)
    setConfirmClose(false)
  }

  return (
    <>
      <CardFrame
        card={card}
        title={title}
        headerActions={
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              toggleCollapsed()
            }}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            title={card.collapsed ? '展开预览' : '折叠为预览'}
          >
            {card.collapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
        }
        onHeaderContextMenu={(event) => setTitleMenu({ x: event.clientX, y: event.clientY })}
        onDelete={requestCloseSession}
        deleteTitle="关闭会话"
        minWidth={320}
        minHeight={card.collapsed ? 104 : 240}
        borderless
        frameClassName="canvas-session-frame"
        bodyClassName={session.type === 'claude-gui' || session.type === 'browser' ? 'bg-[var(--color-bg-secondary)]' : 'bg-[var(--color-terminal-bg)]'}
        coordinateMode={frameCoordinateMode}
        focusOnClick
      >
        {card.collapsed ? (
          <CollapsedSessionPreview
            status={session.status}
            type={session.type}
            lines={card.collapsedPreview ?? []}
          />
        ) : session.type === 'claude-gui' ? (
          <div className="h-full w-full overflow-hidden">
            <ClaudeCodePanel sessionId={session.id} />
          </div>
        ) : session.type === 'browser' ? (
          <div className="h-full w-full overflow-hidden">
            <BrowserSessionView session={session} isActive={selected} />
          </div>
        ) : (
          <div className="h-full w-full overflow-hidden bg-[var(--color-terminal-bg)]">
            <TerminalView session={session} isActive={selected} />
          </div>
        )}
      </CardFrame>

      {titleMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[420]" onPointerDown={() => setTitleMenu(null)} />
          <div
            className="fixed z-[421] min-w-[148px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] py-1 shadow-xl"
            style={{
              left: Math.max(8, Math.min(titleMenu.x, window.innerWidth - 156)),
              top: Math.max(8, Math.min(titleMenu.y, window.innerHeight - (isMaximized ? 216 : 180))),
            }}
          >
            <button
              type="button"
              onClick={isMaximized ? restoreCard : maximizeCard}
              className="flex w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-text-primary)]"
            >
              {isMaximized ? '还原' : '最大化'}
            </button>
            <button
              type="button"
              onClick={startRename}
              className="flex w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-text-primary)]"
            >
              重命名
            </button>
            <button
              type="button"
              onClick={openRemarkDialog}
              className="flex w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-text-primary)]"
            >
              添加备注
            </button>
            <button
              type="button"
              onClick={bringCardToFront}
              className="flex w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-text-primary)]"
            >
              置顶
            </button>
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <button
              type="button"
              onClick={detachCardFromCanvas}
              className="flex w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-text-primary)]"
            >
              从画布移除
            </button>
            <button
              type="button"
              onClick={requestCloseSession}
              className="flex w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-error)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-error)_18%,transparent)] hover:text-[var(--color-error)]"
            >
              关闭会话
            </button>
          </div>
        </>,
        document.body,
      )}

      {remarkDialogOpen && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9500] bg-black/45 backdrop-blur-[2px]"
            onPointerDown={() => setRemarkDialogOpen(false)}
          />
          <div
            className="fixed left-1/2 top-1/2 z-[9501] w-[380px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5 shadow-2xl shadow-black/45"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-card-remark-title"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                commitRemark()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setRemarkDialogOpen(false)
              }
            }}
          >
            <h3 id="canvas-card-remark-title" className="mb-3 text-[var(--ui-font-md)] font-semibold text-[var(--color-text-primary)]">
              添加备注
            </h3>
            <label className="mb-5 block">
              <span className="mb-1.5 block text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                {session.name}
              </span>
              <input
                ref={remarkInputRef}
                value={remarkValue}
                onChange={(event) => setRemarkValue(event.target.value)}
                placeholder="备注"
                spellCheck={false}
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none transition-all placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]/70 focus:shadow-[0_0_0_3px_var(--color-accent-muted)]"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemarkDialogOpen(false)}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={commitRemark}
                className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-1.5 text-[var(--ui-font-sm)] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
              >
                完成
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}

      {confirmClose && (
        <ConfirmDialog
          title="关闭会话"
          message={`会话 "${session.name}" 将被结束，确认关闭吗？`}
          confirmLabel="关闭"
          cancelLabel="取消"
          danger
          onConfirm={handleCloseSession}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </>
  )
}

function CollapsedSessionPreview({ status, type, lines }: { status: string; type: string; lines: string[] }): JSX.Element {
  const displayLines = lines.length > 0 ? lines.slice(-4) : [`${type} · ${status}`]
  return (
    <div className="flex h-full flex-col justify-between bg-[var(--color-terminal-bg)] px-3 py-2 font-mono text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
      <div className="flex items-center justify-between gap-3 text-[var(--color-text-tertiary)]">
        <span className="truncate">{type}</span>
        <span className="shrink-0">{status}</span>
      </div>
      <div className="mt-2 min-h-0 space-y-1 overflow-hidden">
        {displayLines.map((line, index) => (
          <div key={`${index}-${line}`} className="truncate">
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}
