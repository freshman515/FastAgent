import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { app, ipcMain } from 'electron'
import {
  IPC,
  type HistoricalSession,
  type HistoricalSessionListResult,
  type HistoricalSessionSource,
} from '@shared/types'

// ─── History scanner (Claude Code + Codex) ─────────────────────────────
// Walks both CLIs' on-disk session stores and builds a summary per conversation
// so the "历史会话" panel can browse + resume them without invoking a TUI picker.
//
// Design notes:
//  - We stream each jsonl file line-by-line and early-exit as soon as we have
//    the first "real" user prompt. Counting total messages requires reading
//    the full file, so we do that in the same pass but cheaply (no JSON parse
//    after the prompt is found — just line counts).
//  - We cap the number of files per source to keep cold-start fast; the user
//    can tune later if they have huge archives.

const MAX_FILES_PER_SOURCE = 1500
const PREVIEW_MAX_CHARS = 200
const HISTORY_CACHE_VERSION = 1
// Cap per-file line reads — avoids multi-second stalls on very long sessions
// while still giving accurate message counts for typical conversations.
const MAX_LINES_PER_FILE = 8000
const CODEX_RESUME_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Patterns that indicate a user "message" is actually injected instructions
// rather than something the user typed. Codex in particular prepends AGENTS.md
// and permissions preamble as role="user" entries.
const INJECTED_PROMPT_PREFIXES = [
  '# AGENTS.md',
  '# Context from my IDE',
  '<INSTRUCTIONS>',
  '<permissions',
  '<environment_context',
  '<user-memory',
  '<system-reminder',
  '<command-message',
  '<command-name',
  '<local-command-stdout',
  '<local-command-stderr',
  '<local-command-caveat',
  '<bash-stdout',
  '<bash-stderr',
]

function isInjectedPrompt(text: string): boolean {
  const trimmed = text.trimStart()
  if (!trimmed) return true
  for (const prefix of INJECTED_PROMPT_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true
  }
  return false
}

function normalizePreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= PREVIEW_MAX_CHARS) return collapsed
  return `${collapsed.slice(0, PREVIEW_MAX_CHARS)}…`
}

interface ClaudeEntry {
  type?: string
  timestamp?: string
  cwd?: string
  message?: {
    role?: string
    content?: unknown
  }
}

function extractClaudeText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const part = item as { type?: string; text?: unknown }
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text)
    }
  }
  return parts.join(' ')
}

async function scanClaudeTranscript(filePath: string, id: string): Promise<HistoricalSession | null> {
  let cwd = ''
  let startedAt: string | null = null
  let lastTimestamp: string | null = null
  let firstUserPrompt: string | null = null
  let userTurns = 0
  let lineCount = 0

  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }) })
  try {
    for await (const line of rl) {
      if (!line) continue
      lineCount += 1
      if (lineCount > MAX_LINES_PER_FILE) break

      // Fast path for the vast majority of lines — anything that isn't a user
      // entry can't affect cwd / prompt / turn count. We still want the
      // timestamp of the LAST line for `updatedAt`, so capture it cheaply.
      const looksLikeUser = line.includes('"role":"user"')
      if (firstUserPrompt && cwd && !looksLikeUser) {
        const tsMatch = line.match(/"timestamp"\s*:\s*"([^"]+)"/)
        if (tsMatch) lastTimestamp = tsMatch[1]
        continue
      }

      let entry: ClaudeEntry
      try { entry = JSON.parse(line) as ClaudeEntry } catch { continue }

      if (typeof entry.timestamp === 'string') {
        if (!startedAt) startedAt = entry.timestamp
        lastTimestamp = entry.timestamp
      }
      if (!cwd && typeof entry.cwd === 'string') cwd = entry.cwd

      if (entry.message?.role === 'user') {
        // Claude Code stores tool_result entries with role=user too, but their
        // content is a tool_result array with no `text` parts — extractClaudeText
        // returns an empty string for those so the filter below naturally
        // excludes them. Injected reminders (AGENTS.md, <system-reminder>, …)
        // are caught by isInjectedPrompt.
        const text = extractClaudeText(entry.message.content)
        if (text && !isInjectedPrompt(text)) {
          userTurns += 1
          if (!firstUserPrompt) firstUserPrompt = normalizePreview(text)
        }
      }
    }
  } finally {
    rl.close()
  }

  if (!cwd && !firstUserPrompt) return null

  return {
    source: 'claude-code',
    id,
    filePath,
    cwd,
    startedAt,
    updatedAt: lastTimestamp ?? startedAt,
    firstUserPrompt,
    userTurns,
  }
}

