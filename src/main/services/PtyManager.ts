import * as pty from '@lydell/node-pty'
import type { IPty } from '@lydell/node-pty'
import headlessPkg from '@xterm/headless'
import serializePkg from '@xterm/addon-serialize'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import type { SessionCreateOptions, SessionReplayPayload } from '@shared/types'
import { getIdeServerPort } from './IdeServer'
import { detectShell, buildAgentCommand } from './ShellDetector'

const isWindows = process.platform === 'win32'
const HeadlessTerminal = (headlessPkg as { Terminal: new (options?: Record<string, unknown>) => import('@xterm/headless').Terminal }).Terminal
const SerializeAddon = (serializePkg as { SerializeAddon: new () => import('@xterm/addon-serialize').SerializeAddon }).SerializeAddon

interface TerminalMirror {
  terminal: import('@xterm/headless').Terminal
  serializeAddon: import('@xterm/addon-serialize').SerializeAddon
  pendingWrite: Promise<void>
}

interface ManagedPty {
  pty: IPty
  cwd: string
  type: SessionCreateOptions['type']
  sessionId: string | undefined
  replayBuffer: string
  mirror: TerminalMirror
  dataSeq: number
  resumeId: string | null
}

// Agent CLIs (especially Codex/Claude) emit a lot of ANSI/TUI repaint traffic.
// When a session tab is unmounted during project/worktree switches we rebuild
// the terminal from this replay buffer. 64 KiB is too small and causes the
// replay to start mid-stream, which drops earlier content and can leave the
// restored screen visually blank/truncated.
const MAX_REPLAY_CHARS = 4 * 1024 * 1024

function createTerminalMirror(cols: number, rows: number): TerminalMirror {
  const terminal = new HeadlessTerminal({
    cols,
    rows,
    scrollback: 10_000,
    allowProposedApi: true,
  })
  const serializeAddon = new SerializeAddon()
  terminal.loadAddon(serializeAddon as unknown as { activate(terminal: unknown): void; dispose(): void })
  return {
    terminal,
    serializeAddon,
    pendingWrite: Promise.resolve(),
  }
}

function queueMirrorWrite(mirror: TerminalMirror, data: string): void {
  mirror.pendingWrite = mirror.pendingWrite
    .catch(() => undefined)
    .then(
      () =>
        new Promise<void>((resolve) => {
          mirror.terminal.write(data, resolve)
        }),
    )
}

function disposeTerminalMirror(mirror: TerminalMirror): void {
  try {
    mirror.serializeAddon.dispose()
  } catch {
    // ignore
  }
  try {
    mirror.terminal.dispose()
  } catch {
    // ignore
  }
}

// Strip ANSI escape sequences for text matching
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-2AB]|\x1b[>=<]|\x1b\[[\?!]?[0-9;]*[hlm]/g, '')
}

