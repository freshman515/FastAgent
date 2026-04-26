#!/usr/bin/env node
// FastAgents MCP bridge — runs as a child process under any MCP-capable
// agent (Claude Code, etc.). Exposes a "Meta-Agent" toolset plus editor-
// context tools that let the agent:
//   - inspect / drive / spawn other FastAgents sessions
//   - read the currently-open editor file + selection
//
// All tools proxy to the OrchestratorService HTTP server in the FastAgents
// main process. Auth uses a per-launch random Bearer token.
//
// Required env (injected by FastAgents when it spawns the PTY):
//   FASTAGENTS_MCP_PORT     – orchestrator HTTP port (loopback)
//   FASTAGENTS_MCP_TOKEN    – random per-launch Bearer token
// Optional:
//   FASTAGENTS_SESSION_ID   – this agent's own session id (set by FastAgents
//                             so the bridge can flag `isSelf` and scope
//                             workspace access).

const http = require('http')
const readline = require('readline')

const PORT = parseInt(process.env.FASTAGENTS_MCP_PORT || '0', 10)
const TOKEN = process.env.FASTAGENTS_MCP_TOKEN || ''
const SELF_SESSION_ID = process.env.FASTAGENTS_SESSION_ID || ''
const CONNECTED = Boolean(PORT && TOKEN)

// If the bridge is spawned outside a FastAgents PTY (no orchestrator env),
// we still speak MCP — we just fail tool calls with a clear message. This
// keeps `claude mcp list` health checks green even when the bridge is
// configured globally and then launched from a plain shell.