interface ClaudeTranscriptFile {
  path: string
  id: string
  mtimeMs: number
  size: number
}

async function listClaudeTranscripts(): Promise<{ files: ClaudeTranscriptFile[]; error?: string }> {
  const root = join(homedir(), '.claude', 'projects')
  let topEntries: string[]
  try {
    topEntries = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch (err) {
    return { files: [], error: `未找到 Claude 会话目录：${root}` }
  }

  const out: ClaudeTranscriptFile[] = []
  for (const dirName of topEntries) {
    const dir = join(root, dirName)
    let names: string[]
    try { names = await readdir(dir) } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const full = join(dir, name)
      try {
        const info = await stat(full)
        out.push({ path: full, id: name.slice(0, -6), mtimeMs: info.mtimeMs, size: info.size })
      } catch { /* skip unreadable */ }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { files: out.slice(0, MAX_FILES_PER_SOURCE) }
}

interface CodexMetaPayload {
  id?: string
  cwd?: string
  timestamp?: string
}

interface CodexMessagePayload {
  type?: string
  role?: string
  content?: unknown
}

function extractCodexText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const part = item as { text?: unknown; content?: unknown }
    if (typeof part.text === 'string') parts.push(part.text)
    else if (typeof part.content === 'string') parts.push(part.content)
  }
  return parts.join(' ')
}

async function scanCodexRollout(filePath: string): Promise<HistoricalSession | null> {
  let id = ''
  let cwd = ''
  let startedAt: string | null = null
  let lastTimestamp: string | null = null
  let firstUserPrompt: string | null = null
  let userTurns = 0
  let lineCount = 0

  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }) })
  try {
    for await (const line of rl) {
      if (!line) continue
      lineCount += 1
      if (lineCount > MAX_LINES_PER_FILE) break

      // Cheap pre-check — most rollout lines are event_msg or tool_call, not
      // user messages. Skip JSON.parse on obvious non-user lines but still
      // update lastTimestamp from them so `updatedAt` reflects the true end.
      const looksLikeUserMsg = line.includes('"role":"user"')
      if (id && cwd && !looksLikeUserMsg) {
        const tsMatch = line.match(/"timestamp"\s*:\s*"([^"]+)"/)
        if (tsMatch) lastTimestamp = tsMatch[1]
        continue
      }

      let entry: { type?: string; timestamp?: string; payload?: unknown }
      try {
        entry = JSON.parse(line) as { type?: string; timestamp?: string; payload?: unknown }
      } catch { continue }

      if (typeof entry.timestamp === 'string') {
        if (!startedAt) startedAt = entry.timestamp
        lastTimestamp = entry.timestamp
      }

      if (entry.type === 'session_meta' && entry.payload && typeof entry.payload === 'object') {
        const meta = entry.payload as CodexMetaPayload
        if (typeof meta.id === 'string') id = meta.id
        if (typeof meta.cwd === 'string') cwd = meta.cwd
        if (!startedAt && typeof meta.timestamp === 'string') startedAt = meta.timestamp
        continue
      }

      if (entry.type === 'response_item' && entry.payload && typeof entry.payload === 'object') {
        const msg = entry.payload as CodexMessagePayload
        if (msg.type === 'message' && msg.role === 'user') {
          const text = extractCodexText(msg.content)
          if (text && !isInjectedPrompt(text)) {
            userTurns += 1
            if (!firstUserPrompt) firstUserPrompt = normalizePreview(text)
          }
        }
      }
    }
  } finally {
    rl.close()
  }

  if (!id) return null

  return {
    source: 'codex',
    id,
    filePath,
    cwd,
    startedAt,
    updatedAt: lastTimestamp ?? startedAt,
    firstUserPrompt,
    userTurns,
  }
}

async function collectCodexRolloutPaths(
  root: string,
  out: CodexRolloutFile[],
  depth: number,
): Promise<void> {
  // Structure is ~/.codex/sessions/yyyy/mm/dd/rollout-*.jsonl — fixed 3 levels
  // of date folders before the files. Stop recursing if we hit the file level.
  let entries: Array<{ name: string; isDir: boolean; isFile: boolean }>
  try {
    const raw = await readdir(root, { withFileTypes: true })
    entries = raw.map((d) => ({ name: d.name, isDir: d.isDirectory(), isFile: d.isFile() }))
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDir && depth < 3) {
      await collectCodexRolloutPaths(full, out, depth + 1)
      continue
    }
    if (entry.isFile && entry.name.endsWith('.jsonl') && entry.name.startsWith('rollout-')) {
      try {
        const info = await stat(full)
        out.push({ path: full, mtimeMs: info.mtimeMs, size: info.size })
      } catch { /* skip */ }
    }
  }
}

