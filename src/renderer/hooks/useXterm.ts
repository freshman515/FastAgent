import { useEffect, useRef, useState } from 'react'
import { Terminal, type IBufferLine } from '@xterm/xterm'
import { addTimelineEvent } from '@/components/rightpanel/SessionTimeline'
import { trackSessionInput, trackSessionOutput } from '@/components/rightpanel/agentRuntime'

// ─── Global terminal registry for preview snapshots ───
const terminalRegistry = new Map<string, Terminal>()

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
import type { Session } from '@shared/types'
import { isClaudeCodeType } from '@shared/types'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { usePanesStore } from '@/stores/panes'
import { useWorktreesStore } from '@/stores/worktrees'
import { getXtermTheme, defaultDarkTheme } from '@/lib/ghosttyTheme'

export function useXterm(
  session: Session,
  isActive: boolean,
): { containerRef: React.RefObject<HTMLDivElement | null>; searchAddonRef: React.RefObject<SearchAddon | null> } {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

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
      cwd = worktree?.path ?? project?.path
      if (!cwd) return
    }
    const sessionId = currentSession.id
    const sessionType = currentSession.type
    const shouldResume = currentSession.initialized && isClaudeCodeType(currentSession.type)
    const resumeUUID = currentSession.resumeUUID ?? undefined
    const { settings } = useUIStore.getState()
    let ptyId: string | null = null
    let destroyed = false

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

    // Fit after a frame so container has real dimensions
    requestAnimationFrame(() => {
      if (!destroyed) {
        try {
          fitAddon.fit()
        } catch {
          // ignore
        }
      }
    })

    // Check if session already has an active PTY (e.g. after React remount during reorder)
    const existingPtyId = currentSession.ptyId
    if (existingPtyId && currentSession.status === 'running') {
      // Reuse existing PTY — replay buffered output to restore scrollback
      ptyId = existingPtyId
      window.api.session.getReplay(existingPtyId).then((replay) => {
        if (destroyed || !replay) return
        terminal.write(replay)
        requestAnimationFrame(() => {
          if (!destroyed) {
            try {
              fitAddon.fit()
              window.api.session.resize(ptyId!, terminal.cols, terminal.rows)
            } catch { /* ignore */ }
          }
        })
      })
    } else {
      // Create new PTY
      window.api.session
        .create({
          cwd: cwd!,
          type: sessionType,
          sessionId,
          resume: shouldResume,
          resumeUUID,
          cols: terminal.cols || 80,
          rows: terminal.rows || 24,
        })
        .then((result) => {
          if (destroyed) {
            window.api.session.kill(result.ptyId)
            return
          }
          ptyId = result.ptyId
          useSessionsStore
            .getState()
            .updateSession(sessionId, { ptyId, status: 'running', initialized: true })
          addTimelineEvent(sessionId, 'start', `Session started (${sessionType})`)

          requestAnimationFrame(() => {
            if (!destroyed) {
              try {
                fitAddon.fit()
                window.api.session.resize(ptyId!, terminal.cols, terminal.rows)
              } catch { /* ignore */ }
            }
          })
        })
    }

    // PTY → xterm
    const offData = window.api.session.onData((event) => {
      if (event.ptyId && event.ptyId === ptyId) {
        terminal.write(event.data)
        trackSessionOutput(sessionId, event.data.length)
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

    // Undo stack for software undo (used by non-terminal sessions).
    // Each entry is a "chunk" that was added in one action (paste = one chunk, keystroke = one char).
    let undoStack: string[] = []

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
          if (sessionType === 'terminal') {
            window.api.session.write(ptyId, '\x1f')
          } else if (undoStack.length > 0) {
            const last = undoStack.pop()!
            // Send one \x7f per code point (handles multi-byte unicode)
            window.api.session.write(ptyId, '\x7f'.repeat([...last].length))
          }
        }
        return false
      }

      // Codex Ctrl+V: smart paste — image → Alt+V (Codex native), text → inject
      if ((sessionType === 'codex' || sessionType === 'codex-yolo')
        && (e.ctrlKey || e.metaKey)
        && !e.altKey
        && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        e.stopPropagation()
        void (async () => {
          try {
            const items = await navigator.clipboard.read()
            const hasImage = items.some((item) =>
              item.types.some((t) => t.startsWith('image/'))
            )
            if (hasImage) {
              if (ptyId) {
                // Capture what Codex echoes back (e.g. "[Image #1]") so Ctrl+Z can undo it
                let echoed = ''
                const offCapture = window.api.session.onData((event: { ptyId: string | null; data: string }) => {
                  if (event.ptyId === ptyId) echoed += event.data
                })
                setTimeout(() => {
                  offCapture()
                  // Strip ANSI escape sequences and keep only printable ASCII
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
          // Text paste
          try {
            const text = await navigator.clipboard.readText()
            if (!text) return
            // Track entire paste as one undo chunk (at call site, not in onData,
            // to avoid double-counting and bracketed-paste escape sequences)
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
        })()
        return false
      }

      // Claude Code Ctrl+V: smart paste — image → Alt+V, text → inject
      if (e.ctrlKey && e.key === 'v' && (sessionType === 'claude-code' || sessionType === 'claude-code-yolo')) {
        e.preventDefault()
        e.stopPropagation()
        void (async () => {
          try {
            const items = await navigator.clipboard.read()
            const hasImage = items.some((item) => item.types.some((t) => t.startsWith('image/')))
            if (hasImage) {
              if (ptyId) {
                // Same echo-capture as Codex for undo
                let echoed = ''
                const offCapture = window.api.session.onData((event: { ptyId: string | null; data: string }) => {
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
          } catch {}
          // Text paste
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
        })()
        return false
      }

      return true
    })

    // xterm → PTY
    const onDataDisposable = terminal.onData((data) => {
      if (ptyId) {
        // Track individual keystrokes for non-terminal sessions (pastes are tracked at call site)
        if (sessionType !== 'terminal' && data.length === 1) {
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
        window.api.session.resize(ptyId, cols, rows)
      }
    })

    // Container resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (!destroyed) {
        try {
          fitAddon.fit()
        } catch {
          // ignore
        }
      }
    })
    resizeObserver.observe(container)

    return () => {
      destroyed = true
      terminalRegistry.delete(sessionId)
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      offData()
      offExit()
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      resizeObserver.disconnect()
      terminal.dispose()
      // NOTE: Do NOT kill PTY here. PTY lifecycle is independent of the React component.
      // PTY is killed explicitly via session.kill() when user closes a tab.
    }
  }, [cwdReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit and focus when becoming active (switching tabs/projects/panes)
  useEffect(() => {
    if (isActive) {
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit()
        } catch { /* ignore */ }
        terminalRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isActive])

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
      try {
        fitAddonRef.current?.fit()
      } catch {
        // ignore
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

  return { containerRef, searchAddonRef }
}
