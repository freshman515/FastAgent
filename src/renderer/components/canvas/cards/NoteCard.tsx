import { createPortal } from 'react-dom'
import { ClipboardPaste, Send, X } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CanvasCard, NoteImage, Session } from '@shared/types'
import { assignNoteImageDisplayIndices, createInlinePlaceholderInsertion, createNoteImagePlaceholderText, pasteEventHasImage, readNoteImagesFromPasteEvent, removeNoteImagePlaceholders, syncNoteImagesWithBodyChange } from '@/lib/noteClipboardImage'
import { sendNoteContentToPty } from '@/lib/noteSend'
import { removeClassicNotesBySyncId, syncCanvasNoteBodyToClassic, syncCanvasNoteImagesToClassic } from '@/lib/noteSync'
import { useCanvasStore } from '@/stores/canvas'
import { useSessionsStore } from '@/stores/sessions'
import { CANVAS_NOTE_CARD_HEIGHT_MIN, CANVAS_NOTE_CARD_WIDTH_MIN, useUIStore } from '@/stores/ui'
import { cn } from '@/lib/utils'
import { CanvasMenuItem, CanvasMenuPanel, CanvasMenuSeparator } from '../CanvasMenu'
import { CardFrame, type CardCoordinateMode } from './CardFrame'

const NOTE_COLORS: Record<string, { label: string; accent: string }> = {
  yellow: {
    label: '黄',
    accent: '#fbbf24',
  },
  blue: {
    label: '蓝',
    accent: '#60a5fa',
  },
  green: {
    label: '绿',
    accent: '#4ade80',
  },
  pink: {
    label: '粉',
    accent: '#f472b6',
  },
  gray: {
    label: '灰',
    accent: 'var(--color-text-tertiary)',
  },
}

interface NoteCardProps {
  card: CanvasCard
  coordinateMode?: CardCoordinateMode
}

interface NoteSendTarget {
  cardId: string
  session: Session
  ptyId: string | null
}

type NoteSendMode = 'selection' | 'all'
type NoteSendPicker = {
  x: number
  y: number
  text: string
  autoSubmit: boolean
  includeUnreferencedImages: boolean
  targets: NoteSendTarget[]
}

type NoteUndoSnapshot = {
  body: string
  images: NoteImage[]
  selectionStart: number
  selectionEnd: number
}

const NOTE_UNDO_LIMIT = 120

