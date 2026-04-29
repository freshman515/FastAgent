import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { BrowserWindow } from 'electron'
import {
  IPC,
  type McpCreateSessionRequest,
  type McpCreateSessionResponse,
  type McpCreatableSessionType,
  type McpSessionInfo,
  type SessionType,
} from '@shared/types'
import { getIdeStateSnapshot } from './IdeServer'
import { ptyManager } from './PtyManager'
import {
  registerFastAgentsMcpInClaudeProjects,
  registerFastAgentsMcpInCodex,
  syncMetaAgentToCodexAgentsMd,
} from './FastAgentsMcpService'
import { shouldRegisterGlobalAgentConfig } from './AppPaths'

// ─── ANSI / control-sequence stripping ──────────────────────────────────────

function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[\?!]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][0-9A-B]|\x1b[>=<]|\x1b[a-zA-Z]/g, '')
    .replace(/\x1b/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface ParsedRoute {
  method: string
  path: string
  query: URLSearchParams
}

const VALID_CREATABLE_TYPES = new Set<SessionType>([
  'terminal',
  'terminal-wsl',
  'claude-code',
  'claude-code-yolo',
  'claude-code-wsl',
  'claude-code-yolo-wsl',
  'codex',
  'codex-yolo',
  'codex-wsl',
  'codex-yolo-wsl',
  'gemini',
  'gemini-yolo',
  'opencode',
])

const RENDERER_REQUEST_TIMEOUT_MS = 20_000
const READ_BODY_LIMIT_BYTES = 64 * 1024

function nowMs(): number {
  return Date.now()
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload))
  res.end(payload)
}

function errorResponse(res: ServerResponse, status: number, message: string): void {
  jsonResponse(res, status, { error: message })
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let received = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > READ_BODY_LIMIT_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim()
      if (!raw) {
        resolve({} as T)
        return
      }
      try {
        resolve(JSON.parse(raw) as T)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.on('error', reject)
  })
}

export class OrchestratorService {
  private server: Server | null = null
  private port: number | null = null
  private token: string | null = null
  private mainWindow: BrowserWindow | null = null

  /** ptyId → last time the PTY emitted output (used by /wait_idle). */
  private readonly lastDataAt = new Map<string, number>()

  private readonly pendingListSessions = new Map<string, PendingRequest<McpSessionInfo[]>>()
  private readonly pendingCreateSession = new Map<string, PendingRequest<McpCreateSessionResponse>>()

