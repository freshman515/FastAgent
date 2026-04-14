import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  IPC,
  type ClaudeCodeContext,
  type ClaudeCodeLocalUsage,
  type ClaudeDiffReviewOptions,
  type ClaudeGuiRequestOptions,
  type ClaudePromptOptimizeOptions,
  type ClaudeUtilization,
} from '@shared/types'
import { claudeGuiService } from '../services/ClaudeGuiService'
import { listClaudeGuiSkills } from '../services/ClaudeSkillCatalogService'

// ─── Local usage aggregation (ported from Claude-Code-Usage-Monitor) ────
// Walk ~/.claude/projects/**/*.jsonl, dedupe by message_id:request_id,
// aggregate tokens into 5-hour session blocks, compare against the plan's
// soft limit. Entirely offline — no OAuth, no API, immune to refresh-token
// rotation problems that plague the /usage HTTP approach.

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const PLAN_TOKEN_LIMITS = {
  pro: 19_000,
  max5: 88_000,
  max20: 220_000,
  unknown: 220_000, // generous default — shows low percentage instead of inflated
} as const

interface CredentialsForPlan {
  claudeAiOauth?: {
    rateLimitTier?: string
    subscriptionType?: string
  }
}

function inferPlan(creds: CredentialsForPlan | null): ClaudeCodeLocalUsage['plan'] {
  const tier = creds?.claudeAiOauth?.rateLimitTier?.toLowerCase() ?? ''
  const sub = creds?.claudeAiOauth?.subscriptionType?.toLowerCase() ?? ''
  // Claude Code stores tiers like 'default_claude_max_5x', 'default_claude_max_20x'
  if (tier.includes('max_20x') || tier.includes('20x')) return 'max20'
  if (tier.includes('max_5x') || tier.includes('5x')) return 'max5'
  if (sub === 'max') return 'max5'
  if (sub === 'pro') return 'pro'
  return 'unknown'
}

async function walkJsonlFiles(root: string): Promise<string[]> {
  const collected: string[] = []
  try {
    const top = await readdir(root, { withFileTypes: true })
    for (const dirent of top) {
      if (!dirent.isDirectory()) continue
      const projectDir = join(root, dirent.name)
      try {
        const files = await readdir(projectDir)
        for (const name of files) {
          if (name.endsWith('.jsonl')) collected.push(join(projectDir, name))
        }
      } catch { /* skip unreadable project */ }
    }
  } catch { /* root missing */ }
  return collected
}

interface UsageSample {
  timestamp: number
  tokens: number
  model: string | null
}

async function extractSamplesFromFile(path: string, cutoffMs: number, seen: Set<string>): Promise<UsageSample[]> {
  let raw: string
  try { raw = await readFile(path, 'utf-8') } catch { return [] }
  const out: UsageSample[] = []
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (!line) continue
    let entry: Record<string, unknown>
    try { entry = JSON.parse(line) as Record<string, unknown> } catch { continue }

    const tsStr = typeof entry.timestamp === 'string' ? entry.timestamp : null
    if (!tsStr) continue
    const ts = Date.parse(tsStr)
    if (Number.isNaN(ts) || ts < cutoffMs) continue

    const message = entry.message as { id?: string; usage?: Record<string, number>; model?: string } | undefined
    const usage = message?.usage
    if (!usage) continue

    const messageId = typeof message?.id === 'string' ? message.id : null
    const requestId = typeof entry.requestId === 'string'
      ? entry.requestId
      : typeof entry.request_id === 'string'
        ? entry.request_id
        : null
    if (messageId && requestId) {
      const key = `${messageId}:${requestId}`
      if (seen.has(key)) continue
      seen.add(key)
    }

    // Billable tokens only — Claude charges cache_read_input_tokens at 10%
    // of the normal rate, and counting them inflates 5h blocks into the
    // millions even for light users. input + output + cache_creation is the
    // metric that meaningfully approaches rate-limit territory.
    const tokens = (typeof usage.input_tokens === 'number' ? usage.input_tokens : 0)
      + (typeof usage.output_tokens === 'number' ? usage.output_tokens : 0)
      + (typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0)
    if (tokens <= 0) continue

    out.push({
      timestamp: ts,
      tokens,
      model: typeof message?.model === 'string' ? message.model : null,
    })
  }
  return out
}

