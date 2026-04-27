import { GitBranch, List, Maximize2, Minimize2, Minus, MoreHorizontal, Plus, Square, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { usePanesStore, registerPaneElement, getPaneLeafIds, type PaneNode, type SplitPosition } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useEditorsStore, FILE_ICONS } from '@/stores/editors'
import { useGitStore } from '@/stores/git'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SessionTab } from '@/components/session/SessionTab'
import { NewSessionMenu } from '@/components/session/NewSessionMenu'
import { TerminalView } from '@/components/session/TerminalView'
import { BrowserSessionView } from '@/components/session/BrowserSessionView'
import { EditorView } from '@/components/session/EditorView'
import { EmptyState } from '@/components/session/EmptyState'
import { ClaudeCodePanel } from '@/components/rightpanel/ClaudeCodePanel'

interface PaneViewProps {
  paneId: string
  projectId: string
}

interface WindowDragState {
  startMouseX: number
  startMouseY: number
  startWindowX: number
  startWindowY: number
  pendingX: number
  pendingY: number
  frameId: number | null
  handleMouseMove: (event: MouseEvent) => void
  handleMouseUp: () => void
}

const isDetached = window.api.detach.isDetached

function isTabDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('session-tab-id') || e.dataTransfer.types.includes('session-tab-drag-token')
}

type EditorTabItem = ReturnType<typeof useEditorsStore.getState>['tabs'][number]
type PaneTabItem =
  | { kind: 'session'; id: string; session: ReturnType<typeof useSessionsStore.getState>['sessions'][number] }
  | { kind: 'editor'; id: string; tab: EditorTabItem }
type DetachedTabDragPayload =
  | { kind: 'session'; session: ReturnType<typeof useSessionsStore.getState>['sessions'][number]; sourcePaneId: string; sourceWindowId: string }
  | { kind: 'editor'; editor: EditorTabItem; sourcePaneId: string; sourceWindowId: string }

const MENU_ITEM = 'flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]'
const MENU_ITEM_DISABLED = `${MENU_ITEM} cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--color-text-secondary)]`
const PANE_ACTION_MENU_ITEM = 'flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]'
const PANE_ACTION_MENU_ITEM_DISABLED = `${PANE_ACTION_MENU_ITEM} cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--color-text-secondary)]`
const FILE_TAB_SPLIT_OPTIONS: Array<{ position: SplitPosition; label: string }> = [
  { position: 'right', label: '向右分屏' },
  { position: 'down', label: '向下分屏' },
  { position: 'left', label: '向左分屏' },
  { position: 'up', label: '向上分屏' },
]

type DropZone = SplitPosition | 'center'

const DROP_ZONE_EDGE_RATIO = 0.25
const DROP_ZONE_COPY: Record<DropZone, { label: string; hint: string }> = {
  left: { label: '拆到左侧新 pane', hint: '松开后创建左右分屏' },
  right: { label: '拆到右侧新 pane', hint: '松开后创建左右分屏' },
  up: { label: '拆到上方新 pane', hint: '松开后创建上下分屏' },
  down: { label: '拆到下方新 pane', hint: '松开后创建上下分屏' },
  center: { label: '移入此 pane', hint: '松开后作为标签加入当前 pane' },
}

function getDropZoneFromPointer(clientX: number, clientY: number, rect: DOMRect): DropZone {
  const x = (clientX - rect.left) / rect.width
  const y = (clientY - rect.top) / rect.height
  const candidates: Array<{ zone: SplitPosition; distance: number }> = []

  if (x < DROP_ZONE_EDGE_RATIO) candidates.push({ zone: 'left', distance: x })
  if (x > 1 - DROP_ZONE_EDGE_RATIO) candidates.push({ zone: 'right', distance: 1 - x })
  if (y < DROP_ZONE_EDGE_RATIO) candidates.push({ zone: 'up', distance: y })
  if (y > 1 - DROP_ZONE_EDGE_RATIO) candidates.push({ zone: 'down', distance: 1 - y })

  if (candidates.length === 0) return 'center'
  candidates.sort((a, b) => a.distance - b.distance)
  return candidates[0].zone
}

function getDropPreviewStyle(zone: DropZone): CSSProperties {
  if (zone === 'left') return { left: 0, top: 0, width: '50%', height: '100%' }
  if (zone === 'right') return { right: 0, top: 0, width: '50%', height: '100%' }
  if (zone === 'up') return { left: 0, top: 0, width: '100%', height: '50%' }
  if (zone === 'down') return { left: 0, bottom: 0, width: '100%', height: '50%' }
  return { left: 18, right: 18, top: 18, bottom: 18 }
}

type PaneTabGroup = 'terminal' | 'claude' | 'codex' | 'gemini' | 'opencode' | 'browser' | 'file' | 'other'

const PANE_TAB_GROUP_ORDER: PaneTabGroup[] = ['terminal', 'claude', 'codex', 'gemini', 'opencode', 'browser', 'file', 'other']
const PANE_TAB_GROUP_LABEL: Record<PaneTabGroup, string> = {
  terminal: '终端',
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  browser: 'Browser',
  file: '文件',
  other: '其他',
}

function getSessionTabGroup(type: string): PaneTabGroup {
  if (type === 'terminal') return 'terminal'
  if (type === 'browser') return 'browser'
  if (type.startsWith('claude')) return 'claude'
  if (type.startsWith('codex')) return 'codex'
  if (type.startsWith('gemini')) return 'gemini'
  if (type.startsWith('opencode')) return 'opencode'
  return 'other'
}

function getPaneTabGroup(tab: PaneTabItem): PaneTabGroup {
  return tab.kind === 'editor' ? 'file' : getSessionTabGroup(tab.session.type)
}

function getPaneTabSplitKey(tab: PaneTabItem): string {
  if (tab.kind === 'editor') return 'file'
  const group = getSessionTabGroup(tab.session.type)
  return group === 'other' ? `session:${tab.session.type}` : group
}

function getParentPath(path: string): string {
  return path.replace(/[/\\][^/\\]+$/, '') || path
}

function getRelativePath(filePath: string, basePath: string | null): string | null {
  if (!basePath) return null
  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedFile = filePath.replace(/\\/g, '/')
  if (normalizedFile === normalizedBase) return normalizedFile.split('/').pop() ?? null
  const prefix = `${normalizedBase}/`
  if (!normalizedFile.toLowerCase().startsWith(prefix.toLowerCase())) return null
  return normalizedFile.slice(prefix.length)
}

