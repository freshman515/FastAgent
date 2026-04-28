import { create } from 'zustand'
import {
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  CANVAS_SCHEMA_VERSION,
  type CanvasBookmark,
  type CanvasCard,
  type CanvasCardKind,
  type CanvasCardSnapshot,
  type CanvasFrameSnapshot,
  type CanvasLayout,
  type CanvasLayoutSnapshot,
  type CanvasRelation,
  type CanvasViewport,
} from '@shared/types'
import { generateId } from '@/lib/utils'
import { SESSIONS_LAYOUT_KEY } from './panes'
import { useUIStore, type CanvasArrangeMode } from './ui'

// ─── Canvas state ───
//
// State is keyed by the same layout scope identifier the panes store uses
// (`currentProjectId` / worktree id / SESSIONS_LAYOUT_KEY). When the user
// switches project/worktree, `setActiveLayout` swaps the visible layout.

const GLOBAL_LAYOUT_KEY = '__global__'
const MAX_UNDO_HISTORY = 80

function defaultViewport(): CanvasViewport {
  return { scale: 1, offsetX: 0, offsetY: 0 }
}

function defaultLayout(): CanvasLayout {
  return { cards: [], viewport: defaultViewport(), bookmarks: [], recentCardIds: [], relations: [], snapshots: [] }
}

interface CanvasHistoryEntry {
  activeLayoutKey: string
  layouts: Record<string, CanvasLayout>
  selectedCardIds: string[]
  focusReturn: { cardId: string; viewport: CanvasViewport } | null
}

function cloneCanvasCard(card: CanvasCard): CanvasCard {
  return {
    ...card,
    collapsedPreview: card.collapsedPreview ? [...card.collapsedPreview] : undefined,
    frameMemberIds: card.frameMemberIds ? [...card.frameMemberIds] : undefined,
    cardSnapshots: card.cardSnapshots?.map((snapshot) => ({
      ...snapshot,
      card: cloneSnapshotCard(snapshot.card),
    })),
    frameSnapshots: card.frameSnapshots?.map(cloneFrameSnapshot),
  }
}

function cloneSnapshotCard(card: CanvasCard): CanvasCard {
  return {
    ...card,
    collapsedPreview: card.collapsedPreview ? [...card.collapsedPreview] : undefined,
    frameMemberIds: card.frameMemberIds ? [...card.frameMemberIds] : undefined,
    cardSnapshots: undefined,
    frameSnapshots: undefined,
  }
}

function cloneFrameSnapshot(snapshot: CanvasFrameSnapshot): CanvasFrameSnapshot {
  return {
    ...snapshot,
    frame: cloneSnapshotCard(snapshot.frame),
    cards: snapshot.cards.map(cloneSnapshotCard),
    relations: snapshot.relations.map((relation) => ({ ...relation })),
  }
}

function cloneLayout(layout: CanvasLayout): CanvasLayout {
  return {
    cards: layout.cards.map(cloneCanvasCard),
    viewport: { ...layout.viewport },
    bookmarks: layout.bookmarks.map((bookmark) => ({
      ...bookmark,
      viewport: { ...bookmark.viewport },
    })),
    recentCardIds: [...(layout.recentCardIds ?? [])],
    relations: layout.relations.map((relation) => ({ ...relation })),
    snapshots: (layout.snapshots ?? []).map((snapshot) => ({
      ...snapshot,
      viewport: { ...snapshot.viewport },
      cards: snapshot.cards.map(cloneSnapshotCard),
      relations: snapshot.relations.map((relation) => ({ ...relation })),
    })),
  }
}

function cloneLayouts(layouts: Record<string, CanvasLayout>): Record<string, CanvasLayout> {
  return Object.fromEntries(
    Object.entries(layouts).map(([key, layout]) => [key, cloneLayout(layout)]),
  )
}

function clampScale(scale: number): number {
  return Math.max(CANVAS_MIN_SCALE, Math.min(CANVAS_MAX_SCALE, scale))
}

export function isCanvasCardHidden(card: CanvasCard): boolean {
  return Boolean(card.hidden || card.hiddenByFrameId)
}

/** Viewport transition duration for programmatic canvas navigation, in ms. */
const FOCUS_ANIMATION_MS = 360
const LAYOUT_ANIMATION_MS = 260
const FOCUS_CARD_PADDING = 48
const FOCUS_CONTROL_GAP = 24
const FOCUS_CARD_MIN_VISIBLE_SPACE = 160

interface CanvasFocusScreenArea {
  width: number
  height: number
  centerX: number
  centerY: number
}

// ─── Programmatic viewport animation ───
//
// Used by canvas navigation actions — eases from the current viewport to a
// target with a soft ease-out curve. Any wheel / pointer gesture should call
// `cancelViewportAnimation` first so user input isn't overwritten.

let animationFrame: number | null = null
let layoutAnimationTimer: number | null = null

export function cancelViewportAnimation(): void {
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

function animateViewport(target: CanvasViewport): void {
  cancelViewportAnimation()
  const start = useCanvasStore.getState().getViewport()
  const startTime = performance.now()
  const ease = (t: number): number => 1 - Math.pow(1 - t, 4)

  const step = (now: number): void => {
    const t = Math.min(1, (now - startTime) / FOCUS_ANIMATION_MS)
    const progress = ease(t)
    useCanvasStore.getState().setViewport({
      scale: start.scale + (target.scale - start.scale) * progress,
      offsetX: start.offsetX + (target.offsetX - start.offsetX) * progress,
      offsetY: start.offsetY + (target.offsetY - start.offsetY) * progress,
    })
    if (t < 1) {
      animationFrame = requestAnimationFrame(step)
    } else {
      animationFrame = null
    }
  }
  animationFrame = requestAnimationFrame(step)
}

function triggerCanvasLayoutAnimation(): void {
  if (typeof document === 'undefined') return
  document.body.classList.add('canvas-layout-animating')
  if (layoutAnimationTimer !== null) {
    window.clearTimeout(layoutAnimationTimer)
  }
  layoutAnimationTimer = window.setTimeout(() => {
    document.body.classList.remove('canvas-layout-animating')
    layoutAnimationTimer = null
  }, LAYOUT_ANIMATION_MS + 80)
}

function getCanvasFocusScreenArea(): CanvasFocusScreenArea | null {
  const el = document.querySelector('[data-canvas-viewport]') as HTMLDivElement | null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  const sessionToggle = document.querySelector('[data-canvas-session-list-toggle]') as HTMLElement | null
  const toolbar = document.querySelector('[data-canvas-toolbar]') as HTMLElement | null
  const sessionToggleRect = sessionToggle?.getBoundingClientRect()
  const toolbarRect = toolbar?.getBoundingClientRect()

  let top = FOCUS_CARD_PADDING
  if (sessionToggleRect) top = Math.max(top, sessionToggleRect.bottom - rect.top + FOCUS_CONTROL_GAP)

  let bottom = rect.height - FOCUS_CARD_PADDING
  if (toolbarRect) bottom = Math.min(bottom, toolbarRect.top - rect.top - FOCUS_CONTROL_GAP)

  if (bottom - top < FOCUS_CARD_MIN_VISIBLE_SPACE) {
    const verticalInset = Math.max(0, (rect.height - FOCUS_CARD_MIN_VISIBLE_SPACE) / 2)
    top = verticalInset
    bottom = rect.height - verticalInset
  }

  const preferredHorizontalInset = Math.max(FOCUS_CARD_PADDING, top)
  const maxHorizontalInset = Math.max(0, (rect.width - FOCUS_CARD_MIN_VISIBLE_SPACE) / 2)
  const horizontalInset = Math.min(preferredHorizontalInset, maxHorizontalInset)
  const left = horizontalInset
  const right = rect.width - horizontalInset
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)

  return {
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  }
}

function getCardElement(cardId: string): HTMLElement | null {
  const escaped = cardId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return document.querySelector(`[data-card-id="${escaped}"]`) as HTMLElement | null
}

function parsePixelSize(value: string): number | null {
  const size = Number.parseFloat(value)
  return Number.isFinite(size) && size > 0 ? size : null
}

function getTransformedCardBaseFontPx(card: CanvasCard, cardElement: HTMLElement): number | null {
  if (cardElement.dataset.cardCoordinateMode !== 'screen-transform') return null

  if (card.kind === 'session' || card.kind === 'terminal') {
    return useUIStore.getState().settings.terminalFontSize
  }

  const xtermEl = cardElement.querySelector('.xterm-rows, .xterm') as HTMLElement | null
  const xtermFont = xtermEl ? parsePixelSize(getComputedStyle(xtermEl).fontSize) : null
  if (xtermFont) return xtermFont

  const textEl = cardElement.querySelector('[data-card-drag]') as HTMLElement | null
  const textFont = textEl ? parsePixelSize(getComputedStyle(textEl).fontSize) : null
  return textFont
}

function getFocusTargetScale(card: CanvasCard, currentScale: number): number {
  const cardElement = getCardElement(card.id)
  if (!cardElement) return currentScale

  const baseFontPx = getTransformedCardBaseFontPx(card, cardElement)
  if (!baseFontPx) return currentScale

  const currentReadableFontPx = baseFontPx * currentScale
  const settings = useUIStore.getState().settings
  const rangeMin = Math.min(settings.canvasFocusReadableFontMinPx, settings.canvasFocusReadableFontMaxPx)
  const rangeMax = Math.max(settings.canvasFocusReadableFontMinPx, settings.canvasFocusReadableFontMaxPx)
  const targetFontPx = Math.max(rangeMin, Math.min(rangeMax, settings.canvasFocusTargetFontPx))
  if (
    currentReadableFontPx >= rangeMin
    && currentReadableFontPx <= rangeMax
  ) {
    return currentScale
  }

  return clampScale(targetFontPx / baseFontPx)
}

function getConfiguredSessionFocusScale(): number {
  const settings = useUIStore.getState().settings
  const rangeMin = Math.min(settings.canvasFocusReadableFontMinPx, settings.canvasFocusReadableFontMaxPx)
  const rangeMax = Math.max(settings.canvasFocusReadableFontMinPx, settings.canvasFocusReadableFontMaxPx)
  const targetFontPx = Math.max(rangeMin, Math.min(rangeMax, settings.canvasFocusTargetFontPx))
  return clampScale(targetFontPx / settings.terminalFontSize)
}

function getFocusVisibleScaleCap(
  card: CanvasCard,
  focusArea: CanvasFocusScreenArea,
): number {
  return clampScale(Math.min(focusArea.width / card.width, focusArea.height / card.height))
}

function getCardFocusViewport(card: CanvasCard, currentViewport: CanvasViewport): CanvasViewport | null {
  const focusArea = getCanvasFocusScreenArea()
  if (!focusArea) return null

  const readableScale = getFocusTargetScale(card, currentViewport.scale)
  const visibleScaleCap = getFocusVisibleScaleCap(card, focusArea)
  const targetScale = clampScale(Math.min(readableScale, visibleScaleCap))
  const centerX = card.x + card.width / 2
  const centerY = card.y + card.height / 2

  return {
    scale: targetScale,
    offsetX: focusArea.centerX - centerX * targetScale,
    offsetY: focusArea.centerY - centerY * targetScale,
  }
}

function getFrameWorkspaceViewport(frame: CanvasCard): CanvasViewport | null {
  const focusArea = getCanvasFocusScreenArea()
  if (!focusArea) return null

  const paddedWidth = frame.width + FRAME_AUTO_PADDING * 2
  const paddedHeight = frame.height + FRAME_AUTO_PADDING * 2
  const targetScale = clampScale(Math.min(focusArea.width / paddedWidth, focusArea.height / paddedHeight))
  const centerX = frame.x + frame.width / 2
  const centerY = frame.y + frame.height / 2

  return {
    scale: targetScale,
    offsetX: focusArea.centerX - centerX * targetScale,
    offsetY: focusArea.centerY - centerY * targetScale,
  }
}

