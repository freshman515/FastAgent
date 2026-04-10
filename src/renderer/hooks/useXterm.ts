import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
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

  // Create terminal + PTY once on mount
  useEffect(() => {
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

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: settings.terminalFontSize,
      fontFamily: settings.terminalFontFamily,
      fontWeight: 'normal',
      fontWeightBold: '500',
      theme: {
        background: '#1a1a1e',
        foreground: '#e8e8ec',
        cursor: '#7c6aef',
        cursorAccent: '#1a1a1e',
        selectionBackground: 'rgba(124, 106, 239, 0.3)',
        black: '#1a1a1e',
        red: '#ef5757',
        green: '#3ecf7b',
        yellow: '#f0a23b',
        blue: '#5fa0f5',
        magenta: '#c084fc',
        cyan: '#45c8c8',
        white: '#e8e8ec',
        brightBlack: '#5e5e66',
        brightRed: '#ff6b6b',
        brightGreen: '#5edd9a',
        brightYellow: '#ffbe5c',
        brightBlue: '#7bb8ff',
        brightMagenta: '#d4a5ff',
        brightCyan: '#6eded8',
        brightWhite: '#ffffff',
      },
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
      }
    })

    // PTY exit
    const offExit = window.api.session.onExit((event) => {
      if (event.ptyId && event.ptyId === ptyId) {
        ptyId = null
        // For agent sessions, auto-remove from pane and session store
        if (sessionType !== 'terminal') {
          const paneId = usePanesStore.getState().findPaneForSession(sessionId)
          if (paneId) usePanesStore.getState().removeSessionFromPane(paneId, sessionId)
          useSessionsStore.getState().removeSession(sessionId)
        } else {
          terminal.write(
            `\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`,
          )
          useSessionsStore.getState().updateStatus(sessionId, 'stopped')
        }
      }
    })

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
        || (e.ctrlKey && e.shiftKey && e.key === 'T')) {
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

      // Ctrl+V in claude-code session: remap to Alt+V (image paste)
      if (e.ctrlKey && e.key === 'v' && (sessionType === 'claude-code' || sessionType === 'claude-code-yolo')) {
        if (ptyId) {
          window.api.session.write(ptyId, '\x1bv')
        }
        return false
      }

      return true
    })

    // xterm → PTY
    const onDataDisposable = terminal.onData((data) => {
      if (ptyId) {
        window.api.session.write(ptyId, data)
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  return { containerRef, searchAddonRef }
}
