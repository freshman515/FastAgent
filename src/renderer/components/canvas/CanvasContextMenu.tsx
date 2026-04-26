import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionType } from '@shared/types'
import { cn } from '@/lib/utils'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { createSessionWithPrompt } from '@/lib/createSession'
import { getDefaultCanvasCardSize, useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore, type CanvasArrangeMode } from '@/stores/ui'
import { SESSION_OPTIONS } from '@/components/session/NewSessionMenu'

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
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: state.screenX, top: state.screenY })
  const [submenuDirection, setSubmenuDirection] = useState<'right' | 'left'>('right')
  const items = useMemo(() => buildMenuItems(state, onClose), [state, onClose])

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!menuRef.current) return
      if (menuRef.current.contains(event.target as Node)) return
      onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [onClose])

  useEffect(() => {
    setMenuPosition({ left: state.screenX, top: state.screenY })
  }, [state.screenX, state.screenY])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return

    const updatePosition = (): void => {
      const margin = 8
      const rect = menu.getBoundingClientRect()
      const left = Math.min(Math.max(margin, state.screenX), Math.max(margin, window.innerWidth - rect.width - margin))
      const top = Math.min(Math.max(margin, state.screenY), Math.max(margin, window.innerHeight - rect.height - margin))
      setMenuPosition((current) => current.left === left && current.top === top ? current : { left, top })
      setSubmenuDirection(left + rect.width + 190 + margin > window.innerWidth ? 'left' : 'right')
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [state.screenX, state.screenY, items.length])

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        'fixed z-[400] min-w-[200px] overflow-visible rounded-[var(--radius-lg)] border border-white/[0.08]',
        'bg-[var(--color-bg-secondary)]/90 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.05)] py-1.5 p-1',
        'animate-in fade-in zoom-in-95 duration-150',
      )}
      style={{ left: menuPosition.left, top: menuPosition.top }}
    >
      {items.map((item, index) => (
        item.kind === 'separator' ? (
          <div key={index} className="my-1.5 h-px bg-white/[0.06] mx-2" />
        ) : item.kind === 'submenu' ? (
          <div
            key={index}
            className="relative"
            onMouseEnter={() => setOpenSubmenuIndex(index)}
          >
            <button
              type="button"
              disabled={item.disabled}
              className={cn(
                'group/item relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-left text-[13px] transition-all duration-200',
                'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white',
                'disabled:cursor-not-allowed disabled:opacity-30',
              )}
            >
              {/* Left accent bar on hover */}
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/item:scale-y-100 group-hover/item:opacity-100 group-hover/item:shadow-[0_0_8px_var(--color-accent)]" />
              
              <span className="flex-1 font-medium">{item.label}</span>
              <span className="text-[14px] text-[var(--color-text-tertiary)] opacity-40 group-hover/item:opacity-100 transition-opacity">›</span>
            </button>
            {openSubmenuIndex === index && !item.disabled && (
              <div
                className={cn(
                  'absolute top-0 min-w-[200px] overflow-hidden rounded-[var(--radius-lg)] border border-white/[0.08] bg-[var(--color-bg-secondary)]/95 backdrop-blur-3xl p-1 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-200',
                  submenuDirection === 'right' ? 'left-full ml-1.5' : 'right-full mr-1.5',
                )}
              >
                {item.items.map((child) => (
                  <button
                    key={child.label}
                    type="button"
                    onClick={() => { child.onClick(); onClose() }}
                    className={cn(
                      'group/subitem relative flex h-9 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-left text-[13px] transition-all duration-200',
                      'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white',
                    )}
                  >
                    {/* Left accent bar on hover */}
                    <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/subitem:scale-y-100 group-hover/subitem:opacity-100 group-hover/subitem:shadow-[0_0_8px_var(--color-accent)]" />

                    {child.icon && (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center transition-transform duration-200 group-hover/subitem:scale-110">
                        <img src={child.icon} alt="" className="h-4.5 w-4.5 shrink-0" />
                      </div>
                    )}
                    <span className="flex-1 font-medium">{child.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            key={index}
            type="button"
            disabled={item.disabled}
            onMouseEnter={() => setOpenSubmenuIndex(null)}
            onClick={() => { item.onClick(); onClose() }}
            className={cn(
              'group/item relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-left text-[13px] transition-all duration-200',
              item.danger
                ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/15 hover:text-[var(--color-error)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white',
              'disabled:cursor-not-allowed disabled:opacity-30',
            )}
          >
            {/* Left accent bar on hover (non-danger) */}
            {!item.danger && (
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/item:scale-y-100 group-hover/item:opacity-100 group-hover/item:shadow-[0_0_8px_var(--color-accent)]" />
            )}
            
            <span className="flex-1 font-medium">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] font-bold tabular-nums text-[var(--color-text-tertiary)] opacity-40 uppercase tracking-tighter group-hover/item:opacity-70 transition-opacity">
                {item.shortcut}
              </span>
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
  | ActionMenuItem
  | { kind: 'submenu'; label: string; items: ActionMenuItem[]; disabled?: boolean }

type ActionMenuItem = {
  kind: 'item'
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  shortcut?: string
  icon?: string
}

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
  const ui = useUIStore.getState()
  const updateSettings = ui.updateSettings
  const projectId = useProjectsStore.getState().selectedProjectId
  const setArrangeMode = (mode: CanvasArrangeMode): void => {
    updateSettings({ canvasArrangeMode: mode })
    if (mode !== 'free') arrange(mode)
  }

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
    {
      kind: 'submenu',
      label: projectId ? '新建会话' : '新建会话（未选择项目）',
      disabled: !projectId,
      items: projectId ? SESSION_OPTIONS.map((option) => ({
        kind: 'item',
        label: option.label,
        icon: option.icon,
        onClick: () => createCanvasSession(projectId, option.type, state.worldX, state.worldY),
      })) : [],
    },
    { kind: 'separator' },
    { kind: 'item', label: '自由排列', onClick: () => setArrangeMode('free') },
    { kind: 'item', label: '网格排列', onClick: () => setArrangeMode('grid') },
    { kind: 'item', label: '横向排列', onClick: () => setArrangeMode('rowFlow') },
    { kind: 'item', label: '纵向排列', onClick: () => setArrangeMode('colFlow') },
    { kind: 'item', label: '紧凑打包', onClick: () => { updateSettings({ canvasArrangeMode: 'free' }); arrange('pack') } },
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

function createCanvasSession(projectId: string, type: SessionType, worldX: number, worldY: number): void {
  const worktreeId = getDefaultWorktreeIdForProject(projectId)
  const cardKind = type === 'terminal' ? 'terminal' : 'session'
  const cardSize = getDefaultCanvasCardSize(cardKind)

  createSessionWithPrompt({ projectId, type, worktreeId }, (sessionId) => {
    const paneStore = usePanesStore.getState()
    paneStore.addSessionToPane(paneStore.activePaneId, sessionId)

    useSessionsStore.getState().setActive(sessionId)
    const canvasStore = useCanvasStore.getState()
    const cardId = canvasStore.attachSession(sessionId, cardKind, {
      x: worldX - cardSize.width / 2,
      y: worldY - cardSize.height / 2,
    })
    requestAnimationFrame(() => useCanvasStore.getState().focusOnCard(cardId))
  })
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