function resizeSessionCardsToGrid(
  layout: CanvasLayout,
  targetWidth: number,
  targetHeight: number,
  now: number,
): { cards: CanvasCard[]; touched: boolean } {
  const targetIds = new Set<string>()
  const resizedCards = layout.cards.map((card) => {
    if (card.kind !== 'session' && card.kind !== 'terminal') return card
    targetIds.add(card.id)
    return {
      ...card,
      width: targetWidth,
      height: targetHeight,
      updatedAt: now,
    }
  })
  if (targetIds.size === 0) return { cards: layout.cards, touched: false }

  const targets = resizedCards.filter((card) => targetIds.has(card.id))
  const layoutPositions = computeArrangePositions(
    sortCardsForArrangeMode(targets, 'grid'),
    'grid',
    getArrangeOrigin(targets),
  )
  const previousById = new Map(layout.cards.map((card) => [card.id, card]))

  let touched = false
  const cards = resizedCards.map((card) => {
    const pos = layoutPositions.get(card.id)
    if (!pos) return card
    const previous = previousById.get(card.id)
    if (
      previous
      && previous.width === targetWidth
      && previous.height === targetHeight
      && previous.x === pos.x
      && previous.y === pos.y
    ) {
      return previous
    }
    touched = true
    return { ...card, x: pos.x, y: pos.y, updatedAt: now }
  })

  return { cards, touched }
}

function isValidCard(value: unknown): value is CanvasCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<string, unknown>
  return (
    typeof card.id === 'string'
    && (card.kind === 'session' || card.kind === 'terminal' || card.kind === 'note' || card.kind === 'frame')
    && (card.refId === null || typeof card.refId === 'string')
    && typeof card.x === 'number'
    && typeof card.y === 'number'
    && typeof card.width === 'number'
    && typeof card.height === 'number'
    && typeof card.zIndex === 'number'
  )
}

function isValidBookmark(value: unknown): value is CanvasBookmark {
  if (!value || typeof value !== 'object') return false
  const bookmark = value as Record<string, unknown>
  const viewport = bookmark.viewport as Record<string, unknown> | undefined
  return (
    typeof bookmark.id === 'string'
    && typeof bookmark.name === 'string'
    && Boolean(viewport)
    && typeof viewport?.scale === 'number'
    && typeof viewport?.offsetX === 'number'
    && typeof viewport?.offsetY === 'number'
  )
}

function isValidRelation(value: unknown): value is CanvasRelation {
  if (!value || typeof value !== 'object') return false
  const relation = value as Record<string, unknown>
  return (
    typeof relation.id === 'string'
    && typeof relation.fromCardId === 'string'
    && typeof relation.toCardId === 'string'
    && relation.fromCardId !== relation.toCardId
  )
}

function sanitizeSnapshotCard(card: CanvasCard): CanvasCard {
  return {
    ...card,
    expandedWidth: typeof card.expandedWidth === 'number' ? card.expandedWidth : undefined,
    expandedHeight: typeof card.expandedHeight === 'number' ? card.expandedHeight : undefined,
    collapsed: Boolean(card.collapsed),
    collapsedPreview: Array.isArray(card.collapsedPreview)
      ? card.collapsedPreview.filter((line): line is string => typeof line === 'string').slice(-6)
      : undefined,
    hidden: Boolean(card.hidden),
    hiddenByFrameId: typeof card.hiddenByFrameId === 'string' ? card.hiddenByFrameId : undefined,
    favorite: Boolean(card.favorite),
    cardSnapshots: undefined,
    frameSnapshots: undefined,
    sessionRemark: typeof card.sessionRemark === 'string' ? card.sessionRemark : undefined,
    frameMemberIds: Array.isArray(card.frameMemberIds)
      ? card.frameMemberIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    createdAt: typeof card.createdAt === 'number' ? card.createdAt : Date.now(),
    updatedAt: typeof card.updatedAt === 'number' ? card.updatedAt : Date.now(),
  }
}

function getCanvasCardLabel(card: CanvasCard): string {
  if (card.kind === 'frame') return card.frameTitle?.trim() || '分组'
  if (card.kind === 'note') return card.noteBody?.split(/\r?\n/).find((line) => line.trim())?.trim() || '便签'
  return card.sessionRemark?.trim() || '会话'
}

function withRecentCard(layout: CanvasLayout, cardId: string): CanvasLayout {
  if (!layout.cards.some((card) => card.id === cardId)) return layout
  const validIds = new Set(layout.cards.map((card) => card.id))
  const recentCardIds = [
    cardId,
    ...(layout.recentCardIds ?? []).filter((id) => id !== cardId && validIds.has(id)),
  ].slice(0, 12)

  const previous = layout.recentCardIds ?? []
  if (previous.length === recentCardIds.length && previous.every((id, index) => id === recentCardIds[index])) return layout
  return { ...layout, recentCardIds }
}

function isValidCardSnapshot(value: unknown): value is CanvasCardSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return (
    typeof snapshot.id === 'string'
    && typeof snapshot.name === 'string'
    && isValidCard(snapshot.card)
  )
}

function isValidFrameSnapshot(value: unknown): value is CanvasFrameSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return (
    typeof snapshot.id === 'string'
    && typeof snapshot.name === 'string'
    && isValidCard(snapshot.frame)
    && Array.isArray(snapshot.cards)
    && Array.isArray(snapshot.relations)
  )
}

function sanitizeFrameSnapshot(snapshot: CanvasFrameSnapshot): CanvasFrameSnapshot {
  const frame = sanitizeSnapshotCard(snapshot.frame)
  const cards = snapshot.cards.filter(isValidCard).map(sanitizeSnapshotCard)
  const ids = new Set([frame.id, ...cards.map((card) => card.id)])
  return {
    id: snapshot.id,
    name: snapshot.name,
    frame,
    cards,
    relations: snapshot.relations
      .filter(isValidRelation)
      .filter((relation) => ids.has(relation.fromCardId) && ids.has(relation.toCardId))
      .map((relation) => ({ ...relation })),
    createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : Date.now(),
    updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.now(),
  }
}

function isValidLayoutSnapshot(value: unknown): value is CanvasLayoutSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  const viewport = snapshot.viewport as Record<string, unknown> | undefined
  return (
    typeof snapshot.id === 'string'
    && typeof snapshot.name === 'string'
    && Array.isArray(snapshot.cards)
    && Boolean(viewport)
    && typeof viewport?.scale === 'number'
    && typeof viewport?.offsetX === 'number'
    && typeof viewport?.offsetY === 'number'
  )
}

function sanitizeLayout(raw: unknown): CanvasLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const rawCards = Array.isArray(data.cards) ? data.cards : []
  const cards = rawCards.filter(isValidCard).map((card) => {
    const clean = sanitizeSnapshotCard(card)
    return {
      ...clean,
      cardSnapshots: Array.isArray(card.cardSnapshots)
        ? card.cardSnapshots.filter(isValidCardSnapshot).map((snapshot) => ({
            ...snapshot,
            card: sanitizeSnapshotCard(snapshot.card),
            createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : Date.now(),
            updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.now(),
          }))
        : undefined,
      frameSnapshots: Array.isArray(card.frameSnapshots)
        ? card.frameSnapshots.filter(isValidFrameSnapshot).map(sanitizeFrameSnapshot).slice(-12)
        : undefined,
    }
  })
  const cardIds = new Set(cards.map((card) => card.id))

  const rawViewport = data.viewport && typeof data.viewport === 'object'
    ? (data.viewport as Record<string, unknown>)
    : {}
  const viewport: CanvasViewport = {
    scale: typeof rawViewport.scale === 'number' ? clampScale(rawViewport.scale) : 1,
    offsetX: typeof rawViewport.offsetX === 'number' ? rawViewport.offsetX : 0,
    offsetY: typeof rawViewport.offsetY === 'number' ? rawViewport.offsetY : 0,
  }

  const rawBookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : []
  const bookmarks = rawBookmarks.filter(isValidBookmark).map((bookmark) => ({
    ...bookmark,
    viewport: {
      scale: clampScale(bookmark.viewport.scale),
      offsetX: bookmark.viewport.offsetX,
      offsetY: bookmark.viewport.offsetY,
    },
    cardId: typeof bookmark.cardId === 'string' && cardIds.has(bookmark.cardId) ? bookmark.cardId : undefined,
    createdAt: typeof bookmark.createdAt === 'number' ? bookmark.createdAt : Date.now(),
    updatedAt: typeof bookmark.updatedAt === 'number' ? bookmark.updatedAt : Date.now(),
  }))
  const recentCardIds = Array.isArray(data.recentCardIds)
    ? data.recentCardIds.filter((id): id is string => typeof id === 'string' && cardIds.has(id)).slice(0, 12)
    : []

  const seenRelations = new Set<string>()
  const rawRelations = Array.isArray(data.relations) ? data.relations : []
  const relations = rawRelations
    .filter(isValidRelation)
    .filter((relation) => cardIds.has(relation.fromCardId) && cardIds.has(relation.toCardId))
    .filter((relation) => {
      const key = relation.fromCardId < relation.toCardId
        ? `${relation.fromCardId}:${relation.toCardId}`
        : `${relation.toCardId}:${relation.fromCardId}`
      if (seenRelations.has(key)) return false
      seenRelations.add(key)
      return true
    })
    .map((relation) => ({
      ...relation,
      createdAt: typeof relation.createdAt === 'number' ? relation.createdAt : Date.now(),
      updatedAt: typeof relation.updatedAt === 'number' ? relation.updatedAt : Date.now(),
    }))

  const rawSnapshots = Array.isArray(data.snapshots) ? data.snapshots : []
  const snapshots = rawSnapshots.filter(isValidLayoutSnapshot).map((snapshot) => ({
    ...snapshot,
    viewport: {
      scale: clampScale(snapshot.viewport.scale),
      offsetX: snapshot.viewport.offsetX,
      offsetY: snapshot.viewport.offsetY,
    },
    cards: snapshot.cards.filter(isValidCard).map(sanitizeSnapshotCard),
    relations: Array.isArray(snapshot.relations)
      ? snapshot.relations.filter(isValidRelation).map((relation) => ({
          ...relation,
          createdAt: typeof relation.createdAt === 'number' ? relation.createdAt : Date.now(),
          updatedAt: typeof relation.updatedAt === 'number' ? relation.updatedAt : Date.now(),
        }))
      : [],
    createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : Date.now(),
    updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.now(),
  }))

  return { cards, viewport, bookmarks, recentCardIds, relations, snapshots }
}

// ─── Card defaults ───

const DEFAULT_CARD_SIZE: Record<CanvasCardKind, { width: number; height: number }> = {
  session: { width: 1040, height: 660 },
  terminal: { width: 1040, height: 660 },
  note: { width: 320, height: 240 },
  frame: { width: 760, height: 460 },
}

const CARD_GAP = 24
const FRAME_AUTO_PADDING = 56

export interface CanvasFrameGeometry {
  x: number
  y: number
  width: number
  height: number
}

function rectsTouchOrOverlap(a: CanvasFrameGeometry, b: CanvasFrameGeometry): boolean {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y
}

function getIntersectionArea(a: CanvasFrameGeometry, b: CanvasFrameGeometry): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function getMemberBounds(cards: CanvasCard[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...cards.map((card) => card.x)),
    minY: Math.min(...cards.map((card) => card.y)),
    maxX: Math.max(...cards.map((card) => card.x + card.width)),
    maxY: Math.max(...cards.map((card) => card.y + card.height)),
  }
}

