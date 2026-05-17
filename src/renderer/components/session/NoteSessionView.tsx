import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ListChecks, Send, StickyNote } from 'lucide-react'
import type { Session } from '@shared/types'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { registerContentSelectAllTarget } from '@/lib/contentSelectAll'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { sendNoteTextToPty } from '@/lib/noteSend'
import { syncClassicNoteBodyToCanvas } from '@/lib/noteSync'
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
  const isDarkTheme = useIsDarkTheme()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const draftRef = useRef(session.noteBody ?? '')
  const [draft, setDraft] = useState(session.noteBody ?? '')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null)
  const canSend = Boolean(connectedSession?.ptyId && draft.trim())
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
    requestAnimationFrame(() => textareaRef.current?.focus())
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

  const sendText = useCallback((text: string) => {
    const value = text.trimEnd()
    if (!value || !session.connectedSessionId) return
    const target = useSessionsStore.getState().sessions.find((item) => item.id === session.connectedSessionId)
    if (!target?.ptyId) return
    setContextMenu(null)
    focusSessionTarget(target.id)
    window.setTimeout(() => {
      const latestTarget = useSessionsStore.getState().sessions.find((item) => item.id === target.id)
      const ptyId = latestTarget?.ptyId ?? target.ptyId
      if (ptyId) void sendNoteTextToPty(ptyId, value, settings.noteSendAutoSubmit)
    }, 80)
  }, [session.connectedSessionId, settings.noteSendAutoSubmit])

  const updateDraft = useCallback((nextDraft: string) => {
    setDraft(nextDraft)
    syncClassicNoteBodyToCanvas(session.noteSyncId, nextDraft)
  }, [session.noteSyncId])

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
    const height = 132
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
        <button
          type="button"
          onClick={() => sendText(draft)}
          disabled={!canSend}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]"
        >
          <Send size={12} />
          发送
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        spellCheck={false}
        onChange={(event) => updateDraft(event.target.value)}
        onContextMenu={openContextMenu}
        className="min-h-0 flex-1 resize-none bg-[var(--color-bg-primary)] p-4 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        style={{
          fontFamily: settings.terminalFontFamily,
          fontSize: settings.canvasNoteFontSize,
          lineHeight: `${Math.round(settings.canvasNoteFontSize * 1.5)}px`,
        }}
      />
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
              onClick={() => sendText(contextMenu.selectedText)}
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
              onClick={() => sendText(draft)}
              disabled={!canSend}
            >
              <span className="flex items-center gap-2">
                <Send size={13} />
                发送全文
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