async function fetchClaudeCodeLocalUsage(): Promise<ClaudeCodeLocalUsage> {
  const projectsRoot = join(homedir(), '.claude', 'projects')
  const credentialsPath = join(homedir(), '.claude', '.credentials.json')

  let plan: ClaudeCodeLocalUsage['plan'] = 'unknown'
  try {
    const creds = JSON.parse(await readFile(credentialsPath, 'utf-8')) as CredentialsForPlan
    plan = inferPlan(creds)
  } catch { /* no credentials — stay 'unknown' */ }

  const files = await walkJsonlFiles(projectsRoot)
  if (files.length === 0) {
    return {
      fiveHourTokens: 0,
      fiveHourLimit: PLAN_TOKEN_LIMITS[plan],
      fiveHourResetsAt: null,
      sevenDayTokens: 0,
      plan,
      latestModel: null,
      error: `未找到任何 Claude 会话记录：${projectsRoot}`,
    }
  }

  const cutoff = Date.now() - SEVEN_DAYS_MS
  const seen = new Set<string>()
  const samples: UsageSample[] = []
  for (const path of files) {
    samples.push(...(await extractSamplesFromFile(path, cutoff, seen)))
  }
  if (samples.length === 0) {
    return {
      fiveHourTokens: 0,
      fiveHourLimit: PLAN_TOKEN_LIMITS[plan],
      fiveHourResetsAt: null,
      sevenDayTokens: 0,
      plan,
      latestModel: null,
    }
  }

  samples.sort((a, b) => a.timestamp - b.timestamp)

  // Build 5-hour blocks: each new block starts at the hour of its first entry,
  // ends 5h later, OR extends whenever a subsequent entry falls inside. If a
  // gap ≥ 5h separates two entries, start a new block.
  interface Block { start: number; end: number; tokens: number }
  const blocks: Block[] = []
  for (const s of samples) {
    const last = blocks[blocks.length - 1]
    const gapFromLastEntry = last ? s.timestamp - last.end + FIVE_HOURS_MS : Infinity
    if (!last || s.timestamp >= last.end || gapFromLastEntry >= FIVE_HOURS_MS) {
      const startHour = new Date(s.timestamp)
      startHour.setMinutes(0, 0, 0)
      blocks.push({
        start: startHour.getTime(),
        end: startHour.getTime() + FIVE_HOURS_MS,
        tokens: s.tokens,
      })
    } else {
      last.tokens += s.tokens
    }
  }

  // Active block = the one containing "now", otherwise the most recent block.
  const now = Date.now()
  const activeBlock = blocks.find((b) => now >= b.start && now < b.end) ?? blocks[blocks.length - 1]

  const sevenDayTokens = samples.reduce((sum, s) => sum + s.tokens, 0)
  const latestModel = samples.length > 0 ? samples[samples.length - 1].model : null

  return {
    fiveHourTokens: activeBlock?.tokens ?? 0,
    fiveHourLimit: PLAN_TOKEN_LIMITS[plan],
    fiveHourResetsAt: activeBlock ? new Date(activeBlock.end).toISOString() : null,
    sevenDayTokens,
    plan,
    latestModel,
  }
}

// ─── Claude Code session context lookup ─────────────────────────────────
// Reads the most recent assistant message from the session's JSONL file in
// ~/.claude/projects/{sanitized-cwd}/*.jsonl to surface the current context
// window usage for terminal-based Claude Code sessions.

function sanitizeCwdForClaudeProjectDir(cwd: string): string {
  // Claude Code replaces all path separators, ':' and '.' with '-'. Matches
  // folders like D--pragma-MyProject-FastAgents or C--Users-22004.
  return cwd.replace(/[\\/:.]/g, '-')
}

/** Pick the jsonl transcript most likely to belong to the caller's session.
 *  Strategy: prefer the file whose FIRST entry timestamp is ≥ sessionStartedAt
 *  (the transcript must have started after our tab was spawned, with a small
 *  slack). Among candidates, pick the closest timestamp to sessionStartedAt.
 *  Falls back to mtime-latest when sessionStartedAt is missing or no match. */
