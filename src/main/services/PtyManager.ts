import * as pty from '@lydell/node-pty'
import type { IPty } from '@lydell/node-pty'
import headlessPkg from '@xterm/headless'
import serializePkg from '@xterm/addon-serialize'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC, isClaudeCodeType } from '@shared/types'
import type { SessionCreateOptions, SessionCreateResult, SessionReplayPayload } from '@shared/types'
import type { ClaudeSessionLaunchMode } from '@shared/claudeSession'
import { getIdeServerPort } from './IdeServer'
import { detectShell, buildAgentCommand } from './ShellDetector'
import { resolveClaudeSessionLaunch } from './ClaudeSessionResolver'
import { createFastAgentsMcpConfig } from './FastAgentsMcpService'

const isWindows = process.platform === 'win32'
const HeadlessTerminal = (headlessPkg as { Terminal: new (options?: Record<string, unknown>) => import('@xterm/headless').Terminal }).Terminal
const SerializeAddon = (serializePkg as { SerializeAddon: new () => import('@xterm/addon-serialize').SerializeAddon }).SerializeAddon

interface TerminalMirror {
  terminal: import('@xterm/headless').Terminal
  serializeAddon: import('@xterm/addon-serialize').SerializeAddon
  pendingWrite: Promise<void>
}

interface QueuedInput {
  data: string
  delayAfterMs: number
}

interface ManagedPty {
  pty: IPty
  cwd: string
  type: SessionCreateOptions['type']
  sessionId: string | undefined
  startedAt: number
  replayBuffer: string
  mirror: TerminalMirror
  dataSeq: number
  resumeId: string | null
  inputReady: boolean
  queuedInput: QueuedInput[]
  inputReadyTimer: NodeJS.Timeout | null
  inputFlushInProgress: boolean
}

export interface ManagedSessionInfo {
  ptyId: string
  sessionId: string
  cwd: string
  type: SessionCreateOptions['type']
  startedAt: number
}

// Agent CLIs (especially Codex/Claude) emit a lot of ANSI/TUI repaint traffic.
// When a session tab is unmounted during project/worktree switches we rebuild
// the terminal from this replay buffer. 64 KiB is too small and causes the
// replay to start mid-stream, which drops earlier content and can leave the
// restored screen visually blank/truncated.
const MAX_REPLAY_CHARS = 4 * 1024 * 1024
const AGENT_START_FALLBACK_MS = 3000
const AGENT_INPUT_READY_QUIET_MS = 1000
const QUEUED_INPUT_WRITE_GAP_MS = 120
const AGENT_SUBMIT_BASE_DELAY_MS = 550
const AGENT_SUBMIT_MAX_DELAY_MS = 1800
const AGENT_SUBMIT_REINFORCE_DELAY_MS = 900
const CODEX_STARTUP_INPUT_WARMUP_MS = 650
const CODEX_STARTUP_SUBMIT_DELAY_MS = 1400

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Strip ANSI escape sequences for text matching
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-2AB]|\x1b[>=<]|\x1b\[[\?!]?[0-9;]*[hlm]/g, '')
}

function quoteShellArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) return arg
  if (isWindows) return `"${arg.replace(/"/g, '\\"')}"`
  return `'${arg.replace(/'/g, "'\\''")}'`
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
}

function getAgentSubmitDelay(input: string): number {
  return Math.min(
    AGENT_SUBMIT_MAX_DELAY_MS,
    AGENT_SUBMIT_BASE_DELAY_MS + Math.floor(input.length / 20),
  )
}

function stripTrailingSubmitNewlines(input: string): string {
  return input.replace(/[\r\n]+$/g, '')
}

interface McpBridgeEnv {
  port: number
  token: string
}

export type DataObserver = (ptyId: string) => void

export class PtyManager {
  private readonly ptys = new Map<string, ManagedPty>()
  private idCounter = 0
  private readonly gitCommonDirCache = new Map<string, string | null>()

