// HookServer — Local HTTP server receiving agent hook callbacks
// Routes: POST /agent-hook (Stop etc.), POST /permission (PermissionRequest — blocking)

import http from 'node:http'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import { ptyManager } from './PtyManager'
import { claudeGuiService } from './ClaudeGuiService'

const DEFAULT_PORT = 24680
const PORT_RANGE = 5

// Tools that are auto-allowed (no side effects)
const PASSTHROUGH_TOOLS = new Set([
  'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop', 'TaskOutput',
])

interface PermissionSuggestion {
  type: string
  toolName?: string
  ruleContent?: string
  destination?: string
  behavior?: string
  mode?: string
  rules?: Array<{ toolName: string; ruleContent: string }>
}

interface PendingPermission {
  id: string
  res: http.ServerResponse
  faSessionId: string | null
  toolName: string
  toolInput: Record<string, unknown>
  suggestions: PermissionSuggestion[]
}

function truncateStr(s: unknown, max = 200): string {
  if (typeof s !== 'string') return ''
  return s.length > max ? s.slice(0, max) + '\u2026' : s
}

function formatDetail(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash' && toolInput.command) return truncateStr(toolInput.command, 120)
  if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') && toolInput.file_path)
    return truncateStr(toolInput.file_path, 120)
  if ((toolName === 'Glob' || toolName === 'Grep') && toolInput.pattern)
    return truncateStr(toolInput.pattern, 120)
  for (const v of Object.values(toolInput)) {
    if (typeof v === 'string') return truncateStr(v, 100)
  }
  return ''
}

export class HookServer {
  private server: http.Server | null = null
  private activePort: number | null = null
  private readonly pending = new Map<string, PendingPermission>()
  private permIdCounter = 0

  get port(): number | null {
    return this.activePort
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleRequest(req, res))
      this.server = server