  async init(): Promise<void> {
    this.token = randomBytes(32).toString('hex')

    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err: unknown) => {
          if (!res.headersSent) {
            errorResponse(res, 500, err instanceof Error ? err.message : String(err))
          } else {
            try { res.end() } catch { /* ignore */ }
          }
        })
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (typeof address === 'object' && address) {
          this.server = server
          this.port = address.port
          resolve()
        } else {
          reject(new Error('Failed to bind orchestrator HTTP server'))
        }
      })
    })

    // Feed PtyManager the env for subsequently-spawned PTYs.
    ptyManager.setMcpEnv({ port: this.port!, token: this.token! })

    // Track last-emit time for every PTY so /wait_idle is accurate.
    ptyManager.addDataObserver((ptyId) => {
      this.lastDataAt.set(ptyId, nowMs())
    })

    // Packaged builds keep the convenience global registrations. Dev builds
    // run from a separate profile and pass MCP config per spawned session, so
    // they do not overwrite the user's stable Claude/Codex config.
    if (shouldRegisterGlobalAgentConfig()) {
      try {
        registerFastAgentsMcpInClaudeProjects({ port: this.port!, token: this.token! })
      } catch (err) {
        console.warn('[orchestrator] auto-register to ~/.claude.json failed:', err)
      }
      try {
        registerFastAgentsMcpInCodex({ port: this.port!, token: this.token! })
      } catch (err) {
        console.warn('[orchestrator] auto-register to ~/.codex/config.toml failed:', err)
      }
      // Mirror the Meta-Agent section from ~/.claude/CLAUDE.md into
      // ~/.codex/AGENTS.md so Codex gets the same guidance. Idempotent.
      try {
        syncMetaAgentToCodexAgentsMd()
      } catch (err) {
        console.warn('[orchestrator] sync CLAUDE.md → AGENTS.md failed:', err)
      }
    }

    console.log(`[orchestrator] HTTP server on 127.0.0.1:${this.port}`)
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  getPort(): number | null {
    return this.port
  }

  getToken(): string | null {
    return this.token
  }

  resolveListSessions(requestId: string, sessions: McpSessionInfo[]): void {
    const pending = this.pendingListSessions.get(requestId)
    if (!pending) return
    this.pendingListSessions.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(sessions)
  }

  resolveCreateSession(requestId: string, response: McpCreateSessionResponse): void {
    const pending = this.pendingCreateSession.get(requestId)
    if (!pending) return
    this.pendingCreateSession.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(response)
  }

  dispose(): void {
    for (const pending of this.pendingListSessions.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Orchestrator disposed'))
    }
    this.pendingListSessions.clear()
    for (const pending of this.pendingCreateSession.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Orchestrator disposed'))
    }
    this.pendingCreateSession.clear()
    if (this.server) {
      try { this.server.close() } catch { /* ignore */ }
      this.server = null
    }
    this.port = null
    this.token = null
    this.lastDataAt.clear()
    ptyManager.setMcpEnv(null)
  }

  // ─── Request routing ────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const route = parseRoute(req)
    if (!route) {
      errorResponse(res, 400, 'Bad request')
      return
    }

    // /health is public (used by the bridge to detect a live port).
    if (route.method === 'GET' && route.path === '/health') {
      jsonResponse(res, 200, { ok: true, port: this.port })
      return
    }

    if (!this.checkAuth(req)) {
      errorResponse(res, 401, 'Unauthorized')
      return
    }

    // Editor snapshot — served by IdeServer, proxied here so the bridge only
    // needs one port to talk to.
    if (route.method === 'GET' && route.path === '/state') {
      jsonResponse(res, 200, getIdeStateSnapshot())
      return
    }

    if (route.method === 'GET' && route.path === '/fa/sessions') {
      const callerSessionId = req.headers['x-fastagents-session-id']
      const sessions = await this.listSessions(typeof callerSessionId === 'string' ? callerSessionId : null)
      jsonResponse(res, 200, { sessions })
      return
    }

    const sessionActionMatch = route.path.match(/^\/fa\/sessions\/([^/]+)\/(output|input|wait_idle)$/)
    if (sessionActionMatch) {
      const sessionId = decodeURIComponent(sessionActionMatch[1])
      const action = sessionActionMatch[2]
      const callerSessionId = headerString(req.headers['x-fastagents-session-id'])

      // Workspace scope — callers can only touch sessions in the same cwd tree.
      if (callerSessionId && !ptyManager.canAccessSession(callerSessionId, sessionId)) {
        errorResponse(res, 403, 'Target session is outside the current workspace scope.')
        return
      }

      const ptyId = ptyManager.findPtyIdBySessionId(sessionId)
      if (!ptyId) {
        errorResponse(res, 404, `No active session with id "${sessionId}"`)
        return
      }

      if (route.method === 'GET' && action === 'output') {
        await this.handleReadOutput(res, ptyId, route.query)
        return
      }
      if (route.method === 'POST' && action === 'input') {
        if (callerSessionId && callerSessionId === sessionId) {
          errorResponse(res, 400, 'Refusing to send input to the calling session itself.')
          return
        }
        await this.handleWriteInput(req, res, ptyId)
        return
      }
      if (route.method === 'POST' && action === 'wait_idle') {
        await this.handleWaitIdle(req, res, ptyId)
        return
      }
      errorResponse(res, 405, 'Method not allowed for this resource')
      return
    }

    if (route.method === 'POST' && route.path === '/fa/sessions') {
      const callerSessionId = headerString(req.headers['x-fastagents-session-id'])
      await this.handleCreateSession(req, res, callerSessionId)
      return
    }

    errorResponse(res, 404, 'Not found')
  }

  private checkAuth(req: IncomingMessage): boolean {
    if (!this.token) return false
    const header = req.headers['authorization']
    if (typeof header !== 'string') return false
    const expected = `Bearer ${this.token}`
    if (header.length !== expected.length) return false
    let mismatch = 0
    for (let i = 0; i < expected.length; i += 1) {
      mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    return mismatch === 0
  }

  // ─── Route handlers ─────────────────────────────────────────────

  private async listSessions(callerSessionId: string | null): Promise<McpSessionInfo[]> {
    const win = this.resolveMainWindow()
    if (!win) return []

    const requestId = `mcp-list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const sessions = await new Promise<McpSessionInfo[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingListSessions.delete(requestId)
        reject(new Error('Timed out waiting for renderer to list sessions'))
      }, RENDERER_REQUEST_TIMEOUT_MS)
      this.pendingListSessions.set(requestId, { resolve, reject, timer })
      win.webContents.send(IPC.MCP_LIST_SESSIONS_REQUEST, { requestId })
    })

    // Reconcile renderer-reported metadata with live PtyManager state + apply
    // workspace scoping. Outside-scope sessions are simply omitted — the
    // agent never learns about them.
    return sessions
      .map((session) => ({
        ...session,
        hasPty: ptyManager.findPtyIdBySessionId(session.id) !== null,
        isSelf: callerSessionId !== null && callerSessionId === session.id,
      }))
      .filter((session) => {
        if (!callerSessionId) return true
        if (session.id === callerSessionId) return true
        // Only include sessions the caller is allowed to see. Sessions with
        // no live PTY are excluded by canAccessSession anyway.
        return ptyManager.canAccessSession(callerSessionId, session.id)
      })
  }

  private async handleReadOutput(
    res: ServerResponse,
    ptyId: string,
    query: URLSearchParams,
  ): Promise<void> {
    const lineLimit = clampInt(query.get('lines'), { min: 1, max: 2000, fallback: 200 })

    const replay = await ptyManager.getReplay(ptyId)
    const cleaned = stripAnsi(replay.data)
    const lines = cleaned.split('\n')
    const tail = lines.slice(-lineLimit).join('\n')
    jsonResponse(res, 200, {
      lines: tail.split('\n').length,
      requestedLines: lineLimit,
      output: tail,
    })
  }

  private async handleWriteInput(
    req: IncomingMessage,
    res: ServerResponse,
    ptyId: string,
  ): Promise<void> {
    const body = await readJsonBody<{ input?: unknown; press_enter?: unknown }>(req)
    if (typeof body.input !== 'string' || body.input.length === 0) {
      errorResponse(res, 400, '`input` must be a non-empty string')
      return
    }
    if (body.input.length > 16 * 1024) {
      errorResponse(res, 400, '`input` exceeds 16 KiB limit')
      return
    }
    const pressEnter = body.press_enter !== false
    ptyManager.submitInput(ptyId, body.input, { submit: pressEnter })
    jsonResponse(res, 200, { ok: true, bytesWritten: Buffer.byteLength(body.input) })
  }

  private async handleWaitIdle(
    req: IncomingMessage,
    res: ServerResponse,
    ptyId: string,
  ): Promise<void> {
    const body = await readJsonBody<{ idle_ms?: unknown; timeout_ms?: unknown }>(req)
    const idleMs = clampInt(body.idle_ms, { min: 200, max: 60_000, fallback: 1500 })
    const timeoutMs = clampInt(body.timeout_ms, { min: idleMs, max: 300_000, fallback: 30_000 })

    const startedAt = nowMs()
    const deadline = startedAt + timeoutMs

    while (nowMs() < deadline) {
      const last = this.lastDataAt.get(ptyId) ?? 0
      const sinceLast = nowMs() - last
      if (last !== 0 && sinceLast >= idleMs) {
        jsonResponse(res, 200, {
          idle: true,
          waitedMs: nowMs() - startedAt,
          quietMs: sinceLast,
        })
        return
      }
      const sleepMs = Math.max(50, Math.min(idleMs - sinceLast, deadline - nowMs()))
      await delay(sleepMs)
    }

    jsonResponse(res, 200, {
      idle: false,
      waitedMs: nowMs() - startedAt,
      quietMs: nowMs() - (this.lastDataAt.get(ptyId) ?? startedAt),
    })
  }

  private async handleCreateSession(
    req: IncomingMessage,
    res: ServerResponse,
    callerSessionId: string | null,
  ): Promise<void> {
    const body = await readJsonBody<{
      type?: unknown
      cwd?: unknown
      project_id?: unknown
      worktree_id?: unknown
      isolate_worktree?: unknown
      branch_name?: unknown
      name?: unknown
      activate?: unknown
      initial_input?: unknown
    }>(req)

    const typeRaw = typeof body.type === 'string' ? body.type as SessionType : 'claude-code'
    if (!VALID_CREATABLE_TYPES.has(typeRaw)) {
      errorResponse(res, 400, `Unknown session type "${String(body.type)}"`)
      return
    }
    const type = typeRaw as McpCreatableSessionType
    const cwd = typeof body.cwd === 'string' ? body.cwd : ''
    const projectId = typeof body.project_id === 'string' ? body.project_id : null
    const worktreeId = typeof body.worktree_id === 'string' ? body.worktree_id : null
    const isolateWorktree = body.isolate_worktree === true
    const branchName = typeof body.branch_name === 'string' ? body.branch_name : null
    const name = typeof body.name === 'string' ? body.name : null
    const activate = body.activate !== false
    const initialInput = typeof body.initial_input === 'string' ? body.initial_input : null

    const win = this.resolveMainWindow()
    if (!win) {
      errorResponse(res, 503, 'Main window not ready')
      return
    }

    const requestId = `mcp-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const payload: McpCreateSessionRequest = {
      requestId,
      sourceSessionId: callerSessionId,
      type,
      cwd,
      projectId,
      worktreeId,
      isolateWorktree,
      branchName,
      name,
      activate,
      initialInput,
    }

    try {
      const result = await new Promise<McpCreateSessionResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingCreateSession.delete(requestId)
          reject(new Error('Timed out waiting for renderer to create session'))
        }, RENDERER_REQUEST_TIMEOUT_MS)
        this.pendingCreateSession.set(requestId, { resolve, reject, timer })
        win.webContents.send(IPC.MCP_CREATE_SESSION_REQUEST, payload)
      })

      if (!result.ok || !result.sessionId) {
        errorResponse(res, 500, result.error ?? 'Renderer failed to create session')
        return
      }

      jsonResponse(res, 200, {
        ok: true,
        session_id: result.sessionId,
        worktree_fallback: result.worktreeFallback === true,
        worktree_error: result.worktreeError ?? null,
      })
    } catch (err) {
      errorResponse(res, 504, err instanceof Error ? err.message : String(err))
    }
  }

  private resolveMainWindow(): BrowserWindow | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        const url = win.webContents.getURL()
        if (!url.includes('detached=true') && !url.includes('overlay=true')) {
          return win
        }
      }
    }
    return null
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampInt(
  raw: unknown,
  options: { min: number; max: number; fallback: number },
): number {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(value)) return options.fallback
  return Math.min(options.max, Math.max(options.min, Math.floor(value)))
}

function parseRoute(req: IncomingMessage): ParsedRoute | null {
  if (!req.url || !req.method) return null
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  return {
    method: req.method.toUpperCase(),
    path,
    query: url.searchParams,
  }
}

function headerString(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export const orchestratorService = new OrchestratorService()
