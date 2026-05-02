import { useEffect, useRef, useState } from 'react'
import {
  Terminal,
  type IBufferLine,
  type IDecoration,
  type ILink,
  type ILinkProvider,
  type IMarker,
} from '@xterm/xterm'
import { addTimelineEvent } from '@/components/rightpanel/SessionTimeline'
import { trackSessionInput, trackSessionOutput } from '@/components/rightpanel/agentRuntime'

// ─── Global terminal registry for preview snapshots ───
const terminalRegistry = new Map<string, Terminal>()
const terminalQuestionMarkers = new Map<string, Set<IMarker>>()
const terminalQuestionAnchors = new Map<string, number>()
const terminalQuestionHighlights = new Map<string, {
  decoration: IDecoration
  marker: IMarker
  timeoutId: number
}>()

export interface TerminalQuestionNavigation {
  previousLine: number | null
  nextLine: number | null
}
type TerminalQuestionNavigationOptions = {
  syncAnchorToViewport?: boolean
}

function isTerminalAtBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active
  return buffer.viewportY >= buffer.baseY
}

function getQuestionMarkerSet(sessionId: string): Set<IMarker> {
  let markers = terminalQuestionMarkers.get(sessionId)
  if (!markers) {
    markers = new Set<IMarker>()
    terminalQuestionMarkers.set(sessionId, markers)
  }
  return markers
}

function looksLikeUserQuestionLine(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /^(?:›|❯)\s+\S/.test(trimmed)
    || /^(?:User|Human|You|用户|我)[:：]\s+\S/i.test(trimmed)
    || /^╭.*(?:User|Human|You|用户)/i.test(trimmed)
}

function looksLikeAgentToolActivityLine(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /^[•●]\s+(?:Ran|Read|Edited|Added|Updated|Deleted|Created|Searched|Listed|Opened|Called|Checked|Built)\b/i.test(trimmed)
    || /^Ran\s+(?:rg|git|pnpm|npm|node|python|Get-Content|docker|gh)\b/i.test(trimmed)
}

function isNearAgentToolActivityLine(terminal: Terminal, line: number): boolean {
  const buffer = terminal.buffer.active
  for (let offset = 0; offset <= 2; offset += 1) {
    const candidate = buffer.getLine(line - offset)
    if (candidate && looksLikeAgentToolActivityLine(candidate.translateToString(true))) {
      return true
    }
  }
  return false
}

function markTerminalQuestionLine(sessionId: string, terminal: Terminal, line: number): void {
  const buffer = terminal.buffer.active
  const maxLine = buffer.baseY + Math.max(0, terminal.rows - 1)
  const boundedLine = Math.max(0, Math.min(line, maxLine))
  const cursorLine = buffer.baseY + buffer.cursorY
  const marker = terminal.registerMarker(boundedLine - cursorLine)
  if (!marker) return

  const markers = getQuestionMarkerSet(sessionId)
  markers.add(marker)
  marker.onDispose(() => markers.delete(marker))
}

function getTerminalQuestionLines(sessionId: string, terminal: Terminal): number[] {
  const buffer = terminal.buffer.active
  const lines = new Set<number>()
  const endLine = buffer.baseY + terminal.rows

  for (const marker of getQuestionMarkerSet(sessionId)) {
    const line = marker.line
    if (line < 0) continue
    if (line >= 0 && line < endLine && buffer.getLine(line) && !isNearAgentToolActivityLine(terminal, line)) {
      lines.add(line)
    }
  }

  for (let lineIndex = 0; lineIndex < endLine; lineIndex += 1) {
    const line = buffer.getLine(lineIndex)
    if (!line) continue
    if (looksLikeUserQuestionLine(line.translateToString(true))) {
      lines.add(lineIndex)
    }
  }

  return [...lines].sort((a, b) => a - b)
}

function getTerminalViewportBounds(terminal: Terminal): { start: number; end: number } {
  const start = terminal.buffer.active.viewportY
  return { start, end: start + Math.max(0, terminal.rows - 1) }
}

function getNearestVisibleQuestionLine(terminal: Terminal, lines: number[]): number | null {
  const { start, end } = getTerminalViewportBounds(terminal)
  const visibleLines = lines.filter((line) => line >= start && line <= end)
  if (visibleLines.length === 0) return null

  const buffer = terminal.buffer.active
  const referenceLine = isTerminalAtBottom(terminal)
    ? buffer.baseY + buffer.cursorY
    : start + 2

  return visibleLines.reduce((nearest, line) => (
    Math.abs(line - referenceLine) < Math.abs(nearest - referenceLine) ? line : nearest
  ), visibleLines[0])
}

function syncTerminalQuestionAnchorToViewport(
  sessionId: string,
  terminal: Terminal,
  lines: number[],
): number | null {
  const nearestLine = getNearestVisibleQuestionLine(terminal, lines)
  if (nearestLine === null) return null
  terminalQuestionAnchors.set(sessionId, nearestLine)
  return nearestLine
}

export function scrollTerminalToLatest(sessionId: string): boolean {
  const terminal = terminalRegistry.get(sessionId)
  if (!terminal) return false
  clearTerminalQuestionHighlight(sessionId)
  terminalQuestionAnchors.delete(sessionId)
  terminal.scrollToBottom()
  return true
}

function clearTerminalQuestionHighlight(sessionId: string): void {
  const highlight = terminalQuestionHighlights.get(sessionId)
  if (!highlight) return
  window.clearTimeout(highlight.timeoutId)
  highlight.decoration.dispose()
  highlight.marker.dispose()
  terminalQuestionHighlights.delete(sessionId)
}

