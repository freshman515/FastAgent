import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { DOCK_PANEL_IDS, type DockPanelId, type DockSide, useUIStore } from '@/stores/ui'
import { DOCK_PANEL_DEFINITIONS } from './dockPanels'
import { DockActionsContext } from './DockActions'

const TAB_BUTTON = 'flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] transition-colors'
const DRAG_MIME = 'application/x-fastagents-dock-panel'
const DRAG_TEXT_PREFIX = 'fastagents-dock-panel:'
const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]'
let draggingDockPanelId: DockPanelId | null = null

function isDockPanelId(value: unknown): value is DockPanelId {
  return typeof value === 'string' && DOCK_PANEL_IDS.includes(value as DockPanelId)
}

function readDragPanelId(event: React.DragEvent): DockPanelId | null {
  if (draggingDockPanelId) return draggingDockPanelId
  const raw = event.dataTransfer.getData(DRAG_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { panelId?: unknown }
      if (isDockPanelId(parsed.panelId)) return parsed.panelId
    } catch {
      // Ignore malformed payloads and continue with the plain-text fallback.
    }
  }

  const plainText = event.dataTransfer.getData('text/plain')
  if (!plainText.startsWith(DRAG_TEXT_PREFIX)) return null

  const panelId = plainText.slice(DRAG_TEXT_PREFIX.length)
  return isDockPanelId(panelId) ? panelId : null
}

function hasDockPanelDrag(event: React.DragEvent): boolean {
  return draggingDockPanelId !== null || event.dataTransfer.types.includes(DRAG_MIME)
}