async function pickSessionJsonl(dir: string, sessionStartedAt?: number): Promise<string | null> {
  try {
    const entries = await readdir(dir)
    const jsonlFiles = entries.filter((name) => name.endsWith('.jsonl'))
    if (jsonlFiles.length === 0) return null

    const candidates = await Promise.all(jsonlFiles.map(async (name) => {
      const full = join(dir, name)
      try {
        const info = await stat(full)
        let firstTimestamp: number | null = null
        try {
          // Read first ~2KB to grab the first JSONL entry's timestamp.
          const fd = await readFile(full, 'utf-8')
          const firstNewline = fd.indexOf('\n')
          const firstLine = (firstNewline === -1 ? fd : fd.slice(0, firstNewline)).trim()
          if (firstLine) {
            const parsed = JSON.parse(firstLine) as { timestamp?: string }
            if (typeof parsed.timestamp === 'string') {
              const t = Date.parse(parsed.timestamp)
              if (!Number.isNaN(t)) firstTimestamp = t
            }
          }
        } catch { /* ignore — treat as unknown timestamp */ }
        return { path: full, mtimeMs: info.mtimeMs, firstTimestamp }
      } catch {
        return null
      }
    }))
    const valid = candidates.filter((c): c is NonNullable<typeof c> => c !== null)
    if (valid.length === 0) return null

    if (typeof sessionStartedAt === 'number' && sessionStartedAt > 0) {
      // 60s slack before the tab's createdAt to tolerate clock drift and the
      // brief delay between PTY spawn and Claude Code's first write.
      const threshold = sessionStartedAt - 60_000
      const eligible = valid.filter((c) => c.firstTimestamp != null && c.firstTimestamp >= threshold)
      if (eligible.length > 0) {
        eligible.sort((a, b) => Math.abs((a.firstTimestamp ?? 0) - sessionStartedAt) - Math.abs((b.firstTimestamp ?? 0) - sessionStartedAt))
        return eligible[0].path
      }
    }

    // Fallback: pick the most recently modified transcript.
    valid.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return valid[0].path
  } catch {
    return null
  }
}

async function fetchClaudeCodeContext(cwd: string, sessionStartedAt?: number): Promise<ClaudeCodeContext> {
  if (!cwd || typeof cwd !== 'string') {
    return { contextTokens: 0, model: null, sessionFile: null, error: 'cwd 为空' }
  }
  const projectDir = join(homedir(), '.claude', 'projects', sanitizeCwdForClaudeProjectDir(cwd))
  const sessionFile = await pickSessionJsonl(projectDir, sessionStartedAt)
  if (!sessionFile) {
    return { contextTokens: 0, model: null, sessionFile: null, error: `未找到会话记录：${projectDir}` }
  }

  let raw: string
  try {
    raw = await readFile(sessionFile, 'utf-8')
  } catch (err) {
    return { contextTokens: 0, model: null, sessionFile, error: `读取会话记录失败：${err instanceof Error ? err.message : String(err)}` }
  }

  // Scan from the end backwards — the last entry with a usage field is the
  // latest assistant message, whose usage reflects the current context.
  const lines = raw.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line) continue
    let entry: Record<string, unknown>
    try { entry = JSON.parse(line) as Record<string, unknown> } catch { continue }
    const message = entry.message as { usage?: Record<string, number>; model?: string } | undefined
    const usage = message?.usage
    if (!usage) continue

    const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
    const cacheCreate = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0
    const cacheRead = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0
    const contextTokens = input + cacheCreate + cacheRead

    return {
      contextTokens,
      model: typeof message?.model === 'string' ? message.model : null,
      sessionFile,
    }
  }

  return { contextTokens: 0, model: null, sessionFile, error: '会话中还没有 usage 记录' }
}

// ─── Claude `/usage` implementation ──────────────────────────────────────
// Reuses the same OAuth access token Claude Code CLI stores in
// ~/.claude/.credentials.json and hits the public usage endpoint directly,
// so the panel mirrors what `claude /usage` shows in the terminal.

const CLAUDE_OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'

interface CredentialsFile {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
    subscriptionType?: string
  }
}

interface RawUsageRateLimit {
  utilization?: number | null
  resets_at?: string | null
}

interface RawUsageExtraUsage {
  is_enabled?: boolean
  monthly_limit?: number | null
  used_credits?: number | null
  utilization?: number | null
}

interface RawUsage {
  five_hour?: RawUsageRateLimit | null
  seven_day?: RawUsageRateLimit | null
  seven_day_opus?: RawUsageRateLimit | null
  seven_day_sonnet?: RawUsageRateLimit | null
  extra_usage?: RawUsageExtraUsage | null
}

function normalizeRate(raw: RawUsageRateLimit | null | undefined): { utilization: number | null; resetsAt: string | null } | null {
  if (!raw) return null
  return {
    utilization: typeof raw.utilization === 'number' ? raw.utilization : null,
    resetsAt: typeof raw.resets_at === 'string' ? raw.resets_at : null,
  }
}

