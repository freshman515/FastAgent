import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CanvasCard } from '@shared/types'
import { EditorView } from '@/components/session/EditorView'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FILE_ICONS, resolveEditorLanguage, useEditorsStore, type EditorTab } from '@/stores/editors'
import { useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { CanvasMenuItem, CanvasMenuPanel, CanvasMenuSeparator } from '../CanvasMenu'
import { CardFrame, type CardCoordinateMode } from './CardFrame'

interface EditorCardProps {
  card: CanvasCard
  coordinateMode?: CardCoordinateMode
}

export function EditorCard({ card, coordinateMode }: EditorCardProps): JSX.Element | null {
  const tab = useEditorsStore((state) =>
    card.refId ? state.tabs.find((item) => item.id === card.refId) ?? null : null,
  )
  const selected = useCanvasStore((state) => state.selectedCardIds.includes(card.id))
  const isMaximized = useCanvasStore((state) => state.maximizedCardId === card.id)
  const removeCard = useCanvasStore((state) => state.removeCard)
  const toggleCardFavorite = useCanvasStore((state) => state.toggleCardFavorite)
  const toggleMaximizedCard = useCanvasStore((state) => state.toggleMaximizedCard)
  const addCardSnapshot = useCanvasStore((state) => state.addCardSnapshot)
  const restoreCardSnapshot = useCanvasStore((state) => state.restoreCardSnapshot)
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const [titleMenu, setTitleMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [pendingBulkClose, setPendingBulkClose] = useState<{ ids: string[]; label: string; modifiedCount: number } | null>(null)

  if (!tab) return null

  const language = resolveEditorLanguage(tab.fileName, tab.language)
  const iconInfo = FILE_ICONS[language] ?? FILE_ICONS.plaintext
  const sortedEditorCards = useMemo(
    () => cards
      .filter((item) => item.kind === 'editor' && item.refId)
      .sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.createdAt - b.createdAt)),
    [cards],
  )
  const allEditorCardIds = useMemo(
    () => sortedEditorCards.map((item) => item.refId).filter((id): id is string => Boolean(id)),
    [sortedEditorCards],
  )
  const otherEditorCardIds = useMemo(
    () => allEditorCardIds.filter((id) => id !== tab.id),
    [allEditorCardIds, tab.id],
  )
  const editorCardCenterX = card.x + card.width / 2
  const leftEditorCardIds = useMemo(
    () => sortedEditorCards
      .filter((item) => item.id !== card.id && item.x + item.width / 2 < editorCardCenterX)
      .map((item) => item.refId)
      .filter((id): id is string => Boolean(id)),
    [card.id, editorCardCenterX, sortedEditorCards],
  )
  const rightEditorCardIds = useMemo(
    () => sortedEditorCards
      .filter((item) => item.id !== card.id && item.x + item.width / 2 > editorCardCenterX)
      .map((item) => item.refId)
      .filter((id): id is string => Boolean(id)),
    [card.id, editorCardCenterX, sortedEditorCards],
  )
  const title = (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="inline-flex h-[22px] min-w-[28px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] px-1 text-[9px] font-bold leading-none"
        style={{
          color: iconInfo.color,
          backgroundColor: `${iconInfo.color}18`,
          border: `1px solid ${iconInfo.color}22`,
        }}
      >
        {iconInfo.icon}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        {card.favorite && <Star size={12} className="shrink-0 fill-[var(--color-accent)] text-[var(--color-accent)]" />}
        <span className="truncate font-medium text-[var(--color-text-primary)]">{tab.fileName}</span>
        {tab.modified && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" title="未保存" />}
      </span>
    </div>
  )

  const closeTitleMenu = (): void => setTitleMenu(null)

  const detachCardFromCanvas = (): void => {
    closeTitleMenu()
    removeCard(card.id)
  }

  const closeFileTabs = (ids: string[]): void => {
    const targets = [...new Set(ids)]
      .map((id) => useEditorsStore.getState().getTab(id))
      .filter((item): item is EditorTab => Boolean(item))
    const paneStore = usePanesStore.getState()
    const canvasStore = useCanvasStore.getState()
    const editorStore = useEditorsStore.getState()
    for (const target of targets) {
      const paneIds = Object.entries(paneStore.paneSessions)
        .filter(([, tabIds]) => tabIds.includes(target.id))
        .map(([paneId]) => paneId)
      for (const paneId of paneIds) {
        paneStore.removeSessionFromPane(paneId, target.id)
      }
      canvasStore.detachSessionEverywhere(target.id)
      editorStore.closeTab(target.id)
    }
    setConfirmClose(false)
    setPendingBulkClose(null)
    closeTitleMenu()
  }

  const closeFileTab = (): void => {
    closeFileTabs([tab.id])
  }

  const requestCloseFile = (): void => {
    closeTitleMenu()
    if (tab.modified) {
      setConfirmClose(true)
      return
    }
    closeFileTab()
  }

  const requestBulkClose = (ids: string[], label: string): void => {
    const targets = [...new Set(ids)]
      .map((id) => useEditorsStore.getState().getTab(id))
      .filter((item): item is EditorTab => Boolean(item))
    closeTitleMenu()
    if (targets.length === 0) return
    const modifiedCount = targets.filter((item) => item.modified).length
    if (modifiedCount > 0) {
      setPendingBulkClose({ ids: targets.map((item) => item.id), label, modifiedCount })
      return
    }
    closeFileTabs(targets.map((item) => item.id))
  }

  const restoreCard = (): void => {
    closeTitleMenu()
    useCanvasStore.getState().clearMaximizedCard()
  }

  const maximizeCard = (): void => {
    closeTitleMenu()
    toggleMaximizedCard(card.id)
  }

  const toggleFavorite = (): void => {
    closeTitleMenu()
    toggleCardFavorite(card.id)
  }

  const saveCardSnapshot = (): void => {
    closeTitleMenu()
    addCardSnapshot(card.id, tab.fileName)
  }

  const restoreSnapshot = (snapshotId: string): void => {
    closeTitleMenu()
    restoreCardSnapshot(card.id, snapshotId)
  }

  return (
    <>
      <CardFrame
        card={card}
        title={title}
        headerActions={
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              toggleMaximizedCard(card.id)
            }}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            title={isMaximized ? '还原' : '最大化'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        }
        onHeaderContextMenu={(event) => setTitleMenu({ x: event.clientX, y: event.clientY })}
        onDelete={requestCloseFile}
        deleteTitle="关闭文件"
        minWidth={360}
        minHeight={260}
        borderless
        frameClassName="canvas-editor-frame"
        bodyClassName="bg-[var(--color-bg-primary)]"
        coordinateMode={coordinateMode}
        focusOnClick
      >
        <div className="h-full w-full overflow-hidden">
          <EditorView editorTabId={tab.id} isActive={selected} />
        </div>
      </CardFrame>

      {titleMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[420]" onPointerDown={() => setTitleMenu(null)} />
          <CanvasMenuPanel x={titleMenu.x} y={titleMenu.y} width={210} height={390}>
            <CanvasMenuItem label={isMaximized ? '还原' : '最大化'} onClick={isMaximized ? restoreCard : maximizeCard} />
            <CanvasMenuItem label={card.favorite ? '取消收藏' : '收藏卡片'} onClick={toggleFavorite} />
            <CanvasMenuItem label="保存卡片快照" onClick={saveCardSnapshot} />
            {(card.cardSnapshots?.length ?? 0) > 0 && (
              <>
                <CanvasMenuSeparator />
                {card.cardSnapshots?.slice(-4).reverse().map((snapshot) => (
                  <CanvasMenuItem
                    key={snapshot.id}
                    label={`恢复：${snapshot.name}`}
                    onClick={() => restoreSnapshot(snapshot.id)}
                  />
                ))}
              </>
            )}
            <CanvasMenuSeparator />
            <CanvasMenuItem label="置顶" onClick={() => { closeTitleMenu(); useCanvasStore.getState().bringToFront(card.id) }} />
            <CanvasMenuSeparator />
            <CanvasMenuItem label="从画布移除" onClick={detachCardFromCanvas} />
            <CanvasMenuItem label="关闭文件" danger onClick={requestCloseFile} />
            <CanvasMenuItem
              label="关闭其他文件卡片"
              danger
              disabled={otherEditorCardIds.length === 0}
              onClick={() => requestBulkClose(otherEditorCardIds, '其他文件卡片')}
            />
            <CanvasMenuItem
              label="关闭左侧文件卡片"
              danger
              disabled={leftEditorCardIds.length === 0}
              onClick={() => requestBulkClose(leftEditorCardIds, '左侧文件卡片')}
            />
            <CanvasMenuItem
              label="关闭右侧文件卡片"
              danger
              disabled={rightEditorCardIds.length === 0}
              onClick={() => requestBulkClose(rightEditorCardIds, '右侧文件卡片')}
            />
            <CanvasMenuItem
              label="关闭全部文件卡片"
              danger
              disabled={allEditorCardIds.length === 0}
              onClick={() => requestBulkClose(allEditorCardIds, '全部文件卡片')}
            />
          </CanvasMenuPanel>
        </>,
        document.body,
      )}

      {confirmClose && (
        <ConfirmDialog
          title="未保存更改"
          message={`"${tab.fileName}" 有未保存更改，仍要关闭吗？`}
          confirmLabel="关闭"
          cancelLabel="取消"
          danger
          onConfirm={closeFileTab}
          onCancel={() => setConfirmClose(false)}
        />
      )}

      {pendingBulkClose && (
        <ConfirmDialog
          title={`关闭${pendingBulkClose.label}`}
          message={
            pendingBulkClose.modifiedCount > 0
              ? `${pendingBulkClose.modifiedCount} 个文件有未保存更改，仍要关闭 ${pendingBulkClose.ids.length} 个文件卡片吗？`
              : `将关闭 ${pendingBulkClose.ids.length} 个文件卡片，确认操作吗？`
          }
          confirmLabel="关闭"
          cancelLabel="取消"
          danger
          onConfirm={() => closeFileTabs(pendingBulkClose.ids)}
          onCancel={() => setPendingBulkClose(null)}
        />
      )}
    </>
  )
}