interface CodexRolloutFile {
  path: string
  mtimeMs: number
  size: number
}

async function listCodexRollouts(): Promise<{ files: CodexRolloutFile[]; error?: string }> {
  const root = join(homedir(), '.codex', 'sessions')
  try { await stat(root) } catch { return { files: [], error: `未找到 Codex 会话目录：${root}` } }

  const all: CodexRolloutFile[] = []
  await collectCodexRolloutPaths(root, all, 0)
  all.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { files: all.slice(0, MAX_FILES_PER_SOURCE) }
}

// ─── Per-file cache ────────────────────────────────────────────────────
// Each jsonl is parsed once and reused until its mtime changes on disk. A
// cache hit cuts a cold re-scan from ~2s to a few tens of ms on 1000+ files
// because all we do is stat() each path and compare the recorded mtime.
// Live sessions that are actively writing will have updated mtimes on every
// call, so they'll still be rescanned — which is exactly what we want.

interface CacheEntry {
  mtimeMs: number
  size: number
  session: HistoricalSession
}

const fileCache = new Map<string, CacheEntry>()
let persistentCacheLoaded = false
let persistentCacheLoadPromise: Promise<void> | null = null
let persistCacheTimer: ReturnType<typeof setTimeout> | null = null
let cacheDirty = false
let currentBuild: Promise<HistoricalSessionListResult> | null = null

function getHistoryCacheFile(): string {
  return join(app.getPath('userData'), 'cache', 'session-history-v1.json')
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isHistoricalSession(value: unknown): value is HistoricalSession {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<HistoricalSession>
  return (
    (s.source === 'claude-code' || s.source === 'codex')
    && typeof s.id === 'string'
    && typeof s.filePath === 'string'
    && typeof s.cwd === 'string'
    && isNullableString(s.startedAt)
    && isNullableString(s.updatedAt)
    && isNullableString(s.firstUserPrompt)
    && typeof s.userTurns === 'number'
  )
}

async function loadPersistentCache(): Promise<void> {
  if (persistentCacheLoaded) return
  if (persistentCacheLoadPromise) return persistentCacheLoadPromise

  persistentCacheLoadPromise = (async () => {
    try {
      const raw = await readFile(getHistoryCacheFile(), 'utf-8')
      const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown }
      if (parsed.version !== HISTORY_CACHE_VERSION || !Array.isArray(parsed.entries)) return

      for (const rawEntry of parsed.entries) {
        if (!rawEntry || typeof rawEntry !== 'object') continue
        const entry = rawEntry as { path?: unknown; mtimeMs?: unknown; size?: unknown; session?: unknown }
        if (typeof entry.path !== 'string') continue
        if (typeof entry.mtimeMs !== 'number' || typeof entry.size !== 'number') continue
        if (!isHistoricalSession(entry.session)) continue
        if (entry.session.filePath !== entry.path) continue
        if (!fileCache.has(entry.path)) {
          fileCache.set(entry.path, {
            mtimeMs: entry.mtimeMs,
            size: entry.size,
            session: entry.session,
          })
        }
      }
    } catch {
      // Missing or corrupt cache just means the first scan rebuilds it.
    } finally {
      persistentCacheLoaded = true
      persistentCacheLoadPromise = null
    }
  })()

  return persistentCacheLoadPromise
}

function schedulePersistentCacheWrite(): void {
  cacheDirty = true
  if (persistCacheTimer) return

  persistCacheTimer = setTimeout(() => {
    persistCacheTimer = null
    void writePersistentCache()
  }, 250)
}

async function writePersistentCache(): Promise<void> {
  if (!cacheDirty) return
  cacheDirty = false

  const cacheFile = getHistoryCacheFile()
  const payload = {
    version: HISTORY_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    entries: [...fileCache.entries()].map(([path, entry]) => ({
      path,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      session: entry.session,
    })),
  }

  try {
    await mkdir(join(app.getPath('userData'), 'cache'), { recursive: true })
    const tmpFile = `${cacheFile}.tmp`
    await writeFile(tmpFile, JSON.stringify(payload), 'utf-8')
    await rename(tmpFile, cacheFile)
  } catch (err) {
    cacheDirty = true
    console.warn('[sessionHistory] failed to persist cache:', err)
  }
}

export function invalidateSessionHistoryCache(paths: string[]): void {
  let changed = false
  for (const p of paths) {
    if (fileCache.delete(p)) changed = true
  }
  if (changed) schedulePersistentCacheWrite()
}