export function getTerminalQuestionNavigation(
  sessionId: string,
  referenceLine?: number | null,
  options: TerminalQuestionNavigationOptions = {},
): TerminalQuestionNavigation {
  const terminal = terminalRegistry.get(sessionId)
  if (!terminal) return { previousLine: null, nextLine: null }

  const lines = getTerminalQuestionLines(sessionId, terminal)
  const clickedQuestionLine = referenceLine != null && lines.includes(referenceLine)
    ? referenceLine
    : null
  const anchorLine = terminalQuestionAnchors.get(sessionId) ?? null
  const { start: viewportStart, end: viewportEnd } = getTerminalViewportBounds(terminal)
  const visibleAnchorLine = anchorLine != null
    && anchorLine >= viewportStart
    && anchorLine <= viewportEnd
    && lines.includes(anchorLine)
    ? anchorLine
    : null

  if (anchorLine != null && visibleAnchorLine === null) {
    terminalQuestionAnchors.delete(sessionId)
  }

  const syncedAnchorLine = clickedQuestionLine === null
    && visibleAnchorLine === null
    && options.syncAnchorToViewport
    ? syncTerminalQuestionAnchorToViewport(sessionId, terminal, lines)
    : null

  const currentLine = clickedQuestionLine
    ?? visibleAnchorLine
    ?? syncedAnchorLine
    ?? referenceLine
    ?? (isTerminalAtBottom(terminal) ? viewportEnd + 1 : viewportStart)
  let previousLine: number | null = null
  let nextLine: number | null = null

  for (const line of lines) {
    if (line < currentLine) {
      previousLine = line
      continue
    }
    if (line > currentLine) {
      nextLine = line
      break
    }
  }

  return { previousLine, nextLine }
}

export function scrollTerminalToQuestion(sessionId: string, line: number): boolean {
  const terminal = terminalRegistry.get(sessionId)
  if (!terminal) return false
  const topLine = Math.max(0, line - 2)
  terminalQuestionAnchors.set(sessionId, line)
  terminal.focus()
  terminal.scrollToLine(topLine)
  flashTerminalQuestionLine(sessionId, terminal, line)
  return true
}

function flashTerminalQuestionLine(sessionId: string, terminal: Terminal, line: number): void {
  clearTerminalQuestionHighlight(sessionId)

  const buffer = terminal.buffer.active
  const cursorLine = buffer.baseY + buffer.cursorY
  const marker = terminal.registerMarker(line - cursorLine)
  if (!marker) return

  const decoration = terminal.registerDecoration({
    marker,
    x: 0,
    width: terminal.cols,
    height: 1,
  })
  if (!decoration) {
    marker.dispose()
    return
  }

  decoration.onRender((element) => {
    element.classList.add('terminal-question-jump-highlight')
  })

  const timeoutId = window.setTimeout(() => {
    const current = terminalQuestionHighlights.get(sessionId)
    if (current?.decoration !== decoration) return
    clearTerminalQuestionHighlight(sessionId)
  }, 1800)

  terminalQuestionHighlights.set(sessionId, { decoration, marker, timeoutId })
}

export function scrollTerminalToAdjacentQuestion(
  sessionId: string,
  direction: 'previous' | 'next',
): boolean {
  const navigation = getTerminalQuestionNavigation(sessionId, null, { syncAnchorToViewport: true })
  const line = direction === 'previous' ? navigation.previousLine : navigation.nextLine
  if (line === null) return false
  return scrollTerminalToQuestion(sessionId, line)
}

export function scrollTerminalToLatestSoon(sessionId: string): void {
  let attempts = 0
  const run = (): void => {
    attempts += 1
    if (scrollTerminalToLatest(sessionId)) return
    if (attempts >= 16) return
    window.setTimeout(run, 80)
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(run)
  })
}

export function getTerminalPreviewText(sessionId: string, lineCount = 16): string[] {
  const terminal = terminalRegistry.get(sessionId)
  if (!terminal) return []
  const buf = terminal.buffer.active
  const result: string[] = []
  const end = buf.baseY + buf.cursorY + 1
  const start = Math.max(0, end - lineCount)
  for (let i = start; i < end; i++) {
    const line = buf.getLine(i)
    result.push(line ? line.translateToString() : '')
  }
  return result
}

export function getTerminalBufferText(sessionId: string, lineCount = 120): string {
  return getTerminalPreviewText(sessionId, lineCount).join('\n')
}
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { Session, SessionDataEvent } from '@shared/types'
import { isClaudeCodeType, isCodexType, isGeminiType, isWslSessionType } from '@shared/types'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { usePanesStore } from '@/stores/panes'
import { useWorktreesStore } from '@/stores/worktrees'
import { useEditorsStore } from '@/stores/editors'
import { getXtermTheme, defaultDarkTheme } from '@/lib/ghosttyTheme'
import { parseCustomSessionArgs } from '@/lib/createSession'

const TERMINAL_FONT_SIZE_MIN = 8
const TERMINAL_FONT_SIZE_MAX = 36

/** Match file path candidates like `src/foo.ts:42`, `./foo.py`, `C:\\x\\y.rs:1:2`, or quoted paths with spaces. */
const FILE_PATH_RE = /"((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[A-Za-z0-9_][^"'\r\n]*[\\/])[^"\r\n]+)"|'((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[A-Za-z0-9_][^"'\r\n]*[\\/])[^'\r\n]+)'|((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[A-Za-z0-9_][^\s<>"'`|]*[\\/])[^\s<>"'`|]+)/g
const WINDOWS_ABSOLUTE_FILE_PATH_RE = /[A-Za-z]:[\\/][^\r\n<>"'`|]*?\.[A-Za-z0-9]{1,10}(?::\d+(?::\d+)?)?(?=$|[\s,;!?)\]}>"'`，。；！）】])/g

const URL_RE = /https?:\/\/[^\s<>()"'`\\]+/g

export interface ParsedFileRef {
  path: string
  line: number | null
  column: number | null
}

export interface TerminalFileLinkCandidate {
  raw: string
  start: number
  end: number
  ref: ParsedFileRef
}

function parseFileRef(raw: string): ParsedFileRef | null {
  const cleaned = raw.trim().replace(/[.,;!?)\]}>'"`]+$/, '')
  const match = cleaned.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/)
  if (!match) return null
  const path = match[1]
  if (!looksLikeFilePath(path)) return null
  return {
    path,
    line: match[2] ? parseInt(match[2], 10) : null,
    column: match[3] ? parseInt(match[3], 10) : null,
  }
}

