import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardPaste, Eraser, ListChecks, Send, StickyNote, X } from 'lucide-react'
import type { NoteImage, Session } from '@shared/types'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { registerContentSelectAllTarget } from '@/lib/contentSelectAll'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { assignNoteImageDisplayIndices, createInlinePlaceholderInsertion, createNoteImagePlaceholderText, pasteEventHasImage, readNoteImagesFromPasteEvent, removeNoteImagePlaceholders, syncNoteImagesWithBodyChange } from '@/lib/noteClipboardImage'
import { clearPtyInput, sendNoteContentToPty } from '@/lib/noteSend'
import { syncClassicNoteBodyToCanvas, syncClassicNoteImagesToCanvas } from '@/lib/noteSync'
import { getSessionIcon } from '@/lib/sessionIcon'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { SessionIconView } from './SessionIconView'

interface NoteSessionViewProps {
  session: Session
  isActive: boolean
}

const MENU_ITEM =
  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]'

type NoteUndoSnapshot = {
  body: string
  images: NoteImage[]
  selectionStart: number
  selectionEnd: number
}

const NOTE_UNDO_LIMIT = 120

function getTextareaSelection(textarea: HTMLTextAreaElement | null): string {
  if (!textarea) return ''
  return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
}

export function NoteSessionView({ session, isActive }: NoteSessionViewProps): JSX.Element {
  const connectedSession = useSessionsStore((state) =>
    session.connectedSessionId
      ? state.sessions.find((item) => item.id === session.connectedSessionId) ?? null
      : null,
  )
  const updateSession = useSessionsStore((state) => state.updateSession)
  const settings = useUIStore((state) => state.settings)
  const addToast = useUIStore((state) => state.addToast)
  const isDarkTheme = useIsDarkTheme()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const draftRef = useRef(session.noteBody ?? '')
  const undoStackRef = useRef<NoteUndoSnapshot[]>([])
  const [draft, setDraft] = useState(session.noteBody ?? '')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null)
  const noteImages = session.noteImages ?? []
  const canSend = Boolean(connectedSession?.ptyId && (draft.trim() || noteImages.length > 0))
  const canClearConnectedInput = Boolean(connectedSession?.ptyId)
  const connectedIcon = connectedSession ? getSessionIcon(connectedSession.type, isDarkTheme) : null

  useEffect(() => {
    setDraft(session.noteBody ?? '')
    draftRef.current = session.noteBody ?? ''
  }, [session.id, session.noteBody])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    if ((session.noteBody ?? '') === draft) return
    const timer = window.setTimeout(() => {
      updateSession(session.id, { noteBody: draft })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [draft, session.id, session.noteBody, updateSession])

  useEffect(() => () => {
    const latest = useSessionsStore.getState().sessions.find((item) => item.id === session.id)
    if ((latest?.noteBody ?? '') !== draftRef.current) {
      updateSession(session.id, { noteBody: draftRef.current })
    }
  }, [session.id, updateSession])

  useEffect(() => {
    if (!isActive) return
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
    })
  }, [isActive, session.id])

  useEffect(() => registerContentSelectAllTarget(session.id, () => {
    const textarea = textareaRef.current
    if (!textarea) return false
    textarea.focus()
    textarea.select()
    return true
  }), [session.id])

  useEffect(() => {
    if (!contextMenu) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [contextMenu])

  const sendText = useCallback((text: string, autoSubmit: boolean, includeUnreferencedImages: boolean) => {
    const value = text.trimEnd()
    if ((!value && !includeUnreferencedImages) || !session.connectedSessionId) return
    const target = useSessionsStore.getState().sessions.find((item) => item.id === session.connectedSessionId)
    if (!target?.ptyId) return
    setContextMenu(null)
    focusSessionTarget(target.id)
    window.setTimeout(() => {
      const latestTarget = useSessionsStore.getState().sessions.find((item) => item.id === target.id)
      const ptyId = latestTarget?.ptyId ?? target.ptyId
      if (ptyId) {
        void sendNoteContentToPty(ptyId, value, noteImages, autoSubmit, { includeUnreferencedImages })
          .then((ok) => {
            if (!ok) addToast({ type: 'error', title: '便签发送失败', body: '图片写入剪贴板失败。' })
          })
          .catch(() => addToast({ type: 'error', title: '便签发送失败', body: '图片写入剪贴板失败。' }))
      }
    }, 80)
  }, [addToast, noteImages, session.connectedSessionId])

  const sendCurrentSelectionOrDraft = useCallback((autoSubmit: boolean) => {
    const selectedText = getTextareaSelection(textareaRef.current)
    if (selectedText) {
      sendText(selectedText, autoSubmit, false)
      return
    }
    sendText(draftRef.current, autoSubmit, true)
  }, [sendText])

  const clearConnectedInput = useCallback(() => {
    const target = session.connectedSessionId
      ? useSessionsStore.getState().sessions.find((item) => item.id === session.connectedSessionId)
      : null
    if (!target?.ptyId) {
      addToast({ type: 'warning', title: '无法清空输入框', body: '连接的会话当前没有运行中的终端。' })
      return
    }
    clearPtyInput(target.ptyId)
  }, [addToast, session.connectedSessionId])

  const updateNoteImages = useCallback((nextImages: NoteImage[]) => {
    updateSession(session.id, { noteImages: nextImages })
    syncClassicNoteImagesToCanvas(session.noteSyncId, nextImages)
  }, [session.id, session.noteSyncId, updateSession])

  const pushUndoSnapshot = useCallback(() => {
    const textarea = textareaRef.current
    const snapshot: NoteUndoSnapshot = {
      body: draftRef.current,
      images: noteImages,
      selectionStart: textarea?.selectionStart ?? draftRef.current.length,
      selectionEnd: textarea?.selectionEnd ?? textarea?.selectionStart ?? draftRef.current.length,
    }
    const last = undoStackRef.current[undoStackRef.current.length - 1]
    if (last && last.body === snapshot.body && last.images === snapshot.images) return
    undoStackRef.current = [...undoStackRef.current, snapshot].slice(-NOTE_UNDO_LIMIT)
  }, [noteImages])

  const restoreUndoSnapshot = useCallback((snapshot: NoteUndoSnapshot) => {
    setDraft(snapshot.body)
    draftRef.current = snapshot.body
    updateSession(session.id, { noteBody: snapshot.body, noteImages: snapshot.images })
    syncClassicNoteBodyToCanvas(session.noteSyncId, snapshot.body)
    syncClassicNoteImagesToCanvas(session.noteSyncId, snapshot.images)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const start = Math.max(0, Math.min(snapshot.selectionStart, snapshot.body.length))
      const end = Math.max(start, Math.min(snapshot.selectionEnd, snapshot.body.length))
      textarea.focus()
      textarea.setSelectionRange(start, end)
    })
  }, [session.id, session.noteSyncId, updateSession])

  const undoLastChange = useCallback(() => {
    const snapshot = undoStackRef.current.pop()
    if (!snapshot) return false
    restoreUndoSnapshot(snapshot)
    return true
  }, [restoreUndoSnapshot])

  const handleTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
    if (!undoLastChange()) return
    event.preventDefault()
    event.stopPropagation()
  }, [undoLastChange])

  const updateDraft = useCallback((nextDraft: string) => {
    if (nextDraft === draftRef.current) return
    pushUndoSnapshot()
    const nextImages = syncNoteImagesWithBodyChange(draftRef.current, nextDraft, noteImages)
    setDraft(nextDraft)
    draftRef.current = nextDraft
    syncClassicNoteBodyToCanvas(session.noteSyncId, nextDraft)
    if (nextImages !== noteImages) updateNoteImages(nextImages)
  }, [noteImages, pushUndoSnapshot, session.noteSyncId, updateNoteImages])

  const addPastedImages = useCallback((images: NoteImage[]) => {
    if (images.length === 0) return
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? draftRef.current.length
    const end = textarea?.selectionEnd ?? start
    const currentDraft = draftRef.current
    const before = currentDraft.slice(0, start)
    const after = currentDraft.slice(end)
    const pastedImages = assignNoteImageDisplayIndices(images, noteImages)
    const placeholders = createNoteImagePlaceholderText(pastedImages)
    const insertedText = createInlinePlaceholderInsertion(before, placeholders, after)
    const nextDraft = `${before}${insertedText}${after}`
    pushUndoSnapshot()
    setDraft(nextDraft)
    draftRef.current = nextDraft
    updateSession(session.id, { noteBody: nextDraft })
    syncClassicNoteBodyToCanvas(session.noteSyncId, nextDraft)
    updateNoteImages([...noteImages, ...pastedImages])
    requestAnimationFrame(() => {
      const nextCursor = start + insertedText.length
      textarea?.focus()
      textarea?.setSelectionRange(nextCursor, nextCursor)
    })
    addToast({ type: 'success', title: '图片已粘贴到便签', body: pastedImages.length === 1 ? createNoteImagePlaceholderText(pastedImages) : `${pastedImages.length} 张图片` })
  }, [addToast, noteImages, pushUndoSnapshot, session.id, session.noteSyncId, updateNoteImages, updateSession])

  const removeNoteImage = useCallback((imageId: string) => {
    const image = noteImages.find((item) => item.id === imageId)
    const nextImages = noteImages.filter((item) => item.id !== imageId)
    const nextDraft = image ? removeNoteImagePlaceholders(draftRef.current, image) : draftRef.current
    pushUndoSnapshot()
    setDraft(nextDraft)
    draftRef.current = nextDraft
    updateSession(session.id, { noteBody: nextDraft })
    syncClassicNoteBodyToCanvas(session.noteSyncId, nextDraft)
    updateNoteImages(nextImages)
  }, [noteImages, pushUndoSnapshot, session.id, session.noteSyncId, updateNoteImages, updateSession])

  const selectAll = useCallback(() => {
    setContextMenu(null)
    const textarea = textareaRef.current
    textarea?.focus()
    textarea?.select()
  }, [])

  const openContextMenu = useCallback((event: ReactMouseEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      selectedText: getTextareaSelection(textareaRef.current),
    })
  }, [])

  const contextMenuStyle = useMemo(() => {
    if (!contextMenu) return undefined
    const width = 210
    const height = 232
    return {
      left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - height - 8)),
    }
  }, [contextMenu])

  return (
    <div className="flex h-full w-full flex-col bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <StickyNote size={15} className="shrink-0 text-[var(--color-accent)]" />
          <span className="shrink-0 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">便签</span>
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">连接到</span>
          {connectedSession ? (
            <button
              type="button"
              onClick={() => focusSessionTarget(connectedSession.id)}
              className="flex min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              title={connectedSession.name}
            >
              {connectedIcon && (
                <SessionIconView
                  icon={connectedSession.customSessionIcon}
                  fallbackSrc={connectedIcon}
                  className="h-4 w-4 shrink-0"
                  imageClassName="h-3.5 w-3.5 object-contain"
                />
              )}
              <span className="truncate">{connectedSession.name}</span>
            </button>
          ) : (
            <span className="truncate text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">会话已不存在</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={clearConnectedInput}
            disabled={!canClearConnectedInput}
            className="flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]"
            title="清空连接会话的输入框"
          >
            <Eraser size={12} />
            清空
          </button>
          <button
            type="button"
            onClick={() => sendCurrentSelectionOrDraft(false)}
            disabled={!canSend}
            className="flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]"
            title="只放入连接会话，不回车"
          >
            <ClipboardPaste size={12} />
            放入
          </button>
          <button
            type="button"
            onClick={() => sendCurrentSelectionOrDraft(true)}
            disabled={!canSend}
            className="flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 text-[var(--ui-font-xs)] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            title="发送到连接会话并回车"
          >
            <Send size={12} />
            发送
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <textarea
          ref={textareaRef}
          value={draft}
          spellCheck={false}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={handleTextareaKeyDown}
          onPaste={(event) => {
            if (!pasteEventHasImage(event)) return
            event.preventDefault()
            void readNoteImagesFromPasteEvent(event)
              .then(addPastedImages)
              .catch(() => addToast({ type: 'error', title: '图片粘贴失败', body: '无法读取剪贴板里的图片。' }))
          }}
          onContextMenu={openContextMenu}
          className="min-h-[120px] flex-1 resize-none bg-[var(--color-bg-primary)] p-4 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          style={{
            fontFamily: settings.terminalFontFamily,
            fontSize: settings.canvasNoteFontSize,
            lineHeight: `${Math.round(settings.canvasNoteFontSize * 1.5)}px`,
          }}
        />
        {noteImages.length > 0 && (
          <div className="grid max-h-[45%] shrink-0 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
            {noteImages.map((image) => (
              <div key={image.id} className="group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <img
                  src={image.dataUrl}
                  alt={image.name}
                  className="block max-h-64 w-full object-contain"
                  draggable={false}
                />
                <button
                  type="button"
                  onClick={() => removeNoteImage(image.id)}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                  title="移除图片"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {contextMenu && contextMenuStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[119]"
            onMouseDown={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setContextMenu(null)
            }}
          />
          <div
            className="no-drag fixed z-[120] w-[210px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/35"
            style={contextMenuStyle}
          >
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => sendText(contextMenu.selectedText, true, false)}
              disabled={!connectedSession?.ptyId || !contextMenu.selectedText.trim()}
            >
              <span className="flex items-center gap-2">
                <Send size={13} />
                发送选中内容
              </span>
            </button>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => sendText(draft, true, true)}
              disabled={!canSend}
            >
              <span className="flex items-center gap-2">
                <Send size={13} />
                发送全文
              </span>
            </button>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => sendText(contextMenu.selectedText, false, false)}
              disabled={!connectedSession?.ptyId || !contextMenu.selectedText.trim()}
            >
              <span className="flex items-center gap-2">
                <ClipboardPaste size={13} />
                放入选中内容
              </span>
            </button>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => sendText(draft, false, true)}
              disabled={!canSend}
            >
              <span className="flex items-center gap-2">
                <ClipboardPaste size={13} />
                放入全文
              </span>
            </button>
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <button
              type="button"
              className={MENU_ITEM}
              onClick={selectAll}
            >
              <span className="flex items-center gap-2">
                <ListChecks size={13} />
                全选
              </span>
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