async function fetchClaudeUsage(): Promise<ClaudeUtilization> {
  const credentialsPath = join(homedir(), '.claude', '.credentials.json')
  let raw: string
  try {
    raw = await readFile(credentialsPath, 'utf-8')
  } catch {
    return { notAuthenticated: true, error: '未找到 Claude Code 凭证文件。请先在终端运行 `claude login`。' }
  }

  let creds: CredentialsFile
  try {
    creds = JSON.parse(raw) as CredentialsFile
  } catch {
    return { error: '~/.claude/.credentials.json 格式异常，无法解析。' }
  }

  const accessToken = creds.claudeAiOauth?.accessToken
  if (!accessToken) {
    return { notAuthenticated: true, error: '凭证中没有找到 OAuth access token。请重新登录：`claude login`。' }
  }

  // NOTE: we intentionally do NOT refresh the token here — Claude Code CLI
  // rotates the refresh token each time it refreshes, so a parallel refresh
  // from our process would invalidate the CLI's cached refresh token and
  // force the user to re-login. Instead we mirror claude-code's own
  // `fetchUtilization`: if the token is expired just return a soft error
  // and let the CLI refresh naturally on the user's next interaction.

  try {
    const response = await fetch(CLAUDE_OAUTH_USAGE_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'claude-cli/fastagents',
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return {
        error: response.status === 401
          ? 'OAuth token 已过期，等 Claude Code 下次发消息时会自动续期，随后刷新即可。'
          : `请求失败（HTTP ${response.status}）${text ? ': ' + text.slice(0, 200) : ''}`,
      }
    }

    const data = (await response.json()) as RawUsage
    return {
      fiveHour: normalizeRate(data.five_hour),
      sevenDay: normalizeRate(data.seven_day),
      sevenDayOpus: normalizeRate(data.seven_day_opus),
      sevenDaySonnet: normalizeRate(data.seven_day_sonnet),
      extraUsage: data.extra_usage
        ? {
          isEnabled: data.extra_usage.is_enabled === true,
          monthlyLimit: typeof data.extra_usage.monthly_limit === 'number' ? data.extra_usage.monthly_limit : null,
          usedCredits: typeof data.extra_usage.used_credits === 'number' ? data.extra_usage.used_credits : null,
          utilization: typeof data.extra_usage.utilization === 'number' ? data.extra_usage.utilization : null,
        }
        : null,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerClaudeGuiHandlers(): void {
  ipcMain.handle(IPC.CLAUDE_GUI_START, async (event, options: ClaudeGuiRequestOptions) => {
    await claudeGuiService.start(event.sender, options)
  })

  ipcMain.handle(IPC.CLAUDE_GUI_STOP, async () => {
    await claudeGuiService.stop()
  })

  ipcMain.handle(IPC.CLAUDE_GUI_LIST_SKILLS, async (_event, cwd: string) => {
    return await listClaudeGuiSkills(cwd)
  })

  ipcMain.handle(IPC.CLAUDE_GUI_FETCH_USAGE, async (): Promise<ClaudeUtilization> => {
    return fetchClaudeUsage()
  })

  ipcMain.handle(IPC.CLAUDE_CODE_FETCH_CONTEXT, async (_event, payload: string | { cwd: string; sessionStartedAt?: number }): Promise<ClaudeCodeContext> => {
    if (typeof payload === 'string') return fetchClaudeCodeContext(payload)
    return fetchClaudeCodeContext(payload.cwd, payload.sessionStartedAt)
  })

  ipcMain.handle(IPC.CLAUDE_CODE_FETCH_LOCAL_USAGE, async (): Promise<ClaudeCodeLocalUsage> => {
    return fetchClaudeCodeLocalUsage()
  })

  ipcMain.handle(IPC.CLAUDE_PROMPT_OPTIMIZE, async (_event, options: ClaudePromptOptimizeOptions) => {
    return claudeGuiService.optimizePrompt(options)
  })

  ipcMain.handle(IPC.CLAUDE_DIFF_REVIEW, async (_event, options: ClaudeDiffReviewOptions) => {
    return claudeGuiService.reviewDiff(options)
  })

  ipcMain.handle(IPC.CLAUDE_GUI_EXPORT, async (event, options: {
    suggestedName: string
    extension: 'md' | 'json'
    content: string
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false

    const safeName = options.suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'claude-gui-export'
    const extension = options.extension === 'json' ? 'json' : 'md'
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${safeName}.${extension}`,
      filters: extension === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md'] }],
    })

    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, options.content, 'utf-8')
    return true
  })
}