function getResumePattern(type: SessionCreateOptions['type']): RegExp | null {
  if (type === 'claude-code' || type === 'claude-code-yolo') {
    return /claude\s+--resume\s+([0-9a-f-]{36})/i
  }
  return null
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
      // IDE server port for Claude Code MCP integration
      ...(getIdeServerPort() ? { FASTAGENTS_IDE_PORT: String(getIdeServerPort()) } : {}),
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
      mirror: createTerminalMirror(cols, rows),
      dataSeq: 0,
      resumeId: null,
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

    const sendToWindows = (payload: { ptyId: string; data: string; seq: number }): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SESSION_DATA, payload)
        }
      }
    }

    const broadcastResumeId = (resumeId: string): void => {
      if (!managed.sessionId) return
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('session:resume-uuids', { [managed.sessionId]: resumeId })
        }
      }
    }

    const captureResumeId = (): void => {
      const pattern = getResumePattern(managed.type)
      if (!pattern) return
      const clean = stripAnsi(managed.replayBuffer)
      const match = clean.match(pattern)
      const nextResumeId = match?.[1] ?? null
      if (!nextResumeId || nextResumeId === managed.resumeId) return
      managed.resumeId = nextResumeId
      broadcastResumeId(nextResumeId)
    }

    const emitVisibleData = (data: string): void => {
      queueMirrorWrite(managed.mirror, data)
      managed.dataSeq += 1
      sendToWindows({ ptyId: id, data, seq: managed.dataSeq })
    }

    // Forward data to all windows
    ptyProcess.onData((data) => {
      // Append to replay buffer (always, for graceful shutdown capture)
      managed.replayBuffer += data
      if (managed.replayBuffer.length > MAX_REPLAY_CHARS) {
        managed.replayBuffer = managed.replayBuffer.slice(-MAX_REPLAY_CHARS)
      }
      captureResumeId()

      // For agent sessions, suppress shell prompt/command, only show agent output
      if (!agentStarted) {
        const raw = managed.replayBuffer
        const clean = stripAnsi(raw)
        const detected = AGENT_KEYWORDS.some((kw) => clean.includes(kw) || raw.includes(kw))
        if (detected) {
          agentStarted = true
          emitVisibleData(data)
        }
        return
      }

      emitVisibleData(data)

      // Permission & idle notifications are handled by HookServer (Claude Code hooks)
    })

    ptyProcess.onExit(({ exitCode }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SESSION_EXIT, { ptyId: id, exitCode, resumeUUID: managed.resumeId })
        }
      }
      if (this.ptys.has(id)) {
        disposeTerminalMirror(managed.mirror)
        this.ptys.delete(id)
      }
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
      const managed = this.ptys.get(id)
      managed?.pty.resize(cols, rows)
      managed?.mirror.terminal.resize(cols, rows)
    } catch {
      // Ignore resize errors (process may have exited)
    }
  }

  kill(id: string): void {
    const managed = this.ptys.get(id)
    if (managed) {
      managed.pty.kill()
      disposeTerminalMirror(managed.mirror)
      this.ptys.delete(id)
    }

  }

  getPid(id: string): number | undefined {
    return this.ptys.get(id)?.pty.pid
  }

  isAlive(id: string): boolean {
    return this.ptys.has(id)
  }

  async getReplay(id: string): Promise<SessionReplayPayload> {
    const managed = this.ptys.get(id)
    if (!managed) return { data: '', seq: 0 }

    const targetSeq = managed.dataSeq
    const targetPendingWrite = managed.mirror.pendingWrite

    try {
      await targetPendingWrite.catch(() => undefined)
      const data = managed.mirror.serializeAddon.serialize()
      if (data) {
        return { data, seq: targetSeq }
      }
    } catch {
      // Fall back to raw replay buffer below.
    }

    return {
      data: managed.replayBuffer,
      seq: targetSeq,
    }
  }

  /**
   * Gracefully shutdown all Claude Code sessions by sending Ctrl+C twice,
   * then capture the resume id from the output.
   * Returns a map of sessionId → resumeUUID.
   */
  async gracefulShutdownClaudeSessions(): Promise<Map<string, string>> {
    const results = new Map<string, string>()
    const resumablePtys = Array.from(this.ptys.entries()).filter(
      ([, m]) =>
        (m.type === 'claude-code' || m.type === 'claude-code-yolo')
        && m.sessionId,
    )

    if (resumablePtys.length === 0) return results

    const promises = resumablePtys.map(
      ([, managed]) =>
        new Promise<void>((resolve) => {
          const ptyProcess = managed.pty
          let captureBuffer = ''
          const resumePattern = /claude\s+--resume\s+([0-9a-f-]{36})/i

          if (managed.resumeId) {
            results.set(managed.sessionId!, managed.resumeId)
          }

          // Listen for resume id in output
          const onData = ptyProcess.onData((data) => {
            captureBuffer += data
            const clean = stripAnsi(captureBuffer)
            const match = clean.match(resumePattern)
            if (match) {
              managed.resumeId = match[1]
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
            const match = clean.match(resumePattern)
            if (match && !results.has(managed.sessionId!)) {
              managed.resumeId = match[1]
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
      disposeTerminalMirror(managed.mirror)
    }
    this.ptys.clear()
  }
}

export const ptyManager = new PtyManager()