function EditorTabButton({ tab, isActive, isPaneFocused, paneId, projectId, currentWindowId, isDragging, showDivider, dropSide, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, onSelect, canSplitSameType = false, onSplitSameType, sameTypeLabel = '同类' }: {
  tab: EditorTabItem
  isActive: boolean
  isPaneFocused: boolean
  paneId: string
  projectId: string
  currentWindowId: string
  isDragging: boolean
  showDivider: boolean
  dropSide: 'left' | 'right' | null
  onDragStart: (id: string, e: React.DragEvent) => void
  onDragOver: (id: string, e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (id: string) => void
  onDragEnd: () => void
  onSelect: () => void
  canSplitSameType?: boolean
  onSplitSameType?: (id: string) => void
  sameTypeLabel?: string
}): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [pendingClose, setPendingClose] = useState<{ ids: string[]; title: string; message: string } | null>(null)
  const [pendingPopout, setPendingPopout] = useState<{ position?: { x: number; y: number } } | null>(null)
  const dragTokenRef = useRef<string | null>(null)
  const iconInfo = FILE_ICONS[tab.language] ?? FILE_ICONS.plaintext
  const paneTabIds = usePanesStore((s) => s.paneSessions[paneId] ?? [])
  const splitPane = usePanesStore((s) => s.splitPane)
  const rootType = usePanesStore((s) => s.root.type)
  const allEditorTabs = useEditorsStore((s) => s.tabs)
  const project = useProjectsStore((s) => s.projects.find((item) => item.id === projectId))
  const branchInfo = useGitStore((s) => s.branchInfo[projectId])
  const selectedWorktree = useWorktreesStore((s) => s.worktrees.find((item) => item.id === s.selectedWorktreeId && item.projectId === projectId))
  const tabWorktree = useWorktreesStore((s) => tab.worktreeId ? s.worktrees.find((item) => item.id === tab.worktreeId) : undefined)
  const projectRootPath = selectedWorktree?.path ?? project?.path ?? null
  const relativePath = useMemo(() => getRelativePath(tab.filePath, projectRootPath), [tab.filePath, projectRootPath])
  const branchName = tabWorktree && !tabWorktree.isMain ? tabWorktree.branch : branchInfo?.current

  const fileTabIds = useMemo(
    () => paneTabIds.filter((id) => id.startsWith('editor-')),
    [paneTabIds],
  )
  const fileTabsToRightIds = useMemo(() => {
    const currentIndex = paneTabIds.indexOf(tab.id)
    if (currentIndex === -1) return []
    return paneTabIds.slice(currentIndex + 1).filter((id) => id.startsWith('editor-'))
  }, [paneTabIds, tab.id])
  const otherFileTabIds = useMemo(
    () => fileTabIds.filter((id) => id !== tab.id),
    [fileTabIds, tab.id],
  )
  const canSplit = paneTabIds.length >= 2
  const isSplit = rootType === 'split'
  const activeTabClass = isActive
    ? cn(
      'tab-active font-medium text-[var(--color-text-primary)]',
      isPaneFocused ? 'tab-active-focused' : 'tab-active-muted',
    )
    : 'tab-inactive text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] rounded-t-[10px]'

  const closeEditorTabs = useCallback((ids: string[]) => {
    const targets = [...new Set(ids)].filter((id) => fileTabIds.includes(id))
    if (targets.length === 0) {
      setPendingClose(null)
      setContextMenu(null)
      return
    }

    for (const id of targets) {
      if (!usePanesStore.getState().paneSessions[paneId]?.includes(id)) continue
      usePanesStore.getState().removeSessionFromPane(paneId, id)
      useEditorsStore.getState().closeTab(id)
    }

    setPendingClose(null)
    setContextMenu(null)
  }, [fileTabIds, paneId])

  const requestClose = useCallback((ids: string[]) => {
    const targets = [...new Set(ids)].filter((id) => fileTabIds.includes(id))
    if (targets.length === 0) {
      setContextMenu(null)
      return
    }

    const modifiedTabs = targets
      .map((id) => allEditorTabs.find((item) => item.id === id))
      .filter((item): item is typeof allEditorTabs[number] => Boolean(item?.modified))

    if (modifiedTabs.length > 0) {
      setPendingClose({
        ids: targets,
        title: modifiedTabs.length === 1 ? '未保存更改' : '关闭文件',
        message: modifiedTabs.length === 1
          ? `"${modifiedTabs[0].fileName}" 有未保存更改，仍要关闭吗？`
          : `${modifiedTabs.length} 个文件标签页有未保存更改，仍要关闭吗？`,
      })
      setContextMenu(null)
      return
    }

    closeEditorTabs(targets)
  }, [allEditorTabs, closeEditorTabs, fileTabIds])

  const doPopOut = useCallback((position?: { x: number; y: number }) => {
    const liveTab = useEditorsStore.getState().getTab(tab.id) ?? tab
    const detachTitle = (project?.name ?? liveTab.fileName) + (branchName ? `|${branchName}` : '')
    const { popoutPosition, popoutWidth, popoutHeight } = useUIStore.getState().settings
    const pos = position ?? (
      popoutPosition === 'center'
        ? undefined
        : { x: window.screenX + window.innerWidth / 2, y: window.screenY + window.innerHeight / 2 }
    )
    usePanesStore.getState().removeSessionFromPane(paneId, tab.id)
    window.api.detach.create(
      [tab.id],
      detachTitle,
      [],
      [liveTab],
      { projectId: liveTab.projectId, worktreeId: liveTab.worktreeId ?? null },
      pos,
      { width: popoutWidth, height: popoutHeight },
    )
    setPendingPopout(null)
    setContextMenu(null)
  }, [branchName, paneId, project?.name, tab])

  const requestPopOut = useCallback((position?: { x: number; y: number }) => {
    const liveTab = useEditorsStore.getState().getTab(tab.id) ?? tab
    if (liveTab.modified) {
      setPendingPopout({ position })
      setContextMenu(null)
      return
    }
    doPopOut(position)
  }, [doPopOut, tab])

  const handleClose = (e: React.MouseEvent): void => {
    e.stopPropagation()
    requestClose([tab.id])
  }

  return (
    <>
      {dropSide === 'left' && (
        <div className="h-5 w-0.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
      )}

      <div
        draggable
        onDragStart={(e) => {
          const liveTab = useEditorsStore.getState().getTab(tab.id) ?? tab
          const dragToken = `tabdrag-${tab.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          dragTokenRef.current = dragToken
          e.dataTransfer.setData('session-tab-id', tab.id)
          e.dataTransfer.setData('source-pane-id', paneId)
          e.dataTransfer.setData('source-window-id', currentWindowId)
          e.dataTransfer.setData('session-tab-drag-token', dragToken)
          e.dataTransfer.effectAllowed = 'move'
          window.api.detach.registerTabDrag(dragToken, {
            kind: 'editor',
            editor: liveTab,
            sourcePaneId: paneId,
            sourceWindowId: currentWindowId,
          } satisfies DetachedTabDragPayload)
          onDragStart(tab.id, e)
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(tab.id, e) }}
        onDragLeave={onDragLeave}
        onDrop={() => onDrop(tab.id)}
        onDragEnd={(e) => {
          onDragEnd()
          const dragToken = dragTokenRef.current
          dragTokenRef.current = null
          const dragResult = dragToken ? window.api.detach.finishTabDrag(dragToken) : null

          if (dragResult?.claimed && dragResult.targetWindowId && dragResult.targetWindowId !== currentWindowId) {
            usePanesStore.getState().removeSessionFromPane(paneId, tab.id)
            return
          }

          const { clientX, clientY, screenX, screenY } = e
          const inWindow = clientX >= 0 && clientY >= 0
            && clientX <= window.innerWidth && clientY <= window.innerHeight
          if (!inWindow) {
            requestPopOut({ x: screenX, y: screenY })
          }
        }}
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        className={cn(
          'no-drag group flex h-[34px] cursor-pointer items-center gap-2 px-3 max-w-[220px] min-w-[120px]',
          'transition-all duration-200',
          activeTabClass,
          isDragging && 'opacity-40',
        )}
      >
        {/* File type icon */}
        <span
          className="inline-flex h-4.5 min-w-[18px] shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold leading-none shadow-sm"
          style={{ backgroundColor: iconInfo.color + '20', color: iconInfo.color, border: `1px solid ${iconInfo.color}30` }}
        >
          {tab.isDiff ? '⇄' : iconInfo.icon}
        </span>
        <span className={cn('flex-1 truncate text-[var(--ui-font-xs)]', isActive ? 'font-bold' : 'font-medium')}>
          {tab.fileName}
        </span>
        {/* Modified indicator or close button */}
        {tab.modified ? (
          <button onClick={handleClose} onDoubleClick={(e) => e.stopPropagation()} className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[var(--color-warning)]" title="未保存更改">
            <span className="text-[10px] animate-pulse">●</span>
          </button>
        ) : (
          <button
            onClick={handleClose}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] shrink-0',
              'text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100',
              'hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
              'transition-all duration-200',
            )}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {dropSide === 'right' && (
        <div className="h-5 w-0.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
      )}

      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setContextMenu(null)} />
          <div
            style={{ top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
            className="fixed w-56 rounded-[var(--radius-md)] py-1 border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30"
          >
            <button
              onClick={() => requestClose([tab.id])}
              className={`${MENU_ITEM} text-[var(--color-error)] hover:text-[var(--color-error)]`}
            >
              关闭
            </button>
            <button
              onClick={() => requestClose(otherFileTabIds)}
              disabled={otherFileTabIds.length === 0}
              className={otherFileTabIds.length === 0 ? MENU_ITEM_DISABLED : MENU_ITEM}
            >
              关闭其他文件标签页
            </button>
            <button
              onClick={() => requestClose(fileTabsToRightIds)}
              disabled={fileTabsToRightIds.length === 0}
              className={fileTabsToRightIds.length === 0 ? MENU_ITEM_DISABLED : MENU_ITEM}
            >
              关闭右侧文件标签页
            </button>
            <button
              onClick={() => requestClose(fileTabIds)}
              disabled={fileTabIds.length <= 1}
              className={fileTabIds.length <= 1 ? MENU_ITEM_DISABLED : MENU_ITEM}
            >
              关闭全部文件标签页
            </button>

            <div className="h-px my-0.5 bg-[var(--color-border)]" />

            <button
              onClick={() => { window.api.shell.openPath(tab.filePath); setContextMenu(null) }}
              className={MENU_ITEM}
            >
              使用默认程序打开
            </button>
            <button
              onClick={() => { window.api.shell.openPath(getParentPath(tab.filePath)); setContextMenu(null) }}
              className={MENU_ITEM}
            >
              在资源管理器中打开
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(tab.filePath); setContextMenu(null) }}
              className={MENU_ITEM}
            >
              复制路径
            </button>
            {relativePath && (
              <button
                onClick={() => { navigator.clipboard.writeText(relativePath); setContextMenu(null) }}
                className={MENU_ITEM}
              >
                复制相对路径
              </button>
            )}
            <button
              onClick={() => requestPopOut()}
              className={MENU_ITEM}
            >
              弹出为独立窗口
            </button>

            {(canSplit || onSplitSameType || isSplit) && <div className="h-px my-0.5 bg-[var(--color-border)]" />}

            {canSplit && FILE_TAB_SPLIT_OPTIONS.map((opt) => (
              <button
                key={opt.position}
                onClick={() => {
                  setContextMenu(null)
                  splitPane(paneId, opt.position, tab.id)
                }}
                className={MENU_ITEM}
              >
                {opt.label}
              </button>
            ))}

            {onSplitSameType && (
              <button
                onClick={() => {
                  setContextMenu(null)
                  onSplitSameType(tab.id)
                }}
                disabled={!canSplitSameType}
                className={canSplitSameType ? MENU_ITEM : MENU_ITEM_DISABLED}
              >
                把{sameTypeLabel}标签移到新 pane
              </button>
            )}

            {isSplit && (
              <button
                onClick={() => {
                  setContextMenu(null)
                  usePanesStore.getState().mergeAllPanes()
                }}
                className={MENU_ITEM}
              >
                合并全部分屏
              </button>
            )}
          </div>
        </>,
        document.body,
      )}

      {pendingClose && (
        <ConfirmDialog
          title={pendingClose.title}
          message={pendingClose.message}
          confirmLabel="关闭"
          danger
          onConfirm={() => closeEditorTabs(pendingClose.ids)}
          onCancel={() => setPendingClose(null)}
        />
      )}

      {pendingPopout && (
        <ConfirmDialog
          title="弹出文件标签页"
          message={`"${tab.fileName}" 有未保存更改。弹出后会按磁盘中的内容重新打开，仍要继续吗？`}
          confirmLabel="继续弹出"
          danger
          onConfirm={() => doPopOut(pendingPopout.position)}
          onCancel={() => setPendingPopout(null)}
        />
      )}
    </>
  )
}

function getTopRightLeafId(node: PaneNode): string {
  if (node.type === 'leaf') return node.id
  return node.direction === 'horizontal'
    ? getTopRightLeafId(node.second)
    : getTopRightLeafId(node.first)
}

export function PaneView({ paneId, projectId }: PaneViewProps): JSX.Element {
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const setActivePaneId = usePanesStore((s) => s.setActivePaneId)
  const root = usePanesStore((s) => s.root)
  const paneSessions = usePanesStore((s) => s.paneSessions[paneId] ?? [])
  const paneActiveSessionId = usePanesStore((s) => s.paneActiveSession[paneId] ?? null)
  const allSessions = useSessionsStore((s) => s.sessions)

  const isActivePane = activePaneId === paneId
  const rootType = usePanesStore((s) => s.root.type)
  const isMultiPane = rootType === 'split'
  const fullscreenPaneId = usePanesStore((s) => s.fullscreenPaneId)
  const togglePaneFullscreen = usePanesStore((s) => s.togglePaneFullscreen)
  const isFullscreenPane = fullscreenPaneId === paneId
  const showActivePaneBorder = useUIStore((s) => s.settings.showActivePaneBorder)
  const paneUiMode = useUIStore((s) => s.settings.paneUiMode)
  const tabUiMode = useUIStore((s) => s.settings.tabUiMode)
  const paneDensityMode = useUIStore((s) => s.settings.paneDensityMode)

  // Get full session objects for this pane, in pane order
  const sessions = useMemo(() => {
    return paneSessions
      .map((id) => allSessions.find((s) => s.id === id))
      .filter(Boolean) as typeof allSessions
  }, [paneSessions, allSessions])

  // Editor tabs in this pane
  const allEditorTabs = useEditorsStore((s) => s.tabs)
  const editorTabs = useMemo(() => {
    const editorIds = paneSessions.filter((id) => id.startsWith('editor-'))
    return editorIds.map((id) => allEditorTabs.find((t) => t.id === id)).filter(Boolean) as typeof allEditorTabs
  }, [paneSessions, allEditorTabs])
  const orderedTabs = useMemo<PaneTabItem[]>(() => {
    return paneSessions.flatMap<PaneTabItem>((id) => {
      if (id.startsWith('editor-')) {
        const tab = allEditorTabs.find((item) => item.id === id)
        return tab ? [{ kind: 'editor', id, tab }] : []
      }

      const session = allSessions.find((item) => item.id === id)
      return session ? [{ kind: 'session', id, session }] : []
    })
  }, [paneSessions, allEditorTabs, allSessions])
  const tabGroupById = useMemo(() => {
    const groups = new Map<string, PaneTabGroup>()
    for (const tab of orderedTabs) {
      groups.set(tab.id, getPaneTabGroup(tab))
    }
    return groups
  }, [orderedTabs])
  const tabSplitKeyById = useMemo(() => {
    const keys = new Map<string, string>()
    for (const tab of orderedTabs) {
      keys.set(tab.id, getPaneTabSplitKey(tab))
    }
    return keys
  }, [orderedTabs])
  const groupedTabs = useMemo(() => {
    return PANE_TAB_GROUP_ORDER.map((group) => ({
      group,
      tabs: orderedTabs.filter((tab) => getPaneTabGroup(tab) === group),
    })).filter((item) => item.tabs.length > 0)
  }, [orderedTabs])
  const showDetachedWindowControls = isDetached && paneId === getTopRightLeafId(root)

  const [showNewMenu, setShowNewMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [dropHighlight, setDropHighlight] = useState(false)
  const [edgeDrop, setEdgeDrop] = useState<DropZone | null>(null)
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null)
  const termAreaRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const paneMenuButtonRef = useRef<HTMLButtonElement>(null)
  const tabListButtonRef = useRef<HTMLButtonElement>(null)
  const windowDragRef = useRef<WindowDragState | null>(null)
  const currentWindowId = isDetached ? window.api.detach.getWindowId() : 'main'
  const [paneActionMenu, setPaneActionMenu] = useState<{ x: number; y: number } | null>(null)
  const [tabListMenu, setTabListMenu] = useState<{ x: number; y: number } | null>(null)

  const closeMenuTimerRef = useRef<number | null>(null)

  const cancelCloseMenu = useCallback(() => {
    if (closeMenuTimerRef.current !== null) {
      window.clearTimeout(closeMenuTimerRef.current)
      closeMenuTimerRef.current = null
    }
  }, [])

  const scheduleCloseMenu = useCallback(() => {
    cancelCloseMenu()
    closeMenuTimerRef.current = window.setTimeout(() => {
      setShowNewMenu(false)
      closeMenuTimerRef.current = null
    }, 150)
  }, [cancelCloseMenu])

  useEffect(() => () => cancelCloseMenu(), [cancelCloseMenu])

  const openNewSessionMenu = useCallback((anchor: HTMLElement, align: 'left' | 'center' = 'left') => {
    cancelCloseMenu()
    const rect = anchor.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      left: align === 'center' ? rect.left + rect.width / 2 - 96 : rect.left,
    })
    setShowNewMenu(true)
  }, [cancelCloseMenu])

  const handlePlusClick = (): void => {
    if (!btnRef.current) return
    if (showNewMenu) {
      cancelCloseMenu()
      setShowNewMenu(false)
      return
    }
    openNewSessionMenu(btnRef.current)
  }

  const handlePlusMouseEnter = useCallback(() => {
    if (btnRef.current) openNewSessionMenu(btnRef.current)
  }, [openNewSessionMenu])

  const handleEmptyIconClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    openNewSessionMenu(event.currentTarget, 'center')
  }, [openNewSessionMenu])

  const activeTabIdForMenu = paneActiveSessionId && paneSessions.includes(paneActiveSessionId)
    ? paneActiveSessionId
    : (paneSessions[0] ?? null)

  const openPaneActionMenu = useCallback(() => {
    const rect = paneMenuButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    setPaneActionMenu((current) => current ? null : { x: Math.max(4, rect.right - 204), y: rect.bottom + 4 })
  }, [])

  const getSameTypeTabIds = useCallback((tabId: string) => {
    const targetKey = tabSplitKeyById.get(tabId)
    if (!targetKey) return []
    return paneSessions.filter((id) => tabSplitKeyById.get(id) === targetKey)
  }, [paneSessions, tabSplitKeyById])

  const canSplitSameType = useCallback((tabId: string) => {
    const ids = getSameTypeTabIds(tabId)
    return ids.length > 0 && ids.length < paneSessions.length
  }, [getSameTypeTabIds, paneSessions.length])

  const splitSameTypeToNewPane = useCallback((tabId: string) => {
    const ids = getSameTypeTabIds(tabId)
    if (ids.length === 0 || ids.length >= paneSessions.length) return
    usePanesStore.getState().splitPaneWithSessions(paneId, 'right', ids)
    setPaneActionMenu(null)
    setTabListMenu(null)
  }, [getSameTypeTabIds, paneId, paneSessions.length])

  const organizePaneTabsByType = useCallback(() => {
    const groupRank = new Map(PANE_TAB_GROUP_ORDER.map((group, index) => [group, index]))
    const originalIndex = new Map(paneSessions.map((id, index) => [id, index]))
    const nextOrder = [...paneSessions].sort((a, b) => {
      const aRank = groupRank.get(tabGroupById.get(a) ?? 'other') ?? PANE_TAB_GROUP_ORDER.length
      const bRank = groupRank.get(tabGroupById.get(b) ?? 'other') ?? PANE_TAB_GROUP_ORDER.length
      if (aRank !== bRank) return aRank - bRank
      return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0)
    })
    usePanesStore.getState().setPaneSessionOrder(paneId, nextOrder)
    setPaneActionMenu(null)
    setTabListMenu(null)
  }, [paneId, paneSessions, tabGroupById])

  const smartSplitByType = useCallback(() => {
    const state = usePanesStore.getState()
    const orderedIds = getPaneLeafIds(state.root).flatMap((leafId) => state.paneSessions[leafId] ?? [])
    const groupRank = new Map(PANE_TAB_GROUP_ORDER.map((group, index) => [group, index]))
    const buckets = new Map<string, { group: PaneTabGroup; firstIndex: number; ids: string[] }>()

    orderedIds.forEach((id, index) => {
      const tab: PaneTabItem | null = id.startsWith('editor-')
        ? (() => {
            const editor = allEditorTabs.find((item) => item.id === id)
            return editor ? { kind: 'editor' as const, id, tab: editor } : null
          })()
        : (() => {
            const session = allSessions.find((item) => item.id === id)
            return session ? { kind: 'session' as const, id, session } : null
          })()
      if (!tab) return

      const key = getPaneTabSplitKey(tab)
      const existing = buckets.get(key)
      if (existing) {
        existing.ids.push(id)
        return
      }

      buckets.set(key, {
        group: getPaneTabGroup(tab),
        firstIndex: index,
        ids: [id],
      })
    })

    const groups = [...buckets.values()]
      .sort((a, b) => {
        const rankDiff = (groupRank.get(a.group) ?? PANE_TAB_GROUP_ORDER.length)
          - (groupRank.get(b.group) ?? PANE_TAB_GROUP_ORDER.length)
        return rankDiff || a.firstIndex - b.firstIndex
      })
      .map((bucket) => bucket.ids)

    if (groups.length === 0) return
    usePanesStore.getState().applyPaneGroups(groups, activeTabIdForMenu)
    setPaneActionMenu(null)
    setTabListMenu(null)
  }, [activeTabIdForMenu, allEditorTabs, allSessions])

  const openTabListMenu = useCallback(() => {
    const rect = tabListButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    setTabListMenu((current) => current ? null : { x: Math.max(8, rect.right - 284), y: rect.bottom + 4 })
  }, [])

  const selectTabFromMenu = useCallback((tab: PaneTabItem) => {
    usePanesStore.getState().setActivePaneId(paneId)
    usePanesStore.getState().setPaneActiveSession(paneId, tab.id)
    if (tab.kind === 'session') {
      useSessionsStore.getState().setActive(tab.session.id)
    }
    setTabListMenu(null)
  }, [paneId])

  const openPaneActionMenuAt = useCallback((x: number, y: number) => {
    setPaneActionMenu({ x: Math.max(4, x), y: Math.max(4, y) })
  }, [])

  const paneRootRef = useRef<HTMLDivElement>(null)

  const handleFocus = useCallback(() => {
    if (!isActivePane) setActivePaneId(paneId)
  }, [isActivePane, paneId, setActivePaneId])

  const stopWindowDrag = useCallback(() => {
    const drag = windowDragRef.current
    if (!drag) return
    if (drag.frameId !== null) {
      cancelAnimationFrame(drag.frameId)
    }
    window.removeEventListener('mousemove', drag.handleMouseMove)
    window.removeEventListener('mouseup', drag.handleMouseUp)
    document.body.style.cursor = ''
    windowDragRef.current = null
  }, [])

  const handleWindowDragMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isDetached || e.button !== 0) return

    e.preventDefault()
    e.stopPropagation()
    stopWindowDrag()

    const dragState: WindowDragState = {
      startMouseX: e.screenX,
      startMouseY: e.screenY,
      startWindowX: window.screenX,
      startWindowY: window.screenY,
      pendingX: window.screenX,
      pendingY: window.screenY,
      frameId: null,
      handleMouseMove: () => {},
      handleMouseUp: () => {},
    }

    dragState.handleMouseMove = (moveEvent: MouseEvent) => {
      if (moveEvent.buttons === 0) {
        stopWindowDrag()
        return
      }

      dragState.pendingX = dragState.startWindowX + (moveEvent.screenX - dragState.startMouseX)
      dragState.pendingY = dragState.startWindowY + (moveEvent.screenY - dragState.startMouseY)

      if (dragState.frameId !== null) return
      dragState.frameId = requestAnimationFrame(() => {
        dragState.frameId = null
        void window.api.detach.setPosition(dragState.pendingX, dragState.pendingY)
      })
    }

    dragState.handleMouseUp = () => {
      stopWindowDrag()
    }

    windowDragRef.current = dragState
    document.body.style.cursor = ''
    window.addEventListener('mousemove', dragState.handleMouseMove)
    window.addEventListener('mouseup', dragState.handleMouseUp)
  }, [stopWindowDrag])

  const handleWindowDragDoubleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isDetached) return
    e.preventDefault()
    e.stopPropagation()
    stopWindowDrag()
    void window.api.detach.maximize()
  }, [stopWindowDrag])

  const handleTopBarBlankMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    handleWindowDragMouseDown(e)
  }, [handleWindowDragMouseDown])

  const handleTopBarBlankDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    handleWindowDragDoubleClick(e)
  }, [handleWindowDragDoubleClick])

  const handlePaneHeaderDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isDetached) {
      if (e.target !== e.currentTarget) return
      handleWindowDragDoubleClick(e)
      return
    }

    e.preventDefault()
    togglePaneFullscreen(paneId)
  }, [handleWindowDragDoubleClick, paneId, togglePaneFullscreen])

  const attachDraggedTab = useCallback((dragToken: string, zone?: DropZone | null) => {
    const payload = window.api.detach.claimTabDrag(dragToken, currentWindowId) as DetachedTabDragPayload | null
    if (!payload) return false

    const tabId = payload.kind === 'session' ? payload.session.id : payload.editor.id
    if (payload.kind === 'session') {
      useSessionsStore.getState().upsertSessions([payload.session])
    } else {
      useEditorsStore.getState().upsertTabs([payload.editor])
    }
    const store = usePanesStore.getState()

    if (zone && zone !== 'center') {
      store.addSessionToPane(paneId, tabId)
      store.splitPane(paneId, zone, tabId)
    } else {
      store.addSessionToPane(paneId, tabId)
    }

    store.setActivePaneId(paneId)
    store.setPaneActiveSession(paneId, tabId)
    if (payload.kind === 'session') {
      useSessionsStore.getState().setActive(payload.session.id)
    }
    return true
  }, [currentWindowId, paneId])

  // Register pane DOM element for rect-based navigation
  useEffect(() => {
    registerPaneElement(paneId, paneRootRef.current)
    return () => registerPaneElement(paneId, null)
  }, [paneId])

  useEffect(() => {
    return () => stopWindowDrag()
  }, [stopWindowDrag])

  return (
    <div
      ref={paneRootRef}
      className={cn(
        'pane-surface relative flex h-full flex-col',
        paneUiMode === 'classic' && 'pane-surface-classic',
        paneDensityMode === 'compact' && 'pane-density-compact',
      )}
      onMouseDown={handleFocus}
    >
      {/* Active pane highlight overlay */}
      {isMultiPane && showActivePaneBorder && isActivePane && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-50',
            paneUiMode !== 'classic' && 'rounded-[var(--radius-panel)]',
          )}
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 4%, transparent)' }}
        />
      )}
      {/* Tab bar */}
      <div
        className={cn(
          'tab-bar relative flex shrink-0 items-end bg-[var(--color-bg-secondary)]',
          tabUiMode === 'square' ? 'tab-style-square' : 'tab-style-rounded',
          dropHighlight && 'ring-2 ring-inset ring-[var(--color-accent)]',
        )}
        style={{ height: paneDensityMode === 'compact' ? 32 : 38 }}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('.tab-active, .tab-inactive, button')) return
          e.preventDefault()
          e.stopPropagation()
          openPaneActionMenuAt(e.clientX, e.clientY)
        }}
        onWheel={(e) => {
          if (orderedTabs.length === 0) return
          const activeIdx = orderedTabs.findIndex((tab) => tab.id === paneActiveSessionId)
          const dir = e.deltaY > 0 ? 1 : -1
          const next = (activeIdx + dir + orderedTabs.length) % orderedTabs.length
          usePanesStore.getState().setPaneActiveSession(paneId, orderedTabs[next].id)
        }}
        onDoubleClick={(e) => {
          handlePaneHeaderDoubleClick(e)
        }}
        onDragOver={(e) => {
          if (isTabDrag(e)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropHighlight(true)
          }
        }}
        onDragLeave={() => setDropHighlight(false)}
        onDrop={(e) => {
          setDropHighlight(false)
          const sessionId = e.dataTransfer.getData('session-tab-id')
          const sourcePaneId = e.dataTransfer.getData('source-pane-id')
          const sourceWindowId = e.dataTransfer.getData('source-window-id') || 'main'
          const dragToken = e.dataTransfer.getData('session-tab-drag-token')
            || window.api.detach.getActiveTabDrag()
          if (dragToken && sourceWindowId !== currentWindowId) {
            attachDraggedTab(dragToken)
            return
          }
          if (sourceWindowId !== currentWindowId && !dragToken) return
          // Cross-window fallback: getData may return empty, use IPC token
          if (!sessionId && dragToken) {
            attachDraggedTab(dragToken)
            return
          }
          if (sessionId && sourcePaneId && sourcePaneId !== paneId) {
            usePanesStore.getState().moveSession(sourcePaneId, paneId, sessionId)
          }
        }}
      >
        {/* Scrollable tabs + buttons area */}
        <div
          className={cn(
            'flex min-w-0 flex-1 items-end gap-0 overflow-x-auto scrollbar-none',
            paneDensityMode === 'compact' ? 'px-1' : 'px-2',
          )}
          style={{ position: 'relative', zIndex: 1 }}
          onMouseDown={handleTopBarBlankMouseDown}
          onDoubleClick={handleTopBarBlankDoubleClick}
        >
          {/* Project + branch badge in detached window */}
          {isDetached && (() => {
            const title = window.api.detach.getTitle()
            const [projName, branchName] = title.includes('|') ? title.split('|', 2) : [title, '']
            return (
              <span
                className="no-drag flex shrink-0 items-center gap-1.5 self-center mr-2 pl-2 pr-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text-secondary)]"
                onMouseDown={handleWindowDragMouseDown}
                onDoubleClick={handleWindowDragDoubleClick}
              >
                {projName}
                {branchName && (
                  <>
                    <GitBranch size={11} className="text-[var(--color-text-tertiary)]" />
                    <span className="font-normal text-[var(--color-text-tertiary)]">{branchName}</span>
                  </>
                )}
              </span>
            )
          })()}
          {orderedTabs.map((tab, index) => tab.kind === 'session' ? (
            <SessionTab
              key={tab.id}
              session={tab.session}
              isActive={tab.id === paneActiveSessionId}
              isPaneFocused={isActivePane}
              paneId={paneId}
              isDragging={dragTabId === tab.id}
              showDivider={index < orderedTabs.length - 1}
              dropSide={dropTargetId === tab.id ? dropSide : null}
              onDragStart={(id) => setDragTabId(id)}
              onDragOver={(id, e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const mid = rect.left + rect.width / 2
                setDropTargetId(id)
                setDropSide(e.clientX < mid ? 'left' : 'right')
              }}
              onDragLeave={() => { setDropTargetId(null); setDropSide(null) }}
              onDrop={(id) => {
                if (dragTabId && dragTabId !== id) {
                  usePanesStore.getState().reorderPaneSessions(paneId, dragTabId, id)
                }
                setDropTargetId(null); setDropSide(null)
              }}
              onDragEnd={() => { setDragTabId(null); setDropTargetId(null); setDropSide(null) }}
              canSplitSameType={canSplitSameType(tab.id)}
              onSplitSameType={splitSameTypeToNewPane}
              sameTypeLabel={PANE_TAB_GROUP_LABEL[tabGroupById.get(tab.id) ?? 'other']}
            />
          ) : (
            <EditorTabButton
              key={tab.id}
              tab={tab.tab}
              isActive={tab.id === paneActiveSessionId}
              isPaneFocused={isActivePane}
              paneId={paneId}
              projectId={projectId}
              currentWindowId={currentWindowId}
              isDragging={dragTabId === tab.id}
              showDivider={index < orderedTabs.length - 1}
              dropSide={dropTargetId === tab.id ? dropSide : null}
              onDragStart={(id) => setDragTabId(id)}
              onDragOver={(id, e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const mid = rect.left + rect.width / 2
                setDropTargetId(id)
                setDropSide(e.clientX < mid ? 'left' : 'right')
              }}
              onDragLeave={() => { setDropTargetId(null); setDropSide(null) }}
              onDrop={(id) => {
                if (dragTabId && dragTabId !== id) {
                  usePanesStore.getState().reorderPaneSessions(paneId, dragTabId, id)
                }
                setDropTargetId(null); setDropSide(null)
              }}
              onDragEnd={() => { setDragTabId(null); setDropTargetId(null); setDropSide(null) }}
              onSelect={() => {
                usePanesStore.getState().setPaneActiveSession(paneId, tab.id)
                usePanesStore.getState().setActivePaneId(paneId)
              }}
              canSplitSameType={canSplitSameType(tab.id)}
              onSplitSameType={splitSameTypeToNewPane}
              sameTypeLabel={PANE_TAB_GROUP_LABEL[tabGroupById.get(tab.id) ?? 'file']}
            />
          ))}

          <button
            ref={btnRef}
            onClick={handlePlusClick}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseEnter={handlePlusMouseEnter}
            onMouseLeave={scheduleCloseMenu}
            className={cn(
              'no-drag group/new flex h-7 w-7 shrink-0 items-center justify-center self-center mx-1',
              'rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)]',
              'hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]',
              'active:scale-95 transition-all duration-200',
            )}
            title="新建会话"
          >
            <Plus size={15} strokeWidth={2.5} className="transition-transform duration-300 group-hover/new:rotate-90" />
          </button>

          {/* Close pane button — only when multiple panes exist */}
          {isMultiPane && (
            <button
              onClick={() => usePanesStore.getState().mergePane(paneId)}
              onDoubleClick={(event) => event.stopPropagation()}
              className={cn(
                'no-drag flex h-7 w-7 shrink-0 items-center justify-center self-center',
                'rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)]',
                'hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]',
                'active:scale-95 transition-all duration-200',
              )}
              title="关闭当前分屏（合并标签）"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {orderedTabs.length > 0 && (
          <button
            ref={tabListButtonRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              openTabListMenu()
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className={cn(
              'no-drag mr-1 flex shrink-0 items-center justify-center gap-1 rounded-[var(--radius-sm)]',
              paneDensityMode === 'compact' ? 'h-[26px] px-1.5' : 'h-7.5 px-2',
              'text-[var(--color-text-tertiary)] transition-all duration-200',
              'hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
              'active:scale-95',
            )}
            title="标签列表"
            aria-label="标签列表"
          >
            <List size={13} strokeWidth={2.5} />
            <span className="text-[10px] font-bold tabular-nums">{orderedTabs.length}</span>
          </button>
        )}

        {isMultiPane && (
          <div className="no-drag flex h-full shrink-0 items-center gap-0.5 pr-1.5">
            <button
              ref={paneMenuButtonRef}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                openPaneActionMenu()
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className={cn(
                'flex h-7.5 w-7.5 items-center justify-center rounded-[var(--radius-sm)]',
                'text-[var(--color-text-tertiary)] transition-all duration-200',
                'hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                'active:scale-95',
              )}
              title="Pane 快捷动作"
              aria-label="Pane 快捷动作"
            >
              <MoreHorizontal size={14} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                togglePaneFullscreen(paneId)
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className={cn(
                'flex h-7.5 w-7.5 items-center justify-center rounded-[var(--radius-sm)]',
                'text-[var(--color-text-tertiary)] transition-all duration-200',
                'hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]',
                'active:scale-95',
              )}
              title={isFullscreenPane ? '恢复分屏布局' : '放大当前分屏'}
              aria-label={isFullscreenPane ? '恢复分屏布局' : '放大当前分屏'}
            >
              {isFullscreenPane ? <Minimize2 size={13} strokeWidth={2.5} /> : <Maximize2 size={13} strokeWidth={2.5} />}
            </button>
          </div>
        )}

        {/* Detached window controls — pushed to far right */}
        {showDetachedWindowControls && (
          <>
            <div className="no-drag ml-auto flex shrink-0 items-center self-stretch">
              <button onClick={() => window.api.detach.minimize()} onDoubleClick={(event) => event.stopPropagation()} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors">
                <Minus size={14} />
              </button>
              <button onClick={() => window.api.detach.maximize()} onDoubleClick={(event) => event.stopPropagation()} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors">
                <Square size={11} />
              </button>
              <button onClick={() => window.api.detach.close()} onDoubleClick={(event) => event.stopPropagation()} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-error)] hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
          </>
        )}

        {showNewMenu && (
          <NewSessionMenu
            projectId={projectId}
            paneId={paneId}
            onClose={() => {
              cancelCloseMenu()
              setShowNewMenu(false)
            }}
            position={menuPos}
            onMouseEnter={cancelCloseMenu}
            onMouseLeave={scheduleCloseMenu}
          />
        )}

        {tabListMenu && createPortal(
          <>
            <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setTabListMenu(null)} />
            <div
              style={{ top: tabListMenu.y, left: tabListMenu.x, zIndex: 9999 }}
              className="fixed max-h-[min(520px,calc(100vh-24px))] w-72 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-xl shadow-black/35"
            >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                <span className="text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-primary)]">当前 pane 标签</span>
                <span className="text-[10px] font-bold tabular-nums text-[var(--color-text-tertiary)]">{orderedTabs.length}</span>
              </div>
              <button
                type="button"
                className={PANE_ACTION_MENU_ITEM}
                onClick={organizePaneTabsByType}
              >
                按类型整理当前 pane
              </button>
              <button
                type="button"
                className={PANE_ACTION_MENU_ITEM}
                onClick={smartSplitByType}
              >
                智能按类型分屏
              </button>
              <div className="max-h-[440px] overflow-y-auto py-1">
                {groupedTabs.map(({ group, tabs }) => (
                  <div key={group} className="py-1">
                    <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                        {PANE_TAB_GROUP_LABEL[group]} · {tabs.length}
                      </span>
                      <button
                        type="button"
                        disabled={tabs.length >= paneSessions.length}
                        className={cn(
                          'text-[10px] font-medium transition-colors',
                          tabs.length < paneSessions.length
                            ? 'text-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                            : 'cursor-not-allowed text-[var(--color-text-tertiary)] opacity-40',
                        )}
                        onClick={() => splitSameTypeToNewPane(tabs[0].id)}
                      >
                        移到新 pane
                      </button>
                    </div>
                    {tabs.map((tab) => {
                      const isCurrent = tab.id === paneActiveSessionId
                      const title = tab.kind === 'session' ? tab.session.name : tab.tab.fileName
                      const subtitle = tab.kind === 'session' ? tab.session.type : tab.tab.language
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                            isCurrent
                              ? 'bg-[var(--color-accent)]/12 text-[var(--color-text-primary)]'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                          )}
                          onClick={() => selectTabFromMenu(tab)}
                        >
                          <span className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            isCurrent ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-tertiary)]/45',
                          )} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[var(--ui-font-xs)] font-medium">{title}</span>
                            <span className="block truncate text-[10px] text-[var(--color-text-tertiary)]">{subtitle}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}

        {paneActionMenu && createPortal(
          <>
            <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setPaneActionMenu(null)} />
            <div
              style={{ top: paneActionMenu.y, left: paneActionMenu.x, zIndex: 9999 }}
              className="fixed w-52 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-lg shadow-black/30"
            >
              <button
                className={PANE_ACTION_MENU_ITEM}
                onClick={() => {
                  togglePaneFullscreen(paneId)
                  setPaneActionMenu(null)
                }}
              >
                {isFullscreenPane ? '恢复分屏布局' : '放大当前 pane'}
              </button>
              <button
                className={isMultiPane ? PANE_ACTION_MENU_ITEM : PANE_ACTION_MENU_ITEM_DISABLED}
                disabled={!isMultiPane}
                onClick={() => {
                  usePanesStore.getState().balanceSplits()
                  setPaneActionMenu(null)
                }}
              >
                等分全部 pane
              </button>
              <button
                className={PANE_ACTION_MENU_ITEM}
                onClick={organizePaneTabsByType}
              >
                按类型整理当前 pane
              </button>
              <button
                className={PANE_ACTION_MENU_ITEM}
                onClick={smartSplitByType}
              >
                智能按类型分屏
              </button>
              <div className="my-0.5 border-t border-[var(--color-border)]" />
              <button
                className={isMultiPane ? PANE_ACTION_MENU_ITEM : PANE_ACTION_MENU_ITEM_DISABLED}
                disabled={!isMultiPane}
                onClick={() => {
                  usePanesStore.getState().mergeAllPanes()
                  setPaneActionMenu(null)
                }}
              >
                合并全部 pane
              </button>
              <button
                className={isMultiPane
                  ? `${PANE_ACTION_MENU_ITEM} text-[var(--color-error)] hover:text-[var(--color-error)]`
                  : PANE_ACTION_MENU_ITEM_DISABLED}
                disabled={!isMultiPane}
                onClick={() => {
                  usePanesStore.getState().mergePane(paneId)
                  setPaneActionMenu(null)
                }}
              >
                关闭当前 pane
              </button>
            </div>
          </>,
          document.body,
        )}
      </div>

      {/* Terminal area */}
      <div
        ref={termAreaRef}
        className={cn(
          'relative flex-1 overflow-hidden bg-[var(--color-bg-primary)]',
          edgeDrop && 'ring-1 ring-inset ring-[var(--color-accent)]/25',
        )}
        onDragOver={(e) => {
          if (!isTabDrag(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'

          const rect = termAreaRef.current?.getBoundingClientRect()
          if (!rect) return
          const zone = getDropZoneFromPointer(e.clientX, e.clientY, rect)
          setEdgeDrop((current) => current === zone ? current : zone)
        }}
        onDragLeave={(e) => {
          const nextTarget = e.relatedTarget
          if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) return
          setEdgeDrop(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const rect = termAreaRef.current?.getBoundingClientRect()
          const zone = rect ? getDropZoneFromPointer(e.clientX, e.clientY, rect) : edgeDrop
          setEdgeDrop(null)
          const sessionId = e.dataTransfer.getData('session-tab-id')
          const sourcePaneId = e.dataTransfer.getData('source-pane-id')
          const sourceWindowId = e.dataTransfer.getData('source-window-id') || 'main'
          const dragToken = e.dataTransfer.getData('session-tab-drag-token')
            || window.api.detach.getActiveTabDrag()
          // Cross-window drop
          if (dragToken && (sourceWindowId !== currentWindowId || !sessionId)) {
            attachDraggedTab(dragToken, zone)
            return
          }
          if (sourceWindowId !== currentWindowId && !dragToken) return
          if (!sessionId || !sourcePaneId) return
          const store = usePanesStore.getState()

          if (zone && zone !== 'center') {
            // Edge drop → split this pane
            if (sourcePaneId === paneId) {
              // Same pane: just split (session moves from this pane to new split)
              store.splitPane(paneId, zone, sessionId)
            } else {
              // Cross-pane: first add session to this pane, remove from source, then split
              store.addSessionToPane(paneId, sessionId)
              store.removeSessionFromPane(sourcePaneId, sessionId)
              store.splitPane(paneId, zone, sessionId)
            }
          } else if (sourcePaneId !== paneId) {
            // Center drop: merge into this pane
            store.moveSession(sourcePaneId, paneId, sessionId)
          }
        }}
      >
        {sessions.map((session) => {
          const isActive = session.id === paneActiveSessionId
          return (
            <div
              key={session.id}
              className="absolute inset-0"
              style={{
                visibility: isActive ? 'visible' : 'hidden',
                zIndex: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              {session.type === 'claude-gui'
                ? <ClaudeCodePanel sessionId={session.id} />
                : session.type === 'browser'
                  ? <BrowserSessionView session={session} isActive={isActive && isActivePane} />
                : <TerminalView session={session} isActive={isActive && isActivePane} />}
            </div>
          )
        })}

        {/* Editor views */}
        {editorTabs.map((tab) => {
          const isActive = tab.id === paneActiveSessionId
          return (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{
                visibility: isActive ? 'visible' : 'hidden',
                zIndex: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              <EditorView editorTabId={tab.id} isActive={isActive && isActivePane} />
            </div>
          )
        })}

        {sessions.length === 0 && editorTabs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState
              title="空白分屏"
              description="创建一个新会话，或把标签页拖到这里。"
              icon={<Plus size={22} className="text-[var(--color-accent)]/80" />}
              actionLabel="新建会话"
              onIconClick={handleEmptyIconClick}
            />
          </div>
        )}

        {/* Tab drop preview overlay */}
        {edgeDrop && (
          <div className="pointer-events-none absolute inset-0 z-50">
            <div className="absolute inset-0 bg-black/20" />
            <div
              className={cn(
                'absolute flex items-center justify-center rounded-[var(--radius-md)]',
                'bg-[var(--color-accent)]/15 shadow-xl shadow-black/30',
                edgeDrop === 'center'
                  ? 'border-2 border-dashed border-[var(--color-accent)]/45'
                  : 'border-2 border-solid border-[var(--color-accent)]/65',
              )}
              style={getDropPreviewStyle(edgeDrop)}
            >
              {edgeDrop !== 'center' && (
                <div
                  className={cn(
                    'absolute bg-[var(--color-accent)]/75',
                    edgeDrop === 'left' && 'right-0 top-0 h-full w-px',
                    edgeDrop === 'right' && 'left-0 top-0 h-full w-px',
                    edgeDrop === 'up' && 'bottom-0 left-0 h-px w-full',
                    edgeDrop === 'down' && 'left-0 top-0 h-px w-full',
                  )}
                />
              )}
              <div className="max-w-[220px] rounded-[var(--radius-md)] border border-[var(--color-accent)]/35 bg-[var(--color-bg-tertiary)]/90 px-3 py-2 text-center shadow-xl shadow-black/35 backdrop-blur">
                <div className="text-[12px] font-bold text-[var(--color-text-primary)]">
                  {DROP_ZONE_COPY[edgeDrop].label}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                  {DROP_ZONE_COPY[edgeDrop].hint}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
