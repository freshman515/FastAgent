import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { WebContents } from 'electron'

interface OpencodeRequest {
  directory: string
  model?: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
}

interface OpencodeSubscriptionRequest {
  directory: string
  model?: string
}

interface RunningInstance {
  key: string
  directory: string
  url: string
  proc: ChildProcessWithoutNullStreams
}

interface LiveSubscription {
  id: string
  sender: WebContents
  controller: AbortController
}

function normalizeDirectory(directory: string): string {
  const normalized = directory.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配 OpenCode 端口'))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

function takeSseBlock(buffer: string): { block: string | null; rest: string } {
  const match = buffer.match(/\r?\n\r?\n/)
  if (!match || match.index === undefined) return { block: null, rest: buffer }
  return {
    block: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  }
}

function parseSseBlock(block: string): unknown | null {
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null

  const payload = dataLines.join('\n')
  if (!payload) return null

  try {
    return JSON.parse(payload)
  } catch {
    return { type: 'raw', payload }
  }
}

function resolveNodeExecutable(): string {
  const candidates = [
    process.env.NVM_SYMLINK ? join(process.env.NVM_SYMLINK, 'node.exe') : null,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node.exe') : null,
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return process.platform === 'win32' ? 'node.exe' : 'node'
}

function getOpencodeSpawnTarget(args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') {
    return { command: 'opencode', args }
  }

  const appData = process.env.APPDATA
  const localCmd = appData ? join(appData, 'npm', 'opencode.cmd') : null
  const localScript = appData ? join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode') : null

  if (localScript && existsSync(localScript)) {
    return {
      command: resolveNodeExecutable(),
      args: [localScript, ...args],
    }
  }

  if (localCmd && existsSync(localCmd)) {
    const cmd = process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
    return {
      command: cmd,
      args: ['/d', '/c', localCmd, ...args],
    }
  }

  return { command: 'opencode', args }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function parseModelList(output: string): string[] {
  const models = new Set<string>()
  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('Performing one time') || line.startsWith('Database migration')) continue
    const match = line.match(/[A-Za-z0-9_.-]+\/[^\s]+/)
    if (match) models.add(match[0])
  }
  return [...models].sort((a, b) => a.localeCompare(b))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function collectProviderModels(payload: unknown): string[] {
  const providers = isRecord(payload) && Array.isArray(payload.providers)
    ? payload.providers
    : isRecord(payload) && Array.isArray(payload.all)
      ? payload.all
      : []
  const models = new Set<string>()

  for (const provider of providers) {
    if (!isRecord(provider) || typeof provider.id !== 'string') continue
    const providerId = provider.id
    const providerModels = provider.models
    if (Array.isArray(providerModels)) {
      for (const model of providerModels) {
        if (!isRecord(model) || typeof model.id !== 'string') continue
        models.add(`${providerId}/${model.id}`)
      }
      continue
    }

    if (!isRecord(providerModels)) continue
    for (const [modelKey, model] of Object.entries(providerModels)) {
      const modelId = isRecord(model) && typeof model.id === 'string' ? model.id : modelKey
      if (modelId) models.add(`${providerId}/${modelId}`)
    }
  }

  return [...models].sort((a, b) => a.localeCompare(b))
}

class OpencodeService {
  private instances = new Map<string, RunningInstance>()
  private subscriptions = new Map<string, LiveSubscription>()
  private pendingEnsures = new Map<string, Promise<RunningInstance>>()

  private async startInstance(directory: string): Promise<RunningInstance> {
    const key = normalizeDirectory(directory)
    const port = await getFreePort()

    const launchArgs = ['serve', '--hostname=127.0.0.1', `--port=${port}`, '--log-level=ERROR']
    const launch = getOpencodeSpawnTarget(launchArgs)
    const proc = spawn(launch.command, launch.args, {
      cwd: directory,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OpenCode 服务启动超时'))
      }, 8000)

      let output = ''

      const finish = (fn: () => void): void => {
        clearTimeout(timeout)
        proc.stdout.removeAllListeners('data')
        proc.stderr.removeAllListeners('data')
        proc.removeAllListeners('error')
        proc.removeAllListeners('exit')
        fn()
      }

      proc.stdout.on('data', (chunk) => {
        output += chunk.toString()
        const lines = output.split(/\r?\n/)
        for (const line of lines) {
          if (!line.startsWith('opencode server listening')) continue
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (!match) {
            finish(() => reject(new Error(`无法解析 OpenCode 服务地址: ${line}`)))
            return
          }
          finish(() => resolve(match[1]))
          return
        }
      })

      proc.stderr.on('data', (chunk) => {
        output += chunk.toString()
      })

      proc.once('error', (error) => {
        finish(() => reject(error))
      })

      proc.once('exit', (code) => {
        finish(() => reject(new Error(output.trim() || `OpenCode 服务异常退出，code=${code ?? 'unknown'}`)))
      })
    })

    const instance: RunningInstance = { key, directory, url, proc }
    proc.once('exit', () => {
      const current = this.instances.get(key)
      if (current?.proc === proc) this.instances.delete(key)
    })
    this.instances.set(key, instance)
    return instance
  }

  async ensure(directory: string): Promise<RunningInstance> {
    const key = normalizeDirectory(directory)
    const existing = this.instances.get(key)
    if (existing && !existing.proc.killed) {
      return existing
    }

    const pending = this.pendingEnsures.get(key)
    if (pending) {
      return await pending
    }

    if (existing) this.disposeInstance(existing.key)

    const startPromise = this.startInstance(directory)
    this.pendingEnsures.set(key, startPromise)

    try {
      return await startPromise
    } finally {
      if (this.pendingEnsures.get(key) === startPromise) {
        this.pendingEnsures.delete(key)
      }
    }
  }

  async request<T = unknown>(payload: OpencodeRequest): Promise<T | null> {
    const instance = await this.ensure(payload.directory)
    const url = new URL(payload.path, instance.url)
    const query = { ...payload.query, directory: payload.directory }
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }

    const response = await fetch(url, {
      method: payload.method,
      headers: payload.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload.body === undefined ? undefined : JSON.stringify(payload.body),
    })

    if (response.status === 204) return null

    const rawText = await response.text()
    if (!response.ok) {
      throw new Error(rawText || `OpenCode 请求失败: ${response.status}`)
    }
    if (!rawText) return null

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return rawText as T
    }
    return JSON.parse(rawText) as T
  }

  async subscribe(sender: WebContents, payload: OpencodeSubscriptionRequest): Promise<string> {
    const instance = await this.ensure(payload.directory)
    const controller = new AbortController()
    const id = randomUUID()
    this.subscriptions.set(id, { id, sender, controller })

    sender.once('destroyed', () => this.unsubscribe(id))

    void (async () => {
      try {
        const url = new URL('/event', instance.url)
        url.searchParams.set('directory', payload.directory)
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          throw new Error(`OpenCode 事件流连接失败: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          while (true) {
            const next = takeSseBlock(buffer)
            if (!next.block) break
            buffer = next.rest
            const event = parseSseBlock(next.block)
            if (!event || sender.isDestroyed()) continue
            sender.send('opencode:event', { subscriptionId: id, type: 'event', event })
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && !sender.isDestroyed()) {
          sender.send('opencode:event', {
            subscriptionId: id,
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        this.subscriptions.delete(id)
      }
    })()

    return id
  }

  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return
    this.subscriptions.delete(subscriptionId)
    subscription.controller.abort()
  }

  async listModels(directory: string): Promise<string[]> {
    try {
      const instance = await this.ensure(directory)
      const response = await fetch(new URL('/config/providers', instance.url))
      if (response.ok) {
        const models = collectProviderModels(await response.json())
        if (models.length > 0) return models
      }
    } catch {
      // The model picker is optional. Fall back to the CLI/cache path below.
    }

    const launch = getOpencodeSpawnTarget(['models'])

    return await new Promise<string[]>((resolve, reject) => {
      const proc = spawn(launch.command, launch.args, {
        cwd: directory,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      })
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error('读取 OpenCode 模型列表超时'))
      }, 10000)

      proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      proc.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      proc.once('exit', (code) => {
        clearTimeout(timeout)
        if (code !== 0) {
          resolve([])
          return
        }
        resolve(parseModelList(stdout))
      })
    })
  }

  disposeInstance(key: string): void {
    const instance = this.instances.get(key)
    if (!instance) return
    this.instances.delete(key)
    if (!instance.proc.killed) instance.proc.kill()
  }

  disposeAll(): void {
    for (const subscriptionId of this.subscriptions.keys()) {
      this.unsubscribe(subscriptionId)
    }
    for (const key of this.instances.keys()) {
      this.disposeInstance(key)
    }
  }
}

export const opencodeService = new OpencodeService()
export type { OpencodeRequest, OpencodeSubscriptionRequest }
