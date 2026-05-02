import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { app, shell } from 'electron'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { ConfigSyncKey, SessionCreateOptions, SessionSubmitOptions } from '@shared/types'
import { addConfigObserver, readConfig, writeConfig } from './ConfigStore'
import { ptyManager } from './PtyManager'
import { activityMonitor } from './ActivityMonitor'
import { gitService } from './GitService'
import { detectShell } from './ShellDetector'
import { findInFiles, findFiles } from '../ipc/search'

interface Route {
  method: string
  path: string
  query: URLSearchParams
}

const READ_BODY_LIMIT_BYTES = 2 * 1024 * 1024
const SESSION_COOKIE = 'fastagents_web_auth'
const DEFAULT_HOST = '127.0.0.1'
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
}

function parseRoute(req: IncomingMessage): Route | null {
  if (!req.url) return null
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`)
    return {
      method: (req.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
    }
  } catch {
    return null
  }
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload))
  res.end(payload)
}

function textResponse(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  if (res.writableEnded || res.destroyed) return
  res.statusCode = status
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function errorResponse(res: ServerResponse, status: number, message: string): void {
  jsonResponse(res, status, { error: message })
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise<T>((resolveBody, reject) => {
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
        resolveBody({} as T)
        return
      }
      try {
        resolveBody(JSON.parse(raw) as T)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.on('error', reject)
  })
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  return Object.fromEntries(
    header.split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=')
        if (index === -1) return [part, '']
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))]
      }),
  )
}

function execGit(cwd: string, args: string[], maxBuffer = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile('git', args, { cwd, maxBuffer, windowsHide: true }, (err, stdout) => {
      if (err) reject(err)
      else resolveOutput(stdout)
    })
  })
}

function isValidConfigKey(value: string): value is ConfigSyncKey {
  return [
    'groups',
    'sessionGroups',
    'projects',
    'sessions',
    'editors',
    'worktrees',
    'templates',
    'activeTasks',
    'infiniteTasks',
    'ui',
    'panes',
    'canvas',
    'claudeGui',
    'customThemes',
    'launches',
  ].includes(value)
}

function safeStaticPath(root: string, requestPath: string): string | null {
  const pathname = decodeURIComponent(requestPath)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const target = resolve(root, relative)
  const normalizedRoot = resolve(root)
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}\\`) && !target.startsWith(`${normalizedRoot}/`)) {
    return null
  }
  return target
}

function resolveRendererRoot(): string {
  return resolve(__dirname, '../renderer')
}

function normalizeHost(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed || DEFAULT_HOST
}

function normalizePort(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 0
}

