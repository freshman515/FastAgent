import { FileText, Minimize2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useMemo, useState } from 'react'
import { SESSION_TYPE_CONFIG } from '@shared/types'
import { cn } from '@/lib/utils'
import { getSessionIcon } from '@/lib/sessionIcon'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { FILE_ICONS, useEditorsStore } from '@/stores/editors'
import { getPaneLeafIds, usePanesStore, type PaneNode } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { PaneView } from './PaneView'
import { ResizeHandle } from './ResizeHandle'

interface SplitContainerProps {
  node: PaneNode
  projectId: string
  framed?: boolean
}

function SplitNodeRenderer({ node, projectId, framed = false }: SplitContainerProps): JSX.Element {
  if (node.type === 'leaf') {
    const pane = <PaneView paneId={node.id} projectId={projectId} />
    if (framed) return pane
    return (
      <div className="h-full w-full overflow-hidden rounded-[var(--radius-panel)]">
        {pane}
      </div>
    )
  }

  const { direction, ratio, first, second } = node
  const isHorizontal = direction === 'horizontal'

  return (
    <div
      className="flex h-full w-full bg-[var(--color-titlebar-bg)]"
      style={{ flexDirection: isHorizontal ? 'row' : 'column' }}
    >
      <div className="rounded-[var(--radius-panel)] overflow-hidden" style={{ flex: `0 0 ${ratio * 100}%`, minWidth: 0, minHeight: 0 }}>
        <SplitNodeRenderer node={first} projectId={projectId} framed />
      </div>
      <ResizeHandle splitId={node.id} direction={direction} currentRatio={ratio} />
      <div className="rounded-[var(--radius-panel)] overflow-hidden" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <SplitNodeRenderer node={second} projectId={projectId} framed />
      </div>
    </div>
  )
}

function findLeaf(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'leaf') return node.id === paneId ? node : null
  return findLeaf(node.first, paneId) ?? findLeaf(node.second, paneId)
}

interface FocusStripItem {
  paneId: string
  index: number
  activeTabId: string | null
  label: string
  detail: string
  badge?: string
  color?: string
  iconSrc?: string
  status?: string
  kind: 'session' | 'editor' | 'empty'
  tabCount: number
}

const FOCUS_MENU_ITEM = 'flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]'
const FOCUS_MENU_ITEM_DISABLED = `${FOCUS_MENU_ITEM} cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--color-text-secondary)]`

function getStatusDotClass(status?: string): string {
  if (status === 'running') return 'bg-[var(--color-success)]'
  if (status === 'waiting-input') return 'bg-[var(--color-warning)]'
  if (status === 'idle') return 'bg-[var(--color-accent)]'
  return 'bg-[var(--color-text-tertiary)]'
}

function FocusStrip({
  items,
  activePaneId,
  onSelectPane,
  onRestore,
  onOpenMenu,
}: {
  items: FocusStripItem[]
  activePaneId: string
  onSelectPane: (item: FocusStripItem) => void
  onRestore: () => void
  onOpenMenu: (item: FocusStripItem, x: number, y: number) => void
}): JSX.Element {
  return (
    <aside
      className={cn(
        'flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-[var(--color-border)]',
        'bg-[var(--color-bg-secondary)] px-1 py-1.5 scrollbar-none',
      )}
      aria-label="分屏切换"
    >
      <button
        type="button"
        onClick={onRestore}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)]',
          'text-[var(--color-text-tertiary)] transition-all duration-120',
          'hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-accent)] active:scale-95',
        )}
        title="恢复分屏布局"
        aria-label="恢复分屏布局"
      >
        <Minimize2 size={13} />
      </button>

      <div className="my-0.5 h-px w-6 bg-[var(--color-border)]" />

      {items.map((item) => {
        const active = item.paneId === activePaneId
        return (
          <button
            key={item.paneId}
            type="button"
            onClick={() => onSelectPane(item)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onOpenMenu(item, event.clientX, event.clientY)
            }}
            className={cn(
              'group relative flex h-11 w-8 shrink-0 flex-col items-center justify-center rounded-[var(--radius-sm)] border pb-1',
              'transition-all duration-120 active:scale-95',
              active
                ? 'border-transparent text-[var(--color-text-primary)]'
                : 'border-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
            )}
            title={`Pane ${item.index + 1}: ${item.label} (${item.detail})`}
            aria-label={`切换到 Pane ${item.index + 1}: ${item.label}`}
          >
            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--color-accent)] opacity-0 transition-opacity group-hover:opacity-60" />
            {active && <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-[var(--color-accent)]" />}
            <span className="relative flex h-5 w-5 items-center justify-center text-[10px] font-semibold leading-none">
              {item.iconSrc ? (
                <img
                  src={item.iconSrc}
                  alt=""
                  className="h-[17px] w-[17px] object-contain"
                  draggable={false}
                />
              ) : item.kind === 'editor' ? (
                <FileText size={12} />
              ) : (
                item.index + 1
              )}
            </span>
            {item.badge && (
              <span className="relative mt-0.5 max-w-7 truncate text-[8px] font-semibold leading-none" style={{ color: item.color }}>
                {item.badge}
              </span>
            )}
            {item.kind === 'session' && (
              <span className={cn('absolute right-1 top-1 h-1.5 w-1.5 rounded-full', getStatusDotClass(item.status))} />
            )}
            {item.tabCount > 1 && (
              <span className="absolute bottom-1 right-0.5 text-[9px] font-semibold leading-none text-[var(--color-text-tertiary)]">
                {item.tabCount}
              </span>
            )}
          </button>
        )
      })}
    </aside>
  )
}

