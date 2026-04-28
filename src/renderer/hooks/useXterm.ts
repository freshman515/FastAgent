import { useEffect, useRef, useState } from 'react'
import { Terminal, type IBufferLine, type ILink, type ILinkProvider } from '@xterm/xterm'
import { addTimelineEvent } from '@/components/rightpanel/SessionTimeline'
import { trackSessionInput, trackSessionOutput } from '@/components/rightpanel/agentRuntime'

// ─── Global terminal registry for preview snapshots ───
const terminalRegistry = new Map<string, Terminal>()

export function scrollTerminalToLatest(sessionId: string): boolean {
  const terminal = terminalRegistry.get(sessionId)
  if (!terminal) return false
  terminal.scrollToBottom()
  return true
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

/** File extensions we treat as clickable when referenced in the terminal. */
const CLICKABLE_FILE_EXT_RE = /\.[A-Za-z0-9]{1,10}(?::\d+(?::\d+)?)?$/

/** Match file path candidates like `src/foo.ts:42`, `./foo.py`, `C:\\x\\y.rs:1:2`. */
const FILE_PATH_RE = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[A-Za-z0-9_][\w.\-+]*[\\/])[\w.\-+\\/]*\.[A-Za-z0-9]{1,10}(?::\d+(?::\d+)?)?/g

const URL_RE = /https?:\/\/[^\s<>()"'`\\]+/g

interface ParsedFileRef {
  path: string
  line: number | null
  column: number | null
}

function parseFileRef(raw: string): ParsedFileRef | null {
  if (!CLICKABLE_FILE_EXT_RE.test(raw)) return null
  const match = raw.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/)
  if (!match) return null
  return {
    path: match[1],
    line: match[2] ? parseInt(match[2], 10) : null,
    column: match[3] ? parseInt(match[3], 10) : null,
  }
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/')
}

function joinCwd(cwd: string, relative: string): string {
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  const trimmedCwd = cwd.replace(/[\\/]+$/, '')
  const normalizedRelative = relative.replace(/^\.[\\/]+/, '')
  return `${trimmedCwd}${sep}${normalizedRelative}`
}

