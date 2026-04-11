import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { ipcMain } from 'electron'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'

// ─── IDE Bridge for Claude Code /ide integration ───
// Implements the same lock-file + WebSocket protocol that VS Code / EnsoAI use

interface LockFilePayload {
  pid: number
  workspaceFolders: string[]
  ideName: string
  transport: string
  runningInWindows: boolean
  authToken: string
}

interface SelectionChangedParams {
  text: string
  filePath: string
  fileUrl: string
  fileName: string
  language: string
  cursorLine: number
  cursorColumn: number
  selection: {
    start: { line: number; character: number }
    end: { line: number; character: number }
    isEmpty: boolean
  }
}

interface EditorStateSnapshot {
  filePath: string
  fileUrl: string
  fileName: string
  language: string
  cursorLine: number
  cursorColumn: number
  selection: string
  selectionRange: SelectionChangedParams['selection']
}

let serverPort: number | null = null
let authToken: string | null = null
let httpServer: http.Server | null = null
let wss: WebSocketServer | null = null
let lockPath: string | null = null
let currentWorkspaceFolders: string[] = []
let currentEditorState: EditorStateSnapshot | null = null
const clients = new Map<string, WebSocket>()
let clientIdCounter = 0

function getIdeDir(): string {
  return path.join(os.homedir(), '.claude', 'ide')
}

function writeLockFile(port: number, token: string, folders: string[]): string {
  const ideDir = getIdeDir()
  fs.mkdirSync(ideDir, { recursive: true, mode: 0o700 })

  const lp = path.join(ideDir, `${port}.lock`)
  const payload: LockFilePayload = {
    pid: process.pid,
    workspaceFolders: folders,
    ideName: 'FastAgents',
    transport: 'ws',
    runningInWindows: process.platform === 'win32',
    authToken: token,
  }
  fs.writeFileSync(lp, JSON.stringify(payload), { mode: 0o600 })
  return lp
}

function deleteLockFile(): void {
  if (lockPath) {
    try { fs.unlinkSync(lockPath) } catch { /* ignore */ }
    lockPath = null
  }
}

function reply(ws: WebSocket, id: number | string, result: unknown): void {
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

function handleMessage(ws: WebSocket, raw: RawData): void {
  let msg: { jsonrpc: string; id?: number | string; method: string; params?: Record<string, unknown> }
  try { msg = JSON.parse(raw.toString('utf-8')) } catch { return }
  if (!msg || msg.jsonrpc !== '2.0') return

  // Notification (no id)
  if (msg.id === undefined) return

  const { id, method } = msg

  if (method === 'ping') return reply(ws, id, {})

  if (method === 'initialize') {
    return reply(ws, id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        logging: {},
        prompts: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        tools: { listChanged: true },
      },
      serverInfo: { name: 'FastAgents', version: '1.0.0' },
    })
  }

  if (method === 'tools/list') return reply(ws, id, { tools: [] })
  if (method === 'prompts/list') return reply(ws, id, { prompts: [] })
  if (method === 'resources/list') return reply(ws, id, { resources: [] })

  reply(ws, id, {})
}

// Send notification to all connected Claude Code clients
function broadcast(method: string, params: object): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params })
  for (const [, ws] of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

export function startIdeServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    authToken = crypto.randomUUID()

    httpServer = http.createServer((req, res) => {
      if (req.url === '/state') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          workspaceFolders: currentWorkspaceFolders,
          ...currentEditorState,
        }))
        return
      }

      res.writeHead(404)
      res.end()
    })

    wss = new WebSocketServer({ server: httpServer })

    wss.on('connection', (ws, req) => {
      const token = req.headers['x-claude-code-ide-authorization']
      if (token !== authToken) {
        ws.close(1008, 'Unauthorized')
        return
      }

      const clientId = String(++clientIdCounter)
      clients.set(clientId, ws)
      console.log(`[IDE] Claude Code connected (client ${clientId})`)

      ws.on('message', (data) => handleMessage(ws, data))
      ws.on('close', () => {
        clients.delete(clientId)
        console.log(`[IDE] Claude Code disconnected (client ${clientId})`)
      })
    })

    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer!.address()
      if (typeof addr === 'object' && addr) {
        serverPort = addr.port
        lockPath = writeLockFile(serverPort, authToken!, currentWorkspaceFolders)
        console.log(`[IDE] WebSocket server on port ${serverPort}, lock file written`)
        resolve(serverPort)
      } else {
        reject(new Error('Failed to get server address'))
      }
    })
    httpServer.on('error', reject)
  })
}

export function stopIdeServer(): void {
  deleteLockFile()
  for (const [, ws] of clients) ws.close()
  clients.clear()
  wss?.close()
  httpServer?.close()
  serverPort = null
  authToken = null
  currentEditorState = null
}

export function getIdeServerPort(): number | null {
  return serverPort
}

export function updateWorkspaceFolders(folders: string[]): void {
  currentWorkspaceFolders = folders
  if (serverPort && authToken) {
    lockPath = writeLockFile(serverPort, authToken, currentWorkspaceFolders)
  }
}

export function sendSelectionChanged(params: SelectionChangedParams): void {
  currentEditorState = {
    filePath: params.filePath,
    fileUrl: params.fileUrl,
    fileName: params.fileName,
    language: params.language,
    cursorLine: params.cursorLine,
    cursorColumn: params.cursorColumn,
    selection: params.text,
    selectionRange: params.selection,
  }
  broadcast('selection_changed', params)
}

export function registerIdeIPC(): void {
  // Renderer sends selection changes
  ipcMain.on('ide:selection-changed', (_event, params: SelectionChangedParams) => {
    sendSelectionChanged(params)
  })

  // Renderer updates workspace folders (when project changes)
  ipcMain.on('ide:update-workspace', (_event, folders: string[]) => {
    updateWorkspaceFolders(folders)
  })

  ipcMain.handle('ide:get-port', () => serverPort)
}
