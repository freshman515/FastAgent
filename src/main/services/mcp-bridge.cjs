#!/usr/bin/env node
// MCP Server bridge for FastAgents IDE integration
// Claude Code runs this as an MCP server — it queries FastAgents' HTTP IDE server

const http = require('http')
const readline = require('readline')

const PORT = parseInt(process.env.FASTAGENTS_IDE_PORT || '0', 10)
if (!PORT) { process.exit(1) }

function fetchState() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/state`, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({}) } })
    }).on('error', reject)
  })
}

// Simple JSON-RPC over stdio (MCP protocol)
const rl = readline.createInterface({ input: process.stdin })

function send(obj) {
  const json = JSON.stringify(obj)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`)
}

const TOOLS = [
  {
    name: 'fastagents_get_open_file',
    description: 'Get the currently open file in FastAgents editor, including its path, language, and cursor position',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fastagents_get_selection',
    description: 'Get the currently selected text in the FastAgents editor. Returns the selected code/text and the file it belongs to.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fastagents_get_editor_context',
    description: 'Get full editor context: open file, selection, cursor position, project path, and language',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
]

let buffer = ''

rl.on('line', (line) => {
  // Skip Content-Length headers
  if (line.startsWith('Content-Length:') || line.trim() === '') {
    return
  }
  buffer += line
  try {
    const msg = JSON.parse(buffer)
    buffer = ''
    handleMessage(msg)
  } catch {
    // incomplete JSON, keep buffering
  }
})

async function handleMessage(msg) {
  const { id, method, params } = msg

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fastagents-ide', version: '1.0.0' },
      },
    })
  } else if (method === 'notifications/initialized') {
    // no-op
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  } else if (method === 'tools/call') {
    const toolName = params?.name
    try {
      const state = await fetchState()
      let content
      if (toolName === 'fastagents_get_open_file') {
        content = state.filePath
          ? `File: ${state.filePath}\nLanguage: ${state.language || 'unknown'}\nCursor: line ${state.cursorLine}, column ${state.cursorColumn}`
          : 'No file is currently open in the editor.'
      } else if (toolName === 'fastagents_get_selection') {
        content = state.selection
          ? `File: ${state.filePath || state.fileName || 'unknown file'}\nLanguage: ${state.language || 'unknown'}\nSelection: ${state.selectionRange ? `L${state.selectionRange.start.line + 1}:C${state.selectionRange.start.character + 1} - L${state.selectionRange.end.line + 1}:C${state.selectionRange.end.character + 1}` : 'unknown'}\n\nSelected text:\n\n${state.selection}`
          : 'No text is currently selected in the editor.'
      } else if (toolName === 'fastagents_get_editor_context') {
        content = JSON.stringify(state, null, 2)
      } else {
        content = `Unknown tool: ${toolName}`
      }
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: content }] } })
    } catch (err) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error connecting to FastAgents: ${err.message}` }], isError: true } })
    }
  } else {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
