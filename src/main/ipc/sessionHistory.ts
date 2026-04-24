import { createReadStream } from 'node:fs'
import { readdir, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { ipcMain } from 'electron'
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
// Cap per-file line reads — avoids multi-second stalls on very long sessions
// while still giving accurate message counts for typical conversations.
const MAX_LINES_PER_FILE = 8000

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

async function listClaudeTranscripts(): Promise<{ files: Array<{ path: string; id: string; mtimeMs: number }>; error?: string }> {
  const root = join(homedir(), '.claude', 'projects')
  let topEntries: string[]
  try {
    topEntries = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch (err) {
    return { files: [], error: `未找到 Claude 会话目录：${root}` }
  }

  const out: Array<{ path: string; id: string; mtimeMs: number }> = []
  for (const dirName of topEntries) {
    const dir = join(root, dirName)
    let names: string[]
    try { names = await readdir(dir) } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const full = join(dir, name)
      try {
        const info = await stat(full)
        out.push({ path: full, id: name.slice(0, -6), mtimeMs: info.mtimeMs })
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
  out: Array<{ path: string; mtimeMs: number }>,
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
        out.push({ path: full, mtimeMs: info.mtimeMs })
      } catch { /* skip */ }
    }
  }
}

async function listCodexRollouts(): Promise<{ files: Array<{ path: string; mtimeMs: number }>; error?: string }> {
  const root = join(homedir(), '.codex', 'sessions')
  try { await stat(root) } catch { return { files: [], error: `未找到 Codex 会话目录：${root}` } }

  const all: Array<{ path: string; mtimeMs: number }> = []
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
  session: HistoricalSession
}

const fileCache = new Map<string, CacheEntry>()

export function invalidateSessionHistoryCache(paths: string[]): void {
  for (const p of paths) fileCache.delete(p)
}

async function buildHistoryList(): Promise<HistoricalSessionListResult> {
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
  const claudeToScan: Array<{ path: string; id: string; mtimeMs: number }> = []
  const codexToScan: Array<{ path: string; mtimeMs: number }> = []

  for (const f of claudeList.files) {
    seenPaths.add(f.path)
    const hit = fileCache.get(f.path)
    if (hit && hit.mtimeMs === f.mtimeMs) {
      cachedSessions.push(hit.session)
    } else {
      claudeToScan.push(f)
    }
  }
  for (const f of codexList.files) {
    seenPaths.add(f.path)
    const hit = fileCache.get(f.path)
    if (hit && hit.mtimeMs === f.mtimeMs) {
      cachedSessions.push(hit.session)
    } else {
      codexToScan.push(f)
    }
  }

  // Drop cache entries whose files are no longer in the listing (deleted on
  // disk or rotated out past MAX_FILES_PER_SOURCE). Otherwise the Map grows
  // unboundedly across the process lifetime.
  for (const key of fileCache.keys()) {
    if (!seenPaths.has(key)) fileCache.delete(key)
  }

  // Rescan only the changed / new files.
  const [claudeScanned, codexScanned] = await Promise.all([
    scanAll(claudeToScan.map((f) => async () => {
      const parsed = await scanClaudeTranscript(f.path, f.id)
      if (parsed) fileCache.set(f.path, { mtimeMs: f.mtimeMs, session: parsed })
      return parsed
    })),
    scanAll(codexToScan.map((f) => async () => {
      const parsed = await scanCodexRollout(f.path)
      if (parsed) fileCache.set(f.path, { mtimeMs: f.mtimeMs, session: parsed })
      return parsed
    })),
  ])

  const sessions = [...cachedSessions, ...claudeScanned, ...codexScanned]
  sessions.sort((a, b) => {
    const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return bt - at
  })

  return { sessions, errors }
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
      fileCache.delete(raw)
      result.deleted += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Treat "file already missing" as success — the user's goal is "make it
      // go away", and a stale cache from a previous list() doesn't deserve a
      // hard error.
      if (msg.includes('ENOENT')) {
        fileCache.delete(raw)
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
    return buildHistoryList()
  })

  ipcMain.handle(IPC.SESSION_HISTORY_DELETE, async (_event, paths: string[]): Promise<DeleteResult> => {
    if (!Array.isArray(paths)) return { deleted: 0, errors: [{ path: '', error: '参数必须是路径数组' }] }
    return deleteHistoryFiles(paths)
  })
}

// Exposed only for the `HistoricalSessionSource` compile-time reference; keeps
// tree-shakers from dropping the type import when there are no runtime users.
export type { HistoricalSessionSource }