// ─── HTTP helper ────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    }
    if (SELF_SESSION_ID) {
      headers['X-FastAgents-Session-Id'] = SELF_SESSION_ID
    }
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(payload)
    }
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path, headers },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {}
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${parsed.error || data || 'unknown error'}`))
            } else {
              resolve(parsed)
            }
          } catch (err) {
            reject(new Error(`Bad JSON from FastAgents: ${err.message}`))
          }
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// ─── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  // Editor context (served by FastAgents' IdeServer, proxied via orchestrator /state)
  {
    name: 'fa_get_open_file',
    description: 'Get the currently open file in the FastAgents editor, including its path, language, and cursor position.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fa_get_selection',
    description: 'Get the currently selected text in the FastAgents editor. Returns the selected code/text and the file it belongs to.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fa_get_editor_context',
    description: 'Get full editor context: open file, selection, cursor position, project path, and language.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },

  // Session orchestration
  {
    name: 'fa_list_sessions',
    description:
      'List every FastAgents session currently in the workspace scope of this calling agent. Returns id, name, type, status, cwd, pane, and whether the calling agent owns each session. Use this first whenever you need to find a session to read or write to.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fa_read_session',
    description:
      'Read recent terminal output from a FastAgents session. ANSI escape sequences are stripped. Use this to inspect what another session (or worker agent) has produced.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Renderer session id, exactly as returned by fa_list_sessions.',
        },
        lines: {
          type: 'integer',
          description: 'How many trailing lines to return (default 200, min 1, max 2000).',
          minimum: 1,
          maximum: 2000,
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'fa_write_session',
    description:
      'Send input to a FastAgents session as if the user typed it. By default a trailing Enter is appended. Use this to dispatch a prompt to a worker agent or run a shell command in another terminal. Refuses to write to the calling agent\'s own session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        input: {
          type: 'string',
          description: 'Text to send. Up to 16 KiB.',
        },
        press_enter: {
          type: 'boolean',
          description: 'If true (default), appends a carriage return.',
        },
      },
      required: ['session_id', 'input'],
    },
  },
  {
    name: 'fa_create_session',
    description:
      'Create a new FastAgents session in the active pane. Use this to spawn a worker agent (claude-code / codex / gemini / opencode) or a plain terminal for a follow-up task.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['terminal', 'claude-code', 'claude-code-yolo', 'codex', 'codex-yolo', 'gemini', 'gemini-yolo', 'opencode'],
          description: 'Session type. Defaults to claude-code.',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (absolute path). Optional — falls back to the active project / home dir.',
        },
        project_id: {
          type: 'string',
          description: 'Optional FastAgents project id to attach the session to.',
        },
        worktree_id: {
          type: 'string',
          description: 'Optional FastAgents worktree id (overrides cwd resolution).',
        },
        isolate_worktree: {
          type: 'boolean',
          description: 'When true, create a new git worktree for this session before launch.',
        },
        branch_name: {
          type: 'string',
          description: 'Optional branch name to use with isolate_worktree.',
        },
        name: {
          type: 'string',
          description: 'Display name for the new tab.',
        },
        activate: {
          type: 'boolean',
          description: 'Whether to activate the newly-created tab. Defaults to true.',
        },
        initial_input: {
          type: 'string',
          description: 'Optional first line to type into the new session once it boots.',
        },
      },
      required: [],
    },
  },
  {
    name: 'fa_wait_for_idle',
    description:
      'Block until a FastAgents session has produced no output for `idle_ms` milliseconds, or `timeout_ms` elapses. Use this as a synchronization point after dispatching work to a worker agent.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        idle_ms: {
          type: 'integer',
          description: 'Quiet period required (default 1500, min 200, max 60000).',
          minimum: 200,
          maximum: 60000,
        },
        timeout_ms: {
          type: 'integer',
          description: 'Maximum total wait (default 30000, max 300000).',
          minimum: 200,
          maximum: 300000,
        },
      },
      required: ['session_id'],
    },
  },
]

// ─── Tool dispatch ──────────────────────────────────────────────────────────

async function callTool(name, args) {
  switch (name) {
    case 'fa_get_open_file': {
      const state = await request('GET', '/state')
      if (!state || !state.filePath) return 'No file is currently open in the editor.'
      return `File: ${state.filePath}\nLanguage: ${state.language || 'unknown'}\nCursor: line ${state.cursorLine}, column ${state.cursorColumn}`
    }

    case 'fa_get_selection': {
      const state = await request('GET', '/state')
      if (!state || !state.selection) return 'No text is currently selected in the editor.'
      const range = state.selectionRange
      const rangeText = range
        ? `L${range.start.line + 1}:C${range.start.character + 1} - L${range.end.line + 1}:C${range.end.character + 1}`
        : 'unknown'
      return `File: ${state.filePath || state.fileName || 'unknown file'}\nLanguage: ${state.language || 'unknown'}\nSelection: ${rangeText}\n\nSelected text:\n\n${state.selection}`
    }

    case 'fa_get_editor_context': {
      const state = await request('GET', '/state')
      return JSON.stringify(state, null, 2)
    }

    case 'fa_list_sessions': {
      const data = await request('GET', '/fa/sessions')
      const sessions = Array.isArray(data.sessions) ? data.sessions : []
      if (sessions.length === 0) return 'No active sessions.'
      const lines = sessions.map((s) => {
        const tags = []
        if (s.isSelf) tags.push('SELF')
        if (!s.hasPty) tags.push('no-pty')
        const tagStr = tags.length ? ` [${tags.join(', ')}]` : ''
        return `- ${s.id} · ${s.name} · ${s.type} · ${s.status}${tagStr}\n    cwd: ${s.cwd || '(none)'}\n    pane: ${s.paneId || '(detached)'}`
      })
      return `${sessions.length} session(s):\n${lines.join('\n')}`
    }

    case 'fa_read_session': {
      const sessionId = String(args.session_id || '')
      if (!sessionId) throw new Error('session_id is required')
      const lines = args.lines ? `?lines=${encodeURIComponent(args.lines)}` : ''
      const data = await request('GET', `/fa/sessions/${encodeURIComponent(sessionId)}/output${lines}`)
      return typeof data.output === 'string' ? data.output : ''
    }

    case 'fa_write_session': {
      const sessionId = String(args.session_id || '')
      if (!sessionId) throw new Error('session_id is required')
      if (sessionId === SELF_SESSION_ID) {
        throw new Error('Refusing to write to the calling agent\'s own session.')
      }
      if (typeof args.input !== 'string' || !args.input) {
        throw new Error('input must be a non-empty string')
      }
      const body = { input: args.input }
      if (typeof args.press_enter === 'boolean') body.press_enter = args.press_enter
      const data = await request('POST', `/fa/sessions/${encodeURIComponent(sessionId)}/input`, body)
      return `Wrote ${data.bytesWritten ?? args.input.length} bytes to session ${sessionId}.`
    }

    case 'fa_create_session': {
      const body = {
        type: args.type || 'claude-code',
        cwd: args.cwd || '',
        project_id: args.project_id,
        worktree_id: args.worktree_id,
        isolate_worktree: args.isolate_worktree,
        branch_name: args.branch_name,
        name: args.name,
        activate: args.activate,
        initial_input: args.initial_input,
      }
      const data = await request('POST', '/fa/sessions', body)
      if (!data.ok || !data.session_id) {
        throw new Error(data.error || 'create_session failed')
      }
      const fallback = data.worktree_fallback
        ? ` Worktree isolation was not used: ${data.worktree_error || 'fallback to current workspace'}.`
        : ''
      return `Created session ${data.session_id} (type=${body.type}).${fallback}`
    }

    case 'fa_wait_for_idle': {
      const sessionId = String(args.session_id || '')
      if (!sessionId) throw new Error('session_id is required')
      const body = {}
      if (typeof args.idle_ms === 'number') body.idle_ms = args.idle_ms
      if (typeof args.timeout_ms === 'number') body.timeout_ms = args.timeout_ms
      const data = await request('POST', `/fa/sessions/${encodeURIComponent(sessionId)}/wait_idle`, body)
      return data.idle
        ? `Idle after ${data.waitedMs}ms (quiet ${data.quietMs}ms).`
        : `Timed out after ${data.waitedMs}ms (last output ${data.quietMs}ms ago).`
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── MCP JSON-RPC framing (newline-delimited JSON) ──────────────────────────

function send(obj) {
  const json = JSON.stringify(obj)
  process.stdout.write(json + '\n')
}

const DEBUG = process.env.FASTAGENTS_MCP_DEBUG === '1'
function debug(...args) {
  if (DEBUG) {
    try { process.stderr.write(`[mcp-bridge] ${args.join(' ')}\n`) } catch { /* ignore */ }
  }
}

debug('boot', JSON.stringify({ connected: CONNECTED, port: PORT, pid: process.pid }))

let buffer = ''
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (rawLine) => {
  // Strip Windows CRLF leftovers — readline keeps the trailing \r on some Windows shells.
  const line = rawLine.replace(/\r$/, '')
  // Skip any legacy LSP-style Content-Length headers / separators.
  if (line.startsWith('Content-Length:') || line === '') return
  buffer += line
  let msg
  try {
    msg = JSON.parse(buffer)
    buffer = ''
  } catch {
    // Incomplete JSON — keep buffering until the next line completes it.
    return
  }
  debug('recv', msg && msg.method, 'id=' + (msg && msg.id))
  handleMessage(msg).catch((err) => {
    send({
      jsonrpc: '2.0',
      id: msg && msg.id,
      error: { code: -32603, message: err && err.message ? err.message : String(err) },
    })
  })
})

async function handleMessage(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fastagents-meta-agent', version: '1.0.0' },
      },
    })
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'tools/list') {
    // Always advertise the full toolset so clients don't flag the server as
    // broken when the orchestrator isn't attached yet. tools/call enforces
    // CONNECTED and returns a clear message otherwise.
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    return
  }
  if (method === 'tools/call') {
    if (!CONNECTED) {
      send({
        jsonrpc: '2.0', id,
        result: {
          content: [{
            type: 'text',
            text: 'FastAgents MCP bridge is not attached to a FastAgents session. Start the MCP-capable agent from inside a FastAgents tab — the bridge needs FASTAGENTS_MCP_PORT / FASTAGENTS_MCP_TOKEN env vars that FastAgents injects automatically.',
          }],
          isError: true,
        },
      })
      return
    }
    const toolName = params && params.name
    const toolArgs = (params && params.arguments) || {}
    try {
      const text = await callTool(toolName, toolArgs)
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } })
    } catch (err) {
      send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
      })
    }
    return
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
}

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
