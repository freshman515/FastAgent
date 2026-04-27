import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { CanvasCard } from '@shared/types'
import { isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'
import { useSessionsStore } from '@/stores/sessions'
import { getTerminalBufferText } from '@/hooks/useXterm'
import { formatSessionCardTitle } from '@/lib/canvasSessionLabel'
import { cn } from '@/lib/utils'

interface CanvasSearchProps {
  open: boolean
  scopeFrameId?: string | null
  onClose: () => void
}

interface SearchResult {
  card: CanvasCard
  title: string
  meta: string
  haystack: string
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[\s_-]+/g, '')
}

function searchTokens(value: string): string[] {
  return normalizeSearchText(value).match(/[a-z]+|\d+|[\u4e00-\u9fff]+/g) ?? []
}

function searchInitials(value: string): string {
  return searchTokens(value).map((token) => token[0]).join('')
}

function isOrderedSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true
  let index = 0
  for (const char of haystack) {
    if (char === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return false
}

function getSubsequenceSpan(needle: string, haystack: string): number | null {
  if (!needle) return 0
  let needleIndex = 0
  let start = -1
  let end = -1
  for (let haystackIndex = 0; haystackIndex < haystack.length; haystackIndex += 1) {
    if (haystack[haystackIndex] !== needle[needleIndex]) continue
    if (start === -1) start = haystackIndex
    end = haystackIndex
    needleIndex += 1
    if (needleIndex === needle.length) return end - start + 1
  }
  return null
}

function searchAliases(value: string): string[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return Array.from(new Set([
    searchInitials(value),
    ...lines.map(searchInitials),
  ].filter(Boolean)))
}

function scoreText(value: string, query: string, compactQuery: string): number {
  if (!query || !compactQuery) return 0

  const normalized = normalizeSearchText(value)
  const compact = compactSearchText(value)
  if (!normalized || !compact) return 0

  let score = 0
  const raise = (next: number): void => {
    score = Math.max(score, next)
  }

  if (normalized === query) raise(1000)
  if (compact === compactQuery) raise(960)
  if (normalized.startsWith(query)) raise(920 - Math.min(80, normalized.length))
  if (compact.startsWith(compactQuery)) raise(880 - Math.min(80, compact.length))

  const normalizedIndex = normalized.indexOf(query)
  if (normalizedIndex >= 0) raise(780 - Math.min(180, normalizedIndex * 12))

  const compactIndex = compact.indexOf(compactQuery)
  if (compactIndex >= 0) raise(740 - Math.min(180, compactIndex * 10))

  for (const alias of searchAliases(value)) {
    if (alias === compactQuery) raise(900)
    else if (alias.startsWith(compactQuery)) raise(840 - Math.min(120, alias.length))
    else if (alias.includes(compactQuery)) raise(760 - Math.min(160, alias.indexOf(compactQuery) * 12))
  }

  for (const token of searchTokens(value)) {
    if (token === query || token === compactQuery) raise(700)
    else if (token.startsWith(query) || token.startsWith(compactQuery)) raise(660 - Math.min(80, token.length))
  }

  if (compactQuery.length >= 2 && isOrderedSubsequence(compactQuery, compact)) {
    const span = getSubsequenceSpan(compactQuery, compact)
    const tightness = span ? compactQuery.length / span : 0
    const firstIndex = compact.indexOf(compactQuery[0])
    raise(420 + tightness * 160 - Math.min(120, Math.max(0, firstIndex) * 8))
  }

  return score
}

function scoreSearch(row: SearchResult, query: string, compactQuery: string): number {
  const titleScore = scoreText(row.title, query, compactQuery)
  const metaScore = scoreText(row.meta, query, compactQuery)
  const haystackScore = scoreText(row.haystack, query, compactQuery)

  return titleScore * 1000 + metaScore * 100 + haystackScore
}

export function CanvasSearch({ open, scopeFrameId = null, onClose }: CanvasSearchProps): JSX.Element | null {
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const sessions = useSessionsStore((state) => state.sessions)
  const previewCardInViewport = useCanvasStore((state) => state.previewCardInViewport)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewedCardRef = useRef<string | null>(null)

  const activeScopeTitle = useMemo(() => {
    if (!scopeFrameId) return null
    const frame = cards.find((card) => card.id === scopeFrameId && card.kind === 'frame')
    return frame ? frame.frameTitle?.trim() || '分组' : null
  }, [cards, scopeFrameId])

  const results = useMemo(() => {
    const sessionById = new Map(sessions.map((session) => [session.id, session]))
    const frameByMemberId = new Map<string, CanvasCard>()
    for (const frame of cards) {
      if (frame.kind !== 'frame') continue
      for (const memberId of frame.frameMemberIds ?? []) {
        if (!frameByMemberId.has(memberId)) frameByMemberId.set(memberId, frame)
      }
    }
    const scopeFrame = scopeFrameId
      ? cards.find((card) => card.id === scopeFrameId && card.kind === 'frame')
      : undefined
    const scopedMemberIds = scopeFrame?.kind === 'frame'
      ? new Set(scopeFrame.frameMemberIds ?? [])
      : null
    const sourceCards = scopedMemberIds
      ? cards.filter((card) => scopedMemberIds.has(card.id))
      : cards
    const normalizedQuery = normalizeSearchText(query)
    const compactQuery = compactSearchText(query)
    const rows: SearchResult[] = sourceCards.map((card) => {
      const frame = frameByMemberId.get(card.id)
      const frameTitle = frame?.frameTitle?.trim()
      const frameMeta = frameTitle ? `分组：${frameTitle}` : ''
      if (card.kind === 'note') {
        return {
          card,
          title: card.noteBody?.split(/\r?\n/).find((line) => line.trim())?.trim() || '便签',
          meta: ['便签', frameMeta].filter(Boolean).join(' · '),
          haystack: `${card.noteBody ?? ''}\n${frameTitle ?? ''}`,
        }
      }
      if (card.kind === 'frame') {
        return {
          card,
          title: card.frameTitle?.trim() || '分组',
          meta: '分组工作区',
          haystack: card.frameTitle ?? '',
        }
      }
      const session = card.refId ? sessionById.get(card.refId) : undefined
      const terminalText = card.refId ? getTerminalBufferText(card.refId, 120) : ''
      const title = session ? formatSessionCardTitle(session.name, card.sessionRemark) : '会话'
      const sessionMeta = session ? `${session.type} · ${session.status}` : card.kind
      return {
        card,
        title,
        meta: [sessionMeta, frameMeta].filter(Boolean).join(' · '),
        haystack: `${title}\n${card.sessionRemark ?? ''}\n${session?.name ?? ''}\n${session?.type ?? ''}\n${session?.status ?? ''}\n${frameTitle ?? ''}\n${terminalText}`,
      }
    })
    const filtered = normalizedQuery
      ? rows
        .map((row, index) => ({ row, index, score: scoreSearch(row, normalizedQuery, compactQuery) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .map((item) => item.row)
      : rows
    return filtered.slice(0, 24)
  }, [cards, query, scopeFrameId, sessions])

  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, scopeFrameId])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const panel = panelRef.current
      if (!panel) return
      if (panel.contains(event.target as Node)) return
      onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [onClose, open])

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1))
  }, [activeIndex, results.length])

  useEffect(() => {
    if (!open || !query.trim()) {
      previewedCardRef.current = null
      return
    }
    const result = results[activeIndex]
    if (!result || previewedCardRef.current === result.card.id) return
    previewedCardRef.current = result.card.id
    const frame = requestAnimationFrame(() => {
      const canvas = useCanvasStore.getState()
      if (!canvas.getCard(result.card.id)) return
      previewCardInViewport(result.card.id)
      inputRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeIndex, open, previewCardInViewport, query, results])

  if (!open) return null

  const focusResult = (index: number): void => {
    const result = results[index]
    if (!result) return
    const canvas = useCanvasStore.getState()
    if (isCanvasCardHidden(result.card)) canvas.updateCard(result.card.id, { hidden: false, hiddenByFrameId: undefined })
    canvas.clearMaximizedCard()
    canvas.clearFocusReturn()
    requestAnimationFrame(() => {
      const latest = useCanvasStore.getState().getCard(result.card.id)
      if (latest?.kind === 'frame') useCanvasStore.getState().focusFrameWorkspace(result.card.id)
      else useCanvasStore.getState().focusOnCard(result.card.id)
    })
    onClose()
  }

  return (
    <div ref={panelRef} className="absolute left-1/2 top-4 z-[300] w-[min(560px,calc(100vw-48px))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/96 shadow-2xl backdrop-blur">
      <div className="flex h-11 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <Search size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'Enter') focusResult(activeIndex)
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((index) => results.length === 0 ? 0 : Math.min(results.length - 1, index + 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => Math.max(0, index - 1))
            }
          }}
          placeholder={activeScopeTitle ? '搜索组内卡片' : '搜索画布'}
          className="canvas-search-input min-w-0 flex-1 bg-transparent text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        />
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          title="关闭"
        >
          <X size={15} />
        </button>
      </div>
      {activeScopeTitle && (
        <div className="border-b border-[var(--color-border)] px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
          组内搜索：<span className="text-[var(--color-text-secondary)]">{activeScopeTitle}</span>
        </div>
      )}
      <div className="max-h-[360px] overflow-y-auto p-1.5">
        {results.map((result, index) => (
          <button
            key={result.card.id}
            type="button"
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => focusResult(index)}
            className={cn(
              'flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors',
              index === activeIndex
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
            )}
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[var(--ui-font-sm)] font-medium">{result.title}</span>
              <span className="block truncate text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">{result.meta}</span>
            </span>
          </button>
        ))}
        {results.length === 0 && (
          <div className="px-3 py-8 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
            没有结果
          </div>
        )}
      </div>
    </div>
  )
}