async function buildHistoryList(): Promise<HistoricalSessionListResult> {
  await loadPersistentCache()

  const errors: HistoricalSessionListResult['errors'] = {}

  const [claudeList, codexList] = await Promise.all([
    listClaudeTranscripts(),
    listCodexRollouts(),
  ])
  if (claudeList.error) errors['claude-code'] = claudeList.error
  if (codexList.error) errors.codex = codexList.error

  // Figure out which files we can serve from cache vs. need to rescan.
  const seenPaths = new Set<string>()
  const cachedSessions: HistoricalSession[] = []
  const claudeToScan: ClaudeTranscriptFile[] = []
  const codexToScan: CodexRolloutFile[] = []

  for (const f of claudeList.files) {
    seenPaths.add(f.path)
    const hit = fileCache.get(f.path)
    if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) {
      cachedSessions.push(hit.session)
    } else {
      claudeToScan.push(f)
    }
  }
  for (const f of codexList.files) {
    seenPaths.add(f.path)
    const hit = fileCache.get(f.path)
    if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) {
      cachedSessions.push(hit.session)
    } else {
      codexToScan.push(f)
    }
  }

  // Drop cache entries whose files are no longer in the listing (deleted on
  // disk or rotated out past MAX_FILES_PER_SOURCE). Otherwise the Map grows
  // unboundedly across the process lifetime.
  let removedStaleCacheEntries = false
  for (const key of fileCache.keys()) {
    if (!seenPaths.has(key)) {
      fileCache.delete(key)
      removedStaleCacheEntries = true
    }
  }

  // Rescan only the changed / new files.
  const [claudeScanned, codexScanned] = await Promise.all([
    scanAll(claudeToScan.map((f) => async () => {
      const parsed = await scanClaudeTranscript(f.path, f.id)
      if (parsed) fileCache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, session: parsed })
      return parsed
    })),
    scanAll(codexToScan.map((f) => async () => {
      const parsed = await scanCodexRollout(f.path)
      if (parsed) fileCache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, session: parsed })
      return parsed
    })),
  ])

  if (removedStaleCacheEntries || claudeToScan.length > 0 || codexToScan.length > 0) {
    schedulePersistentCacheWrite()
  }

  const sessions = [...cachedSessions, ...claudeScanned, ...codexScanned]
  sessions.sort((a, b) => {
    const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return bt - at
  })

  return { sessions, errors }
}

function getHistoryList(): Promise<HistoricalSessionListResult> {
  if (!currentBuild) {
    currentBuild = buildHistoryList().finally(() => {
      currentBuild = null
    })
  }
  return currentBuild
}

export function warmSessionHistoryCache(): void {
  void getHistoryList().catch((err) => {
    console.warn('[sessionHistory] failed to warm cache:', err)
  })
}

export interface CodexResumeLookupTarget {
  sessionId: string
  cwd: string
  startedAt?: number
  existingResumeId?: unknown
}

function isCodexResumeId(value: unknown): value is string {
  return typeof value === 'string' && CODEX_RESUME_ID_RE.test(value)
}

function normalizeLookupCwd(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase()
}

function parseLookupTime(value: string | null): number {
  if (!value) return 0
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : 0
}

export async function resolveCodexResumeIdsForSessions(
  targets: CodexResumeLookupTarget[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const pending: CodexResumeLookupTarget[] = []
  const usedIds = new Set<string>()

  for (const target of targets) {
    if (!target.sessionId) continue
    if (isCodexResumeId(target.existingResumeId)) {
      results.set(target.sessionId, target.existingResumeId)
      usedIds.add(target.existingResumeId)
      continue
    }
    if (target.cwd) pending.push(target)
  }

  if (pending.length === 0) return results

  const history = await getHistoryList()
  const candidates = history.sessions
    .filter((session) => session.source === 'codex' && isCodexResumeId(session.id) && session.cwd)
    .map((session) => ({
      id: session.id,
      cwd: normalizeLookupCwd(session.cwd),
      startedAt: parseLookupTime(session.startedAt),
      updatedAt: parseLookupTime(session.updatedAt),
    }))
    .filter((session) => session.cwd)

  for (const target of pending.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))) {
    const targetCwd = normalizeLookupCwd(target.cwd)
    const targetStartedAt = target.startedAt ?? 0
    let best: (typeof candidates)[number] | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const candidate of candidates) {
      if (usedIds.has(candidate.id) || candidate.cwd !== targetCwd) continue
      const candidateStartedAt = candidate.startedAt || candidate.updatedAt
      if (targetStartedAt && candidateStartedAt && candidateStartedAt < targetStartedAt - 2 * 60_000) {
        continue
      }

      const score = targetStartedAt && candidateStartedAt
        ? Math.abs(candidateStartedAt - targetStartedAt)
        : -Math.max(candidate.updatedAt, candidate.startedAt)

      if (score < bestScore) {
        best = candidate
        bestScore = score
      }
    }

    if (!best) {
      for (const candidate of candidates) {
        if (usedIds.has(candidate.id) || candidate.cwd !== targetCwd) continue
        const score = -Math.max(candidate.updatedAt, candidate.startedAt)
        if (score < bestScore) {
          best = candidate
          bestScore = score
        }
      }
    }

    if (best) {
      results.set(target.sessionId, best.id)
      usedIds.add(best.id)
    }
  }

  return results
}