function looksLikeFilePath(path: string): boolean {
  if (!path || path.includes('://')) return false
  return /^[A-Za-z]:[\\/]/.test(path)
    || path.startsWith('/')
    || /^\.{1,2}[\\/]/.test(path)
    || /[\\/]/.test(path)
}

export function isTerminalAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/')
}

export function joinTerminalCwd(cwd: string, relative: string): string {
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  const trimmedCwd = cwd.replace(/[\\/]+$/, '')
  const normalizedRelative = relative.replace(/^\.[\\/]+/, '')
  return `${trimmedCwd}${sep}${normalizedRelative}`
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

export function parseTerminalFileLinks(
  text: string,
  blockedRanges: Array<{ start: number; end: number }> = [],
): TerminalFileLinkCandidate[] {
  const candidates: TerminalFileLinkCandidate[] = []
  const occupiedRanges = [...blockedRanges]

  const addCandidate = (raw: string, start: number): void => {
    const ref = parseFileRef(raw)
    if (!ref) return
    const end = start + raw.length
    if (occupiedRanges.some((range) => rangesOverlap(start, end, range.start, range.end))) return
    occupiedRanges.push({ start, end })
    candidates.push({ raw, start, end, ref })
  }

  WINDOWS_ABSOLUTE_FILE_PATH_RE.lastIndex = 0
  let wm: RegExpExecArray | null
  while ((wm = WINDOWS_ABSOLUTE_FILE_PATH_RE.exec(text)) !== null) {
    const raw = wm[0].replace(/[.,;!?)\]}>'"`，。；！）】]+$/, '')
    addCandidate(raw, wm.index)
  }

  FILE_PATH_RE.lastIndex = 0
  let fm: RegExpExecArray | null
  while ((fm = FILE_PATH_RE.exec(text)) !== null) {
    const rawMatch = fm[0]
    const candidate = fm[1] ?? fm[2] ?? fm[3] ?? rawMatch
    const offset = rawMatch.indexOf(candidate)
    const raw = candidate.replace(/[.,;!?)\]}>'"`]+$/, '')
    addCandidate(raw, fm.index + Math.max(0, offset))
  }

  return candidates
}

function stringIndexToCellBoundary(line: IBufferLine, stringIndex: number): number {
  let textIndex = 0
  for (let column = 0; column < line.length; column += 1) {
    const cell = line.getCell(column)
    const chars = cell?.getChars() ?? ''
    if (!chars) continue
    if (textIndex >= stringIndex) return column
    textIndex += chars.length
    if (textIndex >= stringIndex) return column + Math.max(1, cell?.getWidth() ?? 1)
  }
  return line.length
}

function fileLinkRange(line: IBufferLine, candidate: TerminalFileLinkCandidate, y: number): ILink['range'] {
  const startCell = stringIndexToCellBoundary(line, candidate.start)
  const endCell = stringIndexToCellBoundary(line, candidate.end)
  return { start: { x: startCell + 1, y }, end: { x: Math.max(startCell + 1, endCell), y } }
}

export function findTerminalFileLinkAtCell(line: IBufferLine, cellColumn: number): TerminalFileLinkCandidate | null {
  const text = line.translateToString(true)
  const candidates = parseTerminalFileLinks(text)
  return candidates.find((candidate) => {
    const startCell = stringIndexToCellBoundary(line, candidate.start)
    const endCell = stringIndexToCellBoundary(line, candidate.end)
    return cellColumn >= startCell && cellColumn < endCell
  }) ?? null
}

const TERMINAL_BOTTOM_SAFE_PADDING_PX = 4
const TERMINAL_REPAINT_DELAYS_MS = [50, 150, 350, 700] as const
const INITIAL_TERMINAL_FIT_ATTEMPTS = 8

function applyTerminalFitSafeArea(terminal: Terminal): void {
  const element = terminal.element
  if (!element) return

  element.style.boxSizing = 'border-box'
  element.style.paddingBottom = `${TERMINAL_BOTTOM_SAFE_PADDING_PX}px`
}

function refitAndRefreshTerminal(
  terminal: Terminal | null,
  fitAddon: FitAddon | null,
  container: HTMLElement | null,
  focus = false,
): { cols: number; rows: number } | null {
  if (!terminal || !fitAddon || !container) return null

  const rect = container.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  try {
    const shouldStayAtBottom = isTerminalAtBottom(terminal)
    fitAddon.fit()
    if (terminal.rows > 0) {
      if (shouldStayAtBottom) {
        terminal.scrollToBottom()
      }
      terminal.refresh(0, terminal.rows - 1)
    }
    if (focus) {
      terminal.focus()
    }
    return { cols: terminal.cols, rows: terminal.rows }
  } catch {
    return null
  }
}

function fallbackTerminalDimensions(terminal: Terminal): { cols: number; rows: number } {
  return {
    cols: Math.max(1, terminal.cols || 80),
    rows: Math.max(1, terminal.rows || 24),
  }
}

