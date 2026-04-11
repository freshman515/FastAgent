// HookInstaller — Register/unregister FastAgents hooks in ~/.claude/settings.json
// Registers: Stop (command hook), PermissionRequest (HTTP hook)

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const HOOK_SCRIPT_NAME = 'fastagents-hook.cjs'
const HOOK_MARKER = 'fastagents-hook'
const PERM_MARKER = 'fast-agents' // marker in permission URL

function getClaudeDir(): string {
  return join(homedir(), '.claude')
}

function getSettingsPath(): string {
  return join(getClaudeDir(), 'settings.json')
}

function getHooksDir(): string {
  return join(getClaudeDir(), 'hooks')
}

function getScriptPath(): string {
  return join(getHooksDir(), HOOK_SCRIPT_NAME)
}

/** Generate the hook script content — for command hooks (Stop, etc.) */
function generateScript(port: number): string {
  return `// FastAgents Hook — sends Claude Code events to FastAgents
// Auto-generated — do not edit manually
const http = require('http');

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  data.fa_session_id = process.env.FASTAGENTS_SESSION_ID || null;
  const postData = JSON.stringify(data);
  const req = http.request({
    hostname: '127.0.0.1',
    port: ${port},
    path: '/agent-hook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 2000,
  });
  req.on('error', () => {});
  req.on('timeout', () => { req.destroy(); });
  req.write(postData);
  req.end();
}

main().catch(() => process.exit(0));
`
}

interface HookEntry {
  matcher?: string
  type?: string
  url?: string
  timeout?: number
  hooks?: Array<{ type: string; command?: string; url?: string; timeout?: number }>
}

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(getSettingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  const dir = dirname(getSettingsPath())
  mkdirSync(dir, { recursive: true })
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

function hasCommandHook(entries: HookEntry[]): boolean {
  return entries.some((e) =>
    e.hooks?.some((h) => h.type === 'command' && h.command?.includes(HOOK_MARKER)),
  )
}

function hasHttpHook(entries: HookEntry[], marker: string): boolean {
  return entries.some((e) => {
    if (e.type === 'http' && e.url?.includes(marker)) return true
    return e.hooks?.some((h) => h.type === 'http' && h.url?.includes(marker))
  })
}

function addCommandHook(settings: Record<string, unknown>, event: string, command: string): void {
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>
  settings.hooks = hooks

  if (!Array.isArray(hooks[event])) hooks[event] = []

  if (hasCommandHook(hooks[event])) {
    for (const entry of hooks[event]) {
      if (entry.hooks) {
        for (const h of entry.hooks) {
          if (h.type === 'command' && h.command?.includes(HOOK_MARKER)) h.command = command
        }
      }
    }
    return
  }

  hooks[event].push({ matcher: '', hooks: [{ type: 'command', command, timeout: 5 }] })
}

function addHttpHook(settings: Record<string, unknown>, event: string, url: string): void {
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>
  settings.hooks = hooks

  if (!Array.isArray(hooks[event])) hooks[event] = []

  if (hasHttpHook(hooks[event], PERM_MARKER)) {
    // Update URL if port changed
    for (const entry of hooks[event]) {
      if (entry.type === 'http' && entry.url?.includes(PERM_MARKER)) entry.url = url
      if (entry.hooks) {
        for (const h of entry.hooks) {
          if (h.type === 'http' && h.url?.includes(PERM_MARKER)) h.url = url
        }
      }
    }
    return
  }

  hooks[event].push({ matcher: '', hooks: [{ type: 'http', url, timeout: 600 }] })
}

/** Register hooks in settings.json and write hook script */
export function registerHooks(port: number): void {
  if (!existsSync(getClaudeDir())) {
    console.log('[HookInstaller] Claude not installed, skipping')
    return
  }

  // Write hook script for command hooks
  const hooksDir = getHooksDir()
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(getScriptPath(), generateScript(port), { mode: 0o755 })

  const settings = readSettings()
  const scriptPath = getScriptPath().replace(/\\/g, '/')
  const command = `node "${scriptPath}"`

  // Stop: command hook (non-blocking)
  addCommandHook(settings, 'Stop', command)

  // Notification: status-line hook (non-blocking — captures model, context, cost)
  // Include port in a query param so the PERM_MARKER match works for cleanup
  const statusUrl = `http://127.0.0.1:${port}/status-line?src=fast-agents`
  addHttpHook(settings, 'Notification', statusUrl)

  // PermissionRequest: HTTP hook (blocking — Claude Code waits for our response)
  const permUrl = `http://127.0.0.1:${port}/permission`
  addHttpHook(settings, 'PermissionRequest', permUrl)

  writeSettings(settings)
  console.log(`[HookInstaller] registered hooks → port ${port}`)
}

/** Remove our hooks from settings.json and delete script */
export function unregisterHooks(): void {
  try {
    if (!existsSync(getSettingsPath())) return

    const settings = readSettings()
    const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>

    // Remove command hooks
    for (const event of ['Stop']) {
      if (!Array.isArray(hooks[event])) continue
      hooks[event] = hooks[event].filter(
        (e) => !e.hooks?.some((h) => h.type === 'command' && h.command?.includes(HOOK_MARKER)),
      )
      if (hooks[event].length === 0) delete hooks[event]
    }

    // Remove HTTP hooks
    for (const event of ['PermissionRequest', 'Notification']) {
      if (!Array.isArray(hooks[event])) continue
      hooks[event] = hooks[event].filter((e) => {
        if (e.type === 'http' && e.url?.includes(PERM_MARKER)) return false
        if (e.hooks) {
          e.hooks = e.hooks.filter((h) => !(h.type === 'http' && h.url?.includes(PERM_MARKER)))
          if (e.hooks.length === 0) return false
        }
        return true
      })
      if (hooks[event].length === 0) delete hooks[event]
    }

    settings.hooks = hooks
    writeSettings(settings)

    const scriptPath = getScriptPath()
    if (existsSync(scriptPath)) unlinkSync(scriptPath)

    console.log('[HookInstaller] unregistered hooks')
  } catch (err) {
    console.error('[HookInstaller] cleanup error:', err)
  }
}
