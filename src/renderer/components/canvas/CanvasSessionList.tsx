import { useEffect, useRef, useState, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Star, ListFilter, AlignJustify } from 'lucide-react'
import { type CanvasCard, type Session } from '@shared/types'
import { formatSessionCardTitle } from '@/lib/canvasSessionLabel'
import { cn } from '@/lib/utils'
import { getSessionIcon } from '@/lib/sessionIcon'
import { SessionIconView } from '@/components/session/SessionIconView'
import { isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { CanvasMenuItem, CanvasMenuPanel, CanvasMenuSeparator } from './CanvasMenu'

export function CanvasSessionList(): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; cardId: string } | null>(null)
  const lastWheelSwitchAtRef = useRef(0)
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)
  const maximizedCardId = useCanvasStore((state) => state.maximizedCardId)
  const sessions = useSessionsStore((state) => state.sessions)
  const isDarkTheme = useIsDarkTheme()
  const direction = useUIStore((state) => state.settings.canvasSessionListDirection)
  const updateSettings = useUIStore((state) => state.updateSettings)
  const isVertical = direction === 'vertical'
  const CollapseIcon = collapsed ? ChevronRight : (isVertical ? ChevronDown : ChevronLeft)

  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const items = cards
    .filter((card) => (card.kind === 'session' || card.kind === 'terminal') && card.refId)
    .map((card) => {
      const session = card.refId ? sessionById.get(card.refId) : undefined
      return session ? { card, session } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => Number(Boolean(b.card.favorite)) - Number(Boolean(a.card.favorite)))

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
    if (card && isCanvasCardHidden(card)) canvas.updateCard(cardId, { hidden: false, hiddenByFrameId: undefined })
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
    const hidden = isCanvasCardHidden(card)
    canvas.updateCard(cardId, hidden ? { hidden: false, hiddenByFrameId: undefined } : { hidden: true })
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

  const toggleDirection = (): void => {
    updateSettings({
      canvasSessionListDirection: isVertical ? 'horizontal' : 'vertical',
    })
  }

  return (
    <aside
      className={cn(
        'absolute z-20 flex overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/92 shadow-xl backdrop-blur transition-all duration-150',
        isVertical
          ? cn('left-3 top-3 w-56 flex-col', collapsed ? 'h-9' : 'bottom-20')
          : collapsed
            ? 'left-3 top-3 h-9 w-44 flex-row'
            : 'left-3 top-3 h-12 w-[calc(100%_-_1.5rem)] flex-row',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center border-[var(--color-border)]',
          isVertical ? 'h-9 w-full border-b' : cn('h-full', collapsed && 'w-full', !collapsed && 'border-r'),
        )}
      >
        <button
          data-canvas-session-list-toggle
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex h-full min-w-0 flex-1 items-center justify-between px-3 text-left transition-colors hover:bg-[var(--color-bg-hover)]"
          title={collapsed ? '展开画布会话' : '折叠画布会话'}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CollapseIcon size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
            <span className="truncate text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-secondary)]">画布会话</span>
          </span>
          <span className="ml-2 rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
            {items.length}
          </span>
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={toggleDirection}
            className="flex h-full w-9 shrink-0 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
            title={isVertical ? '切换为横向排列' : '切换为竖向排列'}
          >
            {isVertical ? <AlignJustify size={13} /> : <ListFilter size={13} />}
          </button>
        )}
      </div>
      <div
        className={cn(
          'min-h-0 flex-1 gap-1.5 p-1.5',
          collapsed && 'hidden',
          isVertical ? 'flex flex-col overflow-y-auto' : 'flex flex-row items-stretch overflow-x-auto',
        )}
        onWheel={handleWheel}
      >
        {items.map(({ card, session }) => {
          const selected = selectedCardIds.includes(card.id)
          const hidden = isCanvasCardHidden(card)
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
                'group relative flex gap-2 overflow-hidden rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-all duration-150',
                isVertical ? 'w-full shrink-0 items-start' : 'h-full w-44 shrink-0 items-center',
                selected
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,var(--color-bg-hover))] hover:text-[var(--color-text-primary)] hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_22%,transparent),0_8px_20px_rgba(0,0,0,0.18)]',
                hidden && 'opacity-55',
              )}
              title={displayName}
            >
              <span
                className={cn(
                  'absolute rounded-full bg-[var(--color-accent)] transition-all duration-150',
                  isVertical
                    ? 'left-0 top-2 bottom-2 w-0.5'
                    : 'left-0 top-2 bottom-2 w-0.5',
                  selected
                    ? 'opacity-100 shadow-[0_0_10px_var(--color-accent)]'
                    : 'scale-y-50 opacity-0 group-hover:scale-y-100 group-hover:opacity-100 group-hover:shadow-[0_0_10px_var(--color-accent)]',
                )}
              />
              <div className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-surface)]/65 transition-transform duration-150 group-hover:scale-110">
                <SessionIconView icon={session.customSessionIcon} fallbackSrc={icon} className="h-4.5 w-4.5" imageClassName="h-3.5 w-3.5 object-contain" />
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--ui-font-sm)] font-medium transition-colors group-hover:text-[var(--color-text-primary)]">{displayName}</span>
                {card.favorite && (
                  <Star size={11} className="absolute right-2 top-2.5 fill-[var(--color-accent)] text-[var(--color-accent)]" />
                )}
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
  item: { card: CanvasCard; session: Session } | null
  maximizedCardId: string | null
  onFocus: (cardId: string) => void
  onMaximize: (cardId: string) => void
  onCloseSession: (session: Session) => void
  onToggleHidden: (cardId: string) => void
}): JSX.Element | null {
  if (!item) return null
  const left = Math.max(8, Math.min(x, window.innerWidth - 164))
  const isMaximized = maximizedCardId === item.card.id
  const isHidden = isCanvasCardHidden(item.card)
  return (
    <CanvasMenuPanel x={left} y={y} width={156} height={156}>
      <CanvasMenuItem label="聚焦" onClick={() => onFocus(item.card.id)} />
      <CanvasMenuItem label={isMaximized ? '取消最大化' : '最大化'} onClick={() => onMaximize(item.card.id)} />
      <CanvasMenuItem
        label="关闭会话"
        danger
        disabled={item.session.pinned}
        onClick={() => onCloseSession(item.session)}
      />
      <CanvasMenuSeparator />
      <CanvasMenuItem label={isHidden ? '显示' : '隐藏'} onClick={() => onToggleHidden(item.card.id)} />
    </CanvasMenuPanel>
  )
}
