import * as pty from '@lydell/node-pty'
import type { IPty } from '@lydell/node-pty'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import type { SessionCreateOptions } from '@shared/types'
import { detectShell, buildAgentCommand } from './ShellDetector'

const isWindows = process.platform === 'win32'

interface ManagedPty {
  pty: IPty
  cwd: string
  type: SessionCreateOptions['type']
  sessionId: string | undefined
  replayBuffer: string
}

const MAX_REPLAY_CHARS = 65_536

// Strip ANSI escape sequences for text matching
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-2AB]|\x1b[>=<]|\x1b\[[\?!]?[0-9;]*[hlm]/g, '')
}

export class PtyManager {
  private readonly ptys = new Map<string, ManagedPty>()
  private idCounter = 0

  create(options: SessionCreateOptions): string {
    const id = `pty-${++this.idCounter}-${Date.now()}`
    const shell = detectShell()

    let shellPath = shell.shell
    let shellArgs: string[] = [...shell.args]

    // For agent sessions, wrap the agent command
    const agentCmd = buildAgentCommand(options.type, options.sessionId, options.resume, options.resumeUUID)
    if (agentCmd && !isWindows) {
      const fullCmd = [agentCmd.command, ...agentCmd.args].join(' ')
      shellArgs = ['-c', fullCmd]
    }

    const cols = options.cols ?? 120
    const rows = options.rows ?? 30

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Inject session ID so hook scripts can identify this exact session
      ...(options.sessionId ? { FASTAGENTS_SESSION_ID: options.sessionId } : {}),
      ...(options.env ?? {}),
    }

    const ptyProcess = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: options.cwd,
      env,
      useConpty: isWindows,
    })

    const managed: ManagedPty = {
      pty: ptyProcess,
      cwd: options.cwd,
      type: options.type,
      sessionId: options.sessionId,
      replayBuffer: '',
    }

    this.ptys.set(id, managed)

    // For agent sessions on Windows, suppress output until the agent CLI actually starts.
    // The shell prompt + command echo arrive before the agent banner.
    // Strategy: after the command is written (500ms), wait for agent-specific text,
    // or fall back to a short timeout.
    const isAgentSession = options.type !== 'terminal'
    let agentStarted = !isAgentSession

    // Agent banner keywords (case-insensitive checked)
    const AGENT_KEYWORDS = ['Claude Code', 'Codex', 'opencode', 'OpenCode', 'open-code']

    if (isAgentSession) {
      // Fallback: start forwarding after 3s no matter what
      setTimeout(() => { agentStarted = true }, 3000)
    }

    const sendToWindows = (payload: { ptyId: string; data: string }): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SESSION_DATA, payload)
        }
      }
    }

    // Forward data to all windows
    ptyProcess.onData((data) => {
      // Append to replay buffer (always, for graceful shutdown capture)
      managed.replayBuffer += data
      if (managed.replayBuffer.length > MAX_REPLAY_CHARS) {
        managed.replayBuffer = managed.replayBuffer.slice(-MAX_REPLAY_CHARS)
      }

      // For agent sessions, suppress shell prompt/command, only show agent output
      if (!agentStarted) {
        const raw = managed.replayBuffer
        const clean = stripAnsi(raw)
        const detected = AGENT_KEYWORDS.some((kw) => clean.includes(kw) || raw.includes(kw))
        if (detected) {
          agentStarted = true
          sendToWindows({ ptyId: id, data })
        }
        return
      }

      sendToWindows({ ptyId: id, data })

      // Permission & idle notifications are handled by HookServer (Claude Code hooks)
    })

    ptyProcess.onExit(({ exitCode }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SESSION_EXIT, { ptyId: id, exitCode })
        }
      }
      this.ptys.delete(id)
    })

    // For agent sessions on Windows, send the command after shell is ready
    // Append "; exit" so shell exits when agent exits → triggers PTY exit event
    if (agentCmd && isWindows) {
      setTimeout(() => {
        const parts = [agentCmd.command, ...agentCmd.args]
        const suffix = options.type !== 'terminal' ? ' ; exit' : ''
        ptyProcess.write(parts.join(' ') + suffix + '\r')
      }, 500)
    }

    return id
  }

  write(id: string, data: string): void {
    const managed = this.ptys.get(id)
    if (!managed) return
    managed.pty.write(data)
  }

  /** Find a claude-code session by CWD path */
  findClaudeSessionByCwd(cwd: string): string | null {
    const norm = cwd.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
    for (const [, m] of this.ptys) {
      if (!m.sessionId) continue
      if (m.type !== 'claude-code' && m.type !== 'claude-code-yolo') continue
      const mCwd = m.cwd.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
      if (norm === mCwd || norm.startsWith(mCwd + '/')) return m.sessionId
    }
    return null
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.ptys.get(id)?.pty.resize(cols, rows)
    } catch {
      // Ignore resize errors (process may have exited)
    }
  }

  kill(id: string): void {
    const managed = this.ptys.get(id)
    if (managed) {
      managed.pty.kill()
      this.ptys.delete(id)
    }

  }

  getPid(id: string): number | undefined {
    return this.ptys.get(id)?.pty.pid
  }

  isAlive(id: string): boolean {
    return this.ptys.has(id)
  }

  getReplay(id: string): string {
    return this.ptys.get(id)?.replayBuffer ?? ''
  }

  /**
   * Gracefully shutdown all Claude Code sessions by sending Ctrl+C twice,
   * then capture the resume UUID from the output.
   * Returns a map of sessionId → resumeUUID.
   */
  async gracefulShutdownClaudeSessions(): Promise<Map<string, string>> {
    const results = new Map<string, string>()
    const claudePtys = Array.from(this.ptys.entries()).filter(
      ([, m]) => (m.type === 'claude-code' || m.type === 'claude-code-yolo') && m.sessionId,
    )

    if (claudePtys.length === 0) return results

    const promises = claudePtys.map(
      ([, managed]) =>
        new Promise<void>((resolve) => {
          const ptyProcess = managed.pty
          let captureBuffer = ''
          const RESUME_RE = /claude\s+--resume\s+([0-9a-f-]{36})/

          // Listen for resume UUID in output
          const onData = ptyProcess.onData((data) => {
            captureBuffer += data
            const clean = stripAnsi(captureBuffer)
            const match = clean.match(RESUME_RE)
            if (match) {
              results.set(managed.sessionId!, match[1])
            }
          })

          // Send Ctrl+C twice with a small gap
          try {
            ptyProcess.write('\x03')
          } catch { /* ignore */ }

          setTimeout(() => {
            try {
              ptyProcess.write('\x03')
            } catch { /* ignore */ }
          }, 300)

          // Wait for output, then clean up
          setTimeout(() => {
            onData.dispose()
            // Check buffer one last time
            const clean = stripAnsi(captureBuffer)
            const match = clean.match(RESUME_RE)
            if (match && !results.has(managed.sessionId!)) {
              results.set(managed.sessionId!, match[1])
            }
            resolve()
          }, 3000)
        }),
    )

    await Promise.all(promises)
    return results
  }

  destroyAll(): void {

    for (const [, managed] of this.ptys) {
      try {
        managed.pty.kill()
      } catch {
        // ignore
      }
    }
    this.ptys.clear()
  }
}

export const ptyManager = new PtyManager()
