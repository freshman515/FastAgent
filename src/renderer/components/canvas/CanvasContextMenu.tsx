import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { CanvasCard, SessionType } from '@shared/types'
import { cn } from '@/lib/utils'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { createSessionWithPrompt } from '@/lib/createSession'
import { getDefaultCanvasCardSize, useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore, type CanvasArrangeMode } from '@/stores/ui'
import { buildNewSessionOptions } from '@/components/session/NewSessionMenu'
import { SessionIconView } from '@/components/session/SessionIconView'
import { FRAME_COLORS } from './cards/FrameCard'

const SUBMENU_WIDTH = 220
const MENU_MARGIN = 8

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
  onRenameFrame?: (cardId: string) => void
  onSearchFrame?: (cardId: string) => void
}

export function CanvasContextMenu({ state, onClose, onRenameFrame, onSearchFrame }: CanvasContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null)
  const [submenuAnchorRect, setSubmenuAnchorRect] = useState<DOMRect | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: state.screenX, top: state.screenY })
  const [submenuDirection, setSubmenuDirection] = useState<'right' | 'left'>('right')
  const items = useMemo(() => buildMenuItems(state, onClose, onRenameFrame, onSearchFrame), [state, onClose, onRenameFrame, onSearchFrame])

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!menuRef.current) return
      if (menuRef.current.contains(event.target as Node)) return
      if (submenuRef.current?.contains(event.target as Node)) return
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
      const rect = menu.getBoundingClientRect()
      const left = Math.min(Math.max(MENU_MARGIN, state.screenX), Math.max(MENU_MARGIN, window.innerWidth - rect.width - MENU_MARGIN))
      const top = Math.min(Math.max(MENU_MARGIN, state.screenY), Math.max(MENU_MARGIN, window.innerHeight - rect.height - MENU_MARGIN))
      setMenuPosition((current) => current.left === left && current.top === top ? current : { left, top })
      setSubmenuDirection(left + rect.width + SUBMENU_WIDTH + MENU_MARGIN > window.innerWidth ? 'left' : 'right')
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
            onMouseEnter={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setOpenSubmenuIndex(index)
              setSubmenuAnchorRect(rect)
              setSubmenuDirection(rect.right + SUBMENU_WIDTH + MENU_MARGIN > window.innerWidth ? 'left' : 'right')
            }}
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
            {openSubmenuIndex === index && !item.disabled && submenuAnchorRect && createPortal(
              <div
                ref={submenuRef}
                className={cn(
                  'fixed z-[401] min-w-[220px] overflow-y-auto rounded-[var(--radius-lg)] border border-white/[0.08] bg-[var(--color-bg-secondary)]/95 backdrop-blur-3xl p-1 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-200',
                )}
                style={getSubmenuStyle(submenuAnchorRect, item.items.length, submenuDirection)}
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
                      <SessionIconView
                        icon={child.customIcon ? child.icon : undefined}
                        fallbackSrc={child.customIcon ? undefined : child.icon}
                        className="transition-transform duration-200 group-hover/subitem:scale-110"
                      />
                    )}
                    <span className="flex-1 font-medium">{child.label}</span>
                    {child.shortcut && (
                      <span className="text-[10px] font-bold tabular-nums text-[var(--color-text-tertiary)] opacity-45 uppercase tracking-tighter group-hover/subitem:opacity-75 transition-opacity">
                        {child.shortcut}
                      </span>
                    )}
                  </button>
                ))}
              </div>,
              document.body,
            )}
          </div>
        ) : (
          <button
            key={index}
            type="button"
            disabled={item.disabled}
            onMouseEnter={() => {
              setOpenSubmenuIndex(null)
              setSubmenuAnchorRect(null)
            }}
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
  customIcon?: boolean
}

function getSubmenuStyle(
  anchorRect: DOMRect,
  itemCount: number,
  direction: 'right' | 'left',
): CSSProperties {
  const estimatedHeight = Math.min(window.innerHeight - MENU_MARGIN * 2, itemCount * 36 + 8)
  const top = Math.min(
    Math.max(MENU_MARGIN, anchorRect.top),
    Math.max(MENU_MARGIN, window.innerHeight - estimatedHeight - MENU_MARGIN),
  )
  const left = direction === 'right'
    ? Math.min(anchorRect.right + 6, window.innerWidth - SUBMENU_WIDTH - MENU_MARGIN)
    : Math.max(MENU_MARGIN, anchorRect.left - SUBMENU_WIDTH - 6)

  return {
    left,
    top,
    width: SUBMENU_WIDTH,
    maxHeight: window.innerHeight - MENU_MARGIN * 2,
  }
}

