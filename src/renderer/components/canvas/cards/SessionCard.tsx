import { useState } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useSessionsStore } from '@/stores/sessions'
import { SESSION_TYPE_CONFIG, type CanvasCard } from '@shared/types'
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
  const [confirmKill, setConfirmKill] = useState(false)

  if (!session) return null
  const frameCoordinateMode =
    coordinateMode === 'screen' && session.type !== 'claude-gui'
      ? 'screen-transform'
      : coordinateMode

  const config = SESSION_TYPE_CONFIG[session.type]
  const title = (
    <span className="flex min-w-0 items-center gap-2">
      <SessionStatusDot status={session.status} />
      <span className="truncate font-medium text-[var(--color-text-primary)]">{session.name}</span>
      <span className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
        {config.label}
      </span>
    </span>
  )

  const handleRemove = (): void => {
    // Default "✕" just detaches from canvas — session stays alive.
    removeCard(card.id)
  }

  const handleKillSession = (): void => {
    if (session.ptyId) {
      void window.api.session.kill(session.ptyId)
    }
    removeSession(session.id)
    // The session-removed subscription will clean up the canvas card too.
    setConfirmKill(false)
  }

  const headerActions = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setConfirmKill(true) }}
      className="flex h-6 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-error)]"
      title="结束会话"
    >
      结束
    </button>
  )

  return (
    <>
      <CardFrame
        card={card}
        title={title}
        headerActions={headerActions}
        onDelete={handleRemove}
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

      {confirmKill && (
        <ConfirmDialog
          title="结束会话?"
          message={`会话 "${session.name}" 的进程将被终止，无法恢复。`}
          confirmLabel="结束"
          cancelLabel="取消"
          danger
          onConfirm={handleKillSession}
          onCancel={() => setConfirmKill(false)}
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