function getFittedFrameRect(memberCards: CanvasCard[]): CanvasFrameGeometry {
  const bounds = getMemberBounds(memberCards)
  return {
    x: bounds.minX - FRAME_AUTO_PADDING,
    y: bounds.minY - FRAME_AUTO_PADDING,
    width: Math.max(DEFAULT_CARD_SIZE.frame.width, bounds.maxX - bounds.minX + FRAME_AUTO_PADDING * 2),
    height: Math.max(DEFAULT_CARD_SIZE.frame.height, bounds.maxY - bounds.minY + FRAME_AUTO_PADDING * 2),
  }
}

function expandFrameRect(frame: CanvasCard, target: CanvasFrameGeometry): CanvasFrameGeometry {
  const minX = Math.min(frame.x, target.x)
  const minY = Math.min(frame.y, target.y)
  const maxX = Math.max(frame.x + frame.width, target.x + target.width)
  const maxY = Math.max(frame.y + frame.height, target.y + target.height)
  return {
    x: minX,
    y: minY,
    width: Math.max(DEFAULT_CARD_SIZE.frame.width, maxX - minX),
    height: Math.max(DEFAULT_CARD_SIZE.frame.height, maxY - minY),
  }
}

function cleanFrameMemberIds(frame: CanvasCard, cardsById: Map<string, CanvasCard>): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of frame.frameMemberIds ?? []) {
    if (seen.has(id)) continue
    const member = cardsById.get(id)
    if (!member || member.kind === 'frame' || member.id === frame.id) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function removeFrameMember(memberIdsByFrame: Map<string, string[]>, cardId: string): void {
  for (const memberIds of memberIdsByFrame.values()) {
    const index = memberIds.indexOf(cardId)
    if (index !== -1) memberIds.splice(index, 1)
  }
}

function expandFrameMoveIds(cards: CanvasCard[], ids: Iterable<string>): {
  movingIds: Set<string>
  membersMovedWithFrame: Set<string>
} {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const movingIds = new Set(ids)
  const membersMovedWithFrame = new Set<string>()

  for (const id of [...movingIds]) {
    const card = cardsById.get(id)
    if (card?.kind !== 'frame') continue
    for (const memberId of card.frameMemberIds ?? []) {
      if (!cardsById.has(memberId)) continue
      movingIds.add(memberId)
      membersMovedWithFrame.add(memberId)
    }
  }

  return { movingIds, membersMovedWithFrame }
}

function findBestTouchedFrame(card: CanvasCard, frames: CanvasCard[]): CanvasCard | null {
  let bestFrame: CanvasCard | null = null
  let bestArea = -1
  let bestDistance = Number.POSITIVE_INFINITY
  const cardCenterX = card.x + card.width / 2
  const cardCenterY = card.y + card.height / 2

  for (const frame of frames) {
    if (frame.collapsed || frame.id === card.id) continue
    if (!rectsTouchOrOverlap(card, frame)) continue

    const area = getIntersectionArea(card, frame)
    const frameCenterX = frame.x + frame.width / 2
    const frameCenterY = frame.y + frame.height / 2
    const distance = Math.hypot(cardCenterX - frameCenterX, cardCenterY - frameCenterY)
    if (
      !bestFrame
      || area > bestArea
      || area === bestArea && distance < bestDistance
      || area === bestArea && distance === bestDistance && frame.zIndex > bestFrame.zIndex
    ) {
      bestFrame = frame
      bestArea = area
      bestDistance = distance
    }
  }

  return bestFrame
}

function applyFrameAutoLayout(
  cards: CanvasCard[],
  changedIdsInput: Iterable<string>,
  now: number,
): { cards: CanvasCard[]; touched: boolean } {
  const changedIds = new Set(changedIdsInput)
  if (changedIds.size === 0) return { cards, touched: false }

  const frames = cards.filter((card) => card.kind === 'frame')
  if (frames.length === 0) return { cards, touched: false }

  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const changedCards = cards.filter((card) => changedIds.has(card.id) && card.kind !== 'frame')
  const rawMemberIdsByFrame = new Map<string, Set<string>>()
  const memberIdsByFrame = new Map<string, string[]>()

  for (const frame of frames) {
    rawMemberIdsByFrame.set(frame.id, new Set(frame.frameMemberIds ?? []))
    memberIdsByFrame.set(frame.id, cleanFrameMemberIds(frame, cardsById))
  }

  for (const card of changedCards) {
    removeFrameMember(memberIdsByFrame, card.id)

    const frame = findBestTouchedFrame(card, frames)
    const memberIds = frame ? memberIdsByFrame.get(frame.id) : undefined
    if (memberIds && !memberIds.includes(card.id)) memberIds.push(card.id)
  }

  let touched = false
  const nextFrames = new Map<string, CanvasCard>()

  for (const frame of frames) {
    const rawMemberIds = [...(frame.frameMemberIds ?? [])]
    const memberIds = memberIdsByFrame.get(frame.id) ?? []
    const rawMemberSet = rawMemberIdsByFrame.get(frame.id) ?? new Set<string>()
    const membershipChanged = !sameStringArray(rawMemberIds, memberIds)
    const hasChangedMember = memberIds.some((id) => changedIds.has(id))
    const hadChangedMember = [...changedIds].some((id) => rawMemberSet.has(id))

    if (!membershipChanged && !hasChangedMember && !hadChangedMember) continue

    let nextFrame: CanvasCard = frame
    const memberCards = memberIds
      .map((id) => cardsById.get(id))
      .filter((card): card is CanvasCard => card !== undefined && card.kind !== 'frame')

    if (!frame.collapsed && memberCards.length > 0 && (hasChangedMember || hadChangedMember || membershipChanged)) {
      const fittedRect = getFittedFrameRect(memberCards)
      const nextRect = hadChangedMember ? fittedRect : expandFrameRect(frame, fittedRect)
      if (
        frame.x !== nextRect.x
        || frame.y !== nextRect.y
        || frame.width !== nextRect.width
        || frame.height !== nextRect.height
      ) {
        nextFrame = {
          ...nextFrame,
          x: nextRect.x,
          y: nextRect.y,
          width: nextRect.width,
          height: nextRect.height,
          updatedAt: now,
        }
        touched = true
      }
    }

    if (membershipChanged) {
      nextFrame = {
        ...nextFrame,
        frameMemberIds: memberIds.length > 0 ? memberIds : undefined,
        updatedAt: now,
      }
      touched = true
    }

    if (nextFrame !== frame) nextFrames.set(frame.id, nextFrame)
  }

  if (!touched) return { cards, touched: false }
  return {
    cards: cards.map((card) => nextFrames.get(card.id) ?? card),
    touched: true,
  }
}

export function computeFrameAutoLayoutPreview(
  cards: CanvasCard[],
  geometry: Map<string, CanvasFrameGeometry>,
): Map<string, CanvasFrameGeometry> {
  if (geometry.size === 0) return new Map()

  const previewCards = cards.map((card) => {
    const rect = geometry.get(card.id)
    return rect ? { ...card, ...rect } : card
  })
  const next = applyFrameAutoLayout(previewCards, geometry.keys(), Date.now())
  if (!next.touched) return new Map()

  const originalById = new Map(cards.map((card) => [card.id, card]))
  const frameGeometry = new Map<string, CanvasFrameGeometry>()
  for (const card of next.cards) {
    if (card.kind !== 'frame') continue
    const original = originalById.get(card.id)
    if (
      !original
      || original.x === card.x
        && original.y === card.y
        && original.width === card.width
        && original.height === card.height
    ) {
      continue
    }
    frameGeometry.set(card.id, {
      x: card.x,
      y: card.y,
      width: card.width,
      height: card.height,
    })
  }
  return frameGeometry
}

export function getDefaultCanvasCardSize(kind: CanvasCardKind): { width: number; height: number } {
  if (kind === 'note' || kind === 'frame') return DEFAULT_CARD_SIZE[kind]
  const settings = useUIStore.getState().settings
  return {
    width: settings.canvasSessionCardWidth,
    height: settings.canvasSessionCardHeight,
  }
}

type CanvasPlacementSettings = {
  arrangeMode: CanvasArrangeMode
  overlapMode: 'free' | 'avoid'
  snapEnabled: boolean
}

function getPlacementSettings(): CanvasPlacementSettings {
  const settings = useUIStore.getState().settings
  return {
    arrangeMode: settings.canvasArrangeMode,
    overlapMode: settings.canvasOverlapMode,
    snapEnabled: settings.canvasSnapEnabled,
  }
}

function placeCard(layout: CanvasLayout, card: CanvasCard, placement: CanvasPlacementSettings): CanvasCard[] {
  if (placement.arrangeMode !== 'free') {
    return insertArrangedCard(layout.cards, card, placement.arrangeMode)
  }

  const placed = placement.overlapMode === 'avoid'
    ? { ...card, ...findNearestAvailablePosition(layout.cards, card, placement.snapEnabled) }
    : card
  return [...layout.cards, placed]
}

function insertArrangedCard(cards: CanvasCard[], card: CanvasCard, mode: Exclude<CanvasArrangeMode, 'free'>): CanvasCard[] {
  const ordered = sortCardsForArrangeMode(cards, mode)
  const origin = getArrangeOrigin([...cards, card])
  const insertIndex = getArrangeInsertIndex(ordered, cards.length + 1, card, mode, origin)
  const arranged = [
    ...ordered.slice(0, insertIndex),
    card,
    ...ordered.slice(insertIndex),
  ]
  const positions = computeArrangePositions(arranged, mode, origin)
  const now = Date.now()
  return arranged.map((candidate) => {
    const position = positions.get(candidate.id)
    if (!position) return candidate
    if (candidate.x === position.x && candidate.y === position.y) return candidate
    return { ...candidate, x: position.x, y: position.y, updatedAt: now }
  })
}

function sortCardsForArrangeMode(cards: CanvasCard[], mode: Exclude<CanvasArrangeMode, 'free'>): CanvasCard[] {
  const byX = (a: CanvasCard, b: CanvasCard): number => (a.x - b.x) || (a.y - b.y) || (a.createdAt - b.createdAt)
  const byY = (a: CanvasCard, b: CanvasCard): number => (a.y - b.y) || (a.x - b.x) || (a.createdAt - b.createdAt)
  if (mode === 'rowFlow') return [...cards].sort(byX)
  if (mode === 'colFlow') return [...cards].sort(byY)
  return [...cards].sort(byY)
}

function getArrangeOrigin(cards: CanvasCard[]): { x: number; y: number } {
  return {
    x: Math.min(...cards.map((card) => card.x)),
    y: Math.min(...cards.map((card) => card.y)),
  }
}

function getArrangeInsertIndex(
  cards: CanvasCard[],
  totalCount: number,
  card: CanvasCard,
  mode: Exclude<CanvasArrangeMode, 'free'>,
  origin: { x: number; y: number },
): number {
  const centerX = card.x + card.width / 2
  const centerY = card.y + card.height / 2

  if (mode === 'rowFlow') {
    return cards.filter((candidate) => centerX > candidate.x + candidate.width / 2).length
  }
  if (mode === 'colFlow') {
    return cards.filter((candidate) => centerY > candidate.y + candidate.height / 2).length
  }

  return getGridInsertIndex(cards, totalCount, card, origin)
}

function getGridInsertIndex(
  cards: CanvasCard[],
  totalCount: number,
  card: CanvasCard,
  origin: { x: number; y: number },
): number {
  const desiredCenterX = card.x + card.width / 2
  const desiredCenterY = card.y + card.height / 2
  let nearestIndex = cards.length
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < totalCount; index += 1) {
    const arranged = [
      ...cards.slice(0, index),
      card,
      ...cards.slice(index),
    ]
    const position = computeArrangePositions(arranged, 'grid', origin).get(card.id)
    if (!position) continue
    const slotCenterX = position.x + card.width / 2
    const slotCenterY = position.y + card.height / 2
    const distance = Math.hypot(desiredCenterX - slotCenterX, desiredCenterY - slotCenterY)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }
  return Math.max(0, Math.min(cards.length, nearestIndex))
}