async function waitForInitialTerminalFit(
  terminal: Terminal,
  fitAddon: FitAddon,
  container: HTMLElement,
  isDisposed: () => boolean,
): Promise<{ cols: number; rows: number }> {
  for (let attempt = 0; attempt < INITIAL_TERMINAL_FIT_ATTEMPTS; attempt += 1) {
    if (isDisposed()) break

    const dimensions = refitAndRefreshTerminal(terminal, fitAddon, container)
    if (dimensions && dimensions.cols > 0 && dimensions.rows > 0) {
      return dimensions
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }

  return fallbackTerminalDimensions(terminal)
}

function scheduleTerminalRepaint(
  terminal: Terminal | null,
  fitAddon: FitAddon | null,
  container: HTMLElement | null,
  onDimensions?: (dimensions: { cols: number; rows: number }) => void,
  focus = false,
): () => void {
  let disposed = false
  const frameIds = new Set<number>()
  const timeoutIds = new Set<ReturnType<typeof setTimeout>>()

  const run = (): void => {
    if (disposed) return
    const dimensions = refitAndRefreshTerminal(terminal, fitAddon, container, focus)
    if (dimensions) {
      onDimensions?.(dimensions)
    }
  }

  const scheduleFrame = (callback: () => void): void => {
    const frameId = requestAnimationFrame(() => {
      frameIds.delete(frameId)
      callback()
    })
    frameIds.add(frameId)
  }

  scheduleFrame(() => scheduleFrame(run))

  for (const delay of TERMINAL_REPAINT_DELAYS_MS) {
    const timeoutId = setTimeout(() => {
      timeoutIds.delete(timeoutId)
      run()
    }, delay)
    timeoutIds.add(timeoutId)
  }

  return () => {
    disposed = true
    for (const frameId of frameIds) {
      cancelAnimationFrame(frameId)
    }
    for (const timeoutId of timeoutIds) {
      clearTimeout(timeoutId)
    }
    frameIds.clear()
    timeoutIds.clear()
  }
}

export function useXterm(
  session: Session,
  isActive: boolean,
): {
  containerRef: React.RefObject<HTMLDivElement | null>
  searchAddonRef: React.RefObject<SearchAddon | null>
  terminalRef: React.RefObject<Terminal | null>
  pasteFromClipboardRef: React.RefObject<(() => Promise<void>) | null>
  isAtBottom: boolean
} {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const pasteFromClipboardRef = useRef<(() => Promise<void>) | null>(null)
  const sessionRef = useRef(session)
  const lastPtyDimensionsRef = useRef<{ ptyId: string; cols: number; rows: number } | null>(null)
  const pendingPtyResizeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  sessionRef.current = session

  const requestPtyResize = (
    ptyId: string,
    cols: number,
    rows: number,
    debounceMs = 120,
  ): void => {
    if (cols <= 0 || rows <= 0) return

    const last = lastPtyDimensionsRef.current
    if (last?.ptyId === ptyId && last.cols === cols && last.rows === rows) return

    if (pendingPtyResizeRef.current) {
      clearTimeout(pendingPtyResizeRef.current)
      pendingPtyResizeRef.current = null
    }

    const send = (): void => {
      pendingPtyResizeRef.current = null
      const latest = lastPtyDimensionsRef.current
      if (latest?.ptyId === ptyId && latest.cols === cols && latest.rows === rows) return
      lastPtyDimensionsRef.current = { ptyId, cols, rows }
      window.api.session.resize(ptyId, cols, rows)
    }

    if (debounceMs <= 0) {
      send()
      return
    }

    pendingPtyResizeRef.current = setTimeout(send, debounceMs)
  }

  // Track when project/worktree stores have enough data to resolve cwd.
  // On startup the stores may hydrate a microtask after this hook mounts;
  // without this signal the Claude Code tab shows blank until the user
  // switches projects to force a re-mount.
  const [cwdReady, setCwdReady] = useState(() => {
    const s = sessionRef.current
    if (s.ptyId && s.status === 'running') return true
    const project = useProjectsStore.getState().projects.find((p) => p.id === s.projectId)
    const wt = s.worktreeId
      ? useWorktreesStore.getState().worktrees.find((w) => w.id === s.worktreeId)
      : useWorktreesStore.getState().getMainWorktree(s.projectId)
    return Boolean(wt?.path ?? project?.path)
  })

  useEffect(() => {
    if (cwdReady) return
    const check = (): void => {
      const s = sessionRef.current
      const project = useProjectsStore.getState().projects.find((p) => p.id === s.projectId)
      const wt = s.worktreeId
        ? useWorktreesStore.getState().worktrees.find((w) => w.id === s.worktreeId)
        : useWorktreesStore.getState().getMainWorktree(s.projectId)
      if (wt?.path ?? project?.path) setCwdReady(true)
    }
    const un1 = useProjectsStore.subscribe(check)
    const un2 = useWorktreesStore.subscribe(check)
    return () => { un1(); un2() }
  }, [cwdReady])

  // Create terminal + PTY once cwd is resolvable
  useEffect(() => {
    if (!cwdReady) return
    const container = containerRef.current
    if (!container) return

    const currentSession = sessionRef.current
    const hasExistingPty = currentSession.ptyId && currentSession.status === 'running'

    // Resolve cwd (only needed for new PTY creation, not for reconnecting)
    let cwd: string | undefined
    if (!hasExistingPty) {
      const project = useProjectsStore
        .getState()
        .projects.find((p) => p.id === currentSession.projectId)
      const worktreeStore = useWorktreesStore.getState()
      const worktree = currentSession.worktreeId
        ? worktreeStore.worktrees.find((w) => w.id === currentSession.worktreeId)
        : worktreeStore.getMainWorktree(currentSession.projectId)
      // session.cwd is an explicit override — set by the MCP bridge or history resume
      // cwds and by the history-resume flow when the original transcript's cwd
      // doesn't match any registered project. When present it takes priority
      // over project/worktree paths so `claude --resume` / `codex resume`
      // actually runs in the same cwd the transcript was recorded in.
      cwd = currentSession.cwd ?? worktree?.path ?? project?.path
      if (!cwd) return
    }
    const sessionId = currentSession.id
    const sessionType = currentSession.type
    const isWslSession = isWslSessionType(sessionType)
    const shouldResume = currentSession.initialized && isClaudeCodeType(currentSession.type)
    const resumeUUID = currentSession.resumeUUID ?? undefined
    const codexResumeId = currentSession.codexResumeId
    const geminiResumeId = isGeminiType(currentSession.type) ? currentSession.geminiResumeId : undefined
    const { settings } = useUIStore.getState()
    let ptyId: string | null = null
    let destroyed = false
    const repaintCleanups: Array<() => void> = []

    const xtermTheme = getXtermTheme(settings.terminalTheme) ?? defaultDarkTheme
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: settings.terminalFontSize,
      fontFamily: settings.terminalFontFamily,
      fontWeight: 'normal',
      fontWeightBold: '500',
      theme: xtermTheme,
      scrollback: 10000,
      allowProposedApi: true,
      rescaleOverlappingGlyphs: true,
    })

    const fitAddon = new FitAddon()
    const unicode11Addon = new Unicode11Addon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(unicode11Addon)
    terminal.loadAddon(searchAddon)
    terminal.unicode.activeVersion = '11'
    searchAddonRef.current = searchAddon
    terminal.open(container)
    applyTerminalFitSafeArea(terminal)
    terminalRegistry.set(sessionId, terminal)
    const updateBottomState = (): void => {
      if (!destroyed) setIsAtBottom(isTerminalAtBottom(terminal))
    }
    updateBottomState()
    const onScrollDisposable = terminal.onScroll(updateBottomState)

    // Resolve current session cwd for relative file path links
    const resolveSessionCwd = (): string | null => {
      const current = sessionRef.current
      const worktreeStore = useWorktreesStore.getState()
      const projectsStore = useProjectsStore.getState()
      const wt = current.worktreeId
        ? worktreeStore.worktrees.find((w) => w.id === current.worktreeId)
        : worktreeStore.getMainWorktree(current.projectId)
      const project = projectsStore.projects.find((p) => p.id === current.projectId)
      return current.cwd ?? wt?.path ?? project?.path ?? null
    }

    const openFileLink = async (ref: ParsedFileRef): Promise<void> => {
      const cwd = resolveSessionCwd()
      const absolute = isTerminalAbsolutePath(ref.path) ? ref.path : (cwd ? joinTerminalCwd(cwd, ref.path) : null)
      if (!absolute) return

      const info = await window.api.fs.stat(absolute)
      if (info.exists && info.isDir) {
        void window.api.shell.openPath(absolute)
        return
      }

      const context = {
        projectId: sessionRef.current.projectId,
        worktreeId: sessionRef.current.worktreeId ?? null,
      }
      const editors = useEditorsStore.getState()
      const tabId = ref.line !== null
        ? editors.openFileAtLocation(absolute, { line: ref.line, column: ref.column ?? 1 }, context)
        : editors.openFile(absolute, context)
      const paneStore = usePanesStore.getState()
      paneStore.addSessionToPane(paneStore.activePaneId, tabId)
      paneStore.setPaneActiveSession(paneStore.activePaneId, tabId)
    }

    // Link provider - double-click opens URLs and file paths.
    const linkProvider: ILinkProvider = {
      provideLinks(y, callback) {
        const line = terminal.buffer.active.getLine(y - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString(true)
        const links: ILink[] = []
        const occupiedRanges: Array<{ start: number; end: number }> = []

        URL_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = URL_RE.exec(text)) !== null) {
          const stripped = m[0].replace(/[.,;:!?)\]}>'"`]+$/, '')
          if (stripped.length === 0) continue
          const start = m.index
          const end = start + stripped.length
          occupiedRanges.push({ start, end })
          links.push({
            range: { start: { x: start + 1, y }, end: { x: end, y } },
            text: stripped,
            activate: (event) => {
              if (event.detail >= 2) {
                void window.api.shell.openExternal(stripped)
              }
            },
          })
        }

        for (const candidate of parseTerminalFileLinks(text, occupiedRanges)) {
          links.push({
            range: fileLinkRange(line, candidate, y),
            text: candidate.raw,
            activate: (event) => {
              if (event.detail >= 2) {
                void openFileLink(candidate.ref)
              }
            },
          })
        }

        callback(links.length > 0 ? links : undefined)
      },
    }
    const linkProviderDisposable = terminal.registerLinkProvider(linkProvider)

    // IME compositionend: clear textarea to prevent stale content
    const textarea = terminal.textarea
    if (textarea) {
      textarea.addEventListener('compositionend', () => {
        setTimeout(() => { textarea.value = '' }, 0)
      })
    }

    // Use DOM renderer (not WebGL) for better CJK text rendering quality

    fitAddonRef.current = fitAddon
    terminalRef.current = terminal

    const scheduleRepaint = (focus = false): void => {
      const cleanup = scheduleTerminalRepaint(
        terminal,
        fitAddon,
        container,
        ({ cols, rows }) => {
          if (ptyId) {
            requestPtyResize(ptyId, cols, rows)
          }
        },
        focus,
      )
      repaintCleanups.push(cleanup)
    }

    // xterm can miss its first DOM paint when opened while React is still
    // settling pane/tab layout. Retry across a few ticks, then refresh rows.
    scheduleRepaint(false)

    if (document.fonts) {
      void document.fonts.ready
        .then(() => {
          if (!destroyed) {
            scheduleRepaint(false)
          }
        })
        .catch(() => {
          // ignore
        })
    }

    // Check if session already has an active PTY (e.g. after React remount during reorder)
    const existingPtyId = currentSession.ptyId
    let restoreReady = !(existingPtyId && currentSession.status === 'running')
    let restoredSnapshotSeq = 0
    const pendingRestoreEvents: SessionDataEvent[] = []

    // PTY → xterm
    const offData = window.api.session.onData((event) => {
      if (event.ptyId && event.ptyId === ptyId) {
        trackSessionOutput(sessionId, event.data.length)
        if (!restoreReady) {
          pendingRestoreEvents.push(event)
          return
        }
        terminal.write(event.data, updateBottomState)
      }
    })

    // PTY exit
    const offExit = window.api.session.onExit((event) => {
      if (event.ptyId && event.ptyId === ptyId) {
        ptyId = null
        terminal.write(
          `\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`,
          updateBottomState,
        )
        useSessionsStore.getState().updateStatus(sessionId, 'stopped')
        addTimelineEvent(sessionId, 'stop', `Exited with code ${event.exitCode}`)
      }
    })

    const restoreFromSnapshot = async (targetPtyId: string): Promise<void> => {
      restoreReady = false
      restoredSnapshotSeq = 0
      pendingRestoreEvents.length = 0
      ptyId = targetPtyId

      try {
        const dimensions = await waitForInitialTerminalFit(terminal, fitAddon, container, () => destroyed)
        if (destroyed) return

        const replay = await window.api.session.getReplay(targetPtyId)
        if (destroyed) return

        restoredSnapshotSeq = replay.seq
        if (replay.data) {
          await new Promise<void>((resolve) => {
            terminal.write(replay.data, resolve)
          })
        }
        terminal.scrollToBottom()
        if (terminal.rows > 0) {
          terminal.refresh(0, terminal.rows - 1)
        }

        requestPtyResize(targetPtyId, dimensions.cols, dimensions.rows, 0)
      } finally {
        restoreReady = true

        if (destroyed) return

        for (const pendingEvent of pendingRestoreEvents) {
          if (pendingEvent.seq > restoredSnapshotSeq) {
            terminal.write(pendingEvent.data)
          }
        }
        pendingRestoreEvents.length = 0

        updateBottomState()
        scheduleRepaint(false)
      }
    }

    if (existingPtyId && currentSession.status === 'running') {
      // Reuse existing PTY — restore a serialized terminal snapshot, then
      // append only live chunks that arrived after the snapshot sequence.
      void restoreFromSnapshot(existingPtyId)
    } else {
      const createPty = async (): Promise<void> => {
        const dimensions = await waitForInitialTerminalFit(terminal, fitAddon, container, () => destroyed)
        if (destroyed) return

        const managed = await window.api.session.getManaged(sessionId).catch(() => null)
        if (destroyed) return
        if (managed) {
          useSessionsStore.getState().updateSession(sessionId, {
            ptyId: managed.ptyId,
            status: 'running',
            initialized: true,
          })
          addTimelineEvent(sessionId, 'start', `Session reconnected (${sessionType})`)
          await restoreFromSnapshot(managed.ptyId)
          return
        }

        const result = await window.api.session.create({
          cwd: cwd!,
          type: sessionType,
          sessionId,
          resume: shouldResume,
          resumeUUID,
          codexResumeId,
          geminiResumeId,
          command: currentSession.customSessionCommand,
          args: currentSession.customSessionArgs,
          terminalShellMode: settings.terminalShellMode,
          terminalShellCommand: settings.terminalShellMode === 'custom' ? settings.terminalShellCommand : undefined,
          terminalShellArgs: settings.terminalShellMode === 'custom' ? parseCustomSessionArgs(settings.terminalShellArgs) : undefined,
          wslDistroName: isWslSession ? settings.wslDistroName : undefined,
          wslShell: isWslSession ? settings.wslShell : undefined,
          wslUseLoginShell: isWslSession ? settings.wslUseLoginShell : undefined,
          wslPathPrefix: isWslSession ? settings.wslPathPrefix : undefined,
          wslInitScript: isWslSession ? settings.wslInitScript : undefined,
          wslEnvVars: isWslSession ? settings.wslEnvVars : undefined,
          cols: dimensions.cols,
          rows: dimensions.rows,
        })
        if (destroyed) {
          window.api.session.kill(result.ptyId)
          return
        }

        ptyId = result.ptyId
        requestPtyResize(ptyId, dimensions.cols, dimensions.rows, 0)
        const nextSessionUpdates: Partial<Omit<Session, 'id'>> = {
          ptyId,
          status: 'running',
          initialized: true,
        }
        if (isClaudeCodeType(sessionType) && result.resumeUUID) {
          nextSessionUpdates.resumeUUID = result.resumeUUID
        }
        useSessionsStore
          .getState()
          .updateSession(sessionId, nextSessionUpdates)
        addTimelineEvent(sessionId, 'start', `Session started (${sessionType})`)

        scheduleRepaint(false)
      }

      void createPty()
    }

    // Undo stack for software undo (used by non-terminal sessions).
    // Each entry is a "chunk" that was added in one action (paste = one chunk, keystroke = one char).
    let undoStack: string[] = []
    let pendingQuestionStartLine: number | null = null

    const getCursorBufferLine = (): number => terminal.buffer.active.baseY + terminal.buffer.active.cursorY

    const trackPotentialQuestionInput = (data: string): void => {
      const plainData = data
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      const hasPrintable = [...plainData].some((ch) => {
        const code = ch.charCodeAt(0)
        return code >= 32 && code !== 127
      })

      if (hasPrintable && pendingQuestionStartLine === null) {
        pendingQuestionStartLine = getCursorBufferLine()
      }

      if (/[\r\n]/.test(plainData) && pendingQuestionStartLine !== null) {
        markTerminalQuestionLine(sessionId, terminal, pendingQuestionStartLine)
        pendingQuestionStartLine = null
      }
    }

    // Unified clipboard paste — used by Ctrl+V handler and the context-menu
    // "Paste" action so both paths record undo chunks and share the image /
    // text dispatch logic for Claude Code / Codex.
    const pasteFromClipboard = async (): Promise<void> => {
      if (sessionType === 'terminal' || sessionType === 'terminal-wsl') {
        try {
          const text = await navigator.clipboard.readText()
          if (!text) return
          terminal.focus()
          terminal.paste(text)
          trackSessionInput(sessionId)
          addTimelineEvent(sessionId, 'input', 'Clipboard paste')
        } catch {}
        return
      }

      // Claude Code / Codex: image → Alt+V (native), text → inject
      try {
        const items = await navigator.clipboard.read()
        const hasImage = items.some((item) => item.types.some((t) => t.startsWith('image/')))
        if (hasImage) {
          if (ptyId) {
            // Capture what the agent echoes (e.g. "[Image #1]") so Ctrl+Z can undo it
            let echoed = ''
            const offCapture = window.api.session.onData((event: SessionDataEvent) => {
              if (event.ptyId === ptyId) echoed += event.data
            })
            setTimeout(() => {
              offCapture()
              // eslint-disable-next-line no-control-regex
              const printable = echoed.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[^\x20-\x7e]/g, '')
              if (printable.length > 0) undoStack.push(printable)
            }, 400)
            window.api.session.write(ptyId, '\x1bv')
          }
          return
        }
      } catch {
        // clipboard.read() may be unavailable; fall through to text paste
      }

      try {
        const text = await navigator.clipboard.readText()
        if (!text) return
        const printable = [...text].filter((ch) => {
          const c = ch.charCodeAt(0)
          return c >= 32 && c !== 127
        }).join('')
        if (printable.length > 0) undoStack.push(printable)
        terminal.focus()
        terminal.paste(text)
        trackSessionInput(sessionId)
        addTimelineEvent(sessionId, 'input', 'Clipboard paste')
      } catch {}
    }

    pasteFromClipboardRef.current = pasteFromClipboard

    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true

      // Allow IME composition (Chinese/Japanese/Korean input)
      if (e.isComposing || e.keyCode === 229) return true

      const isPlainCtrl = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey

      if (isPlainCtrl && (e.key === 'ArrowUp' || e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        e.stopPropagation()
        scrollTerminalToAdjacentQuestion(sessionId, 'previous')
        return false
      }

      if (isPlainCtrl && (e.key === 'ArrowDown' || e.key.toLowerCase() === 'j')) {
        e.preventDefault()
        e.stopPropagation()
        scrollTerminalToAdjacentQuestion(sessionId, 'next')
        return false
      }

      // Jump to latest output without sending navigation keys to the shell.
      if (!e.shiftKey && !e.altKey
        && ((e.ctrlKey && !e.metaKey && e.key === 'End')
          || (e.metaKey && !e.ctrlKey && e.key === 'ArrowDown'))) {
        e.preventDefault()
        e.stopPropagation()
        scrollTerminalToLatest(sessionId)
        return false
      }

      // Let global shortcuts bubble to window for App-level handlers
      if ((e.ctrlKey && e.key === 'Tab')
        || (e.ctrlKey && e.key === 'w')
        || (e.ctrlKey && e.key === 'p')
        || (e.ctrlKey && e.key >= '1' && e.key <= '9')
        || (e.ctrlKey && e.key === 'f')
        || (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'v')
        || (e.ctrlKey && e.shiftKey && e.key === 'T')
        || e.key === 'F11') {
        return false
      }

      // Ctrl+Alt+Arrow — navigate panes directly (avoid dispatch issues)
      if (e.ctrlKey && e.altKey && e.key.startsWith('Arrow')) {
        const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : 'down'
        usePanesStore.getState().navigatePane(dir as 'left' | 'right' | 'up' | 'down')
        return false
      }

      // Ctrl+C: copy selection if any, otherwise send to shell
      if (e.ctrlKey && e.key === 'c') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          terminal.clearSelection()
          return false
        }
        return true
      }

      // Ctrl+Z: undo last input
      // - terminal (bash): send Ctrl+_ (\x1f) — readline undo
      // - claude-code / codex: pop last undo-stack entry and send that many backspaces
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key === 'z') {
        if (ptyId) {
          if (sessionType === 'terminal' || sessionType === 'terminal-wsl') {
            window.api.session.write(ptyId, '\x1f')
          } else if (undoStack.length > 0) {
            const last = undoStack.pop()!
            // Send one \x7f per code point (handles multi-byte unicode)
            window.api.session.write(ptyId, '\x7f'.repeat([...last].length))
          }
        }
        return false
      }

      // Ctrl/Cmd+V: smart paste for agent CLIs — image → Alt+V, text → inject.
      // Terminal sessions fall through to xterm's default paste path.
      const isSmartPasteTarget =
        isCodexType(sessionType)
        || isClaudeCodeType(sessionType)
        || sessionType === 'gemini' || sessionType === 'gemini-yolo'
      if (isSmartPasteTarget
        && (e.ctrlKey || e.metaKey)
        && !e.altKey
        && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        e.stopPropagation()
        void pasteFromClipboard()
        return false
      }

      return true
    })

    // xterm → PTY
    const onDataDisposable = terminal.onData((data) => {
      if (ptyId) {
        trackPotentialQuestionInput(data)
        // Track individual keystrokes for non-terminal sessions (pastes are tracked at call site)
        if (sessionType !== 'terminal' && sessionType !== 'terminal-wsl' && data.length === 1) {
          const code = data.charCodeAt(0)
          if (code >= 32 && code !== 127) {
            undoStack.push(data)
          } else if (code === 127 || code === 8) {
            // Backspace — trim tail of last chunk, remove if empty
            if (undoStack.length > 0) {
              const last = undoStack[undoStack.length - 1]
              const trimmed = [...last].slice(0, -1).join('')
              if (trimmed.length > 0) {
                undoStack[undoStack.length - 1] = trimmed
              } else {
                undoStack.pop()
              }
            }
          } else if (code === 13 || code === 10) {
            undoStack = []
          }
        }
        window.api.session.write(ptyId, data)
        if (data === '\r' || data === '\n') {
          trackSessionInput(sessionId)
          addTimelineEvent(sessionId, 'input', 'User input')
        }
      }
    })

    // Resize
    const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (ptyId) {
        requestPtyResize(ptyId, cols, rows)
      }
      updateBottomState()
    })

    // Container resize observer
    let resizeRepaintCleanup: (() => void) | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (destroyed) return

      resizeRepaintCleanup?.()
      resizeRepaintCleanup = scheduleTerminalRepaint(
        terminal,
        fitAddon,
        container,
        () => updateBottomState(),
      )
    })
    resizeObserver.observe(container)

    // Ctrl+wheel: zoom terminal font (clamped, persisted via UIStore).
    // Must use capture phase — xterm's SmoothScrollableElement attaches a
    // bubble-phase wheel listener on its viewport that calls both
    // preventDefault() and stopPropagation() (scrollableElement.ts:444-446),
    // so a bubble listener on the container never fires for Ctrl+wheel.
    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.deltaY === 0) return
      event.preventDefault()
      event.stopPropagation()
      const current = terminal.options.fontSize ?? useUIStore.getState().settings.terminalFontSize
      const step = event.deltaY < 0 ? 1 : -1
      const next = Math.min(
        TERMINAL_FONT_SIZE_MAX,
        Math.max(TERMINAL_FONT_SIZE_MIN, current + step),
      )
      if (next === current) return
      // Persist via settings — the existing subscription below will apply the
      // change to the terminal and refit. This keeps all panes in sync.
      useUIStore.getState().updateSettings({ terminalFontSize: next })
    }
    container.addEventListener('wheel', onWheel, { passive: false, capture: true })

    return () => {
      destroyed = true
      clearTerminalQuestionHighlight(sessionId)
      terminalRegistry.delete(sessionId)
      terminalQuestionAnchors.delete(sessionId)
      terminalQuestionMarkers.get(sessionId)?.forEach((marker) => marker.dispose())
      terminalQuestionMarkers.delete(sessionId)
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      pasteFromClipboardRef.current = null
      offData()
      offExit()
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      onScrollDisposable.dispose()
      linkProviderDisposable.dispose()
      resizeRepaintCleanup?.()
      resizeObserver.disconnect()
      container.removeEventListener('wheel', onWheel, { capture: true })
      for (const cleanup of repaintCleanups) {
        cleanup()
      }
      if (pendingPtyResizeRef.current) {
        clearTimeout(pendingPtyResizeRef.current)
        pendingPtyResizeRef.current = null
      }
      terminal.dispose()
      // NOTE: Do NOT kill PTY here. PTY lifecycle is independent of the React component.
      // PTY is killed explicitly via session.kill() when user closes a tab.
    }
  }, [cwdReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit and focus when becoming active (switching tabs/projects/panes)
  useEffect(() => {
    if (!isActive) return

    return scheduleTerminalRepaint(
      terminalRef.current,
      fitAddonRef.current,
      containerRef.current,
      ({ cols, rows }) => {
        const currentPtyId = sessionRef.current.ptyId
        if (currentPtyId) {
          requestPtyResize(currentPtyId, cols, rows)
        }
      },
      true,
    )
  }, [cwdReady, isActive])

  // Live-update terminal font when settings change
  useEffect(() => {
    let prevSize = useUIStore.getState().settings.terminalFontSize
    let prevFamily = useUIStore.getState().settings.terminalFontFamily

    return useUIStore.subscribe((state) => {
      const { terminalFontSize, terminalFontFamily } = state.settings
      if (terminalFontSize === prevSize && terminalFontFamily === prevFamily) return
      prevSize = terminalFontSize
      prevFamily = terminalFontFamily

      const term = terminalRef.current
      if (!term) return
      term.options.fontSize = terminalFontSize
      term.options.fontFamily = terminalFontFamily
      const dimensions = refitAndRefreshTerminal(term, fitAddonRef.current, containerRef.current)
      if (dimensions) {
        const currentPtyId = sessionRef.current.ptyId
        if (currentPtyId) {
          requestPtyResize(currentPtyId, dimensions.cols, dimensions.rows)
        }
      }
    })
  }, [])

  // Live-update terminal theme when settings change
  useEffect(() => {
    let prevTheme = useUIStore.getState().settings.terminalTheme

    return useUIStore.subscribe((state) => {
      const { terminalTheme } = state.settings
      if (terminalTheme === prevTheme) return
      prevTheme = terminalTheme

      const term = terminalRef.current
      if (!term) return
      const newTheme = getXtermTheme(terminalTheme) ?? defaultDarkTheme
      term.options.theme = newTheme
    })
  }, [])

  return { containerRef, searchAddonRef, terminalRef, pasteFromClipboardRef, isAtBottom }
}