function FocusStripContextMenu({
  item,
  position,
  activePaneId,
  activeTabId,
  canClosePane,
  onClose,
  onSelectPane,
  onRestore,
  onMoveActiveTab,
  onClosePane,
  onMergeAll,
}: {
  item: FocusStripItem
  position: { x: number; y: number }
  activePaneId: string
  activeTabId: string | null
  canClosePane: boolean
  onClose: () => void
  onSelectPane: (item: FocusStripItem) => void
  onRestore: () => void
  onMoveActiveTab: (paneId: string) => void
  onClosePane: (paneId: string) => void
  onMergeAll: () => void
}): JSX.Element {
  const canMoveActiveTab = Boolean(activeTabId && item.paneId !== activePaneId)

  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={onClose} />
      <div
        style={{ top: position.y, left: position.x, zIndex: 9999 }}
        className="fixed min-w-[180px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-lg shadow-black/30"
      >
        <div className="border-b border-[var(--color-border)] px-3 py-1.5">
          <p className="truncate text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
            Pane {item.index + 1} · {item.label}
          </p>
        </div>
        <button
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            onSelectPane(item)
            onClose()
          }}
        >
          切换到这个 pane
        </button>
        <button
          className={canMoveActiveTab ? FOCUS_MENU_ITEM : FOCUS_MENU_ITEM_DISABLED}
          disabled={!canMoveActiveTab}
          onClick={() => {
            if (!canMoveActiveTab) return
            onMoveActiveTab(item.paneId)
            onClose()
          }}
        >
          把当前 tab 移到这里
        </button>
        <div className="my-0.5 border-t border-[var(--color-border)]" />
        <button
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            onRestore()
            onClose()
          }}
        >
          恢复分屏布局
        </button>
        <button
          className={FOCUS_MENU_ITEM}
          onClick={() => {
            onMergeAll()
            onClose()
          }}
        >
          合并全部 pane
        </button>
        <button
          className={canClosePane ? `${FOCUS_MENU_ITEM} text-[var(--color-error)] hover:text-[var(--color-error)]` : FOCUS_MENU_ITEM_DISABLED}
          disabled={!canClosePane}
          onClick={() => {
            if (!canClosePane) return
            onClosePane(item.paneId)
            onClose()
          }}
        >
          关闭这个 pane
        </button>
      </div>
    </>,
    document.body,
  )
}

interface Props {
  projectId: string
}