      let attempt = 0
      const tryListen = (): void => {
        const port = DEFAULT_PORT + attempt
        server.removeAllListeners('error')
        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' && attempt < PORT_RANGE - 1) {
            attempt++
            tryListen()
          } else {
            reject(err)
          }
        })
        server.listen(port, '127.0.0.1', () => {
          this.activePort = port
          console.log(`[HookServer] listening on 127.0.0.1:${port}`)
          resolve(port)
        })
      }
      tryListen()
    })
  }

  stop(): void {
    // Deny all pending permission requests
    for (const [, perm] of this.pending) {
      this.sendPermissionResponse(perm.res, 'deny', 'FastAgents is shutting down')
    }
    this.pending.clear()
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.activePort = null
  }

  /** Called from IPC when user clicks Allow/Deny in the permission dialog */
  resolvePermission(id: string, behavior: 'allow' | 'deny', suggestionIndex?: number): void {
    const perm = this.pending.get(id)
    if (!perm) return
    this.pending.delete(id)

    const decision: Record<string, unknown> = { behavior }
    if (behavior === 'deny') decision.message = 'Denied by user'
    // If user picked a suggestion (e.g., "always allow"), attach it
    if (behavior === 'allow' && suggestionIndex !== undefined && perm.suggestions[suggestionIndex]) {
      decision.updatedPermissions = [perm.suggestions[suggestionIndex]]
    }
    this.sendPermissionDecision(perm.res, decision)

    // Notify renderer to dismiss
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.PERMISSION_DISMISS, { id })
      }
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const pathname = req.url ? new URL(req.url, 'http://127.0.0.1').pathname : ''

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, app: 'fast-agents' }))
      return
    }

    if (req.method === 'POST' && pathname === '/agent-hook') {
      this.handleAgentHook(req, res)
      return
    }

    if (req.method === 'POST' && pathname === '/status-line') {
      this.handleStatusLine(req, res)
      return
    }

    if (req.method === 'POST' && pathname === '/permission') {
      this.handlePermission(req, res)
      return
    }

    res.writeHead(404)
    res.end()
  }

  /** Non-blocking hooks: Stop, UserPromptSubmit, PreToolUse, PostToolUse */
  private handleAgentHook(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk })
    req.on('end', () => {
      res.writeHead(200)
      res.end('ok')

      try {
        const data = JSON.parse(body)
        const event = data.hook_event_name as string | undefined
        const faSessionId = typeof data.fa_session_id === 'string' && data.fa_session_id
          ? data.fa_session_id
          : null
        const cwd = typeof data.cwd === 'string' ? data.cwd : ''
        const managedSession = faSessionId ? ptyManager.getManagedSession(faSessionId) : null
        const sessionType = typeof data.fastagents_session_type === 'string' && data.fastagents_session_type
          ? data.fastagents_session_type
          : managedSession?.type ?? ''
        const hookSource = typeof data.fastagents_hook_source === 'string'
          ? data.fastagents_hook_source
          : ''
        const isCodex = sessionType === 'codex' || sessionType === 'codex-yolo' || sessionType === 'codex-wsl' || sessionType === 'codex-yolo-wsl' || hookSource === 'codex'
        const resolvedSessionId = managedSession?.sessionId
          ?? (cwd && isCodex ? ptyManager.findCodexSessionByCwd(cwd) : null)
          ?? (cwd && !isCodex ? ptyManager.findClaudeSessionByCwd(cwd) : null)
          ?? (cwd ? ptyManager.findAgentSessionByCwd(cwd) : null)
          ?? faSessionId

        if (!resolvedSessionId) return

        // Map hook event → agent activity status
        // Codex only emits Stop; Claude emits the full set.
        let activity: 'running' | 'thinking' | 'completed' | null = null
        switch (event) {
          case 'Stop':
            activity = 'completed'
            break
          case 'UserPromptSubmit':
          case 'PostToolUse':
            activity = 'thinking'
            break
          case 'PreToolUse':
            activity = 'running'
            break
          default:
            activity = null
        }

        if (activity) {
          const payload = {
            sessionId: resolvedSessionId,
            activity,
            source: isCodex ? 'codex' : 'claude',
            ts: Date.now(),
          }
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(IPC.SESSION_ACTIVITY_UPDATE, payload)
            }
          }
        }

        // Preserve legacy Stop toast signal
        if (event === 'Stop') {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(IPC.SESSION_IDLE_TOAST, { sessionId: resolvedSessionId })
            }
          }
        }
      } catch { /* ignore */ }
    })
  }

  /** Blocking hook: PermissionRequest — hold response until user decides */
  private handlePermission(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''
    let bodySize = 0
    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length
      if (bodySize <= 524288) body += chunk
    })
    req.on('end', () => {
      if (bodySize > 524288) {
        this.sendPermissionResponse(res, 'deny', 'Payload too large')
        return
      }

      try {
        const data = JSON.parse(body)
        const toolName = typeof data.tool_name === 'string' ? data.tool_name : 'Unknown'
        const toolInput = (data.tool_input && typeof data.tool_input === 'object') ? data.tool_input : {}
        const suggestions: PermissionSuggestion[] = Array.isArray(data.permission_suggestions) ? data.permission_suggestions : []
        // HTTP hooks don't pass our FASTAGENTS_* env vars. Resolve Claude
        // hooks by Claude's own session id instead of cwd so external shells
        // in the same project directory don't get attached to this app.
        const cwd = typeof data.cwd === 'string' ? data.cwd : ''
        const claudeSessionId = typeof data.session_id === 'string' ? data.session_id : ''
        const faSessionId = claudeSessionId ? ptyManager.findClaudeSessionByClaudeSessionId(claudeSessionId) : null
        const conversationId = !faSessionId && cwd ? claudeGuiService.findConversationIdByCwd(cwd) : null

        if (!faSessionId && !conversationId) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{}')
          return
        }

        // Claude GUI handles can_use_tool permission prompts through the
        // stream-json control_request/control_response channel. Return an
        // empty hook result here so the hook path passes through instead of
        // racing the GUI flow with an early deny/allow decision.
        if (conversationId) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{}')
          return
        }

        // Auto-allow passthrough tools
        if (PASSTHROUGH_TOOLS.has(toolName)) {
          this.sendPermissionResponse(res, 'allow')
          return
        }

        const id = `perm-${++this.permIdCounter}`
        const perm: PendingPermission = { id, res, faSessionId, toolName, toolInput, suggestions }
        this.pending.set(id, perm)

        // Clean up if client disconnects
        res.on('close', () => {
          if (this.pending.has(id)) {
            this.pending.delete(id)
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed()) {
                win.webContents.send(IPC.PERMISSION_DISMISS, { id })
              }
            }
          }
        })

        // Build suggestion labels for UI
        const suggestionLabels = suggestions.map((s) => {
          if (s.type === 'setMode') return s.mode === 'acceptEdits' ? 'Auto-accept edits' : (s.mode ?? 'Always allow')
          if (s.type === 'addRules') {
            const rule = Array.isArray(s.rules) && s.rules[0] ? s.rules[0] : s
            const rc = (rule as Record<string, unknown>).ruleContent as string | undefined ?? s.ruleContent
            const tn = (rule as Record<string, unknown>).toolName as string | undefined ?? s.toolName ?? ''
            if (rc?.includes('**')) {
              const dir = rc.split('**')[0].replace(/[\\/]$/, '').split(/[\\/]/).pop() || rc
              return `Allow ${tn} in ${dir}/`
            }
            return rc ? `Always allow \`${rc.length > 30 ? rc.slice(0, 29) + '\u2026' : rc}\`` : 'Always allow'
          }
          return 'Always allow'
        })

        // Send to renderer
        const detail = formatDetail(toolName, toolInput)
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC.PERMISSION_REQUEST, {
              id,
              sessionId: faSessionId,
              conversationId,
              toolName,
              detail,
              suggestions: suggestionLabels,
            })
          }
        }
      } catch {
        res.writeHead(400)
        res.end('bad json')
      }
    })
  }

  /** Status line updates from Claude Code */
  private handleStatusLine(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk })
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))

      try {
        const data = JSON.parse(body)
        const sessionId = data.session_id as string | undefined
        const faSessionId = sessionId ? ptyManager.findClaudeSessionByClaudeSessionId(sessionId) : null
        if (!faSessionId) return

        // Broadcast to all windows
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('agent:status-update', {
              sessionId: faSessionId,
              claudeSessionId: sessionId,
              model: data.model,
              contextWindow: data.context_window,
              cost: data.cost,
              workspace: data.workspace,
            })
          }
        }
      } catch { /* ignore */ }
    })
  }

  private sendPermissionDecision(res: http.ServerResponse, decision: Record<string, unknown>): void {
    if (res.writableEnded || res.destroyed) return
    const responseBody = JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision },
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(responseBody)
  }

  private sendPermissionResponse(res: http.ServerResponse, behavior: string, message?: string): void {
    const decision: Record<string, unknown> = { behavior }
    if (message) decision.message = message
    this.sendPermissionDecision(res, decision)
  }
}

export const hookServer = new HookServer()
