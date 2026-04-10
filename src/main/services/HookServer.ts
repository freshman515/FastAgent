// HookServer — Local HTTP server receiving Claude Code hook callbacks
// Routes: POST /agent-hook (Stop etc.), POST /permission (PermissionRequest — blocking)

import http from 'node:http'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import { ptyManager } from './PtyManager'

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
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, app: 'fast-agents' }))
      return
    }

    if (req.method === 'POST' && req.url === '/agent-hook') {
      this.handleAgentHook(req, res)
      return
    }

    if (req.method === 'POST' && req.url === '/permission') {
      this.handlePermission(req, res)
      return
    }

    res.writeHead(404)
    res.end()
  }

  /** Non-blocking hooks: Stop, etc. */
  private handleAgentHook(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk })
    req.on('end', () => {
      res.writeHead(200)
      res.end('ok')

      try {
        const data = JSON.parse(body)
        const event = data.hook_event_name as string | undefined
        const faSessionId = data.fa_session_id as string | undefined

        if (event === 'Stop' && faSessionId) {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(IPC.SESSION_IDLE_TOAST, { sessionId: faSessionId })
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
        // HTTP hooks don't pass env vars, so resolve session by CWD
        const cwd = typeof data.cwd === 'string' ? data.cwd : ''
        const faSessionId = cwd ? ptyManager.findClaudeSessionByCwd(cwd) : null

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