  /** Populated by OrchestratorService.init() so PTYs spawned afterwards see the
   *  MCP bridge port + token in their env. */
  private mcpEnv: McpBridgeEnv | null = null

  /** Observers notified once per visible PTY data chunk. Used by the
   *  orchestrator service to track per-PTY idle time for /wait_idle. */
  private readonly dataObservers = new Set<DataObserver>()

  setMcpEnv(env: McpBridgeEnv | null): void {
    this.mcpEnv = env
  }

  getMcpEnv(): McpBridgeEnv | null {
    return this.mcpEnv
  }

  addDataObserver(observer: DataObserver): () => void {
    this.dataObservers.add(observer)
    return () => { this.dataObservers.delete(observer) }
  }

  /** Reverse lookup: renderer Session.id → ptyId. */
  findPtyIdBySessionId(sessionId: string): string | null {
    for (const [ptyId, managed] of this.ptys) {
      if (managed.sessionId === sessionId) return ptyId
    }
    return null
  }

  private notifyDataObservers(ptyId: string): void {
    for (const observer of this.dataObservers) {
      try {
        observer(ptyId)
      } catch {
        // Observer errors must never break the data path.
      }
    }
  }

  private scheduleInputReady(ptyId: string, quietMs = AGENT_INPUT_READY_QUIET_MS): void {
    const managed = this.ptys.get(ptyId)
    if (!managed || managed.inputReady) return

    if (managed.inputReadyTimer) {
      clearTimeout(managed.inputReadyTimer)
    }

    managed.inputReadyTimer = setTimeout(() => {
      const current = this.ptys.get(ptyId)
      if (!current) return

      current.inputReadyTimer = null
      current.inputReady = true
      void this.flushQueuedInput(current)
    }, quietMs)
  }

  private async flushQueuedInput(managed: ManagedPty): Promise<void> {
    if (managed.inputFlushInProgress) return
    managed.inputFlushInProgress = true

    try {
      while (managed.inputReady && managed.queuedInput.length > 0) {
        const item = managed.queuedInput.shift()
        if (!item) continue
        if (item.data) {
          managed.pty.write(item.data)
        }
        if (managed.queuedInput.length > 0) {
          await delay(item.delayAfterMs)
        }
      }
    } finally {
      managed.inputFlushInProgress = false
      if (managed.inputReady && managed.queuedInput.length > 0) {
        void this.flushQueuedInput(managed)
      }
    }
  }

  private enqueueInput(managed: ManagedPty, data: string, delayAfterMs = QUEUED_INPUT_WRITE_GAP_MS): void {
    managed.queuedInput.push({ data, delayAfterMs })
    if (managed.inputReady) {
      void this.flushQueuedInput(managed)
    }
  }

  private getGitCommonDir(cwd: string): string | null {
    const normalized = normalizeCwd(cwd)
    if (this.gitCommonDirCache.has(normalized)) {
      return this.gitCommonDirCache.get(normalized) ?? null
    }

    try {
      const output = execFileSync('git', ['rev-parse', '--git-common-dir'], {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
      }).trim()
      const commonDir = output
        ? normalizeCwd(resolve(cwd, output))
        : null
      this.gitCommonDirCache.set(normalized, commonDir)
      return commonDir
    } catch {
      this.gitCommonDirCache.set(normalized, null)
      return null
    }
  }