export function SplitContainer({ projectId }: Props): JSX.Element {
  const root = usePanesStore((s) => s.root)
  const fullscreenPaneId = usePanesStore((s) => s.fullscreenPaneId)
  const paneSessions = usePanesStore((s) => s.paneSessions)
  const paneActiveSession = usePanesStore((s) => s.paneActiveSession)
  const setActivePaneId = usePanesStore((s) => s.setActivePaneId)
  const exitPaneFullscreen = usePanesStore((s) => s.exitPaneFullscreen)
  const mergePane = usePanesStore((s) => s.mergePane)
  const mergeAllPanes = usePanesStore((s) => s.mergeAllPanes)
  const sessions = useSessionsStore((s) => s.sessions)
  const setActiveSession = useSessionsStore((s) => s.setActive)
  const editorTabs = useEditorsStore((s) => s.tabs)
  const isDarkTheme = useIsDarkTheme()
  const [focusMenu, setFocusMenu] = useState<{ item: FocusStripItem; position: { x: number; y: number } } | null>(null)
  const leafIds = useMemo(() => getPaneLeafIds(root), [root])
  const focusStripItems = useMemo<FocusStripItem[]>(() => {
    return leafIds.map((paneId, index) => {
      const tabIds = paneSessions[paneId] ?? []
      const activeTabId = paneActiveSession[paneId] && tabIds.includes(paneActiveSession[paneId]!)
        ? paneActiveSession[paneId]
        : (tabIds[0] ?? null)

      if (!activeTabId) {
        return {
          paneId,
          index,
          activeTabId: null,
          label: '空白',
          detail: '0 tabs',
          kind: 'empty',
          tabCount: 0,
        }
      }

      if (activeTabId.startsWith('editor-')) {
        const tab = editorTabs.find((item) => item.id === activeTabId)
        const icon = tab ? FILE_ICONS[tab.language] ?? FILE_ICONS.plaintext : FILE_ICONS.plaintext
        return {
          paneId,
          index,
          activeTabId,
          label: tab?.fileName ?? '文件',
          detail: tabIds.length === 1 ? '1 tab' : `${tabIds.length} tabs`,
          badge: icon.icon,
          color: icon.color,
          kind: 'editor',
          tabCount: tabIds.length,
        }
      }

      const session = sessions.find((item) => item.id === activeTabId)
      return {
        paneId,
        index,
        activeTabId,
        label: session?.name ?? 'Session',
        detail: session ? SESSION_TYPE_CONFIG[session.type].label : 'Session',
        iconSrc: session ? getSessionIcon(session.type, isDarkTheme) : undefined,
        status: session?.status,
        kind: 'session',
        tabCount: tabIds.length,
      }
    })
  }, [editorTabs, isDarkTheme, leafIds, paneActiveSession, paneSessions, sessions])
  const selectFocusItem = useCallback((item: FocusStripItem) => {
    setActivePaneId(item.paneId)
    if (item.activeTabId && !item.activeTabId.startsWith('editor-')) {
      setActiveSession(item.activeTabId)
    }
  }, [setActivePaneId, setActiveSession])
  const moveActiveTabToPane = useCallback((targetPaneId: string) => {
    const state = usePanesStore.getState()
    const sourcePaneId = state.fullscreenPaneId ?? state.activePaneId
    const sourcePaneSessions = state.paneSessions[sourcePaneId] ?? []
    const activeTabId = state.paneActiveSession[sourcePaneId] && sourcePaneSessions.includes(state.paneActiveSession[sourcePaneId]!)
      ? state.paneActiveSession[sourcePaneId]
      : (sourcePaneSessions[0] ?? null)
    if (!activeTabId || sourcePaneId === targetPaneId) return

    state.moveSession(sourcePaneId, targetPaneId, activeTabId)
    state.setPaneActiveSession(targetPaneId, activeTabId)
    if (!activeTabId.startsWith('editor-')) {
      useSessionsStore.getState().setActive(activeTabId)
    }
  }, [])

  if (fullscreenPaneId) {
    const fullscreenLeaf = findLeaf(root, fullscreenPaneId)
    if (fullscreenLeaf?.type === 'leaf') {
      const fullscreenActiveTabId = paneActiveSession[fullscreenLeaf.id] ?? paneSessions[fullscreenLeaf.id]?.[0] ?? null

      return (
        <div className="flex h-full w-full overflow-hidden bg-[var(--color-titlebar-bg)]">
          {leafIds.length > 1 && (
            <FocusStrip
              items={focusStripItems}
              activePaneId={fullscreenLeaf.id}
              onRestore={exitPaneFullscreen}
              onSelectPane={selectFocusItem}
              onOpenMenu={(item, x, y) => setFocusMenu({ item, position: { x, y } })}
            />
          )}
          <div className="min-w-0 flex-1 overflow-hidden">
            <PaneView paneId={fullscreenLeaf.id} projectId={projectId} />
          </div>
          {focusMenu && (
            <FocusStripContextMenu
              item={focusMenu.item}
              position={focusMenu.position}
              activePaneId={fullscreenLeaf.id}
              activeTabId={fullscreenActiveTabId}
              canClosePane={leafIds.length > 1}
              onClose={() => setFocusMenu(null)}
              onSelectPane={selectFocusItem}
              onRestore={exitPaneFullscreen}
              onMoveActiveTab={moveActiveTabToPane}
              onClosePane={mergePane}
              onMergeAll={mergeAllPanes}
            />
          )}
        </div>
      )
    }
  }

  return <SplitNodeRenderer node={root} projectId={projectId} />
}