async function scanAll<T>(tasks: Array<() => Promise<T | null>>): Promise<T[]> {
  // Small concurrency pool — streaming jsonl is I/O bound but spawning
  // hundreds of handles at once on Windows is wasteful.
  const POOL_SIZE = 8
  const results: T[] = []
  let index = 0
  const workers: Array<Promise<void>> = []
  for (let w = 0; w < POOL_SIZE; w += 1) {
    workers.push((async () => {
      while (true) {
        const i = index
        index += 1
        if (i >= tasks.length) return
        try {
          const res = await tasks[i]()
          if (res) results.push(res)
        } catch { /* skip unreadable */ }
      }
    })())
  }
  await Promise.all(workers)
  return results
}

// ─── History delete ────────────────────────────────────────────────────
// The renderer supplies absolute file paths (from HistoricalSession.filePath)
// and we validate each against the two trusted roots before unlinking — we
// must never let a renderer IPC delete arbitrary files on disk.

interface DeleteResult {
  deleted: number
  errors: Array<{ path: string; error: string }>
}

function getDeleteRoots(): string[] {
  // resolve() to strip any trailing slashes and normalize case/slashes
  return [
    resolve(join(homedir(), '.claude', 'projects')),
    resolve(join(homedir(), '.codex', 'sessions')),
  ]
}

function isPathUnderRoot(target: string, root: string): boolean {
  const resolvedTarget = resolve(target)
  // Must be either the root itself or a descendant. startsWith with a trailing
  // separator avoids matching sibling paths like `.claude/projects-evil/...`.
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (process.platform === 'win32') {
    return resolvedTarget.toLowerCase().startsWith(rootWithSep.toLowerCase())
  }
  return resolvedTarget.startsWith(rootWithSep)
}

async function deleteHistoryFiles(paths: string[]): Promise<DeleteResult> {
  const roots = getDeleteRoots()
  const result: DeleteResult = { deleted: 0, errors: [] }

  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw) {
      result.errors.push({ path: String(raw), error: '无效路径' })
      continue
    }
    if (!raw.endsWith('.jsonl')) {
      result.errors.push({ path: raw, error: '仅允许删除 .jsonl 会话文件' })
      continue
    }
    const underTrustedRoot = roots.some((root) => isPathUnderRoot(raw, root))
    if (!underTrustedRoot) {
      result.errors.push({ path: raw, error: '路径不在 Claude / Codex 会话目录内，已拒绝' })
      continue
    }

    try {
      await unlink(raw)
      if (fileCache.delete(raw)) schedulePersistentCacheWrite()
      result.deleted += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Treat "file already missing" as success — the user's goal is "make it
      // go away", and a stale cache from a previous list() doesn't deserve a
      // hard error.
      if (msg.includes('ENOENT')) {
        if (fileCache.delete(raw)) schedulePersistentCacheWrite()
        result.deleted += 1
      } else {
        result.errors.push({ path: raw, error: msg })
      }
    }
  }

  return result
}

export function registerSessionHistoryHandlers(): void {
  ipcMain.handle(IPC.SESSION_HISTORY_LIST, async (): Promise<HistoricalSessionListResult> => {
    return getHistoryList()
  })

  ipcMain.handle(IPC.SESSION_HISTORY_DELETE, async (_event, paths: string[]): Promise<DeleteResult> => {
    if (!Array.isArray(paths)) return { deleted: 0, errors: [{ path: '', error: '参数必须是路径数组' }] }
    return deleteHistoryFiles(paths)
  })
}

// Exposed only for the `HistoricalSessionSource` compile-time reference; keeps
// tree-shakers from dropping the type import when there are no runtime users.
export type { HistoricalSessionSource }