function buildMenuItems(
  state: CanvasContextMenuState,
  onClose: () => void,
  onRenameFrame?: (cardId: string) => void,
  onSearchFrame?: (cardId: string) => void,
): MenuItem[] {
  if (state.target === 'canvas') {
    return buildCanvasItems(state, onClose)
  }
  return buildCardItems(state, onClose, onRenameFrame, onSearchFrame)
}

function buildCanvasItems(
  state: Extract<CanvasContextMenuState, { target: 'canvas' }>,
  _onClose: () => void,
): MenuItem[] {
  const addCard = useCanvasStore.getState().addCard
  const addFrameAroundCards = useCanvasStore.getState().addFrameAroundCards
  const fitAll = useCanvasStore.getState().fitAll
  const arrange = useCanvasStore.getState().arrange
  const addLayoutSnapshot = useCanvasStore.getState().addLayoutSnapshot
  const restoreLayoutSnapshot = useCanvasStore.getState().restoreLayoutSnapshot
  const snapshots = useCanvasStore.getState().getLayout().snapshots
  const hiddenCount = useCanvasStore.getState().getLayout().cards.filter((card) => card.hidden).length
  const ui = useUIStore.getState()
  const settings = ui.settings
  const updateSettings = ui.updateSettings
  const projectId = useProjectsStore.getState().selectedProjectId
  const newSessionOptions = projectId
    ? buildNewSessionOptions(settings.customSessionDefinitions, settings.hiddenNewSessionOptionIds, settings.newSessionOptionOrder)
    : []
  const setArrangeMode = (mode: CanvasArrangeMode): void => {
    updateSettings({ canvasArrangeMode: mode })
    if (mode !== 'free') arrange(mode)
  }
  const noteSize = getDefaultCanvasCardSize('note')

  return [
    {
      kind: 'item',
      label: '在此处新建便签',
      onClick: () => addCard({
        kind: 'note',
        x: state.worldX - noteSize.width / 2,
        y: state.worldY - noteSize.height / 2,
        noteBody: '',
        noteColor: 'yellow',
      }),
    },
    {
      kind: 'item',
      label: '在此处新建分组框',
      onClick: () => addFrameAroundCards([], { x: state.worldX, y: state.worldY }),
    },
    {
      kind: 'submenu',
      label: !projectId
        ? '新建会话（未选择项目）'
        : newSessionOptions.length > 0 ? '新建会话' : '新建会话（无可显示项）',
      disabled: !projectId || newSessionOptions.length === 0,
      items: newSessionOptions.map((option) => ({
        kind: 'item',
        label: option.label,
        icon: option.icon,
        customIcon: Boolean(option.customSessionDefinitionId),
        onClick: () => {
          if (!projectId) return
          createCanvasSession(projectId, option.type, state.worldX, state.worldY, option.customSessionDefinitionId)
        },
      })),
    },
    { kind: 'separator' },
    { kind: 'item', label: '自由排列', onClick: () => setArrangeMode('free') },
    { kind: 'item', label: '网格排列', onClick: () => setArrangeMode('grid') },
    { kind: 'item', label: '横向排列', onClick: () => setArrangeMode('rowFlow') },
    { kind: 'item', label: '纵向排列', onClick: () => setArrangeMode('colFlow') },
    { kind: 'item', label: '紧凑打包', onClick: () => { updateSettings({ canvasArrangeMode: 'free' }); arrange('pack') } },
    { kind: 'separator' },
    { kind: 'item', label: '保存布局快照', onClick: () => addLayoutSnapshot() },
    ...(snapshots.length > 0 ? [{
      kind: 'submenu' as const,
      label: '恢复布局快照',
      items: snapshots.slice(-8).reverse().map((snapshot) => ({
        kind: 'item' as const,
        label: snapshot.name,
        onClick: () => restoreLayoutSnapshot(snapshot.id),
      })),
    }] : []),
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
    ...(hiddenCount > 0 ? [{ kind: 'item' as const, label: `显示全部内容 (${hiddenCount})`, onClick: () => useCanvasStore.getState().showAllCards() }] : []),
  ]
}

