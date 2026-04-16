// HookInstaller — Register FastAgents hooks for Claude Code and Codex.
// Claude: Stop (command hook), Notification/PermissionRequest (HTTP hooks)
// Codex: Stop (command hook)

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const CLAUDE_HOOK_SCRIPT_NAME = 'fastagents-hook.cjs'
const CLAUDE_HOOK_MARKER = 'fastagents-hook'
const CODEX_HOOK_SCRIPT_NAME = 'fastagents-codex-hook.cjs'
const CODEX_HOOK_MARKER = 'fastagents-codex-hook'
const PERM_MARKER = 'fast-agents' // marker in permission URL
const DEFAULT_HOOK_PORT = 24680
const HOOK_PORT_RANGE = 5

function getClaudeDir(): string {
  return join(homedir(), '.claude')
}

function getSettingsPath(): string {
  return join(getClaudeDir(), 'settings.json')
}

function getHooksDir(): string {
  return join(getClaudeDir(), 'hooks')
}

function getClaudeScriptPath(): string {
  return join(getHooksDir(), CLAUDE_HOOK_SCRIPT_NAME)
}

function getCodexDir(): string {
  return join(homedir(), '.codex')
}

function getCodexConfigPath(): string {
  return join(getCodexDir(), 'config.toml')
}

function getCodexHooksJsonPath(): string {
  return join(getCodexDir(), 'hooks.json')
}

function getCodexHooksDir(): string {
  return join(getCodexDir(), 'hooks')
}

function getCodexScriptPath(): string {
  return join(getCodexHooksDir(), CODEX_HOOK_SCRIPT_NAME)
}