export function NoteCard({ card, coordinateMode }: NoteCardProps): JSX.Element {
  const color = NOTE_COLORS[card.noteColor ?? 'yellow'] ?? NOTE_COLORS.yellow
  const updateCard = useCanvasStore((state) => state.updateCard)
  const removeCard = useCanvasStore((state) => state.removeCard)
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const relations = useCanvasStore((state) => state.getLayout().relations)
  const sessions = useSessionsStore((state) => state.sessions)
  const addToast = useUIStore((state) => state.addToast)
  const noteFontSize = useUIStore((state) => state.settings.canvasNoteFontSize)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const undoStackRef = useRef<NoteUndoSnapshot[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null)
  const [sendPicker, setSendPicker] = useState<NoteSendPicker | null>(null)

  const connectedTargets = useMemo(() => {
    const sessionById = new Map(sessions.map((session) => [session.id, session]))
    const cardById = new Map(cards.map((item) => [item.id, item]))
    const targetBySessionId = new Map<string, NoteSendTarget>()

    for (const relation of relations) {
      const otherCardId = relation.fromCardId === card.id
        ? relation.toCardId
        : relation.toCardId === card.id
          ? relation.fromCardId
          : null
      if (!otherCardId) continue

      const targetCard = cardById.get(otherCardId)
      if (!targetCard || (targetCard.kind !== 'session' && targetCard.kind !== 'terminal') || !targetCard.refId) continue

      const session = sessionById.get(targetCard.refId)
      if (!session || targetBySessionId.has(session.id)) continue
      targetBySessionId.set(session.id, {
        cardId: targetCard.id,
        session,
        ptyId: session.ptyId,
      })
    }

    return Array.from(targetBySessionId.values())
  }, [card.id, cards, relations, sessions])

  const getSelectedText = (): string => {
    const textarea = textareaRef.current
    if (!textarea) return ''
    if (textarea.selectionStart === textarea.selectionEnd) return ''
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
  }

  const selectAllText = (): void => {
    const textarea = textareaRef.current
    setContextMenu(null)
    if (!textarea) return
    textarea.focus()
    textarea.select()
  }

  const focusTarget = (target: NoteSendTarget): void => {
    useSessionsStore.getState().setActive(target.session.id)
    requestAnimationFrame(() => {
      useCanvasStore.getState().focusOnCard(target.cardId, { allowReturn: false })
    })
  }

  const sendTextToTarget = (
    target: NoteSendTarget,
    text: string,
    autoSubmit: boolean,
    includeUnreferencedImages: boolean,
  ): void => {
    if (!target.ptyId) {
      addToast({ type: 'warning', title: '无法发送便签', body: `${target.session.name} 当前没有运行中的终端。` })
      return
    }

    void sendNoteContentToPty(target.ptyId, text, noteImages, autoSubmit, { includeUnreferencedImages }).then((ok) => {
      if (!ok) {
        addToast({ type: 'error', title: '便签发送失败', body: '图片写入剪贴板失败。' })
        return
      }
      addToast({ type: 'success', title: autoSubmit ? '便签已发送' : '便签已放入会话', body: target.session.name })
    }).catch(() => {
      addToast({ type: 'error', title: '便签发送失败', body: '图片写入剪贴板失败。' })
    })
    focusTarget(target)
  }

  const sendText = (
    text: string,
    anchor: { x: number; y: number },
    autoSubmit: boolean,
    includeUnreferencedImages: boolean,
  ): void => {
    setContextMenu(null)
    if (!text.trim() && !includeUnreferencedImages) {
      addToast({ type: 'warning', title: '便签为空', body: '没有可发送的内容。' })
      return
    }
    if (connectedTargets.length === 0) {
      addToast({ type: 'warning', title: '没有连接的会话', body: '先把便签和一个会话卡片连接起来。' })
      return
    }

    const runningTargets = connectedTargets.filter((target) => target.ptyId)
    if (runningTargets.length === 0) {
      setSendPicker({ ...anchor, text, autoSubmit, includeUnreferencedImages, targets: connectedTargets })
      return
    }
    if (runningTargets.length === 1 && connectedTargets.length === 1) {
      sendTextToTarget(runningTargets[0], text, autoSubmit, includeUnreferencedImages)
      return
    }

    setSendPicker({ ...anchor, text, autoSubmit, includeUnreferencedImages, targets: connectedTargets })
  }

  const sendNoteText = (mode: NoteSendMode, anchor: { x: number; y: number }, autoSubmit: boolean, selectedText = getSelectedText()): void => {
    sendText(mode === 'selection' ? selectedText : (card.noteBody ?? ''), anchor, autoSubmit, mode === 'all')
  }

  const sendSelectedTextOrNote = (anchor: { x: number; y: number }, autoSubmit: boolean): void => {
    const selectedText = getSelectedText()
    if (selectedText) {
      sendText(selectedText, anchor, autoSubmit, false)
      return
    }
    sendNoteText('all', anchor, autoSubmit)
  }

  const noteBody = card.noteBody ?? ''
  const noteImages = card.noteImages ?? []
  const hasConnectedTarget = connectedTargets.length > 0
  const canSendNote = (noteBody.trim().length > 0 || noteImages.length > 0) && hasConnectedTarget
  const pushUndoSnapshot = (): void => {
    const textarea = textareaRef.current
    const snapshot: NoteUndoSnapshot = {
      body: noteBody,
      images: noteImages,
      selectionStart: textarea?.selectionStart ?? noteBody.length,
      selectionEnd: textarea?.selectionEnd ?? textarea?.selectionStart ?? noteBody.length,
    }
    const last = undoStackRef.current[undoStackRef.current.length - 1]
    if (last && last.body === snapshot.body && last.images === snapshot.images) return
    undoStackRef.current = [...undoStackRef.current, snapshot].slice(-NOTE_UNDO_LIMIT)
  }
  const restoreUndoSnapshot = (snapshot: NoteUndoSnapshot): void => {
    updateCard(card.id, { noteBody: snapshot.body, noteImages: snapshot.images })
    syncCanvasNoteBodyToClassic(card.noteSyncId, snapshot.body)
    syncCanvasNoteImagesToClassic(card.noteSyncId, snapshot.images)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const start = Math.max(0, Math.min(snapshot.selectionStart, snapshot.body.length))
      const end = Math.max(start, Math.min(snapshot.selectionEnd, snapshot.body.length))
      textarea.focus()
      textarea.setSelectionRange(start, end)
    })
  }
  const undoLastChange = (): boolean => {
    const snapshot = undoStackRef.current.pop()
    if (!snapshot) return false
    restoreUndoSnapshot(snapshot)
    return true
  }
  const handleTextareaKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
    if (!undoLastChange()) return
    event.preventDefault()
    event.stopPropagation()
  }
  const updateNoteBody = (nextBody: string): void => {
    if (nextBody === noteBody) return
    pushUndoSnapshot()
    const nextImages = syncNoteImagesWithBodyChange(noteBody, nextBody, noteImages)
    updateCard(card.id, nextImages === noteImages ? { noteBody: nextBody } : { noteBody: nextBody, noteImages: nextImages })
    syncCanvasNoteBodyToClassic(card.noteSyncId, nextBody)
    if (nextImages !== noteImages) syncCanvasNoteImagesToClassic(card.noteSyncId, nextImages)
  }
  const addPastedImages = (images: NoteImage[]): void => {
    if (images.length === 0) return
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? noteBody.length
    const end = textarea?.selectionEnd ?? start
    const before = noteBody.slice(0, start)
    const after = noteBody.slice(end)
    const pastedImages = assignNoteImageDisplayIndices(images, noteImages)
    const placeholders = createNoteImagePlaceholderText(pastedImages)
    const insertedText = createInlinePlaceholderInsertion(before, placeholders, after)
    const nextBody = `${before}${insertedText}${after}`
    const nextImages = [...noteImages, ...pastedImages]
    pushUndoSnapshot()
    updateCard(card.id, { noteBody: nextBody, noteImages: nextImages })
    syncCanvasNoteBodyToClassic(card.noteSyncId, nextBody)
    syncCanvasNoteImagesToClassic(card.noteSyncId, nextImages)
    requestAnimationFrame(() => {
      const nextCursor = start + insertedText.length
      textarea?.focus()
      textarea?.setSelectionRange(nextCursor, nextCursor)
    })
    addToast({ type: 'success', title: '图片已粘贴到便签', body: pastedImages.length === 1 ? createNoteImagePlaceholderText(pastedImages) : `${pastedImages.length} 张图片` })
  }
  const removeNoteImage = (imageId: string): void => {
    const image = noteImages.find((item) => item.id === imageId)
    const nextImages = noteImages.filter((item) => item.id !== imageId)
    const nextBody = image ? removeNoteImagePlaceholders(noteBody, image) : noteBody
    pushUndoSnapshot()
    updateCard(card.id, { noteBody: nextBody, noteImages: nextImages })
    syncCanvasNoteBodyToClassic(card.noteSyncId, nextBody)
    syncCanvasNoteImagesToClassic(card.noteSyncId, nextImages)
  }

  const title = (
    <span className="flex items-center gap-2">
      <span
        className="h-2.5 w-2.5 rounded-full shadow-sm"
        style={{ backgroundColor: color.accent, boxShadow: `0 0 0 3px color-mix(in srgb, ${color.accent} 18%, transparent)` }}
      />
      <span className="font-medium text-[var(--color-text-secondary)]">便签</span>
    </span>
  )

  const headerActions = (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={!canSendNote}
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          sendSelectedTextOrNote({ x: rect.left, y: rect.bottom + 6 }, true)
        }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] transition-colors',
          canSendNote
            ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
            : 'cursor-not-allowed text-[var(--color-text-tertiary)] opacity-45',
        )}
        title={hasConnectedTarget ? '发送便签到连接会话并回车' : '先连接一个会话卡片'}
      >
        <Send size={13} />
      </button>
      <button
        type="button"
        disabled={!canSendNote}
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          sendSelectedTextOrNote({ x: rect.left, y: rect.bottom + 6 }, false)
        }}
        className={cn(
          'mr-1 flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] transition-colors',
          canSendNote
            ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
            : 'cursor-not-allowed text-[var(--color-text-tertiary)] opacity-45',
        )}
        title={hasConnectedTarget ? '只放入连接会话，不回车' : '先连接一个会话卡片'}
      >
        <ClipboardPaste size={13} />
      </button>
      {Object.entries(NOTE_COLORS).map(([key, value]) => (
        <button
          key={key}
          type="button"
          onClick={(e) => { e.stopPropagation(); updateCard(card.id, { noteColor: key }) }}
          className={cn(
            'h-4 w-4 rounded-full border transition-transform hover:scale-110',
            (card.noteColor ?? 'yellow') === key && 'scale-110 ring-1 ring-white/40',
          )}
          style={{ backgroundColor: value.accent, borderColor: value.accent }}
          title={value.label}
        />
      ))}
    </div>
  )

  return (
    <CardFrame
      card={card}
      title={title}
      headerActions={headerActions}
      onDelete={() => {
        removeCard(card.id)
        removeClassicNotesBySyncId(card.noteSyncId)
      }}
      minWidth={CANVAS_NOTE_CARD_WIDTH_MIN}
      minHeight={CANVAS_NOTE_CARD_HEIGHT_MIN}
      coordinateMode={coordinateMode}
      focusOnClick
      showSelectionRing={false}
      frameClassName="canvas-note-frame"
      headerClassName="canvas-note-header"
      bodyClassName="canvas-note-body"
      frameStyleOverride={{
        background: 'var(--color-terminal-bg)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <textarea
          ref={textareaRef}
          value={noteBody}
          onChange={(e) => updateNoteBody(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          onPaste={(event) => {
            if (!pasteEventHasImage(event)) return
            event.preventDefault()
            void readNoteImagesFromPasteEvent(event)
              .then(addPastedImages)
              .catch(() => addToast({ type: 'error', title: '图片粘贴失败', body: '无法读取剪贴板里的图片。' }))
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              selectedText: getSelectedText(),
            })
          }}
          placeholder="写点什么..."
          className="min-h-[96px] flex-1 resize-none border-0 bg-transparent px-4 pb-3 pt-3 text-[var(--ui-font-sm)] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          style={{
            fontSize: noteFontSize,
            lineHeight: `${Math.round(noteFontSize * 1.5)}px`,
          }}
        />
        {noteImages.length > 0 && (
          <div className="grid max-h-[45%] shrink-0 grid-cols-2 gap-2 overflow-y-auto border-t border-[var(--color-border)]/60 px-3 py-3">
            {noteImages.map((image) => (
              <div key={image.id} className="group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <img
                  src={image.dataUrl}
                  alt={image.name}
                  className="block max-h-48 w-full object-contain"
                  draggable={false}
                />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeNoteImage(image.id)
                  }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                  title="移除图片"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9499]" onPointerDown={() => setContextMenu(null)} />
          <CanvasMenuPanel x={contextMenu.x} y={contextMenu.y} width={218} height={274}>
            <CanvasMenuItem
              label="发送选中内容"
              disabled={!contextMenu.selectedText.trim() || connectedTargets.length === 0}
              onClick={() => sendNoteText('selection', contextMenu, true, contextMenu.selectedText)}
            />
            <CanvasMenuItem
              label="发送全文"
              disabled={(noteBody.trim().length === 0 && noteImages.length === 0) || connectedTargets.length === 0}
              onClick={() => sendNoteText('all', contextMenu, true)}
            />
            <CanvasMenuItem
              label="放入选中内容"
              disabled={!contextMenu.selectedText.trim() || connectedTargets.length === 0}
              onClick={() => sendNoteText('selection', contextMenu, false, contextMenu.selectedText)}
            />
            <CanvasMenuItem
              label="放入全文"
              disabled={(noteBody.trim().length === 0 && noteImages.length === 0) || connectedTargets.length === 0}
              onClick={() => sendNoteText('all', contextMenu, false)}
            />
            <CanvasMenuSeparator />
            <CanvasMenuItem label="全选" shortcut="Ctrl+A" disabled={!noteBody} onClick={selectAllText} />
          </CanvasMenuPanel>
        </>,
        document.body,
      )}
      {sendPicker && createPortal(
        <>
          <div className="fixed inset-0 z-[9499]" onPointerDown={() => setSendPicker(null)} />
          <CanvasMenuPanel x={sendPicker.x} y={sendPicker.y} width={240} height={260}>
            <div className="px-3 py-2 text-[var(--ui-font-2xs)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
              {sendPicker.autoSubmit ? '发送到会话' : '放入会话'}
            </div>
            {sendPicker.targets.map((target) => (
              <CanvasMenuItem
                key={`${target.cardId}:${target.session.id}`}
                label={target.ptyId
                  ? target.session.name
                  : `${target.session.name}（未运行）`}
                disabled={!target.ptyId}
                onClick={() => {
                  setSendPicker(null)
                  sendTextToTarget(target, sendPicker.text, sendPicker.autoSubmit, sendPicker.includeUnreferencedImages)
                }}
              />
            ))}
          </CanvasMenuPanel>
        </>,
        document.body,
      )}
    </CardFrame>
  )
}