function computeArrangePositions(
  cards: CanvasCard[],
  mode: Exclude<CanvasArrangeMode, 'free'>,
  origin: { x: number; y: number },
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()

  if (mode === 'rowFlow') {
    let x = origin.x
    for (const card of cards) {
      positions.set(card.id, { x, y: origin.y })
      x += card.width + CARD_GAP
    }
    return positions
  }

  if (mode === 'colFlow') {
    let y = origin.y
    for (const card of cards) {
      positions.set(card.id, { x: origin.x, y })
      y += card.height + CARD_GAP
    }
    return positions
  }

  for (const [id, position] of computeGridPositions(cards, origin)) {
    positions.set(id, position)
  }
  return positions
}

function computePackArrangePositions(
  cards: CanvasCard[],
  origin: { x: number; y: number },
  bandWidth = 1400,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  let x = origin.x
  let y = origin.y
  let rowHeight = 0

  for (const card of cards) {
    if (x > origin.x && x + card.width > origin.x + bandWidth) {
      x = origin.x
      y += rowHeight + CARD_GAP
      rowHeight = 0
    }
    positions.set(card.id, { x, y })
    x += card.width + CARD_GAP
    rowHeight = Math.max(rowHeight, card.height)
  }

  return positions
}

function computeArrangePositionsForKind(
  cards: CanvasCard[],
  kind: 'grid' | 'rowFlow' | 'colFlow' | 'pack',
  origin: { x: number; y: number },
  bandWidth?: number,
): Map<string, { x: number; y: number }> {
  if (kind === 'pack') {
    return computePackArrangePositions(cards, origin, bandWidth)
  }
  return computeArrangePositions(sortCardsForArrangeMode(cards, kind), kind, origin)
}

function getPrimaryFrameMembership(cards: CanvasCard[]): Map<string, string> {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const membership = new Map<string, string>()
  const frames = cards
    .filter((card) => card.kind === 'frame')
    .sort((a, b) => b.zIndex - a.zIndex)

  for (const frame of frames) {
    for (const memberId of cleanFrameMemberIds(frame, cardsById)) {
      if (!membership.has(memberId)) membership.set(memberId, frame.id)
    }
  }

  return membership
}

function computeGridPositions(
  cards: CanvasCard[],
  origin: { x: number; y: number },
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (cards.length === 0) return positions

  const cols = getGridColumnCount(cards.length)
  const columns = Array.from({ length: cols }, (): CanvasCard[] => [])
  const columnHeights = Array.from({ length: cols }, () => 0)

  cards.forEach((card, index) => {
    const col = index < cols ? index : getShortestColumnIndex(columnHeights)
    columns[col].push(card)
    columnHeights[col] += card.height + CARD_GAP
  })

  const colWidths = columns.map((column) =>
    column.reduce((width, card) => Math.max(width, card.width), 0),
  )
  const colX: number[] = []
  let x = origin.x
  for (let col = 0; col < cols; col += 1) {
    colX[col] = x
    x += colWidths[col] + CARD_GAP
  }

  columns.forEach((column, col) => {
    let y = origin.y
    for (const card of column) {
      positions.set(card.id, { x: colX[col], y })
      y += card.height + CARD_GAP
    }
  })

  return positions
}

function getGridColumnCount(totalCount: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(totalCount)))
}

function getShortestColumnIndex(columnHeights: number[]): number {
  let index = 0
  let height = columnHeights[0] ?? 0
  for (let i = 1; i < columnHeights.length; i += 1) {
    if (columnHeights[i] < height) {
      index = i
      height = columnHeights[i]
    }
  }
  return index
}

function findNearestAvailablePosition(
  cards: CanvasCard[],
  card: CanvasCard,
  snapEnabled: boolean,
): { x: number; y: number } {
  if (cards.length === 0) return { x: card.x, y: card.y }
  const obstacleCards = cards.filter((candidate) => candidate.kind !== 'frame')

  const normalize = (value: number): number => snapEnabled ? Math.round(value / CARD_GAP) * CARD_GAP : value
  const requested = { x: normalize(card.x), y: normalize(card.y) }
  const candidates: Array<{ x: number; y: number }> = [requested]

  for (const existing of obstacleCards) {
    candidates.push(
      { x: normalize(existing.x + existing.width + CARD_GAP), y: normalize(existing.y) },
      { x: normalize(existing.x - card.width - CARD_GAP), y: normalize(existing.y) },
      { x: normalize(existing.x), y: normalize(existing.y + existing.height + CARD_GAP) },
      { x: normalize(existing.x), y: normalize(existing.y - card.height - CARD_GAP) },
    )
  }

  const step = snapEnabled ? CARD_GAP : 32
  const rings = 18
  for (let ring = 1; ring <= rings; ring += 1) {
    const distance = ring * step
    for (let x = -distance; x <= distance; x += step) {
      candidates.push({ x: normalize(requested.x + x), y: normalize(requested.y - distance) })
      candidates.push({ x: normalize(requested.x + x), y: normalize(requested.y + distance) })
    }
    for (let y = -distance + step; y <= distance - step; y += step) {
      candidates.push({ x: normalize(requested.x - distance), y: normalize(requested.y + y) })
      candidates.push({ x: normalize(requested.x + distance), y: normalize(requested.y + y) })
    }
  }

  let best = requested
  let bestDistance = Number.POSITIVE_INFINITY
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = `${candidate.x}:${candidate.y}`
    if (seen.has(key)) continue
    seen.add(key)
    if (overlapsAny(obstacleCards, { ...card, x: candidate.x, y: candidate.y }, CARD_GAP)) continue
    const distance = Math.hypot(candidate.x - requested.x, candidate.y - requested.y)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

function overlapsAny(cards: CanvasCard[], card: CanvasCard, gap: number): boolean {
  return cards.some((other) =>
    card.x < other.x + other.width + gap
    && card.x + card.width + gap > other.x
    && card.y < other.y + other.height + gap
    && card.y + card.height + gap > other.y,
  )
}

function createHistoryEntry(state: CanvasState): CanvasHistoryEntry {
  return {
    activeLayoutKey: state.activeLayoutKey,
    layouts: cloneLayouts(state.layouts),
    selectedCardIds: [...state.selectedCardIds],
    focusReturn: state.focusReturn
      ? { cardId: state.focusReturn.cardId, viewport: { ...state.focusReturn.viewport } }
      : null,
  }
}

function pushUndo(state: CanvasState): CanvasHistoryEntry[] {
  return [createHistoryEntry(state), ...state.undoStack].slice(0, MAX_UNDO_HISTORY)
}

// ─── Store ───

interface CanvasState {
  activeLayoutKey: string
  layouts: Record<string, CanvasLayout>
  selectedCardIds: string[]
  focusReturn: { cardId: string; viewport: CanvasViewport } | null
  maximizedCardId: string | null
  undoStack: CanvasHistoryEntry[]

  // getters
  getLayout: (key?: string) => CanvasLayout
  getCards: () => CanvasCard[]
  getViewport: () => CanvasViewport
  getCard: (id: string) => CanvasCard | undefined

  // lifecycle
  loadFromConfig: (raw: Record<string, unknown>) => void
  setActiveLayout: (key: string | null) => void
  canUndo: () => boolean
  undo: () => boolean

  // viewport
  setViewport: (viewport: Partial<CanvasViewport>) => void
  resetViewport: () => void
  clearFocusReturn: () => void
  toggleMaximizedCard: (cardId: string) => void
  setMaximizedCard: (cardId: string | null) => void
  clearMaximizedCard: () => void
  fitAll: (containerWidth: number, containerHeight: number) => void
  /**
   * Animate the viewport so `cardId` lands centered. Scale only changes when
   * the card's transformed text is outside the readable font-size range.
   */
  focusOnCard: (cardId: string) => void
  /** Fit a frame/group as a workspace in the readable focus area. */
  focusFrameWorkspace: (frameId: string) => void
  /** Preview a card from search by moving the viewport without activating the session. */
  previewCardInViewport: (cardId: string) => void
  /** Track card/frame navigation for the canvas recent list. */
  recordCardVisit: (cardId: string) => void

  // cards
  addCard: (partial: Partial<CanvasCard> & { kind: CanvasCardKind }) => string
  addFrameAroundCards: (ids: string[], fallback?: { x: number; y: number }) => string | null
  toggleFrameCollapsed: (frameId: string) => void
  hideAllExceptFrame: (frameId: string) => void
  setFrameMembersHidden: (frameId: string, hidden: boolean) => void
  showAllCards: () => void
  normalizeCardsToFocusArea: () => void
  normalizeCardsToDefaultSessionSize: () => void
  updateCard: (id: string, updates: Partial<CanvasCard>) => void
  toggleCardFavorite: (id: string) => void
  addCardSnapshot: (id: string, name?: string) => string | null
  restoreCardSnapshot: (id: string, snapshotId: string) => void
  removeCardSnapshot: (id: string, snapshotId: string) => void
  updateCardPositions: (positions: Map<string, { x: number; y: number }>) => void
  updateCardsGeometry: (geometry: Map<string, { x: number; y: number; width: number; height: number }>) => void
  setCardCollapsed: (id: string, collapsed: boolean, previewLines?: string[]) => void
  moveCards: (ids: string[], dx: number, dy: number) => void
  resizeCard: (id: string, width: number, height: number, x?: number, y?: number) => void
  removeCard: (id: string) => void
  bringToFront: (id: string) => void

  // selection
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string, additive: boolean) => void
  clearSelection: () => void

  // session card helpers
  /** Find the card (in any layout) that references the given session id. */
  findCardBySessionId: (sessionId: string) => { layoutKey: string; card: CanvasCard } | null
  /** Attach a session as a card in the current active layout. Idempotent — if
   *  a card already exists we return its id and optionally center the viewport. */
  attachSession: (
    sessionId: string,
    kind: 'session' | 'terminal',
    position?: { x: number; y: number },
  ) => string
  /** Remove all cards that reference this session (in every layout). */
  detachSessionEverywhere: (sessionId: string) => void
  /** Auto-populate the current layout from a list of session ids in horizontal
   *  flow. Returns the new card ids that were actually created (skipping any
   *  session that already had a card). */
  autoPopulateFromSessions: (
    sessionIds: string[],
    kindFor: (id: string) => 'session' | 'terminal',
  ) => string[]

  // bulk ops (used by context menu / keyboard)
  removeCards: (ids: string[]) => void
  duplicateCards: (ids: string[]) => string[]

  // bookmarks
  addBookmark: (name?: string) => string
  addBookmarkForCard: (cardId: string, name?: string) => string | null
  goToBookmark: (id: string) => void
  updateBookmarkViewport: (id: string) => void
  renameBookmark: (id: string, name: string) => void
  removeBookmark: (id: string) => void

  // full layout snapshots
  addLayoutSnapshot: (name?: string) => string
  addFrameSnapshot: (frameId: string, name?: string) => string | null
  restoreFrameSnapshot: (frameId: string, snapshotId: string) => void
  removeFrameSnapshot: (frameId: string, snapshotId: string) => void
  restoreLayoutSnapshot: (id: string) => void
  renameLayoutSnapshot: (id: string, name: string) => void
  removeLayoutSnapshot: (id: string) => void

  // relations
  addRelation: (fromCardId: string, toCardId: string) => string | null
  removeRelation: (id: string) => void
  removeRelationsForCards: (ids: string[]) => void

  // arrangement
  arrange: (kind: 'grid' | 'rowFlow' | 'colFlow' | 'pack', ids?: string[]) => void
  alignCards: (axis: 'left' | 'right' | 'top' | 'bottom' | 'hCenter' | 'vCenter', ids: string[]) => void
  distributeCards: (axis: 'horizontal' | 'vertical', ids: string[]) => void
}