function encodeSse(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`
}

function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

class WebUiService {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private token: string | null = null
  private host = DEFAULT_HOST
  private port: number | null = null
  private readonly eventClients = new Set<ServerResponse>()
  private removeDataObserver: (() => void) | null = null
  private removeExitObserver: (() => void) | null = null
  private removeConfigObserver: (() => void) | null = null

  async init(): Promise<void> {
    if (this.server) return
    this.token = randomBytes(32).toString('hex')
    this.host = normalizeHost(process.env.FASTAGENTS_WEB_HOST)
    const preferredPort = normalizePort(process.env.FASTAGENTS_WEB_PORT)

    await new Promise<void>((resolveInit, reject) => {
      const server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err: unknown) => {
          if (!res.headersSent) {
            errorResponse(res, 500, err instanceof Error ? err.message : String(err))
          } else {
            try { res.end() } catch { /* noop */ }
          }
        })
      })
      const wss = new WebSocketServer({ noServer: true })
      server.on('upgrade', (req, socket, head) => {
        const route = parseRoute(req)
        if (!route || route.path !== '/pty' || !this.checkAuth(req)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          this.handlePtySocket(ws)
        })
      })
      server.once('error', reject)
      server.listen(preferredPort, this.host, () => {
        const address = server.address() as AddressInfo | null
        if (!address) {
          reject(new Error('Failed to bind Web UI server'))
          return
        }
        this.server = server
        this.wss = wss
        this.port = address.port
        resolveInit()
      })
    })

    this.removeDataObserver = ptyManager.addSessionDataObserver((event) => {
      this.broadcast('session:data', event)
    })
    this.removeExitObserver = ptyManager.addSessionExitObserver((event) => {
      this.broadcast('session:exit', event)
    })
    this.removeConfigObserver = addConfigObserver((event) => {
      this.broadcast('config:changed', event)
    })

    console.log(`[web-ui] listening on http://${this.host}:${this.port}`)
    console.log(`[web-ui] local login: ${this.getLocalClaimUrl()}`)
    if (this.host === '0.0.0.0') {
      console.warn('[web-ui] LAN access is enabled. Use a trusted network or an SSH tunnel.')
    }
  }

  dispose(): void {
    this.removeDataObserver?.()
    this.removeDataObserver = null
    this.removeExitObserver?.()
    this.removeExitObserver = null
    this.removeConfigObserver?.()
    this.removeConfigObserver = null
    for (const client of this.eventClients) {
      try { client.end() } catch { /* noop */ }
    }
    this.eventClients.clear()
    this.wss?.close()
    this.wss = null
    this.server?.close()
    this.server = null
    this.port = null
    this.token = null
  }

  getPort(): number | null {
    return this.port
  }

  getHost(): string | null {
    return this.server ? this.host : null
  }

  getToken(): string | null {
    return this.token
  }

  getLocalClaimUrl(): string | null {
    if (!this.port || !this.token) return null
    return `http://127.0.0.1:${this.port}/auth/claim?token=${this.token}`
  }

  getLanClaimUrls(): string[] {
    if (!this.port || !this.token) return []
    const hosts = new Set<string>()
    if (this.host === '0.0.0.0' || this.host === '::') {
      for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses ?? []) {
          if (address.internal || address.family !== 'IPv4') continue
          hosts.add(address.address)
        }
      }
    } else if (!['127.0.0.1', 'localhost', '::1'].includes(this.host)) {
      hosts.add(this.host)
    }
    return [...hosts].map((host) => `http://${formatUrlHost(host)}:${this.port}/auth/claim?token=${this.token}`)
  }

  private checkAuth(req: IncomingMessage): boolean {
    if (!this.token) return false
    const cookies = parseCookies(req)
    if (cookies[SESSION_COOKIE] === this.token) return true
    const header = req.headers.authorization
    return typeof header === 'string' && header === `Bearer ${this.token}`
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const route = parseRoute(req)
    if (!route) {
      errorResponse(res, 400, 'Bad request')
      return
    }

    if (route.method === 'GET' && route.path === '/health') {
      jsonResponse(res, 200, { ok: true, port: this.port })
      return
    }

    if (route.method === 'GET' && route.path === '/auth/claim') {
      this.handleAuthClaim(route, res)
      return
    }

    if (!this.checkAuth(req)) {
      if (route.path.startsWith('/api/') || route.path === '/events') {
        errorResponse(res, 401, 'Unauthorized')
      } else {
        textResponse(
          res,
          401,
          '<!doctype html><meta charset="utf-8"><title>FastAgents Web UI</title><body style="font-family:sans-serif;padding:24px">Unauthorized. Open the Web UI claim URL shown in the FastAgents host log.</body>',
          'text/html; charset=utf-8',
        )
      }
      return
    }

    if (route.method === 'GET' && route.path === '/events') {
      this.handleEvents(req, res)
      return
    }

    if (route.path.startsWith('/api/')) {
      await this.handleApi(route, req, res)
      return
    }

    await this.serveStatic(route, res)
  }

  private handleAuthClaim(route: Route, res: ServerResponse): void {
    const token = route.query.get('token')
    if (!this.token || token !== this.token) {
      textResponse(res, 403, 'Invalid Web UI token')
      return
    }
    res.statusCode = 302
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(this.token)}; HttpOnly; SameSite=Lax; Path=/`)
    res.setHeader('Location', '/')
    res.end()
  }

  private handleEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(encodeSse('ready', { ok: true, ts: Date.now() }))
    this.eventClients.add(res)
    const keepAlive = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(': keepalive\n\n')
    }, 20_000)
    req.on('close', () => {
      clearInterval(keepAlive)
      this.eventClients.delete(res)
    })
  }

  private broadcast(eventName: string, payload: unknown): void {
    const message = encodeSse(eventName, payload)
    for (const client of [...this.eventClients]) {
      if (client.writableEnded || client.destroyed) {
        this.eventClients.delete(client)
        continue
      }
      client.write(message)
    }
  }

  private handlePtySocket(ws: WebSocket): void {
    ws.on('message', (raw: RawData) => {
      try {
        const message = JSON.parse(raw.toString()) as {
          type?: string
          ptyId?: string
          data?: string
          input?: string
          submit?: boolean
          cols?: number
          rows?: number
        }
        if (!message.ptyId) return
        if (message.type === 'input' && typeof message.data === 'string') {
          ptyManager.write(message.ptyId, message.data)
        } else if (message.type === 'submit' && typeof message.input === 'string') {
          ptyManager.submitInput(message.ptyId, message.input, { submit: message.submit !== false })
        } else if (message.type === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') {
          ptyManager.resize(message.ptyId, message.cols, message.rows)
        }
      } catch {
        // Ignore malformed WebSocket messages.
      }
    })
  }

  private async handleApi(route: Route, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (route.method === 'GET' && route.path === '/api/web/info') {
      jsonResponse(res, 200, {
        platform: process.platform,
        version: app.getVersion(),
        webPort: this.port,
        host: this.host,
      })
      return
    }

    if (route.method === 'GET' && route.path === '/api/config') {
      jsonResponse(res, 200, readConfig())
      return
    }

    if (route.method === 'POST' && route.path === '/api/config') {
      const body = await readJsonBody<{ key?: unknown; value?: unknown }>(req)
      if (typeof body.key !== 'string' || !isValidConfigKey(body.key)) {
        errorResponse(res, 400, 'Invalid config key')
        return
      }
      writeConfig(body.key, body.value)
      jsonResponse(res, 200, { ok: true })
      return
    }

    if (route.path.startsWith('/api/session/')) {
      await this.handleSessionApi(route, req, res)
      return
    }

    if (route.path.startsWith('/api/fs/')) {
      await this.handleFsApi(route, req, res)
      return
    }

    if (route.path.startsWith('/api/git/')) {
      await this.handleGitApi(route, req, res)
      return
    }

    if (route.path.startsWith('/api/search/')) {
      await this.handleSearchApi(route, req, res)
      return
    }

    if (route.path.startsWith('/api/shell/')) {
      await this.handleShellApi(route, req, res)
      return
    }

    errorResponse(res, 404, 'API not found')
  }

  private async handleSessionApi(route: Route, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (route.method === 'POST' && route.path === '/api/session/create') {
      const options = await readJsonBody<SessionCreateOptions>(req)
      jsonResponse(res, 200, ptyManager.create(options))
      return
    }
    if (route.method === 'POST' && route.path === '/api/session/write') {
      const body = await readJsonBody<{ ptyId?: unknown; data?: unknown }>(req)
      if (typeof body.ptyId !== 'string' || typeof body.data !== 'string') {
        errorResponse(res, 400, '`ptyId` and `data` are required')
        return
      }
      ptyManager.write(body.ptyId, body.data)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/session/submit') {
      const body = await readJsonBody<{ ptyId?: unknown } & SessionSubmitOptions>(req)
      if (typeof body.ptyId !== 'string' || typeof body.input !== 'string') {
        errorResponse(res, 400, '`ptyId` and `input` are required')
        return
      }
      jsonResponse(res, 200, { ok: ptyManager.submitInput(body.ptyId, body.input, { submit: body.submit !== false }) })
      return
    }
    if (route.method === 'POST' && route.path === '/api/session/resize') {
      const body = await readJsonBody<{ ptyId?: unknown; cols?: unknown; rows?: unknown }>(req)
      if (typeof body.ptyId !== 'string' || typeof body.cols !== 'number' || typeof body.rows !== 'number') {
        errorResponse(res, 400, '`ptyId`, `cols`, and `rows` are required')
        return
      }
      ptyManager.resize(body.ptyId, body.cols, body.rows)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/session/kill') {
      const body = await readJsonBody<{ ptyId?: unknown }>(req)
      if (typeof body.ptyId !== 'string') {
        errorResponse(res, 400, '`ptyId` is required')
        return
      }
      activityMonitor.stopMonitoring(body.ptyId)
      ptyManager.kill(body.ptyId)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'GET' && route.path === '/api/session/replay') {
      const ptyId = route.query.get('ptyId')
      if (!ptyId) {
        errorResponse(res, 400, '`ptyId` is required')
        return
      }
      jsonResponse(res, 200, await ptyManager.getReplay(ptyId))
      return
    }
    if (route.method === 'GET' && route.path === '/api/session/activity') {
      const ptyId = route.query.get('ptyId')
      if (!ptyId) {
        errorResponse(res, 400, '`ptyId` is required')
        return
      }
      jsonResponse(res, 200, await activityMonitor.isActive(ptyId))
      return
    }
    if (route.method === 'GET' && route.path === '/api/session/managed') {
      const sessionId = route.query.get('sessionId')
      if (!sessionId) {
        errorResponse(res, 400, '`sessionId` is required')
        return
      }
      jsonResponse(res, 200, ptyManager.getManagedSession(sessionId))
      return
    }
    if (route.method === 'POST' && route.path === '/api/session/graceful-shutdown') {
      const result: Record<string, string> = {}
      const uuids = await ptyManager.gracefulShutdownClaudeSessions()
      for (const [ptyId, uuid] of uuids) result[ptyId] = uuid
      jsonResponse(res, 200, result)
      return
    }
    errorResponse(res, 404, 'Session API not found')
  }

  private async handleFsApi(route: Route, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (route.method === 'POST' && route.path === '/api/fs/read-dir') {
      const { path } = await readJsonBody<{ path?: unknown }>(req)
      if (typeof path !== 'string') {
        errorResponse(res, 400, '`path` is required')
        return
      }
      const entries = await readdir(path).catch(() => [])
      const results: Array<{ name: string; isDir: boolean }> = []
      for (const name of entries) {
        try {
          const item = await stat(join(path, name))
          results.push({ name, isDir: item.isDirectory() })
        } catch {
          // skip inaccessible entries
        }
      }
      jsonResponse(res, 200, results)
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/stat') {
      const { path } = await readJsonBody<{ path?: unknown }>(req)
      if (typeof path !== 'string') {
        errorResponse(res, 400, '`path` is required')
        return
      }
      try {
        const item = await stat(path)
        jsonResponse(res, 200, { exists: true, isDir: item.isDirectory(), isFile: item.isFile() })
      } catch {
        jsonResponse(res, 200, { exists: false, isDir: false, isFile: false })
      }
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/read-file') {
      const { path } = await readJsonBody<{ path?: unknown }>(req)
      if (typeof path !== 'string') {
        errorResponse(res, 400, '`path` is required')
        return
      }
      jsonResponse(res, 200, await readFile(path, 'utf-8'))
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/write-file') {
      const { path, content } = await readJsonBody<{ path?: unknown; content?: unknown }>(req)
      if (typeof path !== 'string' || typeof content !== 'string') {
        errorResponse(res, 400, '`path` and `content` are required')
        return
      }
      await writeFile(path, content, 'utf-8')
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/create-file') {
      const { path } = await readJsonBody<{ path?: unknown }>(req)
      if (typeof path !== 'string') {
        errorResponse(res, 400, '`path` is required')
        return
      }
      await writeFile(path, '', { encoding: 'utf-8', flag: 'wx' })
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/create-dir') {
      const { path } = await readJsonBody<{ path?: unknown }>(req)
      if (typeof path !== 'string') {
        errorResponse(res, 400, '`path` is required')
        return
      }
      await mkdir(path)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/move') {
      const { sourcePath, targetPath } = await readJsonBody<{ sourcePath?: unknown; targetPath?: unknown }>(req)
      if (typeof sourcePath !== 'string' || typeof targetPath !== 'string') {
        errorResponse(res, 400, '`sourcePath` and `targetPath` are required')
        return
      }
      await rename(sourcePath, targetPath)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/delete') {
      const { path } = await readJsonBody<{ path?: unknown }>(req)
      if (typeof path !== 'string') {
        errorResponse(res, 400, '`path` is required')
        return
      }
      await rm(path, { recursive: true, force: true })
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/write-temp-file') {
      const { suggestedName, content, extension } = await readJsonBody<{ suggestedName?: unknown; content?: unknown; extension?: unknown }>(req)
      const safeName = typeof suggestedName === 'string' && suggestedName.trim() ? basename(suggestedName) : 'fastagents'
      const ext = typeof extension === 'string' && extension.trim() ? extension.replace(/^\./, '') : 'txt'
      const target = join(tmpdir(), `${safeName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${randomUUID()}.${ext}`)
      await writeFile(target, typeof content === 'string' ? content : '', 'utf-8')
      jsonResponse(res, 200, target)
      return
    }
    if (route.method === 'POST' && route.path === '/api/fs/write-temp-data-url') {
      const { suggestedName, dataUrl, extension } = await readJsonBody<{ suggestedName?: unknown; dataUrl?: unknown; extension?: unknown }>(req)
      if (typeof dataUrl !== 'string') {
        errorResponse(res, 400, '`dataUrl` is required')
        return
      }
      const comma = dataUrl.indexOf(',')
      const raw = comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
      const safeName = typeof suggestedName === 'string' && suggestedName.trim() ? basename(suggestedName) : 'fastagents'
      const ext = typeof extension === 'string' && extension.trim() ? extension.replace(/^\./, '') : 'png'
      const target = join(tmpdir(), `${safeName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${randomUUID()}.${ext}`)
      await writeFile(target, Buffer.from(raw, 'base64'))
      jsonResponse(res, 200, target)
      return
    }
    errorResponse(res, 404, 'File API not found')
  }

  private async handleGitApi(route: Route, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = route.method === 'POST' ? await readJsonBody<Record<string, unknown>>(req) : {}
    const cwd = typeof body.cwd === 'string' ? body.cwd : typeof body.path === 'string' ? body.path : ''

    if (route.method === 'POST' && route.path === '/api/git/status') {
      jsonResponse(res, 200, await gitService.getStatus(cwd))
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/init') {
      await gitService.initRepo(cwd)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/create-branch') {
      if (typeof body.name !== 'string') {
        errorResponse(res, 400, '`name` is required')
        return
      }
      await gitService.createBranch(cwd, body.name)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/checkout-branch') {
      if (typeof body.name !== 'string') {
        errorResponse(res, 400, '`name` is required')
        return
      }
      await gitService.checkoutBranch(cwd, body.name)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/worktree-list') {
      jsonResponse(res, 200, await gitService.listWorktrees(cwd))
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/worktree-add') {
      if (typeof body.targetPath !== 'string' || typeof body.branch !== 'string') {
        errorResponse(res, 400, '`targetPath` and `branch` are required')
        return
      }
      await gitService.addWorktree(cwd, body.targetPath, body.branch)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/worktree-remove') {
      if (typeof body.targetPath !== 'string') {
        errorResponse(res, 400, '`targetPath` is required')
        return
      }
      await gitService.removeWorktree(cwd, body.targetPath)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/file-status') {
      const output = await execGit(cwd, ['status', '--porcelain', '-u']).catch(() => '')
      const results: Array<{ path: string; status: string; staged: boolean }> = []
      for (const line of output.split(/\r?\n/).filter((entry) => entry.length > 0)) {
        const x = line[0]
        const y = line[1]
        const filePath = line.slice(3)
        if (x !== ' ' && x !== '?') results.push({ path: filePath, status: x, staged: true })
        if (y !== ' ' && x !== '?') results.push({ path: filePath, status: y, staged: false })
        if (x === '?') results.push({ path: filePath, status: '?', staged: false })
      }
      jsonResponse(res, 200, results)
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/diff') {
      if (typeof body.filePath !== 'string') {
        errorResponse(res, 400, '`filePath` is required')
        return
      }
      const diff = await execGit(cwd, ['diff', '--', body.filePath]).catch(() => '')
      jsonResponse(res, 200, diff.trim() ? diff : await execGit(cwd, ['diff', '--cached', '--', body.filePath]).catch(() => ''))
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/review-diff') {
      const diff = await execGit(cwd, ['diff', '--cached', '--no-ext-diff', '--unified=80']).catch(() => '')
      const worktreeDiff = await execGit(cwd, ['diff', '--no-ext-diff', '--unified=80']).catch(() => '')
      const status = await execGit(cwd, ['status', '--porcelain', '-u']).catch(() => '')
      jsonResponse(res, 200, [
        `## Git status\n\`\`\`\n${status.trim() || 'clean'}\n\`\`\``,
        diff.trim() ? `## Staged diff\n\`\`\`diff\n${diff.trim()}\n\`\`\`` : '',
        worktreeDiff.trim() ? `## Worktree diff\n\`\`\`diff\n${worktreeDiff.trim()}\n\`\`\`` : '',
      ].filter(Boolean).join('\n\n'))
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/stage') {
      if (typeof body.filePath !== 'string') {
        errorResponse(res, 400, '`filePath` is required')
        return
      }
      await execGit(cwd, ['add', '--', body.filePath])
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/unstage') {
      if (typeof body.filePath !== 'string') {
        errorResponse(res, 400, '`filePath` is required')
        return
      }
      await execGit(cwd, ['restore', '--staged', '--', body.filePath]).catch(() => execGit(cwd, ['rm', '--cached', '--', body.filePath]))
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/discard') {
      if (typeof body.filePath !== 'string') {
        errorResponse(res, 400, '`filePath` is required')
        return
      }
      await execGit(cwd, ['checkout', '--', body.filePath])
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/commit') {
      if (typeof body.message !== 'string') {
        errorResponse(res, 400, '`message` is required')
        return
      }
      await execGit(cwd, ['commit', '-m', body.message])
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/git/show-head') {
      if (typeof body.filePath !== 'string') {
        errorResponse(res, 400, '`filePath` is required')
        return
      }
      jsonResponse(res, 200, await execGit(cwd, ['show', `HEAD:${body.filePath}`]).catch(() => ''))
      return
    }
    errorResponse(res, 404, 'Git API not found')
  }

  private async handleSearchApi(route: Route, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody<{ rootPath?: unknown; query?: unknown; options?: unknown }>(req)
    if (typeof body.rootPath !== 'string' || typeof body.query !== 'string') {
      errorResponse(res, 400, '`rootPath` and `query` are required')
      return
    }
    if (route.method === 'POST' && route.path === '/api/search/find-files') {
      jsonResponse(res, 200, await findFiles(body.rootPath, body.query, body.options))
      return
    }
    if (route.method === 'POST' && route.path === '/api/search/find-in-files') {
      jsonResponse(res, 200, await findInFiles(body.rootPath, body.query, body.options))
      return
    }
    errorResponse(res, 404, 'Search API not found')
  }

  private async handleShellApi(route: Route, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (route.method === 'GET' && route.path === '/api/shell/list-ides') {
      jsonResponse(res, 200, [])
      return
    }
    if (route.method === 'POST' && route.path === '/api/shell/open-path') {
      const { path } = await readJsonBody<{ path?: unknown }>(req)
      if (typeof path === 'string') void shell.openPath(path)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/shell/open-external') {
      const { url } = await readJsonBody<{ url?: unknown }>(req)
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
      jsonResponse(res, 200, { ok: true })
      return
    }
    if (route.method === 'POST' && route.path === '/api/shell/resolve-terminal-shell') {
      const { mode } = await readJsonBody<{ mode?: unknown }>(req)
      try {
        const shellInfo = detectShell({ mode: typeof mode === 'string' ? mode as never : 'auto' })
        jsonResponse(res, 200, { available: true, shell: shellInfo.shell })
      } catch (err) {
        jsonResponse(res, 200, { available: false, shell: null, reason: err instanceof Error ? err.message : String(err) })
      }
      return
    }
    errorResponse(res, 404, 'Shell API not found')
  }

  private async serveStatic(route: Route, res: ServerResponse): Promise<void> {
    const root = resolveRendererRoot()
    let target = safeStaticPath(root, route.path)
    if (!target) {
      textResponse(res, 403, 'Forbidden')
      return
    }
    if (!existsSync(target)) {
      target = join(root, 'index.html')
    }
    if (!existsSync(target)) {
      textResponse(res, 503, 'FastAgents Web UI bundle not found. Run `pnpm build` first.')
      return
    }

    const ext = extname(target).toLowerCase()
    res.statusCode = 200
    res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
    createReadStream(target).pipe(res)
  }
}

export const webUiService = new WebUiService()
