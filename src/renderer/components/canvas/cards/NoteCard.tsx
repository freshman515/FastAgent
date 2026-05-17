import { createPortal } from 'react-dom'
import { Send } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { CanvasCard, Session } from '@shared/types'
import { sendNoteTextToPty } from '@/lib/noteSend'
import { removeClassicNotesBySyncId, syncCanvasNoteBodyToClassic } from '@/lib/noteSync'
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

export function NoteCard({ card, coordinateMode }: NoteCardProps): JSX.Element {
  const color = NOTE_COLORS[card.noteColor ?? 'yellow'] ?? NOTE_COLORS.yellow
  const updateCard = useCanvasStore((state) => state.updateCard)
  const removeCard = useCanvasStore((state) => state.removeCard)
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const relations = useCanvasStore((state) => state.getLayout().relations)
  const sessions = useSessionsStore((state) => state.sessions)
  const addToast = useUIStore((state) => state.addToast)
  const noteFontSize = useUIStore((state) => state.settings.canvasNoteFontSize)
  const noteSendAutoSubmit = useUIStore((state) => state.settings.noteSendAutoSubmit)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null)
  const [sendPicker, setSendPicker] = useState<{ x: number; y: number; text: string; targets: NoteSendTarget[] } | null>(null)

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

  const sendTextToTarget = (target: NoteSendTarget, text: string): void => {
    if (!target.ptyId) {
      addToast({ type: 'warning', title: '无法发送便签', body: `${target.session.name} 当前没有运行中的终端。` })
      return
    }

    void sendNoteTextToPty(target.ptyId, text, noteSendAutoSubmit).then((ok) => {
      if (!ok) {
        addToast({ type: 'error', title: '便签发送失败', body: target.session.name })
      }
    })
    useSessionsStore.getState().setActive(target.session.id)
    requestAnimationFrame(() => {
      useCanvasStore.getState().focusOnCard(target.cardId, { allowReturn: false })
    })
    addToast({ type: 'success', title: '便签已发送', body: target.session.name })
  }

  const sendText = (text: string, anchor: { x: number; y: number }): void => {
    setContextMenu(null)
    if (!text.trim()) {
      addToast({ type: 'warning', title: '便签为空', body: '没有可发送的内容。' })
      return
    }
    if (connectedTargets.length === 0) {
      addToast({ type: 'warning', title: '没有连接的会话', body: '先把便签和一个会话卡片连接起来。' })
      return
    }

    const runningTargets = connectedTargets.filter((target) => target.ptyId)
    if (runningTargets.length === 0) {
      setSendPicker({ ...anchor, text, targets: connectedTargets })
      return
    }
    if (runningTargets.length === 1 && connectedTargets.length === 1) {
      sendTextToTarget(runningTargets[0], text)
      return
    }

    setSendPicker({ ...anchor, text, targets: connectedTargets })
  }

  const sendNoteText = (mode: NoteSendMode, anchor: { x: number; y: number }, selectedText = getSelectedText()): void => {
    sendText(mode === 'selection' ? selectedText : (card.noteBody ?? ''), anchor)
  }

  const noteBody = card.noteBody ?? ''
  const hasConnectedTarget = connectedTargets.length > 0
  const canSendNote = noteBody.trim().length > 0 && hasConnectedTarget
  const updateNoteBody = (nextBody: string): void => {
    updateCard(card.id, { noteBody: nextBody })
    syncCanvasNoteBodyToClassic(card.noteSyncId, nextBody)
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
          sendNoteText('all', { x: rect.left, y: rect.bottom + 6 })
        }}
        className={cn(
          'mr-1 flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] transition-colors',
          canSendNote
            ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
            : 'cursor-not-allowed text-[var(--color-text-tertiary)] opacity-45',
        )}
        title={hasConnectedTarget ? '发送便签到连接会话' : '先连接一个会话卡片'}
      >
        <Send size={13} />
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
      <textarea
        ref={textareaRef}
        value={noteBody}
        onChange={(e) => updateNoteBody(e.target.value)}
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
        className="h-full w-full resize-none border-0 bg-transparent px-4 pb-4 pt-3 text-[var(--ui-font-sm)] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        style={{
          fontSize: noteFontSize,
          lineHeight: `${Math.round(noteFontSize * 1.5)}px`,
        }}
      />
      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9499]" onPointerDown={() => setContextMenu(null)} />
          <CanvasMenuPanel x={contextMenu.x} y={contextMenu.y} width={210} height={190}>
            <CanvasMenuItem
              label="发送选中内容"
              disabled={!contextMenu.selectedText.trim() || connectedTargets.length === 0}
              onClick={() => sendNoteText('selection', contextMenu, contextMenu.selectedText)}
            />
            <CanvasMenuItem
              label="发送全文"
              disabled={!noteBody.trim() || connectedTargets.length === 0}
              onClick={() => sendNoteText('all', contextMenu)}
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
              发送到会话
            </div>
            {sendPicker.targets.map((target) => (
              <CanvasMenuItem
                key={`${target.cardId}:${target.session.id}`}
                label={target.ptyId ? target.session.name : `${target.session.name}（未运行）`}
                disabled={!target.ptyId}
                onClick={() => {
                  setSendPicker(null)
                  sendTextToTarget(target, sendPicker.text)
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