function persistCanvas(state: CanvasState): void {
  // Detached windows don't own the canvas layout.
  if (window.api.detach.isDetached) return
  void window.api.config.write('canvas', {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    layouts: state.layouts,
  })
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  activeLayoutKey: GLOBAL_LAYOUT_KEY,
  layouts: { [GLOBAL_LAYOUT_KEY]: defaultLayout() },
  selectedCardIds: [],
  focusReturn: null,
  maximizedCardId: null,
  undoStack: [],

  getLayout: (key) => {
    const layoutKey = key ?? get().activeLayoutKey
    return get().layouts[layoutKey] ?? defaultLayout()
  },
  getCards: () => get().getLayout().cards,
  getViewport: () => get().getLayout().viewport,
  getCard: (id) => get().getCards().find((card) => card.id === id),

  loadFromConfig: (raw) => {
    if (!raw || typeof raw !== 'object') return
    const rawLayouts = raw.layouts && typeof raw.layouts === 'object'
      ? raw.layouts as Record<string, unknown>
      : {}
    const layouts: Record<string, CanvasLayout> = {}
    for (const [key, value] of Object.entries(rawLayouts)) {
      const layout = sanitizeLayout(value)
      if (layout) layouts[key] = layout
    }
    if (Object.keys(layouts).length === 0) {
      layouts[GLOBAL_LAYOUT_KEY] = defaultLayout()
    }
    set({ layouts, selectedCardIds: [], focusReturn: null, maximizedCardId: null, undoStack: [] })
  },

  setActiveLayout: (key) => {
    const layoutKey = key ?? GLOBAL_LAYOUT_KEY
    set((state) => {
      if (state.activeLayoutKey === layoutKey) return state
      const layouts = state.layouts[layoutKey]
        ? state.layouts
        : { ...state.layouts, [layoutKey]: defaultLayout() }
      return {
        activeLayoutKey: layoutKey,
        layouts,
        selectedCardIds: [],
        focusReturn: null,
        maximizedCardId: null,
        undoStack: [],
      }
    })
  },

  canUndo: () => get().undoStack.length > 0,

  undo: () => {
    const [entry, ...rest] = get().undoStack
    if (!entry) return false
    cancelViewportAnimation()
    set({
      activeLayoutKey: entry.activeLayoutKey,
      layouts: cloneLayouts(entry.layouts),
      selectedCardIds: [...entry.selectedCardIds],
      focusReturn: entry.focusReturn
        ? { cardId: entry.focusReturn.cardId, viewport: { ...entry.focusReturn.viewport } }
        : null,
      maximizedCardId: null,
      undoStack: rest,
    })
    return true
  },

  setViewport: (viewport) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const nextViewport: CanvasViewport = {
        scale: viewport.scale !== undefined ? clampScale(viewport.scale) : layout.viewport.scale,
        offsetX: viewport.offsetX !== undefined ? viewport.offsetX : layout.viewport.offsetX,
        offsetY: viewport.offsetY !== undefined ? viewport.offsetY : layout.viewport.offsetY,
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, viewport: nextViewport },
        },
      }
    })
  },

  resetViewport: () => {
    set({ focusReturn: null })
    get().setViewport({ scale: 1, offsetX: 0, offsetY: 0 })
  },

  clearFocusReturn: () => set({ focusReturn: null }),

  toggleMaximizedCard: (cardId) => {
    cancelViewportAnimation()
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const cardExists = layout.cards.some((card) => card.id === cardId)
      if (!cardExists) return state
      return {
        maximizedCardId: state.maximizedCardId === cardId ? null : cardId,
        selectedCardIds: [cardId],
        focusReturn: null,
      }
    })
  },

  setMaximizedCard: (cardId) => {
    cancelViewportAnimation()
    if (!cardId) {
      set({ maximizedCardId: null })
      return
    }
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const cardExists = layout.cards.some((card) => card.id === cardId)
      if (!cardExists) return state
      return {
        maximizedCardId: cardId,
        selectedCardIds: [cardId],
        focusReturn: null,
      }
    })
  },

  clearMaximizedCard: () => set({ maximizedCardId: null }),

  focusOnCard: (cardId) => {
    cancelViewportAnimation()
    const focusReturn = get().focusReturn
    if (focusReturn?.cardId === cardId) {
      const card = get().getCard(cardId)
      get().setSelection([cardId])
      if (card?.kind !== 'frame') get().bringToFront(cardId)
      get().recordCardVisit(cardId)
      set({ focusReturn: null })
      animateViewport(focusReturn.viewport)
      return
    }

    const card = get().getCard(cardId)
    if (!card) return
    const returnViewport = get().getViewport()
    const targetViewport = getCardFocusViewport(card, returnViewport)
    if (!targetViewport) return

    get().setSelection([cardId])
    if (card.kind !== 'frame') get().bringToFront(cardId)
    get().recordCardVisit(cardId)
    set({ focusReturn: { cardId, viewport: returnViewport } })
    animateViewport(targetViewport)
  },

  focusFrameWorkspace: (frameId) => {
    cancelViewportAnimation()
    const frame = get().getCard(frameId)
    if (!frame || frame.kind !== 'frame') return
    const targetViewport = getFrameWorkspaceViewport(frame)
    if (!targetViewport) return
    const returnViewport = get().getViewport()
    get().setSelection([frameId])
    get().recordCardVisit(frameId)
    set({ focusReturn: { cardId: frameId, viewport: returnViewport } })
    animateViewport(targetViewport)
  },

  previewCardInViewport: (cardId) => {
    cancelViewportAnimation()
    const card = get().getCard(cardId)
    if (!card) return
    const targetViewport = getCardFocusViewport(card, get().getViewport())
    if (!targetViewport) return
    set({ focusReturn: null })
    animateViewport(targetViewport)
  },

  recordCardVisit: (cardId) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const nextLayout = withRecentCard(layout, cardId)
      if (nextLayout === layout) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: nextLayout,
        },
      }
    })
  },

  fitAll: (containerWidth, containerHeight) => {
    const { cards } = get().getLayout()
    if (cards.length === 0) {
      set({ focusReturn: null })
      animateViewport(defaultViewport())
      return
    }
    const minX = Math.min(...cards.map((c) => c.x))
    const minY = Math.min(...cards.map((c) => c.y))
    const maxX = Math.max(...cards.map((c) => c.x + c.width))
    const maxY = Math.max(...cards.map((c) => c.y + c.height))
    const bboxWidth = maxX - minX
    const bboxHeight = maxY - minY
    const padding = 80
    const scaleX = (containerWidth - padding * 2) / bboxWidth
    const scaleY = (containerHeight - padding * 2) / bboxHeight
    const scale = clampScale(Math.min(scaleX, scaleY, 1))
    const centerX = minX + bboxWidth / 2
    const centerY = minY + bboxHeight / 2
    const offsetX = containerWidth / 2 - centerX * scale
    const offsetY = containerHeight / 2 - centerY * scale
    set({ focusReturn: null })
    animateViewport({ scale, offsetX, offsetY })
  },

  addCard: (partial) => {
    const id = partial.id ?? `card-${generateId()}`
    const size = getDefaultCanvasCardSize(partial.kind)
    const now = Date.now()
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const maxZ = layout.cards.reduce((acc, card) => Math.max(acc, card.zIndex), 0)
      const card: CanvasCard = {
        id,
        kind: partial.kind,
        refId: partial.refId ?? null,
        x: partial.x ?? 0,
        y: partial.y ?? 0,
        width: partial.width ?? size.width,
        height: partial.height ?? size.height,
        expandedWidth: partial.expandedWidth,
        expandedHeight: partial.expandedHeight,
        zIndex: partial.zIndex ?? maxZ + 1,
        collapsed: partial.collapsed ?? false,
        collapsedPreview: partial.collapsedPreview,
        hidden: partial.hidden,
        hiddenByFrameId: partial.hiddenByFrameId,
        favorite: partial.favorite,
        cardSnapshots: partial.cardSnapshots,
        sessionRemark: partial.sessionRemark,
        noteBody: partial.noteBody,
        noteColor: partial.noteColor,
        frameTitle: partial.frameTitle,
        frameColor: partial.frameColor,
        frameMemberIds: partial.frameMemberIds,
        createdAt: partial.createdAt ?? now,
        updatedAt: now,
      }
      const cards = partial.kind === 'frame'
        ? [...layout.cards, card]
        : placeCard(layout, card, getPlacementSettings())
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        selectedCardIds: [id],
        undoStack: pushUndo(state),
      }
    })
    return id
  },

  addFrameAroundCards: (ids, fallback) => {
    const uniqueIds = Array.from(new Set(ids))
    const id = `card-${generateId()}`
    const now = Date.now()
    let created = false
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const targets = layout.cards.filter((card) => uniqueIds.includes(card.id) && card.kind !== 'frame')
      const padding = 56
      const maxZ = layout.cards.reduce((acc, card) => Math.max(acc, card.zIndex), 0)
      const minTargetZ = targets.reduce((acc, card) => Math.min(acc, card.zIndex), Number.POSITIVE_INFINITY)
      const bounds = targets.length > 0
        ? {
            minX: Math.min(...targets.map((card) => card.x)),
            minY: Math.min(...targets.map((card) => card.y)),
            maxX: Math.max(...targets.map((card) => card.x + card.width)),
            maxY: Math.max(...targets.map((card) => card.y + card.height)),
          }
        : {
            minX: (fallback?.x ?? 0) - DEFAULT_CARD_SIZE.frame.width / 2 + padding,
            minY: (fallback?.y ?? 0) - DEFAULT_CARD_SIZE.frame.height / 2 + padding,
            maxX: (fallback?.x ?? 0) + DEFAULT_CARD_SIZE.frame.width / 2 - padding,
            maxY: (fallback?.y ?? 0) + DEFAULT_CARD_SIZE.frame.height / 2 - padding,
          }
      const frame: CanvasCard = {
        id,
        kind: 'frame',
        refId: null,
        x: bounds.minX - padding,
        y: bounds.minY - padding,
        width: Math.max(DEFAULT_CARD_SIZE.frame.width, bounds.maxX - bounds.minX + padding * 2),
        height: Math.max(DEFAULT_CARD_SIZE.frame.height, bounds.maxY - bounds.minY + padding * 2),
        zIndex: Number.isFinite(minTargetZ) ? minTargetZ - 1 : maxZ + 1,
        collapsed: false,
        frameTitle: '分组',
        frameColor: 'violet',
        frameMemberIds: targets.map((target) => target.id),
        createdAt: now,
        updatedAt: now,
      }
      created = true
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards: [...layout.cards, frame] },
        },
        selectedCardIds: [id],
        undoStack: pushUndo(state),
      }
    })
    return created ? id : null
  },

  toggleFrameCollapsed: (frameId) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const frame = layout.cards.find((card) => card.id === frameId && card.kind === 'frame')
      if (!frame) return state

      const memberIds = new Set(frame.frameMemberIds ?? [])
      if (memberIds.size === 0) return state
      const collapsing = !frame.collapsed
      const now = Date.now()

      const cards = layout.cards.map((card) => {
        if (card.id === frameId) {
          return collapsing
            ? {
                ...card,
                collapsed: true,
                expandedWidth: card.width,
                expandedHeight: card.height,
                width: Math.max(260, Math.min(card.width, 420)),
                height: 58,
                updatedAt: now,
              }
            : {
                ...card,
                collapsed: false,
                width: card.expandedWidth ?? card.width,
                height: card.expandedHeight ?? Math.max(card.height, DEFAULT_CARD_SIZE.frame.height),
                expandedWidth: undefined,
                expandedHeight: undefined,
                updatedAt: now,
              }
        }

        if (collapsing && memberIds.has(card.id)) {
          return { ...card, hiddenByFrameId: frameId, updatedAt: now }
        }
        if (!collapsing && card.hiddenByFrameId === frameId) {
          return { ...card, hiddenByFrameId: undefined, updatedAt: now }
        }
        return card
      })

      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        selectedCardIds: collapsing
          ? state.selectedCardIds.filter((id) => !memberIds.has(id))
          : state.selectedCardIds,
        focusReturn: state.focusReturn && memberIds.has(state.focusReturn.cardId) ? null : state.focusReturn,
        maximizedCardId: state.maximizedCardId && memberIds.has(state.maximizedCardId) ? null : state.maximizedCardId,
        undoStack: pushUndo(state),
      }
    })
  },

  hideAllExceptFrame: (frameId) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const frame = layout.cards.find((card) => card.id === frameId && card.kind === 'frame')
      if (!frame) return state
      const visibleIds = new Set([frameId, ...(frame.frameMemberIds ?? [])])
      const now = Date.now()
      let touched = false
      const cards = layout.cards.map((card) => {
        const hidden = !visibleIds.has(card.id)
        if (card.hidden === hidden) return card
        touched = true
        return { ...card, hidden, updatedAt: now }
      })
      if (!touched) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        selectedCardIds: state.selectedCardIds.filter((id) => visibleIds.has(id)),
        focusReturn: state.focusReturn && !visibleIds.has(state.focusReturn.cardId) ? null : state.focusReturn,
        maximizedCardId: state.maximizedCardId && !visibleIds.has(state.maximizedCardId) ? null : state.maximizedCardId,
        undoStack: pushUndo(state),
      }
    })
  },

  setFrameMembersHidden: (frameId, hidden) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const frame = layout.cards.find((card) => card.id === frameId && card.kind === 'frame')
      if (!frame) return state
      const memberIds = new Set(frame.frameMemberIds ?? [])
      if (memberIds.size === 0) return state
      const now = Date.now()
      let touched = false
      const cards = layout.cards.map((card) => {
        if (!memberIds.has(card.id) || card.hidden === hidden) return card
        touched = true
        return { ...card, hidden, updatedAt: now }
      })
      if (!touched) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        selectedCardIds: hidden ? state.selectedCardIds.filter((id) => !memberIds.has(id)) : state.selectedCardIds,
        focusReturn: hidden && state.focusReturn && memberIds.has(state.focusReturn.cardId) ? null : state.focusReturn,
        maximizedCardId: hidden && state.maximizedCardId && memberIds.has(state.maximizedCardId) ? null : state.maximizedCardId,
        undoStack: pushUndo(state),
      }
    })
  },

  showAllCards: () => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const now = Date.now()
      let touched = false
      const cards = layout.cards.map((card) => {
        if (!card.hidden) return card
        touched = true
        return { ...card, hidden: false, updatedAt: now }
      })
      if (!touched) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        undoStack: pushUndo(state),
      }
    })
  },

  normalizeCardsToFocusArea: () => {
    const focusArea = getCanvasFocusScreenArea()
    if (!focusArea) return

    const targetScale = getConfiguredSessionFocusScale()
    const targetWidth = Math.max(320, Math.round(focusArea.width / targetScale))
    const targetHeight = Math.max(240, Math.round(focusArea.height / targetScale))

    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const now = Date.now()
      const { cards, touched } = resizeSessionCardsToGrid(layout, targetWidth, targetHeight, now)
      if (!touched) return state
      triggerCanvasLayoutAnimation()
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        focusReturn: null,
        undoStack: pushUndo(state),
      }
    })
  },

  normalizeCardsToDefaultSessionSize: () => {
    const size = getDefaultCanvasCardSize('session')
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const now = Date.now()
      const { cards, touched } = resizeSessionCardsToGrid(layout, size.width, size.height, now)
      if (!touched) return state
      triggerCanvasLayoutAnimation()
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        focusReturn: null,
        undoStack: pushUndo(state),
      }
    })
  },

  updateCard: (id, updates) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const nextCard: CanvasCard = { ...layout.cards[index], ...updates, updatedAt: Date.now() }
      const cards = [...layout.cards]
      cards[index] = nextCard
      const hiding = updates.hidden === true
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        selectedCardIds: hiding ? state.selectedCardIds.filter((cardId) => cardId !== id) : state.selectedCardIds,
        focusReturn: hiding && state.focusReturn?.cardId === id ? null : state.focusReturn,
        maximizedCardId: hiding && state.maximizedCardId === id ? null : state.maximizedCardId,
        undoStack: pushUndo(state),
      }
    })
  },

  toggleCardFavorite: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const cards = [...layout.cards]
      cards[index] = { ...cards[index], favorite: !cards[index].favorite, updatedAt: Date.now() }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        undoStack: pushUndo(state),
      }
    })
  },

  addCardSnapshot: (id, name) => {
    const snapshotId = `card-snapshot-${generateId()}`
    let created = false
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const card = layout.cards[index]
      const now = Date.now()
      const snapshots = card.cardSnapshots ?? []
      const snapshot: CanvasCardSnapshot = {
        id: snapshotId,
        name: name?.trim() || `快照 ${snapshots.length + 1}`,
        card: cloneSnapshotCard(card),
        createdAt: now,
        updatedAt: now,
      }
      const cards = [...layout.cards]
      cards[index] = {
        ...card,
        cardSnapshots: [...snapshots, snapshot].slice(-12),
        updatedAt: now,
      }
      created = true
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
    return created ? snapshotId : null
  },

  restoreCardSnapshot: (id, snapshotId) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const current = layout.cards[index]
      const snapshot = current.cardSnapshots?.find((item) => item.id === snapshotId)
      if (!snapshot) return state
      const cards = [...layout.cards]
      cards[index] = {
        ...cloneSnapshotCard(snapshot.card),
        id: current.id,
        refId: current.refId,
        kind: current.kind,
        zIndex: current.zIndex,
        cardSnapshots: current.cardSnapshots,
        favorite: current.favorite,
        createdAt: current.createdAt,
        updatedAt: Date.now(),
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        focusReturn: state.focusReturn?.cardId === id ? null : state.focusReturn,
        maximizedCardId: state.maximizedCardId === id ? null : state.maximizedCardId,
        undoStack: pushUndo(state),
      }
    })
  },

  removeCardSnapshot: (id, snapshotId) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const card = layout.cards[index]
      const snapshots = card.cardSnapshots?.filter((snapshot) => snapshot.id !== snapshotId)
      if ((snapshots?.length ?? 0) === (card.cardSnapshots?.length ?? 0)) return state
      const cards = [...layout.cards]
      cards[index] = { ...card, cardSnapshots: snapshots, updatedAt: Date.now() }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  updateCardPositions: (positions) => {
    if (positions.size === 0) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const now = Date.now()
      let touched = false
      let cards = layout.cards.map((card) => {
        const position = positions.get(card.id)
        if (!position) return card
        if (card.x === position.x && card.y === position.y) return card
        touched = true
        return { ...card, x: position.x, y: position.y, updatedAt: now }
      })
      const frameLayout = applyFrameAutoLayout(cards, positions.keys(), now)
      cards = frameLayout.cards
      touched = touched || frameLayout.touched
      if (!touched) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        undoStack: pushUndo(state),
      }
    })
  },

  updateCardsGeometry: (geometry) => {
    if (geometry.size === 0) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const now = Date.now()
      let touched = false
      let cards = layout.cards.map((card) => {
        const rect = geometry.get(card.id)
        if (!rect) return card
        if (
          card.x === rect.x
          && card.y === rect.y
          && card.width === rect.width
          && card.height === rect.height
        ) {
          return card
        }
        touched = true
        return {
          ...card,
          x: rect.x,
          y: rect.y,
          width: Math.max(120, rect.width),
          height: Math.max(80, rect.height),
          updatedAt: now,
        }
      })
      const frameLayout = applyFrameAutoLayout(cards, geometry.keys(), now)
      cards = frameLayout.cards
      touched = touched || frameLayout.touched
      if (!touched) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        focusReturn: state.focusReturn && geometry.has(state.focusReturn.cardId) ? null : state.focusReturn,
        undoStack: pushUndo(state),
      }
    })
  },

  setCardCollapsed: (id, collapsed, previewLines) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const card = layout.cards[index]
      if (card.collapsed === collapsed) return state
      const expandedWidth = collapsed ? card.width : card.expandedWidth
      const expandedHeight = collapsed ? card.height : card.expandedHeight
      const nextCard: CanvasCard = collapsed
        ? {
            ...card,
            collapsed: true,
            collapsedPreview: previewLines?.slice(-6),
            expandedWidth,
            expandedHeight,
            height: Math.min(card.height, 132),
            width: Math.max(320, Math.min(card.width, 520)),
            updatedAt: Date.now(),
          }
        : {
            ...card,
            collapsed: false,
            collapsedPreview: undefined,
            width: expandedWidth ?? card.width,
            height: expandedHeight ?? Math.max(card.height, 240),
            expandedWidth: undefined,
            expandedHeight: undefined,
            updatedAt: Date.now(),
          }
      const cards = [...layout.cards]
      cards[index] = nextCard
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        focusReturn: state.focusReturn?.cardId === id ? null : state.focusReturn,
        undoStack: pushUndo(state),
      }
    })
  },

  moveCards: (ids, dx, dy) => {
    if (dx === 0 && dy === 0) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const { movingIds, membersMovedWithFrame } = expandFrameMoveIds(layout.cards, ids)
      if (movingIds.size === 0) return state
      const now = Date.now()
      let touched = false
      let cards = layout.cards.map((card) => {
        if (!movingIds.has(card.id)) return card
        touched = true
        return { ...card, x: card.x + dx, y: card.y + dy, updatedAt: now }
      })
      const autoLayoutIds = [...movingIds].filter((id) => !membersMovedWithFrame.has(id))
      const frameLayout = applyFrameAutoLayout(cards, autoLayoutIds, now)
      cards = frameLayout.cards
      touched = touched || frameLayout.touched
      if (!touched) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        focusReturn: state.focusReturn && movingIds.has(state.focusReturn.cardId) ? null : state.focusReturn,
        undoStack: pushUndo(state),
      }
    })
  },

  resizeCard: (id, width, height, x, y) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.cards.findIndex((card) => card.id === id)
      if (index === -1) return state
      const card = layout.cards[index]
      const now = Date.now()
      const nextCard: CanvasCard = {
        ...card,
        width: Math.max(120, width),
        height: Math.max(80, height),
        x: x ?? card.x,
        y: y ?? card.y,
        updatedAt: now,
      }
      if (
        card.width === nextCard.width
        && card.height === nextCard.height
        && card.x === nextCard.x
        && card.y === nextCard.y
      ) {
        return state
      }
      const cards = [...layout.cards]
      cards[index] = nextCard
      const frameLayout = applyFrameAutoLayout(cards, [id], now)
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards: frameLayout.cards },
        },
        focusReturn: state.focusReturn?.cardId === id ? null : state.focusReturn,
        undoStack: pushUndo(state),
      }
    })
  },

  removeCard: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const now = Date.now()
      const cards = layout.cards
        .filter((card) => card.id !== id)
        .map((card) => card.hiddenByFrameId === id ? { ...card, hiddenByFrameId: undefined, updatedAt: now } : card)
      if (cards.length === layout.cards.length) return state
      const frameLayout = applyFrameAutoLayout(cards, [id], now)
      const relations = layout.relations.filter((relation) => relation.fromCardId !== id && relation.toCardId !== id)
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards: frameLayout.cards, relations },
        },
        selectedCardIds: state.selectedCardIds.filter((cardId) => cardId !== id),
        focusReturn: state.focusReturn?.cardId === id ? null : state.focusReturn,
        maximizedCardId: state.maximizedCardId === id ? null : state.maximizedCardId,
        undoStack: pushUndo(state),
      }
    })
  },

  bringToFront: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const card = layout.cards.find((c) => c.id === id)
      if (!card) return state
      const maxZ = layout.cards.reduce((acc, c) => Math.max(acc, c.zIndex), 0)
      if (card.zIndex === maxZ) return state
      const cards = layout.cards.map((c) =>
        c.id === id ? { ...c, zIndex: maxZ + 1, updatedAt: Date.now() } : c,
      )
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        undoStack: pushUndo(state),
      }
    })
  },

  setSelection: (ids) => set({ selectedCardIds: ids }),
  toggleSelection: (id, additive) => {
    set((state) => {
      if (!additive) return { selectedCardIds: [id] }
      const current = new Set(state.selectedCardIds)
      if (current.has(id)) current.delete(id)
      else current.add(id)
      return { selectedCardIds: Array.from(current) }
    })
  },
  clearSelection: () => set({ selectedCardIds: [] }),

  // ─── Session <-> card mapping ───

  findCardBySessionId: (sessionId) => {
    const { layouts } = get()
    for (const [layoutKey, layout] of Object.entries(layouts)) {
      const card = layout.cards.find((c) => c.refId === sessionId)
      if (card) return { layoutKey, card }
    }
    return null
  },

  attachSession: (sessionId, kind, position) => {
    const existing = get().findCardBySessionId(sessionId)
    if (existing && existing.layoutKey === get().activeLayoutKey) {
      get().setSelection([existing.card.id])
      get().bringToFront(existing.card.id)
      return existing.card.id
    }
    if (existing) {
      // Session is parked in another layout — move it to the active one.
      set((state) => {
        const nextLayouts = { ...state.layouts }
        const fromLayout = nextLayouts[existing.layoutKey]
        if (fromLayout) {
          const relations = fromLayout.relations.filter((relation) =>
            relation.fromCardId !== existing.card.id && relation.toCardId !== existing.card.id,
          )
          nextLayouts[existing.layoutKey] = {
            ...fromLayout,
            cards: fromLayout.cards.filter((c) => c.id !== existing.card.id),
            relations,
          }
        }
        const toKey = state.activeLayoutKey
        const toLayout = nextLayouts[toKey] ?? defaultLayout()
        const maxZ = toLayout.cards.reduce((acc, card) => Math.max(acc, card.zIndex), 0)
        const card: CanvasCard = {
          ...existing.card,
          x: position?.x ?? existing.card.x,
          y: position?.y ?? existing.card.y,
          zIndex: maxZ + 1,
          updatedAt: Date.now(),
        }
        nextLayouts[toKey] = {
          ...toLayout,
          cards: placeCard(toLayout, card, getPlacementSettings()),
        }
        return { layouts: nextLayouts, selectedCardIds: [existing.card.id], undoStack: pushUndo(state) }
      })
      return existing.card.id
    }
    const size = getDefaultCanvasCardSize(kind)
    return get().addCard({
      kind,
      refId: sessionId,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      width: size.width,
      height: size.height,
    })
  },

  detachSessionEverywhere: (sessionId) => {
    set((state) => {
      const layouts: Record<string, CanvasLayout> = {}
      for (const [key, layout] of Object.entries(state.layouts)) {
        const cards = layout.cards.filter((c) => c.refId !== sessionId)
        if (cards.length === layout.cards.length) {
          layouts[key] = layout
          continue
        }
        const remainingIds = new Set(cards.map((card) => card.id))
        const relations = layout.relations.filter((relation) =>
          remainingIds.has(relation.fromCardId) && remainingIds.has(relation.toCardId),
        )
        layouts[key] = { ...layout, cards, relations }
      }
      const selectedCardIds = state.selectedCardIds.filter((id) => {
        const card = Object.values(layouts).flatMap((l) => l.cards).find((c) => c.id === id)
        return Boolean(card)
      })
      const maximizedExists = state.maximizedCardId
        ? Object.values(layouts).some((layout) => layout.cards.some((card) => card.id === state.maximizedCardId))
        : false
      return {
        layouts,
        selectedCardIds,
        maximizedCardId: maximizedExists ? state.maximizedCardId : null,
      }
    })
  },

  autoPopulateFromSessions: (sessionIds, kindFor) => {
    if (sessionIds.length === 0) return []
    const existingRefIds = new Set(get().getCards().map((c) => c.refId).filter(Boolean) as string[])
    const newSessionIds = sessionIds.filter((id) => !existingRefIds.has(id))
    if (newSessionIds.length === 0) return []

    const createdCardIds: string[] = []
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const placement = getPlacementSettings()
      let startX = 0
      let maxZ = layout.cards.reduce((acc, c) => Math.max(acc, c.zIndex), 0)
      if (layout.cards.length > 0) {
        startX = Math.max(...layout.cards.map((c) => c.x + c.width)) + CARD_GAP
      }
      const now = Date.now()
      let cards = [...layout.cards]
      for (const sessionId of newSessionIds) {
        const kind = kindFor(sessionId)
        const size = getDefaultCanvasCardSize(kind)
        maxZ += 1
        const cardId = `card-${generateId()}`
        createdCardIds.push(cardId)
        const card: CanvasCard = {
          id: cardId,
          kind,
          refId: sessionId,
          x: startX,
          y: 0,
          width: size.width,
          height: size.height,
          zIndex: maxZ,
          collapsed: false,
          createdAt: now,
          updatedAt: now,
        }
        cards = placeCard({ ...layout, cards }, card, placement)
        startX += size.width + CARD_GAP
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        undoStack: pushUndo(state),
      }
    })
    return createdCardIds
  },

  // ─── Bulk ops ───

  removeCards: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const now = Date.now()
      const cards = layout.cards
        .filter((c) => !idSet.has(c.id))
        .map((card) => card.hiddenByFrameId && idSet.has(card.hiddenByFrameId)
          ? { ...card, hiddenByFrameId: undefined, updatedAt: now }
          : card)
      if (cards.length === layout.cards.length) return state
      const frameLayout = applyFrameAutoLayout(cards, idSet, now)
      const relations = layout.relations.filter((relation) =>
        !idSet.has(relation.fromCardId) && !idSet.has(relation.toCardId),
      )
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards: frameLayout.cards, relations },
        },
        selectedCardIds: state.selectedCardIds.filter((id) => !idSet.has(id)),
        focusReturn: state.focusReturn && idSet.has(state.focusReturn.cardId) ? null : state.focusReturn,
        maximizedCardId: state.maximizedCardId && idSet.has(state.maximizedCardId) ? null : state.maximizedCardId,
        undoStack: pushUndo(state),
      }
    })
  },

  duplicateCards: (ids) => {
    if (ids.length === 0) return []
    const newIds: string[] = []
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const placement = getPlacementSettings()
      const now = Date.now()
      let maxZ = layout.cards.reduce((acc, c) => Math.max(acc, c.zIndex), 0)
      let cards = [...layout.cards]
      for (const id of ids) {
        const src = cards.find((c) => c.id === id)
        if (!src) continue
        // Only note cards make sense to clone standalone; session/terminal cards
        // can't have two cards pointing to the same PTY — clone as notes would
        // be confusing, so we only clone notes here.
        if (src.kind !== 'note') continue
        maxZ += 1
        const clone: CanvasCard = {
          ...src,
          id: `card-${generateId()}`,
          x: src.x + 24,
          y: src.y + 24,
          zIndex: maxZ,
          createdAt: now,
          updatedAt: now,
        }
        cards = placeCard({ ...layout, cards }, clone, placement)
        newIds.push(clone.id)
      }
      if (newIds.length === 0) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
        selectedCardIds: newIds,
        undoStack: pushUndo(state),
      }
    })
    return newIds
  },

  // ─── Bookmarks ───

  addBookmark: (name) => {
    const id = `bookmark-${generateId()}`
    const now = Date.now()
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const bookmark: CanvasBookmark = {
        id,
        name: name?.trim() || `视图 ${layout.bookmarks.length + 1}`,
        viewport: { ...layout.viewport },
        createdAt: now,
        updatedAt: now,
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, bookmarks: [...layout.bookmarks, bookmark] },
        },
      }
    })
    return id
  },

  addBookmarkForCard: (cardId, name) => {
    const card = get().getCard(cardId)
    if (!card) return null
    const id = `bookmark-${generateId()}`
    const now = Date.now()
    const bookmarkName = name?.trim() || getCanvasCardLabel(card)
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const bookmark: CanvasBookmark = {
        id,
        name: bookmarkName,
        cardId,
        viewport: { ...layout.viewport },
        createdAt: now,
        updatedAt: now,
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, bookmarks: [...layout.bookmarks, bookmark] },
        },
      }
    })
    return id
  },

  goToBookmark: (id) => {
    const bookmark = get().getLayout().bookmarks.find((item) => item.id === id)
    if (!bookmark) return
    if (bookmark.cardId && get().getCard(bookmark.cardId)) {
      const card = get().getCard(bookmark.cardId)
      if (card && isCanvasCardHidden(card)) get().updateCard(bookmark.cardId, { hidden: false, hiddenByFrameId: undefined })
      get().clearMaximizedCard()
      get().clearFocusReturn()
      requestAnimationFrame(() => {
        if (!bookmark.cardId) return
        const target = get().getCard(bookmark.cardId)
        if (target?.kind === 'frame') get().focusFrameWorkspace(bookmark.cardId)
        else get().focusOnCard(bookmark.cardId)
      })
      return
    }
    set({ focusReturn: null })
    animateViewport(bookmark.viewport)
  },

  updateBookmarkViewport: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.bookmarks.findIndex((bookmark) => bookmark.id === id)
      if (index === -1) return state
      const current = layout.bookmarks[index]
      const bookmarks = [...layout.bookmarks]
      bookmarks[index] = {
        ...current,
        viewport: { ...layout.viewport },
        updatedAt: Date.now(),
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, bookmarks },
        },
      }
    })
  },

  renameBookmark: (id, name) => {
    const nextName = name.trim()
    if (!nextName) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.bookmarks.findIndex((bookmark) => bookmark.id === id)
      if (index === -1) return state
      const current = layout.bookmarks[index]
      if (current.name === nextName) return state
      const bookmarks = [...layout.bookmarks]
      bookmarks[index] = { ...current, name: nextName, updatedAt: Date.now() }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, bookmarks },
        },
      }
    })
  },

  removeBookmark: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const bookmarks = layout.bookmarks.filter((bookmark) => bookmark.id !== id)
      if (bookmarks.length === layout.bookmarks.length) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, bookmarks },
        },
      }
    })
  },

  addLayoutSnapshot: (name) => {
    const id = `layout-snapshot-${generateId()}`
    const now = Date.now()
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const snapshot: CanvasLayoutSnapshot = {
        id,
        name: name?.trim() || `布局 ${layout.snapshots.length + 1}`,
        cards: layout.cards.map(cloneSnapshotCard),
        viewport: { ...layout.viewport },
        relations: layout.relations.map((relation) => ({ ...relation })),
        createdAt: now,
        updatedAt: now,
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, snapshots: [...layout.snapshots, snapshot].slice(-20) },
        },
      }
    })
    return id
  },

  addFrameSnapshot: (frameId, name) => {
    const frame = get().getCard(frameId)
    if (!frame || frame.kind !== 'frame') return null
    const id = `frame-snapshot-${generateId()}`
    const now = Date.now()
    const frameName = frame.frameTitle?.trim() || '分组'
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const currentFrame = layout.cards.find((card) => card.id === frameId && card.kind === 'frame')
      if (!currentFrame) return state
      const memberIds = new Set(currentFrame.frameMemberIds ?? [])
      const snapshotIds = new Set([frameId, ...memberIds])
      const snapshot: CanvasFrameSnapshot = {
        id,
        name: name?.trim() || `${frameName} 快照`,
        frame: cloneSnapshotCard(currentFrame),
        cards: layout.cards.filter((card) => memberIds.has(card.id)).map(cloneSnapshotCard),
        relations: layout.relations
          .filter((relation) => snapshotIds.has(relation.fromCardId) && snapshotIds.has(relation.toCardId))
          .map((relation) => ({ ...relation })),
        createdAt: now,
        updatedAt: now,
      }
      const cards = layout.cards.map((card) => {
        if (card.id !== frameId) return card
        return {
          ...card,
          frameSnapshots: [...(card.frameSnapshots ?? []), snapshot].slice(-12),
          updatedAt: now,
        }
      })
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
    return id
  },

  restoreFrameSnapshot: (frameId, snapshotId) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const frame = layout.cards.find((card) => card.id === frameId && card.kind === 'frame')
      const snapshot = frame?.frameSnapshots?.find((item) => item.id === snapshotId)
      if (!frame || !snapshot) return state

      const oldMemberIds = new Set(frame.frameMemberIds ?? [])
      const restoredFrame: CanvasCard = {
        ...cloneSnapshotCard(snapshot.frame),
        frameSnapshots: frame.frameSnapshots?.map(cloneFrameSnapshot),
      }
      const restoredCards = snapshot.cards.map(cloneSnapshotCard)
      const restoredIds = new Set([restoredFrame.id, ...restoredCards.map((card) => card.id)])
      const ownedIds = new Set([frameId, ...oldMemberIds, ...restoredIds])
      const cards = layout.cards
        .filter((card) => !ownedIds.has(card.id))
        .concat([restoredFrame, ...restoredCards])
      const nextCardIds = new Set(cards.map((card) => card.id))
      const relations = [
        ...layout.relations.filter((relation) => (
          nextCardIds.has(relation.fromCardId)
          && nextCardIds.has(relation.toCardId)
          && !(restoredIds.has(relation.fromCardId) && restoredIds.has(relation.toCardId))
        )),
        ...snapshot.relations
          .filter((relation) => restoredIds.has(relation.fromCardId) && restoredIds.has(relation.toCardId))
          .map((relation) => ({ ...relation })),
      ]

      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards, relations },
        },
        selectedCardIds: state.selectedCardIds.filter((id) => nextCardIds.has(id)),
        focusReturn: state.focusReturn && !nextCardIds.has(state.focusReturn.cardId) ? null : state.focusReturn,
        maximizedCardId: state.maximizedCardId && !nextCardIds.has(state.maximizedCardId) ? null : state.maximizedCardId,
        undoStack: pushUndo(state),
      }
    })
  },

  removeFrameSnapshot: (frameId, snapshotId) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      let touched = false
      const cards = layout.cards.map((card) => {
        if (card.id !== frameId || card.kind !== 'frame') return card
        const frameSnapshots = (card.frameSnapshots ?? []).filter((snapshot) => snapshot.id !== snapshotId)
        if (frameSnapshots.length === (card.frameSnapshots ?? []).length) return card
        touched = true
        return { ...card, frameSnapshots, updatedAt: Date.now() }
      })
      if (!touched) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  restoreLayoutSnapshot: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const snapshot = layout.snapshots.find((item) => item.id === id)
      if (!snapshot) return state
      const nextLayout: CanvasLayout = {
        ...layout,
        cards: snapshot.cards.map(cloneSnapshotCard),
        viewport: { ...snapshot.viewport },
        relations: snapshot.relations.map((relation) => ({ ...relation })),
      }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: nextLayout,
        },
        selectedCardIds: [],
        focusReturn: null,
        maximizedCardId: null,
        undoStack: pushUndo(state),
      }
    })
  },

  renameLayoutSnapshot: (id, name) => {
    const nextName = name.trim()
    if (!nextName) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const index = layout.snapshots.findIndex((snapshot) => snapshot.id === id)
      if (index === -1) return state
      const current = layout.snapshots[index]
      if (current.name === nextName) return state
      const snapshots = [...layout.snapshots]
      snapshots[index] = { ...current, name: nextName, updatedAt: Date.now() }
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, snapshots },
        },
      }
    })
  },

  removeLayoutSnapshot: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const snapshots = layout.snapshots.filter((snapshot) => snapshot.id !== id)
      if (snapshots.length === layout.snapshots.length) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, snapshots },
        },
      }
    })
  },

  // ─── Relations ───

  addRelation: (fromCardId, toCardId) => {
    if (fromCardId === toCardId) return null
    const id = `relation-${generateId()}`
    const now = Date.now()
    let relationId: string | null = null
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const fromExists = layout.cards.some((card) => card.id === fromCardId)
      const toExists = layout.cards.some((card) => card.id === toCardId)
      if (!fromExists || !toExists) return state
      const existing = layout.relations.find((relation) =>
        (relation.fromCardId === fromCardId && relation.toCardId === toCardId)
        || (relation.fromCardId === toCardId && relation.toCardId === fromCardId),
      )
      if (existing) {
        relationId = existing.id
        return state
      }
      const relation: CanvasRelation = {
        id,
        fromCardId,
        toCardId,
        createdAt: now,
        updatedAt: now,
      }
      relationId = id
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, relations: [...layout.relations, relation] },
        },
        undoStack: pushUndo(state),
      }
    })
    return relationId
  },

  removeRelation: (id) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const relations = layout.relations.filter((relation) => relation.id !== id)
      if (relations.length === layout.relations.length) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, relations },
        },
        undoStack: pushUndo(state),
      }
    })
  },

  removeRelationsForCards: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const relations = layout.relations.filter((relation) =>
        !idSet.has(relation.fromCardId) && !idSet.has(relation.toCardId),
      )
      if (relations.length === layout.relations.length) return state
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, relations },
        },
        undoStack: pushUndo(state),
      }
    })
  },

  // ─── Arrangement ───

  arrange: (kind, ids) => {
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const targetIdSet = ids && ids.length > 0 ? new Set(ids) : null
      const targets = ids && ids.length > 0
        ? layout.cards.filter((c) => ids.includes(c.id))
        : layout.cards
      if (targets.length === 0) return state

      const layoutPositions = new Map<string, { x: number; y: number }>()
      const frameChangedIds = new Set<string>()
      const membership = getPrimaryFrameMembership(layout.cards)
      const frames = layout.cards.filter((card) => card.kind === 'frame')
      const targetCards = targets.filter((card) => card.kind !== 'frame')

      for (const frame of frames) {
        const members = targetCards.filter((card) => membership.get(card.id) === frame.id)
        if (members.length === 0) continue

        const maxMemberWidth = Math.max(...members.map((card) => card.width))
        const innerWidth = Math.max(maxMemberWidth, frame.width - FRAME_AUTO_PADDING * 2)
        const positions = computeArrangePositionsForKind(
          members,
          kind,
          { x: frame.x + FRAME_AUTO_PADDING, y: frame.y + FRAME_AUTO_PADDING },
          innerWidth,
        )
        for (const [id, position] of positions) {
          layoutPositions.set(id, position)
          frameChangedIds.add(id)
        }
      }

      const ungroupedTargets = targetCards.filter((card) => !membership.has(card.id))
      if (ungroupedTargets.length > 0) {
        const positions = computeArrangePositionsForKind(
          ungroupedTargets,
          kind,
          getArrangeOrigin(ungroupedTargets),
        )
        for (const [id, position] of positions) {
          layoutPositions.set(id, position)
        }
      }

      const selectedFrames = targetIdSet
        ? targets.filter((card) => card.kind === 'frame')
        : []
      if (selectedFrames.length > 0 && targetCards.length === 0) {
        const positions = computeArrangePositionsForKind(
          selectedFrames,
          kind,
          getArrangeOrigin(selectedFrames),
        )
        for (const [id, position] of positions) {
          layoutPositions.set(id, position)
        }
      }

      const now = Date.now()
      let cards = layout.cards.map((card) => {
        const pos = layoutPositions.get(card.id)
        if (!pos) return card
        return { ...card, x: pos.x, y: pos.y, updatedAt: now }
      })
      if (frameChangedIds.size > 0) {
        const frameLayout = applyFrameAutoLayout(cards, frameChangedIds, now)
        cards = frameLayout.cards
      }
      triggerCanvasLayoutAnimation()
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  alignCards: (axis, ids) => {
    if (ids.length < 2) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const idSet = new Set(ids)
      const targets = layout.cards.filter((c) => idSet.has(c.id))
      if (targets.length < 2) return state

      let reference: number
      if (axis === 'left') reference = Math.min(...targets.map((c) => c.x))
      else if (axis === 'right') reference = Math.max(...targets.map((c) => c.x + c.width))
      else if (axis === 'top') reference = Math.min(...targets.map((c) => c.y))
      else if (axis === 'bottom') reference = Math.max(...targets.map((c) => c.y + c.height))
      else if (axis === 'hCenter') {
        const avg = targets.reduce((acc, c) => acc + c.x + c.width / 2, 0) / targets.length
        reference = avg
      } else {
        const avg = targets.reduce((acc, c) => acc + c.y + c.height / 2, 0) / targets.length
        reference = avg
      }

      const now = Date.now()
      const cards = layout.cards.map((card) => {
        if (!idSet.has(card.id)) return card
        switch (axis) {
          case 'left': return { ...card, x: reference, updatedAt: now }
          case 'right': return { ...card, x: reference - card.width, updatedAt: now }
          case 'top': return { ...card, y: reference, updatedAt: now }
          case 'bottom': return { ...card, y: reference - card.height, updatedAt: now }
          case 'hCenter': return { ...card, x: reference - card.width / 2, updatedAt: now }
          case 'vCenter': return { ...card, y: reference - card.height / 2, updatedAt: now }
        }
      })
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },

  distributeCards: (axis, ids) => {
    if (ids.length < 3) return
    set((state) => {
      const layout = state.layouts[state.activeLayoutKey] ?? defaultLayout()
      const idSet = new Set(ids)
      const targets = layout.cards.filter((c) => idSet.has(c.id))
      if (targets.length < 3) return state

      const sorted = [...targets].sort((a, b) => axis === 'horizontal' ? a.x - b.x : a.y - b.y)
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const sizeSum = sorted.reduce((acc, c) => acc + (axis === 'horizontal' ? c.width : c.height), 0)
      const span = axis === 'horizontal'
        ? (last.x + last.width) - first.x
        : (last.y + last.height) - first.y
      const gap = (span - sizeSum) / (sorted.length - 1)

      const positions = new Map<string, number>()
      let cursor = axis === 'horizontal' ? first.x : first.y
      for (const card of sorted) {
        positions.set(card.id, cursor)
        cursor += (axis === 'horizontal' ? card.width : card.height) + gap
      }

      const now = Date.now()
      const cards = layout.cards.map((card) => {
        const pos = positions.get(card.id)
        if (pos === undefined) return card
        return axis === 'horizontal'
          ? { ...card, x: pos, updatedAt: now }
          : { ...card, y: pos, updatedAt: now }
      })
      return {
        layouts: {
          ...state.layouts,
          [state.activeLayoutKey]: { ...layout, cards },
        },
      }
    })
  },
}))

// ─── Helpers for use in components ───

export { GLOBAL_LAYOUT_KEY, SESSIONS_LAYOUT_KEY }

/** Resolve the layout key for the current project/worktree context. */
export function resolveCanvasLayoutKey(
  workspaceMode: 'project' | 'sessions',
  projectLayoutKey: string | null,
): string {
  if (workspaceMode === 'sessions') return SESSIONS_LAYOUT_KEY
  return projectLayoutKey ?? GLOBAL_LAYOUT_KEY
}

// ─── Debounced persistence ───
let persistTimer: ReturnType<typeof setTimeout> | null = null
let lastLayouts: CanvasState['layouts'] | null = null
useCanvasStore.subscribe((state) => {
  if (state.layouts === lastLayouts) return
  lastLayouts = state.layouts
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistCanvas(useCanvasStore.getState())
  }, 400)
})