export function DockPanel({ side }: { side: DockSide }): JSX.Element {
  const panelIds = useUIStore((s) => s.dockPanelOrder[side])
  const activeTab = useUIStore((s) => s.dockPanelActiveTab[side])
  const collapsed = useUIStore((s) => s.dockPanelCollapsed[side])
  const width = useUIStore((s) => s.dockPanelWidth[side])
  const toggle = useUIStore((s) => s.toggleDockPanel)
  const setTab = useUIStore((s) => s.setDockPanelTab)
  const setWidth = useUIStore((s) => s.setDockPanelWidth)
  const movePanel = useUIStore((s) => s.moveDockPanel)
  const resetDockPanels = useUIStore((s) => s.resetDockPanels)

  const isDragging = useRef(false)
  const [dropTarget, setDropTarget] = useState<{ panelId?: DockPanelId; position: 'before' | 'after' | 'append' } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; panelId?: DockPanelId } | null>(null)
  // Header action slot — populated on mount, consumed by child panels via
  // <DockActions>. We use state (not ref) so the Context consumer re-renders
  // once the DOM node is attached on first paint.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)

  const activePanelId = useMemo(() => {
    if (activeTab && panelIds.includes(activeTab)) return activeTab
    return panelIds[0] ?? null
  }, [activeTab, panelIds])

  const activePanel = activePanelId ? DOCK_PANEL_DEFINITIONS[activePanelId] : null
  const isAppendDropTarget = dropTarget?.position === 'append'

  const handleTabClick = useCallback((tabId: DockPanelId) => {
    if (activePanelId === tabId && !collapsed) {
      toggle(side)
      return
    }
    setTab(side, tabId)
  }, [activePanelId, collapsed, setTab, side, toggle])

  const handleResizeMouseDown = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const newWidth = side === 'left' ? e.clientX : window.innerWidth - e.clientX
      setWidth(side, newWidth)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [setWidth, side])

  const handleTabDragStart = useCallback((panelId: DockPanelId, event: React.DragEvent) => {
    draggingDockPanelId = panelId
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ panelId }))
    event.dataTransfer.setData('text/plain', `${DRAG_TEXT_PREFIX}${panelId}`)
  }, [])

  const handleTabDragOver = useCallback((targetPanelId: DockPanelId, event: React.DragEvent) => {
    if (!hasDockPanelDrag(event)) return
    const draggedPanelId = readDragPanelId(event)
    if (!draggedPanelId) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget({ panelId: targetPanelId, position })
  }, [])

  const handleTabDrop = useCallback((targetPanelId: DockPanelId, event: React.DragEvent) => {
    const draggedPanelId = readDragPanelId(event)
    if (!draggedPanelId) return
    event.preventDefault()
    event.stopPropagation()
    const position = dropTarget?.panelId === targetPanelId && dropTarget.position !== 'append'
      ? dropTarget.position
      : 'before'
    movePanel(draggedPanelId, side, targetPanelId, position)
    draggingDockPanelId = null
    setDropTarget(null)
  }, [dropTarget, movePanel, side])

  const handleStripDragOver = useCallback((event: React.DragEvent) => {
    if (!hasDockPanelDrag(event)) return
    const draggedPanelId = readDragPanelId(event)
    if (!draggedPanelId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget({ position: 'append' })
  }, [])

  const handleStripDrop = useCallback((event: React.DragEvent) => {
    const draggedPanelId = readDragPanelId(event)
    if (!draggedPanelId) return
    event.preventDefault()
    movePanel(draggedPanelId, side)
    draggingDockPanelId = null
    setDropTarget(null)
  }, [movePanel, side])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setDropTarget(null)
  }, [])

  const openContextMenu = useCallback((event: React.MouseEvent, panelId?: DockPanelId) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, panelId })
  }, [])

  const strip = (
    <div
      onDragOver={handleStripDragOver}
      onDrop={handleStripDrop}
      onDragLeave={handleDragLeave}
      onContextMenu={(event) => openContextMenu(event)}
      className={cn(
        'relative flex h-full w-10 shrink-0 flex-col items-center pt-3 pb-2 px-0 gap-1.5 transition-colors',
        isAppendDropTarget && 'bg-[var(--color-accent)]/12',
      )}
    >
      {isAppendDropTarget && (
        <div className="pointer-events-none absolute inset-x-1 inset-y-1 rounded-[var(--radius-md)] border border-dashed border-[var(--color-accent)]/55 bg-[var(--color-accent)]/8" />
      )}
      {panelIds.length === 0 && (
        <div className="mb-1 mt-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
          {side}
        </div>
      )}

      {panelIds.map((panelId) => {
        const panel = DOCK_PANEL_DEFINITIONS[panelId]
        const isDropBefore = dropTarget?.panelId === panelId && dropTarget.position === 'before'
        const isDropAfter = dropTarget?.panelId === panelId && dropTarget.position === 'after'
        return (
          <button
            key={panelId}
            draggable
            onDragStart={(event) => handleTabDragStart(panelId, event)}
            onDragEnd={() => {
              draggingDockPanelId = null
              setDropTarget(null)
            }}
            onDragOver={(event) => handleTabDragOver(panelId, event)}
            onDrop={(event) => handleTabDrop(panelId, event)}
            onContextMenu={(event) => openContextMenu(event, panelId)}
            onClick={() => handleTabClick(panelId)}
            className={cn(
              TAB_BUTTON,
              'relative z-[1]',
              activePanelId === panelId && !collapsed
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              (isDropBefore || isDropAfter) && 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
            )}
            title={panel.label}
          >
            {isDropBefore && (
              <>
                <span className="absolute -top-1.5 left-0 right-0 h-1 rounded-full bg-[var(--color-accent)]" />
                <span className="absolute -top-2.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[var(--color-bg-primary)] bg-[var(--color-accent)]" />
              </>
            )}
            {isDropAfter && (
              <>
                <span className="absolute -bottom-1.5 left-0 right-0 h-1 rounded-full bg-[var(--color-accent)]" />
                <span className="absolute -bottom-2.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[var(--color-bg-primary)] bg-[var(--color-accent)]" />
              </>
            )}
            <panel.icon size={20} />
          </button>
        )
      })}

      {panelIds.length === 0 && (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] px-2 py-4 text-center text-[10px] text-[var(--color-text-tertiary)] [writing-mode:vertical-rl]">
          拖放
        </div>
      )}
    </div>
  )

  if (collapsed || !activePanel) {
    return <div className="shrink-0 rounded-[var(--radius-panel)] overflow-hidden">{strip}</div>
  }

  const content = (
    <div
      className={cn(
        'relative flex flex-1 flex-col overflow-hidden transition-colors',
        isAppendDropTarget && 'bg-[var(--color-accent)]/5',
      )}
      onDragLeave={handleDragLeave}
      onContextMenu={(event) => openContextMenu(event, activePanelId ?? undefined)}
    >
      <div
        onDragOver={handleStripDragOver}
        onDrop={handleStripDrop}
        className="flex h-9 shrink-0 items-center gap-2 px-3 relative overflow-hidden"
        style={{
          background: 'linear-gradient(90deg, var(--color-accent-muted) 0%, transparent 75%)',
        }}
      >
        <activePanel.icon size={15} className="shrink-0 text-[var(--color-accent)]" />
        <span className="flex-1 truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)] tracking-tight">
          {activePanel.label}
        </span>
        <div ref={setActionsSlot} className="flex h-full shrink-0 items-center gap-1" />
      </div>
      <DockActionsContext.Provider value={actionsSlot}>
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden"
          onDragOver={handleStripDragOver}
          onDrop={handleStripDrop}
        >
          {activePanel.render()}
        </div>
      </DockActionsContext.Provider>
      {isAppendDropTarget && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-accent)]/60 bg-[var(--color-accent)]/7">
          <div className="rounded-full bg-[var(--color-bg-primary)]/92 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)] shadow-lg">
            拖放到{side === 'left' ? '左侧面板' : '右侧面板'}
          </div>
        </div>
      )}
    </div>
  )

  const resizeHandle = (
    <div
      onMouseDown={handleResizeMouseDown}
      className="group relative z-10 w-0 shrink-0 cursor-col-resize"
    >
      <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-[var(--color-accent)]/20" />
    </div>
  )

  return (
    <>
      <div
        className="flex h-full shrink-0 gap-[var(--layout-gap)] transition-colors"
        style={{ width }}
        onDragLeave={handleDragLeave}
      >
      {side === 'left' ? (
        <>
          <div className="shrink-0 rounded-[var(--radius-panel)] overflow-hidden">{strip}</div>
          <div className={cn(
            'flex flex-1 min-w-0 rounded-[var(--radius-panel)] overflow-hidden bg-[var(--color-bg-secondary)] transition-colors',
            isAppendDropTarget && 'bg-[var(--color-accent)]/6',
          )}>
            {content}
          </div>
          {resizeHandle}
        </>
      ) : (
        <>
          {resizeHandle}
          <div className={cn(
            'flex flex-1 min-w-0 rounded-[var(--radius-panel)] overflow-hidden bg-[var(--color-bg-secondary)] transition-colors',
            isAppendDropTarget && 'bg-[var(--color-accent)]/6',
          )}>
            {content}
          </div>
          <div className="shrink-0 rounded-[var(--radius-panel)] overflow-hidden">{strip}</div>
        </>
      )}
      </div>

      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setContextMenu(null)} />
          <div
            style={{
              top: Math.min(contextMenu.y, window.innerHeight - 140),
              left: Math.min(contextMenu.x, window.innerWidth - 180),
              zIndex: 9999,
            }}
            className="fixed min-w-[170px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-lg shadow-black/30"
          >
            {contextMenu.panelId && (
              <>
                <div className="px-3 py-1 text-[var(--ui-font-2xs)] font-medium uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                  {DOCK_PANEL_DEFINITIONS[contextMenu.panelId].label}
                </div>
                <button
                  onClick={() => {
                    movePanel(contextMenu.panelId!, 'left')
                    setContextMenu(null)
                  }}
                  disabled={side === 'left'}
                  className={cn(
                    MENU_ITEM,
                    side === 'left' && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <PanelLeftOpen size={13} /> 移到左侧
                </button>
                <button
                  onClick={() => {
                    movePanel(contextMenu.panelId!, 'right')
                    setContextMenu(null)
                  }}
                  disabled={side === 'right'}
                  className={cn(
                    MENU_ITEM,
                    side === 'right' && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <PanelRightOpen size={13} /> 移到右侧
                </button>
                <div className="my-0.5 h-px bg-[var(--color-border)]" />
              </>
            )}
            <button
              onClick={() => {
                resetDockPanels()
                setContextMenu(null)
              }}
              className={MENU_ITEM}
            >
              <RotateCcw size={13} /> 重置默认布局
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
