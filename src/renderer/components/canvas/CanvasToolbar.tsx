import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Bookmark,
  Check,
  Frame,
  Grid3x3,
  LayoutGrid,
  Link2,
  Lock,
  Magnet,
  Maximize2,
  PanelsTopLeft,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  SquareEqual,
  StickyNote,
  Trash2,
  Unlock,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/stores/canvas'
import { useUIStore, type CanvasArrangeMode } from '@/stores/ui'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface CanvasToolbarProps {
  viewportRef: React.RefObject<HTMLDivElement | null>
  onOpenSearch: () => void
}

const CARD_NORMALIZATION_NAVIGATION_DELAY_MS = 300

export function CanvasToolbar({ viewportRef, onOpenSearch }: CanvasToolbarProps): JSX.Element {
  const scale = useCanvasStore((state) => state.getLayout().viewport.scale)
  const bookmarks = useCanvasStore((state) => state.getLayout().bookmarks)
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)
  const addCard = useCanvasStore((state) => state.addCard)
  const addFrameAroundCards = useCanvasStore((state) => state.addFrameAroundCards)
  const addBookmark = useCanvasStore((state) => state.addBookmark)
  const goToBookmark = useCanvasStore((state) => state.goToBookmark)
  const updateBookmarkViewport = useCanvasStore((state) => state.updateBookmarkViewport)
  const renameBookmark = useCanvasStore((state) => state.renameBookmark)
  const removeBookmark = useCanvasStore((state) => state.removeBookmark)
  const addRelation = useCanvasStore((state) => state.addRelation)
  const alignCards = useCanvasStore((state) => state.alignCards)
  const distributeCards = useCanvasStore((state) => state.distributeCards)
  const removeCards = useCanvasStore((state) => state.removeCards)
  const resetViewport = useCanvasStore((state) => state.resetViewport)
  const fitAll = useCanvasStore((state) => state.fitAll)
  const normalizeCardsToFocusArea = useCanvasStore((state) => state.normalizeCardsToFocusArea)
  const normalizeCardsToDefaultSessionSize = useCanvasStore((state) => state.normalizeCardsToDefaultSessionSize)
  const arrange = useCanvasStore((state) => state.arrange)

  const gridEnabled = useUIStore((state) => state.settings.canvasGridEnabled)
  const snapEnabled = useUIStore((state) => state.settings.canvasSnapEnabled)
  const layoutLocked = useUIStore((state) => state.settings.canvasLayoutLocked)
  const overlapMode = useUIStore((state) => state.settings.canvasOverlapMode)
  const arrangeMode = useUIStore((state) => state.settings.canvasArrangeMode)
  const updateSettings = useUIStore((state) => state.updateSettings)

  const [arrangeOpen, setArrangeOpen] = useState(false)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false)
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null)
  const [editingBookmarkName, setEditingBookmarkName] = useState('')
  const [pendingRecordBookmark, setPendingRecordBookmark] = useState<{ id: string; name: string } | null>(null)
  const arrangeRef = useRef<HTMLDivElement>(null)
  const bookmarksRef = useRef<HTMLDivElement>(null)
  const sizeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!arrangeOpen && !bookmarksOpen && !sizeMenuOpen) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        arrangeRef.current?.contains(target)
        || bookmarksRef.current?.contains(target)
        || sizeMenuRef.current?.contains(target)
      ) return
      setArrangeOpen(false)
      setBookmarksOpen(false)
      setSizeMenuOpen(false)
      setEditingBookmarkId(null)
      setEditingBookmarkName('')
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [arrangeOpen, bookmarksOpen, sizeMenuOpen])

  const createNoteAtCenter = (): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const { scale: s, offsetX, offsetY } = useCanvasStore.getState().getLayout().viewport
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const x = (centerX - offsetX) / s - 120
    const y = (centerY - offsetY) / s - 80
    addCard({ kind: 'note', x, y, noteBody: '', noteColor: 'yellow' })
  }

  const getViewportCenter = (): { x: number; y: number } | null => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return null
    const { scale: s, offsetX, offsetY } = useCanvasStore.getState().getLayout().viewport
    return {
      x: (rect.width / 2 - offsetX) / s,
      y: (rect.height / 2 - offsetY) / s,
    }
  }

  const createFrame = (): void => {
    const center = getViewportCenter()
    addFrameAroundCards(selectedCardIds, center ?? undefined)
  }

  const connectSelection = (): void => {
    if (selectedCardIds.length !== 2) return
    addRelation(selectedCardIds[0], selectedCardIds[1])
  }

  const removeSelection = (): void => {
    if (selectedCardIds.length === 0) return
    removeCards(selectedCardIds)
  }

  const handleFitAll = (): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    fitAll(rect.width, rect.height)
  }

  const navigateAfterCardNormalization = (selectedCardId: string | null): void => {
    window.setTimeout(() => {
      const canvas = useCanvasStore.getState()
      if (selectedCardId && canvas.getCard(selectedCardId)) {
        canvas.clearFocusReturn()
        canvas.focusOnCard(selectedCardId)
        return
      }

      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      canvas.fitAll(rect.width, rect.height)
    }, CARD_NORMALIZATION_NAVIGATION_DELAY_MS)
  }

  const normalizeCardsAndNavigate = (normalize: () => void): void => {
    const selectedCardId = useCanvasStore.getState().selectedCardIds[0] ?? null
    normalize()
    navigateAfterCardNormalization(selectedCardId)
  }

  const handleNormalizeToFocusArea = (): void => {
    setSizeMenuOpen(false)
    normalizeCardsAndNavigate(normalizeCardsToFocusArea)
  }

  const handleNormalizeToDefaultSize = (): void => {
    setSizeMenuOpen(false)
    normalizeCardsAndNavigate(normalizeCardsToDefaultSessionSize)
  }

  const btn = (active: boolean): string => cn(
    'flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] transition-colors',
    active
      ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
  )

  const disabledBtn = 'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]'

  const handleArrangeMode = (mode: CanvasArrangeMode): void => {
    updateSettings({ canvasArrangeMode: mode })
    if (mode !== 'free') arrange(mode)
    setArrangeOpen(false)
  }

  const handlePack = (): void => {
    updateSettings({ canvasArrangeMode: 'free' })
    arrange('pack')
    setArrangeOpen(false)
  }

  const beginBookmarkRename = (id: string, name: string): void => {
    setEditingBookmarkId(id)
    setEditingBookmarkName(name)
  }

  const commitBookmarkRename = (): void => {
    if (!editingBookmarkId) return
    renameBookmark(editingBookmarkId, editingBookmarkName)
    setEditingBookmarkId(null)
    setEditingBookmarkName('')
  }

  const cancelBookmarkRename = (): void => {
    setEditingBookmarkId(null)
    setEditingBookmarkName('')
  }

  const confirmBookmarkRecord = (): void => {
    if (!pendingRecordBookmark) return
    updateBookmarkViewport(pendingRecordBookmark.id)
    setPendingRecordBookmark(null)
  }

  return (
    <>
    <div data-canvas-toolbar className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/95 p-1 shadow-lg backdrop-blur">
      <button type="button" onClick={createNoteAtCenter} className={btn(false)} title="新建便签">
        <StickyNote size={16} />
      </button>
      <button type="button" onClick={createFrame} className={btn(false)} title="新建分组框">
        <Frame size={16} />
      </button>
      <button
        type="button"
        onClick={connectSelection}
        disabled={selectedCardIds.length !== 2}
        className={cn(btn(false), disabledBtn)}
        title="连接选中卡片"
      >
        <Link2 size={16} />
      </button>
      {selectedCardIds.length > 1 && (
        <>
          <div className="mx-0.5 h-6 w-px bg-[var(--color-border)]" />
          <span
            className="flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] px-2 text-[var(--ui-font-xs)] font-medium text-[var(--color-accent)]"
            title="已选择卡片数"
          >
            {selectedCardIds.length}
          </span>
          <button type="button" onClick={() => alignCards('left', selectedCardIds)} className={btn(false)} title="左对齐">
            <AlignStartVertical size={16} />
          </button>
          <button type="button" onClick={() => alignCards('hCenter', selectedCardIds)} className={btn(false)} title="水平居中对齐">
            <AlignCenterVertical size={16} />
          </button>
          <button type="button" onClick={() => alignCards('right', selectedCardIds)} className={btn(false)} title="右对齐">
            <AlignEndVertical size={16} />
          </button>
          <button type="button" onClick={() => alignCards('top', selectedCardIds)} className={btn(false)} title="上对齐">
            <AlignStartHorizontal size={16} />
          </button>
          <button type="button" onClick={() => alignCards('vCenter', selectedCardIds)} className={btn(false)} title="垂直居中对齐">
            <AlignCenterHorizontal size={16} />
          </button>
          <button type="button" onClick={() => alignCards('bottom', selectedCardIds)} className={btn(false)} title="下对齐">
            <AlignEndHorizontal size={16} />
          </button>
          <button
            type="button"
            onClick={() => distributeCards('horizontal', selectedCardIds)}
            disabled={selectedCardIds.length < 3}
            className={cn(btn(false), disabledBtn)}
            title="横向等距分布"
          >
            <AlignHorizontalSpaceBetween size={16} />
          </button>
          <button
            type="button"
            onClick={() => distributeCards('vertical', selectedCardIds)}
            disabled={selectedCardIds.length < 3}
            className={cn(btn(false), disabledBtn)}
            title="纵向等距分布"
          >
            <AlignVerticalSpaceBetween size={16} />
          </button>
          <button
            type="button"
            onClick={removeSelection}
            className={cn(
              btn(false),
              'text-[var(--color-error)] hover:bg-[var(--color-error)]/12 hover:text-[var(--color-error)]',
            )}
            title="从画布移除选中卡片"
          >
            <Trash2 size={16} />
          </button>
        </>
      )}
      <div className="mx-0.5 h-6 w-px bg-[var(--color-border)]" />

      <button type="button" onClick={onOpenSearch} className={btn(false)} title="搜索画布">
        <Search size={16} />
      </button>
      <div ref={bookmarksRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setBookmarksOpen((prev) => {
              const next = !prev
              if (!next) {
                setEditingBookmarkId(null)
                setEditingBookmarkName('')
              }
              return next
            })
            setArrangeOpen(false)
            setSizeMenuOpen(false)
          }}
          className={btn(bookmarksOpen || bookmarks.length > 0)}
          title="视图书签"
        >
          <Bookmark size={16} />
        </button>
        {bookmarksOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-1 shadow-xl">
            <BookmarkItem label="保存当前视图" onClick={() => addBookmark()} />
            {bookmarks.length > 0 && <div className="my-1 h-px bg-[var(--color-border)]" />}
            {bookmarks.map((bookmark, index) => (
              <div
                key={bookmark.id}
                className="canvas-arrange-menu-item group relative flex items-center gap-1 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)]"
              >
                <span className="canvas-arrange-menu-item-indicator absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-[var(--color-accent)]" />
                {editingBookmarkId === bookmark.id ? (
                  <>
                    <input
                      autoFocus
                      value={editingBookmarkName}
                      onChange={(event) => setEditingBookmarkName(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') commitBookmarkRename()
                        if (event.key === 'Escape') cancelBookmarkRename()
                      }}
                      className="ml-2 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-accent)]/45 bg-[var(--color-bg-primary)] px-2 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none shadow-[0_0_0_2px_var(--color-accent-muted)]"
                    />
                    <button
                      type="button"
                      onClick={commitBookmarkRename}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent-muted)]"
                      title="保存名称"
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelBookmarkRename}
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                      title="取消"
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        goToBookmark(bookmark.id)
                        setBookmarksOpen(false)
                      }}
                      className="min-w-0 flex-1 px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-inherit"
                    >
                      <span className="block truncate">{bookmark.name}</span>
                    </button>
                    {index < 9 && (
                      <span className="shrink-0 px-1 text-[10px] font-semibold text-[var(--color-text-tertiary)] opacity-55 transition-all group-hover:text-[var(--color-accent)] group-hover:opacity-100">
                        Alt+{index + 1}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingRecordBookmark({ id: bookmark.id, name: bookmark.name })}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] opacity-0 transition-all hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-accent)] group-hover:opacity-100"
                      title="重新录制当前视图"
                    >
                      <RefreshCw size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => beginBookmarkRename(bookmark.id, bookmark.name)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] opacity-0 transition-all hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
                      title="重命名"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBookmark(bookmark.id)}
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] opacity-0 transition-all hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-error)] group-hover:opacity-100"
                      title="删除书签"
                    >
                      <X size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mx-0.5 h-6 w-px bg-[var(--color-border)]" />

      <div ref={arrangeRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setArrangeOpen((prev) => !prev)
            setBookmarksOpen(false)
            setSizeMenuOpen(false)
            setEditingBookmarkId(null)
            setEditingBookmarkName('')
          }}
          className={btn(arrangeOpen || arrangeMode !== 'free')}
          title={`排列模式：${getArrangeModeLabel(arrangeMode)}`}
        >
          <LayoutGrid size={16} />
        </button>
        {arrangeOpen && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[168px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-1 shadow-xl">
            <ArrangeItem label="自由排列" onClick={() => handleArrangeMode('free')} />
            <ArrangeItem label="网格排列" onClick={() => handleArrangeMode('grid')} />
            <ArrangeItem label="横向排列" onClick={() => handleArrangeMode('rowFlow')} />
            <ArrangeItem label="纵向排列" onClick={() => handleArrangeMode('colFlow')} />
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <ArrangeItem label="紧凑打包" onClick={handlePack} />
          </div>
        )}
      </div>

      <button type="button" onClick={handleFitAll} className={btn(false)} title="适配所有内容 (Alt+A)">
        <Maximize2 size={16} />
      </button>
      <div ref={sizeMenuRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setSizeMenuOpen((prev) => !prev)
            setArrangeOpen(false)
            setBookmarksOpen(false)
            setEditingBookmarkId(null)
            setEditingBookmarkName('')
          }}
          className={btn(sizeMenuOpen)}
          title="调整整体尺寸"
        >
          <SquareEqual size={16} />
        </button>
        {sizeMenuOpen && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[220px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-1 shadow-xl">
            <SizeItem icon={<SquareEqual size={14} />} label="适配聚焦工作区" onClick={handleNormalizeToFocusArea} />
            <SizeItem icon={<PanelsTopLeft size={14} />} label="恢复新建会话尺寸" onClick={handleNormalizeToDefaultSize} />
          </div>
        )}
      </div>
      <button type="button" onClick={resetViewport} className={btn(false)} title="重置视图 (100%)">
        <RotateCcw size={16} />
      </button>
      <button
        type="button"
        onClick={() => updateSettings({ canvasLayoutLocked: !layoutLocked })}
        className={btn(layoutLocked)}
        title={layoutLocked ? '布局已锁定，点击解锁' : '锁定布局，防止误拖动和误调整'}
      >
        {layoutLocked ? <Lock size={16} /> : <Unlock size={16} />}
      </button>
      <button
        type="button"
        onClick={() => updateSettings({ canvasGridEnabled: !gridEnabled })}
        className={btn(gridEnabled)}
        title="显示网格"
      >
        <Grid3x3 size={16} />
      </button>
      <button
        type="button"
        onClick={() => updateSettings({ canvasSnapEnabled: !snapEnabled })}
        className={btn(snapEnabled)}
        title="吸附到网格"
      >
        <Magnet size={16} />
      </button>
      <button
        type="button"
        onClick={() => updateSettings({ canvasOverlapMode: overlapMode === 'avoid' ? 'free' : 'avoid' })}
        className={cn(
          'flex h-8 min-w-12 items-center justify-center rounded-[var(--radius-md)] px-2 text-[var(--ui-font-2xs)] font-medium transition-colors',
          overlapMode === 'avoid'
            ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
        )}
        title={overlapMode === 'avoid' ? '当前：避免重叠。点击切换为允许重叠' : '当前：允许重叠。点击切换为避免重叠'}
      >
        {overlapMode === 'avoid' ? '避让' : '重叠'}
      </button>
      <div className="mx-0.5 h-6 w-px bg-[var(--color-border)]" />
      <span
        className="px-2 text-[var(--ui-font-xs)] font-mono text-[var(--color-text-tertiary)]"
        title="缩放"
      >
        {Math.round(scale * 100)}%
      </span>
    </div>
    {pendingRecordBookmark && (
      <ConfirmDialog
        title="重新录制视图"
        message={`将用当前画布的位置和缩放覆盖「${pendingRecordBookmark.name}」。是否继续？`}
        confirmLabel="重新录制"
        cancelLabel="取消"
        onConfirm={confirmBookmarkRecord}
        onCancel={() => setPendingRecordBookmark(null)}
      />
    )}
    </>
  )
}

function ArrangeItem({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="canvas-arrange-menu-item group relative flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]"
    >
      <span className="canvas-arrange-menu-item-indicator absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-[var(--color-accent)]" />
      <span className="flex-1">{label}</span>
    </button>
  )
}

function BookmarkItem({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="canvas-arrange-menu-item group relative flex w-full items-center rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]"
    >
      <span className="canvas-arrange-menu-item-indicator absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-[var(--color-accent)]" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

function SizeItem({ icon, label, onClick }: { icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="canvas-arrange-menu-item group relative flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]"
    >
      <span className="canvas-arrange-menu-item-indicator absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-[var(--color-accent)]" />
      <span className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-tertiary)] transition-colors group-hover:text-[var(--color-accent)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function getArrangeModeLabel(mode: CanvasArrangeMode): string {
  switch (mode) {
    case 'grid': return '网格排列'
    case 'rowFlow': return '横向排列'
    case 'colFlow': return '纵向排列'
    case 'free': return '自由排列'
  }
}