const TERMINAL_REPAINT_DELAYS_MS = [50, 150, 350] as const

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
    fitAddon.fit()
    if (terminal.rows > 0) {
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
} {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const pasteFromClipboardRef = useRef<(() => Promise<void>) | null>(null)
  const sessionRef = useRef(session)
  const lastPtyDimensionsRef = useRef<{ ptyId: string; cols: number; rows: number } | null>(null)
  const pendingPtyResizeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    terminalRegistry.set(sessionId, terminal)

    // Resolve current session cwd for relative file path links
    const resolveSessionCwd = (): string | null => {
      const current = sessionRef.current
      const worktreeStore = useWorktreesStore.getState()
      const projectsStore = useProjectsStore.getState()
      const wt = current.worktreeId
        ? worktreeStore.worktrees.find((w) => w.id === current.worktreeId)
        : worktreeStore.getMainWorktree(current.projectId)
      const project = projectsStore.projects.find((p) => p.id === current.projectId)
      return wt?.path ?? project?.path ?? current.cwd ?? null
    }

    const openFileLink = (ref: ParsedFileRef): void => {
      const cwd = resolveSessionCwd()
      const absolute = isAbsolutePath(ref.path) ? ref.path : (cwd ? joinCwd(cwd, ref.path) : null)
      if (!absolute) return
      const context = {
        projectId: sessionRef.current.projectId,
        worktreeId: sessionRef.current.worktreeId ?? null,
      }
      const editors = useEditorsStore.getState()
      if (ref.line !== null) {
        editors.openFileAtLocation(absolute, { line: ref.line, column: ref.column ?? 1 }, context)
      } else {
        editors.openFile(absolute, context)
      }
    }

    // Link provider — Ctrl/Cmd+Click to open URL in browser or file path in editor
    const linkProvider: ILinkProvider = {
      provideLinks(y, callback) {
        const line = terminal.buffer.active.getLine(y - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString(true)
        const links: ILink[] = []

        URL_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = URL_RE.exec(text)) !== null) {
          const stripped = m[0].replace(/[.,;:!?)\]}>'"`]+$/, '')
          if (stripped.length === 0) continue
          const start = m.index
          const end = start + stripped.length
          links.push({
            range: { start: { x: start + 1, y }, end: { x: end, y } },
            text: stripped,
            activate: (event) => {
              if (event.ctrlKey || event.metaKey) {
                void window.api.shell.openExternal(stripped)
              }
            },
          })
        }

        FILE_PATH_RE.lastIndex = 0
        let fm: RegExpExecArray | null
        while ((fm = FILE_PATH_RE.exec(text)) !== null) {
          const raw = fm[0].replace(/[.,;!?)\]}>'"`]+$/, '')
          const ref = parseFileRef(raw)
          if (!ref) continue
          const start = fm.index
          const end = start + raw.length
          links.push({
            range: { start: { x: start + 1, y }, end: { x: end, y } },
            text: raw,
            activate: (event) => {
              if (event.ctrlKey || event.metaKey) openFileLink(ref)
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
        terminal.write(event.data)
      }
    })

    // PTY exit
    const offExit = window.api.session.onExit((event) => {
      if (event.ptyId && event.ptyId === ptyId) {
        ptyId = null
        terminal.write(
          `\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`,
        )
        useSessionsStore.getState().updateStatus(sessionId, 'stopped')
        addTimelineEvent(sessionId, 'stop', `Exited with code ${event.exitCode}`)
      }
    })

    const restoreFromSnapshot = async (): Promise<void> => {
      if (!existingPtyId || currentSession.status !== 'running') return

      ptyId = existingPtyId

      try {
        const replay = await window.api.session.getReplay(existingPtyId)
        if (destroyed) return

        restoredSnapshotSeq = replay.seq
        if (replay.data) {
          await new Promise<void>((resolve) => {
            terminal.write(replay.data, resolve)
          })
        }
      } finally {
        restoreReady = true

        if (destroyed) return

        for (const pendingEvent of pendingRestoreEvents) {
          if (pendingEvent.seq > restoredSnapshotSeq) {
            terminal.write(pendingEvent.data)
          }
        }
        pendingRestoreEvents.length = 0

        scheduleRepaint(false)
      }
    }

    if (existingPtyId && currentSession.status === 'running') {
      // Reuse existing PTY — restore a serialized terminal snapshot, then
      // append only live chunks that arrived after the snapshot sequence.
      void restoreFromSnapshot()
    } else {
      // Create new PTY
      window.api.session
        .create({
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
          cols: terminal.cols || 80,
          rows: terminal.rows || 24,
        })
        .then((result) => {
          if (destroyed) {
            window.api.session.kill(result.ptyId)
            return
          }
          ptyId = result.ptyId
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
        })
    }

    // Undo stack for software undo (used by non-terminal sessions).
    // Each entry is a "chunk" that was added in one action (paste = one chunk, keystroke = one char).
    let undoStack: string[] = []

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

      // Let global shortcuts bubble to window for App-level handlers
      if ((e.ctrlKey && e.key === 'Tab')
        || (e.ctrlKey && e.key === 'w')
        || (e.ctrlKey && e.key === 'p')
        || (e.ctrlKey && e.key >= '1' && e.key <= '9')
        || (e.ctrlKey && e.key === 'f')
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
    })

    // Container resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (!destroyed) {
        refitAndRefreshTerminal(terminal, fitAddon, container)
      }
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
      terminalRegistry.delete(sessionId)
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      pasteFromClipboardRef.current = null
      offData()
      offExit()
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      linkProviderDisposable.dispose()
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

  return { containerRef, searchAddonRef, terminalRef, pasteFromClipboardRef }
}