  create(options: SessionCreateOptions): SessionCreateResult {
    const id = `pty-${++this.idCounter}-${Date.now()}`
    const shell = detectShell()

    let shellPath = shell.shell
    let shellArgs: string[] = [...shell.args]
    let effectiveResumeUUID = options.resumeUUID ?? null
    let claudeLaunchMode: ClaudeSessionLaunchMode | undefined

    // For agent sessions, wrap the agent command
    if (isClaudeCodeType(options.type)) {
      const launch = resolveClaudeSessionLaunch(options.cwd, options.resume, options.resumeUUID)
      effectiveResumeUUID = launch.sessionUUID
      claudeLaunchMode = launch.mode

      if (launch.replacedUUID) {
        console.warn(
          `[PtyManager] ignoring stale Claude resume id ${launch.replacedUUID} for ${options.cwd} (${launch.replacementReason ?? 'unknown'}); using ${launch.sessionUUID}`,
        )
      }
    }

    const agentCmd = buildAgentCommand(options.type, {
      sessionId: options.sessionId,
      resume: options.resume,
      resumeUUID: effectiveResumeUUID ?? undefined,
      claudeLaunchMode,
      codexResumeId: options.codexResumeId,
      geminiResumeId: options.geminiResumeId,
    })
    if (agentCmd && isClaudeCodeType(options.type) && options.sessionId && this.mcpEnv) {
      const mcpConfigPath = createFastAgentsMcpConfig({
        port: this.mcpEnv.port,
        token: this.mcpEnv.token,
        sessionId: options.sessionId,
      })
      if (mcpConfigPath) {
        agentCmd.args.push('--mcp-config', mcpConfigPath)
      }
    }
    // Codex CLI spawns MCP servers with a *sealed* env — only the env vars
    // declared in ~/.codex/config.toml's [mcp_servers.fastagents] table are
    // visible to the bridge. SESSION_ID is per-PTY so it can't live in the
    // global TOML. Override it on the command line using Codex's `-c` flag
    // which accepts dotted keys into the config.
    //
    // Note: we deliberately pass the value *without* TOML quotes. Codex
    // parses the value as TOML first; since a session id like `mo1gtu87-
    // rsjk8r` fails TOML parsing (bare identifier with a dash), it falls
    // back to treating the raw string as a literal. Wrapping in `"..."`
    // would be correct TOML but then the shell (pwsh on Windows, bash on
    // Unix) re-quotes the whole arg and the extra escape sequences get
    // mis-parsed — PowerShell does not recognize `\"` so the argument
    // splits mid-value and codex sees a stray positional PROMPT.
    if (
      agentCmd
      && (options.type === 'codex' || options.type === 'codex-yolo')
      && options.sessionId
      && this.mcpEnv
    ) {
      agentCmd.args = [
        '-c',
        `mcp_servers.fastagents.env.FASTAGENTS_SESSION_ID=${options.sessionId}`,
        ...agentCmd.args,
      ]
    }
    if (agentCmd && !isWindows) {
      const fullCmd = [agentCmd.command, ...agentCmd.args].map(quoteShellArg).join(' ')
      shellArgs = ['-c', fullCmd]
    }

    const cols = options.cols ?? 120
    const rows = options.rows ?? 30

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Inject session ID so hook scripts / MCP bridge can identify this exact session.
      ...(options.sessionId ? { FASTAGENTS_SESSION_ID: options.sessionId } : {}),
      FASTAGENTS_SESSION_TYPE: options.type,
      // Editor IDE server (separate from the MCP orchestrator).
      ...(getIdeServerPort() ? { FASTAGENTS_IDE_PORT: String(getIdeServerPort()) } : {}),
      // FastAgents MCP bridge — agents in this PTY can talk back to us.
      ...(this.mcpEnv ? {
        FASTAGENTS_MCP_PORT: String(this.mcpEnv.port),
        FASTAGENTS_MCP_TOKEN: this.mcpEnv.token,
      } : {}),
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
      startedAt: Date.now(),
      replayBuffer: '',
      mirror: createTerminalMirror(cols, rows),
      dataSeq: 0,
      resumeId: isClaudeCodeType(options.type) ? effectiveResumeUUID : null,
      inputReady: options.type === 'terminal',
      queuedInput: [],
      inputReadyTimer: null,
      inputFlushInProgress: false,
    }

    this.ptys.set(id, managed)

    // For agent sessions on Windows, suppress output until the agent CLI actually starts.
    // The shell prompt + command echo arrive before the agent banner.
    // Strategy: after the command is written (500ms), wait for agent-specific text,
    // or fall back to a short timeout.
    const isAgentSession = options.type !== 'terminal'
    let agentStarted = !isAgentSession
    let suppressedOutput = ''

