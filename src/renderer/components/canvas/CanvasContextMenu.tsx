import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/stores/canvas'
import { useSessionsStore } from '@/stores/sessions'

export type CanvasContextMenuState =
  | {
      screenX: number
      screenY: number
      target: 'canvas'
      worldX: number
      worldY: number
    }
  | {
      screenX: number
      screenY: number
      target: 'card'
      cardId: string
    }

interface CanvasContextMenuProps {
  state: CanvasContextMenuState
  onClose: () => void
}

export function CanvasContextMenu({ state, onClose }: CanvasContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!menuRef.current) return
      if (menuRef.current.contains(event.target as Node)) return
      onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [onClose])

  const items = useMemo(() => buildMenuItems(state, onClose), [state, onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[400] min-w-[180px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] py-1 shadow-xl"
      style={{ left: state.screenX, top: state.screenY }}
    >
      {items.map((item, index) => (
        item.kind === 'separator' ? (
          <div key={index} className="my-1 h-px bg-[var(--color-border)]" />
        ) : (
          <button
            key={index}
            type="button"
            disabled={item.disabled}
            onClick={() => { item.onClick(); onClose() }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--ui-font-sm)] transition-colors',
              item.danger
                ? 'text-[var(--color-error)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              'hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{item.shortcut}</span>
            )}
          </button>
        )
      ))}
    </div>,
    document.body,
  )
}

type MenuItem =
  | { kind: 'separator' }
  | { kind: 'item'; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; shortcut?: string }

function buildMenuItems(state: CanvasContextMenuState, onClose: () => void): MenuItem[] {
  if (state.target === 'canvas') {
    return buildCanvasItems(state, onClose)
  }
  return buildCardItems(state, onClose)
}

function buildCanvasItems(
  state: Extract<CanvasContextMenuState, { target: 'canvas' }>,
  _onClose: () => void,
): MenuItem[] {
  const addCard = useCanvasStore.getState().addCard
  const fitAll = useCanvasStore.getState().fitAll
  const arrange = useCanvasStore.getState().arrange

  return [
    {
      kind: 'item',
      label: '在此处新建便签',
      onClick: () => addCard({
        kind: 'note',
        x: state.worldX - 120,
        y: state.worldY - 80,
        noteBody: '',
        noteColor: 'yellow',
      }),
    },
    { kind: 'separator' },
    { kind: 'item', label: '自动排列 · 网格', onClick: () => arrange('grid') },
    { kind: 'item', label: '自动排列 · 横向流', onClick: () => arrange('rowFlow') },
    { kind: 'item', label: '自动排列 · 纵向流', onClick: () => arrange('colFlow') },
    { kind: 'item', label: '紧凑打包', onClick: () => arrange('pack') },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '适配所有内容',
      onClick: () => {
        const container = document.querySelector('[data-canvas-viewport]') as HTMLDivElement | null
        const rect = container?.getBoundingClientRect()
        if (rect) fitAll(rect.width, rect.height)
      },
    },
    { kind: 'item', label: '重置视图', onClick: () => useCanvasStore.getState().resetViewport() },
  ]
}

function buildCardItems(
  state: Extract<CanvasContextMenuState, { target: 'card' }>,
  _onClose: () => void,
): MenuItem[] {
  const store = useCanvasStore.getState()
  const card = store.getCard(state.cardId)
  if (!card) return []

  const selection = store.selectedCardIds
  const selectedCount = selection.length
  const multiSelected = selectedCount > 1 && selection.includes(state.cardId)
  const targetIds = multiSelected ? selection : [state.cardId]

  const items: MenuItem[] = []
  items.push({ kind: 'item', label: '置顶', onClick: () => store.bringToFront(state.cardId) })

  if (card.kind === 'note') {
    items.push({
      kind: 'item',
      label: '克隆',
      shortcut: 'Ctrl+D',
      onClick: () => store.duplicateCards(targetIds),
    })
  }

  if (multiSelected) {
    items.push({ kind: 'separator' })
    items.push({ kind: 'item', label: '对齐 · 左边', onClick: () => store.alignCards('left', targetIds) })
    items.push({ kind: 'item', label: '对齐 · 右边', onClick: () => store.alignCards('right', targetIds) })
    items.push({ kind: 'item', label: '对齐 · 顶边', onClick: () => store.alignCards('top', targetIds) })
    items.push({ kind: 'item', label: '对齐 · 底边', onClick: () => store.alignCards('bottom', targetIds) })
    items.push({ kind: 'item', label: '对齐 · 水平居中', onClick: () => store.alignCards('hCenter', targetIds) })
    items.push({ kind: 'item', label: '对齐 · 垂直居中', onClick: () => store.alignCards('vCenter', targetIds) })
    if (selectedCount >= 3) {
      items.push({ kind: 'separator' })
      items.push({ kind: 'item', label: '横向等距分布', onClick: () => store.distributeCards('horizontal', targetIds) })
      items.push({ kind: 'item', label: '纵向等距分布', onClick: () => store.distributeCards('vertical', targetIds) })
    }
  }

  items.push({ kind: 'separator' })
  const removableNotes = targetIds.filter((id) => store.getCard(id)?.kind === 'note')
  if (removableNotes.length > 0) {
    items.push({
      kind: 'item',
      label: multiSelected ? `删除选中便签 (${removableNotes.length})` : '删除便签',
      shortcut: 'Del',
      danger: true,
      onClick: () => store.removeCards(removableNotes),
    })
  }

  const sessionCardIds = targetIds.filter((id) => {
    const c = store.getCard(id)
    return c?.kind === 'session' || c?.kind === 'terminal'
  })
  if (sessionCardIds.length > 0) {
    items.push({
      kind: 'item',
      label: sessionCardIds.length > 1 ? `从画布移除会话 (${sessionCardIds.length})` : '从画布移除',
      onClick: () => store.removeCards(sessionCardIds),
    })
    items.push({
      kind: 'item',
      label: sessionCardIds.length > 1 ? `结束选中会话` : '结束会话',
      danger: true,
      onClick: () => {
        const sessionsStore = useSessionsStore.getState()
        for (const id of sessionCardIds) {
          const c = store.getCard(id)
          if (!c?.refId) continue
          const session = sessionsStore.sessions.find((s) => s.id === c.refId)
          if (session?.ptyId) void window.api.session.kill(session.ptyId)
          sessionsStore.removeSession(c.refId)
        }
      },
    })
  }

  return items
}
