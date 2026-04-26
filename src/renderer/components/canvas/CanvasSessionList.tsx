import { useEffect, useRef, useState, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SESSION_TYPE_CONFIG, type Session } from '@shared/types'
import { formatSessionCardTitle } from '@/lib/canvasSessionLabel'
import { cn } from '@/lib/utils'
import { getSessionIcon } from '@/lib/sessionIcon'
import { useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'

export function CanvasSessionList(): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; cardId: string } | null>(null)
  const lastWheelSwitchAtRef = useRef(0)
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)
  const maximizedCardId = useCanvasStore((state) => state.maximizedCardId)
  const sessions = useSessionsStore((state) => state.sessions)
  const theme = useUIStore((state) => state.settings.theme)
  const isDarkTheme = theme !== 'light'

  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const items = cards
    .filter((card) => (card.kind === 'session' || card.kind === 'terminal') && card.refId)
    .map((card) => {
      const session = card.refId ? sessionById.get(card.refId) : undefined
      return session ? { card, session } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (): void => setMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  if (items.length === 0) return null

  const revealCard = (cardId: string): void => {
    const canvas = useCanvasStore.getState()
    const card = canvas.getCard(cardId)
    if (card?.hidden) canvas.updateCard(cardId, { hidden: false })
  }

  const focusCard = (cardId: string): void => {
    const canvas = useCanvasStore.getState()
    revealCard(cardId)
    canvas.clearMaximizedCard()
    canvas.clearFocusReturn()
    requestAnimationFrame(() => useCanvasStore.getState().focusOnCard(cardId))
  }

  const maximizeCard = (cardId: string): void => {
    revealCard(cardId)
    requestAnimationFrame(() => {
      const canvas = useCanvasStore.getState()
      canvas.toggleMaximizedCard(cardId)
    })
  }

  const toggleHidden = (cardId: string): void => {
    const canvas = useCanvasStore.getState()
    const card = canvas.getCard(cardId)
    if (!card) return
    canvas.updateCard(cardId, { hidden: !card.hidden })
  }

  const closeSession = (session: Session): void => {
    if (session.pinned) return
    if (session.ptyId) {
      void window.api.session.kill(session.ptyId)
    }
    const panes = usePanesStore.getState()
    const paneIds = Object.entries(panes.paneSessions)
      .filter(([, sessionIds]) => sessionIds.includes(session.id))
      .map(([paneId]) => paneId)
    for (const paneId of paneIds) {
      panes.removeSessionFromPane(paneId, session.id)
    }
    useSessionsStore.getState().removeSession(session.id)
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (collapsed || items.length === 0 || Math.abs(event.deltaY) < 4) return
    event.preventDefault()
    event.stopPropagation()

    const now = performance.now()
    if (now - lastWheelSwitchAtRef.current < 120) return
    lastWheelSwitchAtRef.current = now

    const direction = event.deltaY > 0 ? 1 : -1
    const selectedIndex = items.findIndex(({ card }) => selectedCardIds.includes(card.id))
    const nextIndex = selectedIndex === -1
      ? (direction > 0 ? 0 : items.length - 1)
      : (selectedIndex + direction + items.length) % items.length
    focusCard(items[nextIndex].card.id)
  }

  return (
    <aside
      className={cn(
        'absolute left-3 top-3 z-20 flex w-56 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/92 shadow-xl backdrop-blur transition-[height,box-shadow] duration-150',
        collapsed ? 'h-9' : 'bottom-20',
      )}
    >
      <button
        data-canvas-session-list-toggle
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 text-left transition-colors hover:bg-[var(--color-bg-hover)]"
        title={collapsed ? '展开画布会话' : '折叠画布会话'}
      >
        <span className="flex min-w-0 items-center gap-2">
          {collapsed ? <ChevronRight size={13} className="shrink-0 text-[var(--color-text-tertiary)]" /> : <ChevronDown size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />}
          <span className="truncate text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-secondary)]">画布会话</span>
        </span>
        <span className="rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
          {items.length}
        </span>
      </button>
      <div
        className={cn('min-h-0 flex-1 overflow-y-auto p-1.5', collapsed && 'hidden')}
        onWheel={handleWheel}
      >
        {items.map(({ card, session }) => {
          const selected = selectedCardIds.includes(card.id)
          const hidden = Boolean(card.hidden)
          const config = SESSION_TYPE_CONFIG[session.type]
          const icon = getSessionIcon(session.type, isDarkTheme)
          const displayName = formatSessionCardTitle(session.name, card.sessionRemark)
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => focusCard(card.id)}
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                maximizeCard(card.id)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, cardId: card.id })
              }}
              className={cn(
                'group relative flex w-full items-start gap-2 overflow-hidden rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-all duration-150',
                selected
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,var(--color-bg-hover))] hover:text-[var(--color-text-primary)] hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_22%,transparent),0_8px_20px_rgba(0,0,0,0.18)]',
                hidden && 'opacity-55',
              )}
              title={displayName}
            >
              <span
                className={cn(
                  'absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] transition-all duration-150',
                  selected
                    ? 'opacity-100 shadow-[0_0_10px_var(--color-accent)]'
                    : 'scale-y-50 opacity-0 group-hover:scale-y-100 group-hover:opacity-100 group-hover:shadow-[0_0_10px_var(--color-accent)]',
                )}
              />
              <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-surface)]/65 transition-transform duration-150 group-hover:scale-110">
                <img src={icon} alt="" className="h-3.5 w-3.5 object-contain" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--ui-font-sm)] font-medium transition-colors group-hover:text-[var(--color-text-primary)]">{displayName}</span>
                <span className="block truncate text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] transition-colors group-hover:text-[var(--color-text-secondary)]">
                  {config.label} · {hidden ? '已隐藏' : getStatusLabel(session.status)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {menu && createPortal(
        <CanvasSessionListMenu
          x={menu.x}
          y={menu.y}
          item={items.find(({ card }) => card.id === menu.cardId) ?? null}
          maximizedCardId={maximizedCardId}
          onFocus={(cardId) => {
            focusCard(cardId)
            setMenu(null)
          }}
          onMaximize={(cardId) => {
            maximizeCard(cardId)
            setMenu(null)
          }}
          onCloseSession={(session) => {
            closeSession(session)
            setMenu(null)
          }}
          onToggleHidden={(cardId) => {
            toggleHidden(cardId)
            setMenu(null)
          }}
        />,
        document.body,
      )}
    </aside>
  )
}

