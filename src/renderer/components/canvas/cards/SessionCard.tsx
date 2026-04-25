import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import type { CanvasCard } from '@shared/types'
import { TerminalView } from '@/components/session/TerminalView'
import { ClaudeCodePanel } from '@/components/rightpanel/ClaudeCodePanel'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
  const removeCard = useCanvasStore((state) => state.removeCard)
  const removeSession = useSessionsStore((state) => state.removeSession)
  const updateSession = useSessionsStore((state) => state.updateSession)
  const [confirmClose, setConfirmClose] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [titleMenu, setTitleMenu] = useState<{ x: number; y: number } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

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

  if (!session) return null
  const frameCoordinateMode =
    coordinateMode === 'screen' && session.type !== 'claude-gui'
      ? 'screen-transform'
      : coordinateMode

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

  const title = (
    <span className="flex min-w-0 items-center gap-2">
      <SessionStatusDot status={session.status} />
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
        <span className="truncate font-medium text-[var(--color-text-primary)]">{session.name}</span>
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

  const detachCardFromCanvas = (): void => {
    setTitleMenu(null)
    removeCard(card.id)
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
        onHeaderContextMenu={(event) => setTitleMenu({ x: event.clientX, y: event.clientY })}
        onDelete={requestCloseSession}
        deleteTitle="关闭会话"
        minWidth={320}
        minHeight={240}
        borderless
        frameClassName="canvas-session-frame"
        bodyClassName={session.type === 'claude-gui' ? 'bg-[var(--color-bg-secondary)]' : 'bg-[var(--color-terminal-bg)]'}
        coordinateMode={frameCoordinateMode}
        focusOnClick
      >
        {session.type === 'claude-gui' ? (
          <div className="h-full w-full overflow-hidden">
            <ClaudeCodePanel sessionId={session.id} />
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
              top: Math.max(8, Math.min(titleMenu.y, window.innerHeight - 144)),
            }}
          >
            <button
              type="button"
              onClick={startRename}
              className="flex w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-text-primary)]"
            >
              重命名
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

function SessionStatusDot({ status }: { status: string }): JSX.Element {
  const color = status === 'running'
    ? 'var(--color-success, #22c55e)'
    : status === 'waiting-input'
      ? 'var(--color-warning, #f59e0b)'
      : status === 'stopped'
        ? 'var(--color-text-tertiary)'
        : 'var(--color-accent)'
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{
        backgroundColor: color,
        boxShadow: status === 'running' ? `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)` : undefined,
      }}
    />
  )
}