function createCanvasSession(projectId: string, type: SessionType | undefined, worldX: number, worldY: number, customSessionDefinitionId?: string): void {
  const worktreeId = getDefaultWorktreeIdForProject(projectId)
  const cardKind = type === 'terminal' || type === 'terminal-wsl' || customSessionDefinitionId ? 'terminal' : 'session'
  const cardSize = getDefaultCanvasCardSize(cardKind)

  createSessionWithPrompt({ projectId, type, customSessionDefinitionId, worktreeId }, (sessionId) => {
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
  onRenameFrame?: (cardId: string) => void,
  onSearchFrame?: (cardId: string) => void,
): MenuItem[] {
  const store = useCanvasStore.getState()
  const card = store.getCard(state.cardId)
  if (!card) return []

  const selection = store.selectedCardIds
  const selectedCount = selection.length
  const multiSelected = selectedCount > 1 && selection.includes(state.cardId)
  const targetIds = multiSelected ? selection : [state.cardId]
  const targetCards = targetIds
    .map((id) => store.getCard(id))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))

  const items: MenuItem[] = []
  items.push({
    kind: 'item',
    label: card.favorite ? '取消收藏' : '收藏卡片',
    onClick: () => store.toggleCardFavorite(state.cardId),
  })
  items.push({
    kind: 'item',
    label: '保存卡片快照',
    onClick: () => store.addCardSnapshot(state.cardId),
  })
  if ((card.cardSnapshots?.length ?? 0) > 0) {
    items.push({
      kind: 'submenu',
      label: '恢复卡片快照',
      items: card.cardSnapshots!.slice(-8).reverse().map((snapshot) => ({
        kind: 'item' as const,
        label: snapshot.name,
        onClick: () => store.restoreCardSnapshot(state.cardId, snapshot.id),
      })),
    })
  }
  items.push({ kind: 'item', label: '置顶', onClick: () => store.bringToFront(state.cardId) })

  const relationsForTargets = store.getLayout().relations.filter((relation) =>
    targetIds.includes(relation.fromCardId) || targetIds.includes(relation.toCardId),
  )

  if (card.kind === 'note') {
    items.push({
      kind: 'item',
      label: '克隆',
      shortcut: 'Ctrl+D',
      onClick: () => store.duplicateCards(targetIds),
    })
  }

  if (card.kind === 'session' || card.kind === 'terminal') {
    items.push({
      kind: 'item',
      label: card.collapsed ? '展开预览' : '折叠为预览',
      onClick: () => store.setCardCollapsed(card.id, !card.collapsed),
    })
  }

  if (card.kind === 'frame') {
    const memberIds = card.frameMemberIds ?? []
    const memberCards = memberIds
      .map((id) => store.getCard(id))
      .filter((candidate): candidate is CanvasCard => Boolean(candidate))
    const visibleMemberCount = memberCards.filter((member) => !member.hidden).length
    const frameTitle = card.frameTitle?.trim() || '分组'
    const frameSnapshots = card.frameSnapshots ?? []
    items.push({
      kind: 'item',
      label: '聚焦分组',
      onClick: () => store.focusFrameWorkspace(card.id),
    })
    items.push({
      kind: 'item',
      label: '搜索组内',
      disabled: memberIds.length === 0,
      onClick: () => onSearchFrame?.(card.id),
    })
    items.push({
      kind: 'submenu',
      label: '整理组内卡片',
      disabled: memberIds.length === 0,
      items: [
        { kind: 'item' as const, label: '网格排列', onClick: () => store.arrange('grid', memberIds) },
        { kind: 'item' as const, label: '横向排列', onClick: () => store.arrange('rowFlow', memberIds) },
        { kind: 'item' as const, label: '纵向排列', onClick: () => store.arrange('colFlow', memberIds) },
        { kind: 'item' as const, label: '紧凑打包', onClick: () => store.arrange('pack', memberIds) },
      ],
    })
    items.push({
      kind: 'item',
      label: '隐藏其他分组',
      onClick: () => store.hideAllExceptFrame(card.id),
    })
    items.push({
      kind: 'item',
      label: visibleMemberCount > 0 ? '隐藏组内卡片' : '显示组内卡片',
      disabled: memberIds.length === 0,
      onClick: () => store.setFrameMembersHidden(card.id, visibleMemberCount > 0),
    })
    items.push({
      kind: 'item',
      label: '保存分组书签',
      onClick: () => store.addBookmarkForCard(card.id, frameTitle),
    })
    items.push({
      kind: 'item',
      label: '保存分组快照',
      onClick: () => store.addFrameSnapshot(card.id, `${frameTitle} 快照`),
    })
    if (frameSnapshots.length > 0) {
      items.push({
        kind: 'submenu',
        label: '恢复分组快照',
        items: frameSnapshots.slice(-8).reverse().map((snapshot) => ({
          kind: 'item' as const,
          label: snapshot.name,
          onClick: () => store.restoreFrameSnapshot(card.id, snapshot.id),
        })),
      })
    }
    items.push({
      kind: 'submenu',
      label: '分组颜色',
      items: Object.entries(FRAME_COLORS).map(([key, value]) => ({
        kind: 'item' as const,
        label: value.label,
        shortcut: (card.frameColor ?? 'violet') === key ? '当前' : undefined,
        onClick: () => store.updateCard(card.id, { frameColor: key }),
      })),
    })
    items.push({
      kind: 'item',
      label: '重命名分组',
      onClick: () => onRenameFrame?.(card.id),
    })
    items.push({
      kind: 'item',
      label: card.collapsed ? '展开分组' : '折叠分组',
      disabled: (card.frameMemberIds?.length ?? 0) === 0,
      onClick: () => store.toggleFrameCollapsed(card.id),
    })
  }

  if (multiSelected) {
    items.push({ kind: 'separator' })
    if (targetIds.length === 2) {
      items.push({ kind: 'item', label: '连接选中卡片', onClick: () => store.addRelation(targetIds[0], targetIds[1]) })
    }
    items.push({ kind: 'item', label: '快速分组', onClick: () => store.addFrameAroundCards(targetIds) })
    items.push({
      kind: 'item',
      label: '快速分组并折叠',
      onClick: () => {
        const frameId = store.addFrameAroundCards(targetIds)
        if (frameId) useCanvasStore.getState().toggleFrameCollapsed(frameId)
      },
    })
    if (relationsForTargets.length > 0) {
      items.push({ kind: 'item', label: '移除相关连线', onClick: () => store.removeRelationsForCards(targetIds) })
    }
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
    items.push({
      kind: 'submenu',
      label: '调整卡片大小为',
      items: [
        {
          kind: 'item' as const,
          label: '宽度最宽',
          shortcut: `${Math.round(Math.max(...targetCards.map((targetCard) => targetCard.width)))}px`,
          onClick: () => resizeSelectionDimension(targetIds, 'width'),
        },
        {
          kind: 'item' as const,
          label: '高度最高',
          shortcut: `${Math.round(Math.max(...targetCards.map((targetCard) => targetCard.height)))}px`,
          onClick: () => resizeSelectionDimension(targetIds, 'height'),
        },
        ...targetCards.map((sourceCard, index) => ({
          kind: 'item' as const,
          label: `${index + 1}. ${getCardSizeLabel(sourceCard)}`,
          shortcut: `${Math.round(sourceCard.width)}x${Math.round(sourceCard.height)}`,
          onClick: () => resizeSelectionToCard(targetIds, sourceCard.id),
        })),
      ],
    })
  }

  items.push({ kind: 'separator' })
  if (!multiSelected && relationsForTargets.length > 0) {
    items.push({
      kind: 'item',
      label: '移除相关连线',
      onClick: () => store.removeRelationsForCards([state.cardId]),
    })
  }

  const removableFrames = targetIds.filter((id) => store.getCard(id)?.kind === 'frame')
  if (removableFrames.length > 0) {
    items.push({
      kind: 'item',
      label: multiSelected ? `删除选中分组 (${removableFrames.length})` : '删除分组',
      shortcut: 'Del',
      danger: true,
      onClick: () => store.removeCards(removableFrames),
    })
  }

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

function resizeSelectionToCard(targetIds: string[], sourceCardId: string): void {
  const store = useCanvasStore.getState()
  const sourceCard = store.getCard(sourceCardId)
  if (!sourceCard) return

  const geometry = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const id of targetIds) {
    const card = store.getCard(id)
    if (!card) continue
    geometry.set(id, {
      x: card.x,
      y: card.y,
      width: sourceCard.width,
      height: sourceCard.height,
    })
  }
  store.updateCardsGeometry(geometry)
}