/** Generate the hook script content — for command hooks (Stop, etc.) */
function generateClaudeScript(port: number): string {
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
  data.fastagents_session_type = process.env.FASTAGENTS_SESSION_TYPE || null;
  data.fastagents_hook_source = 'claude';
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

function buildPortList(activePort: number): number[] {
  return Array.from(new Set([
    activePort,
    ...Array.from({ length: HOOK_PORT_RANGE }, (_, i) => DEFAULT_HOOK_PORT + i),
  ]))
}

/** Generate the Codex Stop hook script. It no-ops when FastAgents is not running. */
function generateCodexScript(port: number): string {
  return `// FastAgents Codex Hook — sends Codex Stop events to FastAgents
// Auto-generated — do not edit manually
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORTS = ${JSON.stringify(buildPortList(port))};
const LOG_PATH = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.codex', 'hooks', 'fastagents-codex-hook.log');

function log(entry) {
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\\n');
  } catch {}
}

function postToPort(port, postData) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/agent-hook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 300,
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(postData);
    req.end();
  });
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = input.trim() ? JSON.parse(input) : {};
  } catch {
    data = {};
  }

  data.hook_event_name = data.hook_event_name || 'Stop';
  data.fa_session_id = process.env.FASTAGENTS_SESSION_ID || data.fa_session_id || null;
  data.fastagents_session_type = process.env.FASTAGENTS_SESSION_TYPE || data.fastagents_session_type || 'codex';
  data.fastagents_hook_source = 'codex';

  const postData = JSON.stringify(data);
  let delivered = false;
  let deliveredPort = null;
  for (const port of PORTS) {
    if (await postToPort(port, postData)) {
      delivered = true;
      deliveredPort = port;
      break;
    }
  }
  log({
    event: data.hook_event_name,
    cwd: data.cwd || null,
    fa_session_id: data.fa_session_id,
    fastagents_session_type: data.fastagents_session_type,
    delivered,
    delivered_port: deliveredPort,
  });
}

main().catch(() => process.exit(0));
`
}

interface HookHandler {
  type: string
  command?: string
  url?: string
  timeout?: number
  statusMessage?: string
}

interface HookEntry {
  matcher?: string
  type?: string
  url?: string
  timeout?: number
  hooks?: HookHandler[]
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function writeJsonObject(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

function readSettings(): Record<string, unknown> {
  return readJsonObject(getSettingsPath())
}

function writeSettings(settings: Record<string, unknown>): void {
  writeJsonObject(getSettingsPath(), settings)
}

function hasCommandHook(entries: HookEntry[], marker: string): boolean {
  return entries.some((e) =>
    e.hooks?.some((h) => h.type === 'command' && h.command?.includes(marker)),
  )
}

function hasHttpHook(entries: HookEntry[], marker: string): boolean {
  return entries.some((e) => {
    if (e.type === 'http' && e.url?.includes(marker)) return true
    return e.hooks?.some((h) => h.type === 'http' && h.url?.includes(marker))
  })
}

function addCommandHook(
  settings: Record<string, unknown>,
  event: string,
  command: string,
  marker: string,
  statusMessage?: string,
): void {
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>
  settings.hooks = hooks

  if (!Array.isArray(hooks[event])) hooks[event] = []

  if (hasCommandHook(hooks[event], marker)) {
    for (const entry of hooks[event]) {
      if (entry.hooks) {
        for (const h of entry.hooks) {
          if (h.type === 'command' && h.command?.includes(marker)) {
            h.command = command
            if (statusMessage) h.statusMessage = statusMessage
          }
        }
      }
    }
    return
  }

  hooks[event].push({
    matcher: '',
    hooks: [{
      type: 'command',
      command,
      timeout: 5,
      ...(statusMessage ? { statusMessage } : {}),
    }],
  })
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

function ensureCodexHooksFeatureEnabled(): void {
  const configPath = getCodexConfigPath()
  mkdirSync(dirname(configPath), { recursive: true })

  const current = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : ''
  const lines = current ? current.split(/\r?\n/) : []
  const featureLine = 'codex_hooks = true'
  const featuresIndex = lines.findIndex((line) => line.trim() === '[features]')

  if (featuresIndex === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push('[features]', featureLine)
    writeFileSync(configPath, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf-8')
    return
  }

  const nextSectionOffset = lines
    .slice(featuresIndex + 1)
    .findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line))
  const sectionEnd = nextSectionOffset === -1
    ? lines.length
    : featuresIndex + 1 + nextSectionOffset
  const existingIndex = lines
    .slice(featuresIndex + 1, sectionEnd)
    .findIndex((line) => /^\s*codex_hooks\s*=/.test(line))

  if (existingIndex >= 0) {
    const absoluteIndex = featuresIndex + 1 + existingIndex
    if (lines[absoluteIndex].trim() === featureLine) return
    lines[absoluteIndex] = featureLine
  } else {
    lines.splice(featuresIndex + 1, 0, featureLine)
  }

  writeFileSync(configPath, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf-8')
}

function registerClaudeHooks(port: number): void {
  if (!existsSync(getClaudeDir())) {
    console.log('[HookInstaller] Claude not installed, skipping')
    return
  }

  // Write hook script for command hooks
  const hooksDir = getHooksDir()
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(getClaudeScriptPath(), generateClaudeScript(port), { mode: 0o755 })

  const settings = readSettings()
  const scriptPath = getClaudeScriptPath().replace(/\\/g, '/')
  const command = `node "${scriptPath}"`

  // Stop: command hook (non-blocking)
  addCommandHook(settings, 'Stop', command, CLAUDE_HOOK_MARKER)

  // Notification: status-line hook (non-blocking — captures model, context, cost)
  // Include port in a query param so the PERM_MARKER match works for cleanup
  const statusUrl = `http://127.0.0.1:${port}/status-line?src=fast-agents`
  addHttpHook(settings, 'Notification', statusUrl)

  // PermissionRequest: HTTP hook (blocking — Claude Code waits for our response)
  const permUrl = `http://127.0.0.1:${port}/permission`
  addHttpHook(settings, 'PermissionRequest', permUrl)

  writeSettings(settings)
  console.log(`[HookInstaller] registered Claude hooks → port ${port}`)
}

function registerCodexHooks(port: number): void {
  const codexDir = getCodexDir()
  mkdirSync(codexDir, { recursive: true })
  ensureCodexHooksFeatureEnabled()

  const hooksDir = getCodexHooksDir()
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(getCodexScriptPath(), generateCodexScript(port), { mode: 0o755 })

  const hooksConfig = readJsonObject(getCodexHooksJsonPath())
  const scriptPath = getCodexScriptPath().replace(/\\/g, '/')
  const command = `node "${scriptPath}"`

  addCommandHook(
    hooksConfig,
    'Stop',
    command,
    CODEX_HOOK_MARKER,
    'Notifying FastAgents',
  )

  writeJsonObject(getCodexHooksJsonPath(), hooksConfig)
  console.log(`[HookInstaller] registered Codex Stop hook → port ${port}`)
}

/** Register hooks in user-level agent config files and write hook scripts */
export function registerHooks(port: number): void {
  registerClaudeHooks(port)
  registerCodexHooks(port)
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
        (e) => !e.hooks?.some((h) => h.type === 'command' && h.command?.includes(CLAUDE_HOOK_MARKER)),
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

    const scriptPath = getClaudeScriptPath()
    if (existsSync(scriptPath)) unlinkSync(scriptPath)

    console.log('[HookInstaller] unregistered hooks')
  } catch (err) {
    console.error('[HookInstaller] cleanup error:', err)
  }
}