function CanvasSessionListMenu({
  x,
  y,
  item,
  maximizedCardId,
  onFocus,
  onMaximize,
  onCloseSession,
  onToggleHidden,
}: {
  x: number
  y: number
  item: { card: { id: string; hidden?: boolean }; session: Session } | null
  maximizedCardId: string | null
  onFocus: (cardId: string) => void
  onMaximize: (cardId: string) => void
  onCloseSession: (session: Session) => void
  onToggleHidden: (cardId: string) => void
}): JSX.Element | null {
  if (!item) return null
  const left = Math.max(8, Math.min(x, window.innerWidth - 164))
  const top = Math.max(8, Math.min(y, window.innerHeight - 156))
  const isMaximized = maximizedCardId === item.card.id
  const isHidden = Boolean(item.card.hidden)
  return (
    <div
      className="fixed z-[9500] w-[156px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-1 shadow-2xl"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <SessionMenuItem label="聚焦" onClick={() => onFocus(item.card.id)} />
      <SessionMenuItem label={isMaximized ? '取消最大化' : '最大化'} onClick={() => onMaximize(item.card.id)} />
      <SessionMenuItem
        label="关闭会话"
        danger
        disabled={item.session.pinned}
        onClick={() => onCloseSession(item.session)}
      />
      <div className="my-1 h-px bg-[var(--color-border)]" />
      <SessionMenuItem label={isHidden ? '显示' : '隐藏'} onClick={() => onToggleHidden(item.card.id)} />
    </div>
  )
}

function SessionMenuItem({
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] transition-colors',
        danger
          ? 'text-[var(--color-error)] hover:bg-[color-mix(in_srgb,var(--color-error)_18%,transparent)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-text-primary)]',
        disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
      )}
    >
      {label}
    </button>
  )
}

function getStatusLabel(status: string): string {
  if (status === 'running') return '运行中'
  if (status === 'waiting-input') return '等待输入'
  if (status === 'stopped') return '已停止'
  return '空闲'
}