    // Agent banner keywords (case-insensitive checked)
    const AGENT_KEYWORDS = ['Claude Code', 'Codex', 'Gemini', 'gemini', 'opencode', 'OpenCode', 'open-code']

    let agentStartFallback: NodeJS.Timeout | null = null
    if (isAgentSession) {
      // Fallback: start forwarding after 3s no matter what
      agentStartFallback = setTimeout(() => {
        agentStarted = true
        suppressedOutput = ''
        this.scheduleInputReady(id)
      }, AGENT_START_FALLBACK_MS)
    }

    const sendToWindows = (payload: { ptyId: string; data: string; seq: number }): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SESSION_DATA, payload)
        }
      }
    }

    const emitVisibleData = (data: string): void => {
      queueMirrorWrite(managed.mirror, data)
      managed.dataSeq += 1
      sendToWindows({ ptyId: id, data, seq: managed.dataSeq })
      this.notifyDataObservers(id)
      if (isAgentSession) {
        this.scheduleInputReady(id)
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
        suppressedOutput += data
        const raw = managed.replayBuffer
        const clean = stripAnsi(raw)
        const detected = AGENT_KEYWORDS.some((kw) => clean.includes(kw) || raw.includes(kw))
        if (detected) {
          agentStarted = true
          suppressedOutput = ''
          emitVisibleData(data)
        }
        return
      }

      emitVisibleData(data)

      // Permission & idle notifications are handled by HookServer (Claude Code hooks)
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (agentStartFallback) {
        clearTimeout(agentStartFallback)
        agentStartFallback = null
      }
      if (managed.inputReadyTimer) {
        clearTimeout(managed.inputReadyTimer)
        managed.inputReadyTimer = null
      }

      if (!agentStarted && suppressedOutput) {
        agentStarted = true
        emitVisibleData(suppressedOutput)
        suppressedOutput = ''
      }

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
        ptyProcess.write(parts.map(quoteShellArg).join(' ') + suffix + '\r')
      }, 500)
    }

    return { ptyId: id, resumeUUID: managed.resumeId }
  }

  write(id: string, data: string): void {
    const managed = this.ptys.get(id)
    if (!managed) return
    if (!managed.inputReady || managed.inputFlushInProgress) {
      this.enqueueInput(managed, data)
      return
    }
    managed.pty.write(data)
  }

  submitInput(id: string, input: string, options: { submit?: boolean } = {}): boolean {
    const managed = this.ptys.get(id)
    if (!managed) return false

    const shouldSubmit = options.submit !== false
    if (!shouldSubmit) {
      this.write(id, input)
      return true
    }

    if (managed.type === 'terminal') {
      this.write(id, input.endsWith('\r') || input.endsWith('\n') ? input : `${input}\r`)
      return true
    }

    const text = stripTrailingSubmitNewlines(input)
    const queuedBeforeReady = !managed.inputReady
    let submitDelay = getAgentSubmitDelay(text)
    const sequence: QueuedInput[] = []

    if (
      queuedBeforeReady
      && (managed.type === 'codex' || managed.type === 'codex-yolo')
    ) {
      // Codex can show the first prompt before its composer fully transitions
      // into a submit-ready state. When `initial_input` is queued during boot,
      // sending the text immediately followed by Enter can leave the prompt in
      // multiline compose mode. Give the first queued Codex prompt a brief
      // warmup before pasting, then wait longer before the first submit.
      sequence.push({ data: '', delayAfterMs: CODEX_STARTUP_INPUT_WARMUP_MS })
      submitDelay = Math.max(submitDelay, CODEX_STARTUP_SUBMIT_DELAY_MS)
    }

    sequence.push(
      { data: text, delayAfterMs: submitDelay },
      { data: '\r', delayAfterMs: AGENT_SUBMIT_REINFORCE_DELAY_MS },
    )

    if (managed.type === 'codex' || managed.type === 'codex-yolo') {
      // Codex can keep multiline pasted prompts in the composer after the
      // first Enter. A delayed second Enter is harmless when the first one
      // only inserted a newline, and is the most reliable submit signal we
      // can send through ConPTY without a first-class Codex API.
      sequence.push({ data: '\r', delayAfterMs: QUEUED_INPUT_WRITE_GAP_MS })
    }

    managed.queuedInput.push(...sequence)
    if (managed.inputReady) {
      void this.flushQueuedInput(managed)
    }

    return true
  }

  listManagedSessions(): ManagedSessionInfo[] {
    return Array.from(this.ptys.entries())
      .flatMap(([ptyId, managed]) => {
        if (!managed.sessionId) return []
        return [{
          ptyId,
          sessionId: managed.sessionId,
          cwd: managed.cwd,
          type: managed.type,
          startedAt: managed.startedAt,
        }]
      })
  }

  getManagedSession(sessionId: string): ManagedSessionInfo | null {
    for (const [ptyId, managed] of this.ptys) {
      if (managed.sessionId !== sessionId) continue
      return {
        ptyId,
        sessionId,
        cwd: managed.cwd,
        type: managed.type,
        startedAt: managed.startedAt,
      }
    }
    return null
  }

  canAccessSession(sourceSessionId: string | null | undefined, targetSessionId: string): boolean {
    if (!sourceSessionId) return false
    const source = this.getManagedSession(sourceSessionId)
    const target = this.getManagedSession(targetSessionId)
    if (!source || !target) return false
    const sourceCwd = normalizeCwd(source.cwd)
    const targetCwd = normalizeCwd(target.cwd)
    if (sourceCwd === targetCwd) return true

    const sourceCommonDir = this.getGitCommonDir(source.cwd)
    const targetCommonDir = this.getGitCommonDir(target.cwd)
    return Boolean(sourceCommonDir && targetCommonDir && sourceCommonDir === targetCommonDir)
  }

  writeToSession(sessionId: string, data: string): boolean {
    for (const [ptyId, managed] of this.ptys) {
      if (managed.sessionId !== sessionId) continue
      this.write(ptyId, data)
      return true
    }
    return false
  }

  async getReplayBySessionId(sessionId: string): Promise<SessionReplayPayload | null> {
    for (const [ptyId, managed] of this.ptys) {
      if (managed.sessionId !== sessionId) continue
      return this.getReplay(ptyId)
    }
    return null
  }

  /** Find an agent session by CWD path, optionally limited to specific session types. */
  findAgentSessionByCwd(
    cwd: string,
    allowedTypes: Array<SessionCreateOptions['type']> = [
      'claude-code',
      'claude-code-yolo',
      'codex',
      'codex-yolo',
      'gemini',
      'gemini-yolo',
      'opencode',
    ],
  ): string | null {
    const norm = normalizeCwd(cwd)
    for (const [, m] of this.ptys) {
      if (!m.sessionId) continue
      if (!allowedTypes.includes(m.type)) continue
      const mCwd = normalizeCwd(m.cwd)
      if (norm === mCwd || norm.startsWith(mCwd + '/')) return m.sessionId
    }
    return null
  }

  /** Find a claude-code session by CWD path */
  findClaudeSessionByCwd(cwd: string): string | null {
    return this.findAgentSessionByCwd(cwd, ['claude-code', 'claude-code-yolo'])
  }

  /** Find a Codex session by CWD path */
  findCodexSessionByCwd(cwd: string): string | null {
    return this.findAgentSessionByCwd(cwd, ['codex', 'codex-yolo'])
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
      if (managed.inputReadyTimer) {
        clearTimeout(managed.inputReadyTimer)
        managed.inputReadyTimer = null
      }
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
      if (managed.inputReadyTimer) {
        clearTimeout(managed.inputReadyTimer)
        managed.inputReadyTimer = null
      }
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