function resizeSelectionDimension(targetIds: string[], dimension: 'width' | 'height'): void {
  const store = useCanvasStore.getState()
  const cards = targetIds
    .map((id) => store.getCard(id))
    .filter((candidate): candidate is CanvasCard => Boolean(candidate))
  if (cards.length === 0) return

  const targetValue = Math.max(...cards.map((card) => card[dimension]))
  const geometry = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const card of cards) {
    geometry.set(card.id, {
      x: card.x,
      y: card.y,
      width: dimension === 'width' ? targetValue : card.width,
      height: dimension === 'height' ? targetValue : card.height,
    })
  }
  store.updateCardsGeometry(geometry)
}

function getCardSizeLabel(card: CanvasCard): string {
  if (card.kind === 'session' || card.kind === 'terminal') {
    const session = card.refId
      ? useSessionsStore.getState().sessions.find((candidate) => candidate.id === card.refId)
      : null
    return session?.name ?? (card.kind === 'terminal' ? 'Terminal' : 'Session')
  }
  if (card.kind === 'frame') {
    return card.frameTitle?.trim() || '分组'
  }
  const noteText = card.noteBody?.trim().replace(/\s+/g, ' ')
  return noteText ? `便签 · ${noteText.slice(0, 14)}` : '便签'
}
