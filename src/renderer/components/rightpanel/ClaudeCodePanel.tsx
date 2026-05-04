import {
  AtSign,
  BarChart3,
  Bot,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Diff,
  FileJson,
  FileText,
  FolderOpen,
  History,
  ImagePlus,
  Languages,
  LoaderCircle,
  Pin,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Shield,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { structuredPatch, type StructuredPatchHunk } from 'diff'
import type { ClaudeGuiSkillCatalogEntry, ClaudeUtilization, FileSearchResult } from '@shared/types'
import claudeIcon from '@/assets/icons/Claude.png'
import {
  buildSlashSuggestions,
  getSlashSuggestionContext,
  mergeSkillCatalog,
  parseComposerSlashCommand,
  type ClaudeGuiSlashSuggestion,
} from '@/lib/claudeSlashCommands'
import { highlightCode, renderMarkdown } from '@/lib/markdown'
import { cn, generateId } from '@/lib/utils'
import { detectLanguage, useEditorsStore } from '@/stores/editors'
import {
  getClaudeScopeKey,
  type ClaudeGuiConversation,
  type ClaudeGuiMessage,
  type ClaudeGuiPatchFile,
  type ClaudeGuiPatchReview,
  type ClaudeGuiPreferences,
  type ClaudeGuiRequestPayload,
  useClaudeGuiStore,
} from '@/stores/claudeGui'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'

interface PendingImage {
  id: string
  name: string
  mediaType: string
  data: string
  preview: string
}

interface ReferencedFile {
  id: string
  filePath: string
  relativePath: string
  fileName: string
  language: string
  contentChars: number
  includedChars: number
}

interface MentionMatch {
  query: string
  start: number
  end: number
}

interface ClaudeGuiPermissionRequest {
  id: string
  conversationId: string
  toolName: string
  detail: string
  suggestions: string[]
}

type ActiveEditorTab = ReturnType<typeof useEditorsStore.getState>['tabs'][number]
type ActiveCursorInfo = ReturnType<typeof useEditorsStore.getState>['cursorInfo']

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'default', label: 'Default' },
] as const

const LANGUAGE_OPTIONS: Array<{ value: NonNullable<ClaudeGuiPreferences['language']>; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ar', label: 'العربية' },
]

const INPUT =
  'h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none transition-colors'
const MAX_REFERENCED_FILES = 6
const MAX_REFERENCED_FILE_CHARS = 8_000
const PROMPT_PRESETS = [
  { id: 'annotate', label: '加注释', prompt: '请在当前选中的代码附近补充高质量注释，保持现有代码风格，不要改业务逻辑。' },
  { id: 'explain', label: '解释代码', prompt: '请解释当前选中的代码，按职责、关键分支和潜在风险来说明。' },
  { id: 'refactor', label: '风格重构', prompt: '请按当前项目的既有风格重构这段代码，优先改善可读性和命名，不要改变行为。' },
  { id: 'tests', label: '补测试', prompt: '请为当前代码补充测试思路和测试用例，优先覆盖边界条件和回归风险。' },
] as const
const CLAUDE_SPINNER_VERBS = [
  'Philosophising',
  'Thinking',
  'Contemplating',
  'Pondering',
  'Considering',
  'Computing',
  'Generating',
  'Crafting',
  'Processing',
  'Percolating',
  'Synthesizing',
  'Musing',
  'Working',
] as const

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function getSpinnerVerb(requestId: string | null): string {
  if (!requestId) return 'Thinking'
  return CLAUDE_SPINNER_VERBS[hashString(requestId) % CLAUDE_SPINNER_VERBS.length] ?? 'Thinking'
}

function normalizeProcessingDetail(detail: string): string {
  return detail
    .replace(/^⏳\s*/, '')
    .replace(/\s*\(\d+s\)\s*$/, '')
    .trim()
}

function getPermissionModeLabel(mode: ClaudeGuiPreferences['permissionMode']): string {
  switch (mode) {
    case 'plan':
      return 'Plan mode'
    case 'acceptEdits':
      return 'Accept edits'
    case 'bypassPermissions':
      return 'Bypass permissions'
    case 'dontAsk':
      return "Don't ask"
    case 'default':
    default:
      return 'Ask before edits'
  }
}

function formatResetTimestamp(raw: string | null | undefined): string | null {
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const now = Date.now()
  const diff = date.getTime() - now
  const days = Math.round(diff / (24 * 60 * 60 * 1000))
  const hours = Math.round(diff / (60 * 60 * 1000))
  const minutes = Math.round(diff / (60 * 1000))
  const abs = date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  if (diff <= 0) return `${abs}（已重置）`
  if (minutes < 60) return `${abs}（约 ${minutes} 分钟后）`
  if (hours < 24) return `${abs}（约 ${hours} 小时后）`
  return `${abs}（约 ${days} 天后）`
}

function renderUsageBar(label: string, rate: { utilization: number | null; resetsAt: string | null } | null | undefined): ReactNode {
  if (!rate) return null
  const pct = rate.utilization != null ? Math.max(0, Math.min(100, rate.utilization)) : null
  const barColor = pct == null
    ? 'bg-[var(--color-text-tertiary)]'
    : pct >= 85
      ? 'bg-[var(--color-error)]'
      : pct >= 60
        ? 'bg-[var(--color-warning)]'
        : 'bg-[var(--color-accent)]'
  const reset = formatResetTimestamp(rate.resetsAt)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="font-semibold text-[var(--color-text-primary)]">{label}</span>
        <span className="tabular-nums text-[var(--color-text-secondary)]">
          {pct != null ? `${Math.round(pct)}%` : '—'}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-primary)]">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      {reset && (
        <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">重置时间 {reset}</div>
      )}
    </div>
  )
}

function getMessageTypography(size: ClaudeGuiPreferences['messageTextSize']): { body: string; assistant: string; thinking: string } {
  switch (size) {
    case 'md':
      return {
        body: 'text-[13px] leading-7',
        assistant: 'text-[14px] leading-7',
        thinking: 'text-[12px] leading-6',
      }
    case 'xl':
      return {
        body: 'text-[16px] leading-8',
        assistant: 'text-[17px] leading-8',
        thinking: 'text-[14px] leading-7',
      }
    case 'lg':
    default:
      return {
        body: 'text-[14px] leading-7',
        assistant: 'text-[15px] leading-[26px]',
        thinking: 'text-[13px] leading-6',
      }
  }
}

function getClaudeSessionScopeKey(sessionId: string): string {
  return `session::${sessionId}`
}

function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * hour) return `${Math.floor(diff / hour)} 小时前`
  return `${Math.floor(diff / (24 * hour))} 天前`
}

function formatMoney(value: number): string {
  return `$${value.toFixed(4)}`
}

function formatDuration(duration: number): string {
  if (!duration) return '0.0s'
  return `${(duration / 1000).toFixed(1)}s`
}

function getPreview(message: ClaudeGuiMessage | undefined): string {
  if (!message?.text) return '空会话'
  return message.text.replace(/\s+/g, ' ').trim().slice(0, 80) || '空会话'
}

function stringifyInput(value: unknown): string {
  if (value === undefined) return ''
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return raw.length > 2400 ? `${raw.slice(0, 2400)}\n\n[... truncated ...]` : raw
}

function scopeConversationList(conversations: ClaudeGuiConversation[], scopeKey: string): ClaudeGuiConversation[] {
  return conversations
    .filter((conversation) => conversation.scopeKey === scopeKey)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if ((a.group ?? '') !== (b.group ?? '')) return (a.group ?? '').localeCompare(b.group ?? '')
      return b.updatedAt - a.updatedAt
    })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
    reader.readAsDataURL(file)
  })
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function toDisplayPath(filePath: string, rootPath: string | null): string {
  if (!rootPath) return filePath
  const normalizedFile = normalizePath(filePath)
  const normalizedRoot = normalizePath(rootPath)

  if (normalizedFile === normalizedRoot) {
    return filePath.split(/[\\/]/).pop() ?? filePath
  }

  if (!normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return filePath
  }

  return filePath.slice(rootPath.length).replace(/^[/\\]/, '') || filePath
}

type ActiveSelection = NonNullable<NonNullable<ActiveCursorInfo>['selection']>

function formatSelectionRange(selection: ActiveSelection): string {
  return `L${selection.startLine}:C${selection.startColumn} - L${selection.endLine}:C${selection.endColumn}`
}

function buildSelectionLabel(selection: ActiveSelection): string {
  return `${formatSelectionRange(selection)} · ${selection.lines} 行 / ${selection.chars} 字符`
}

function buildSelectionLineLabel(selection: ActiveSelection): string {
  if (selection.startLine === selection.endLine) {
    return `L${selection.startLine}`
  }
  return `L${selection.startLine}-${selection.endLine}`
}

function isCaretOnFirstLine(text: string, caret: number): boolean {
  return !text.slice(0, Math.max(0, caret)).includes('\n')
}

function isCaretOnLastLine(text: string, caret: number): boolean {
  return !text.slice(Math.max(0, caret)).includes('\n')
}

function joinPath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes('\\') ? '\\' : '/'
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  const normalizedRelative = relativePath.replace(/^@/, '').replace(/^[./\\]+/, '').replace(/[\\/]+/g, separator)
  return `${normalizedRoot}${separator}${normalizedRelative}`
}

function normalizeRelativePath(path: string): string {
  return path.replace(/^@/, '').replace(/\\/g, '/').replace(/^\.?\//, '').trim()
}

function getMentionMatch(text: string, caret: number): MentionMatch | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length))
  const prefix = text.slice(0, safeCaret)
  const match = prefix.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return null

  const query = match[1] ?? ''
  return {
    query,
    start: safeCaret - query.length - 1,
    end: safeCaret,
  }
}

function truncateContent(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { text: content, truncated: false }
  }
  return {
    text: `${content.slice(0, maxChars)}\n\n[... truncated ...]`,
    truncated: true,
  }
}

async function readFileStats(filePath: string): Promise<{ contentChars: number; includedChars: number }> {
  const content = await window.api.fs.readFile(filePath)
  return {
    contentChars: content.length,
    includedChars: Math.min(content.length, MAX_REFERENCED_FILE_CHARS),
  }
}

async function buildReferencedFileFromPath(filePath: string, rootPath: string | null): Promise<ReferencedFile | null> {
  try {
    const stats = await readFileStats(filePath)
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath
    return {
      id: `ref-${generateId()}`,
      filePath,
      relativePath: rootPath ? toDisplayPath(filePath, rootPath) : filePath,
      fileName,
      language: detectLanguage(fileName),
      contentChars: stats.contentChars,
      includedChars: stats.includedChars,
    }
  } catch {
    return null
  }
}

async function resolveTypedMentionFiles(
  text: string,
  rootPath: string | null,
  currentReferencedFiles: ReferencedFile[],
): Promise<ReferencedFile[]> {
  if (!rootPath) return currentReferencedFiles

  const matches = Array.from(text.matchAll(/(?:^|\s)@([^\s@]+)/g))
  if (matches.length === 0) return currentReferencedFiles

  const knownPaths = new Set(currentReferencedFiles.map((file) => normalizePath(file.filePath)))
  const nextFiles = [...currentReferencedFiles]

  for (const match of matches) {
    const rawToken = normalizeRelativePath(match[1] ?? '')
    if (!rawToken) continue

    const directPath = joinPath(rootPath, rawToken)
    const directFile = await buildReferencedFileFromPath(directPath, rootPath)
    if (directFile) {
      const normalized = normalizePath(directFile.filePath)
      if (!knownPaths.has(normalized)) {
        knownPaths.add(normalized)
        nextFiles.push(directFile)
      }
      continue
    }

    try {
      const results = await window.api.search.findFiles(rootPath, rawToken, { limit: 12 })
      const exact = results.find((result) => normalizeRelativePath(result.relativePath) === rawToken) ?? results[0]
      if (!exact) continue
      const resolved = await buildReferencedFileFromPath(exact.filePath, rootPath)
      if (!resolved) continue
      const normalized = normalizePath(resolved.filePath)
      if (!knownPaths.has(normalized)) {
        knownPaths.add(normalized)
        nextFiles.push(resolved)
      }
    } catch {
      // Ignore unresolved typed mentions; they remain plain text.
    }
  }

  return nextFiles.slice(0, MAX_REFERENCED_FILES)
}

function buildEditorContextText(
  activeEditorTab: ActiveEditorTab | undefined,
  cursorInfo: ActiveCursorInfo,
  rootPath: string | null,
): string | null {
  if (!activeEditorTab) return null

  const selection = cursorInfo?.selection
  const displayPath = toDisplayPath(activeEditorTab.filePath, rootPath)
  const lines = [
    '[Active editor context]',
    'IMPORTANT: The context below is provided by the GUI as a preview only. It does NOT count as a Claude Code Read tool call.',
    'If you plan to modify this file with Edit, MultiEdit, or Write, you MUST call Read on the file path below first in this request, even if the snippet already looks sufficient.',
    `File: ${displayPath}`,
    `Absolute path: ${activeEditorTab.filePath}`,
    `Language: ${activeEditorTab.language}`,
  ]

  const selections = cursorInfo?.selections?.filter((item) => !item.isEmpty) ?? []
  if (selections.length === 0 && (!selection || selection.isEmpty)) {
    lines.push('Use the active file as primary context when it is relevant to the request.')
    return lines.join('\n')
  }

  const effectiveSelections = selections.length > 0
    ? selections
    : (selection && !selection.isEmpty ? [selection] : [])

  lines.push(`Selected blocks: ${effectiveSelections.length}`)
  lines.push('The user selected the following code in the editor. Prioritize these selections and the immediate surrounding logic.')

  effectiveSelections.forEach((item, index) => {
    lines.push('')
    lines.push(`Selection ${index + 1}: ${formatSelectionRange(item)}`)
    lines.push(`\`\`\`${activeEditorTab.language}`)
    lines.push(item.text)
    lines.push('```')
  })

  return lines.join('\n')
}

async function buildReferencedFilesText(referencedFiles: ReferencedFile[]): Promise<string | null> {
  if (referencedFiles.length === 0) return null

  const blocks = await Promise.all(
    referencedFiles.slice(0, MAX_REFERENCED_FILES).map(async (file) => {
      try {
        const content = await window.api.fs.readFile(file.filePath)
        const { text, truncated } = truncateContent(content, MAX_REFERENCED_FILE_CHARS)
        return [
          `File: ${file.relativePath}`,
          `Absolute path: ${file.filePath}`,
          `Language: ${file.language}`,
          truncated ? `Note: truncated to the first ${MAX_REFERENCED_FILE_CHARS.toLocaleString()} characters.` : null,
          '',
          `\`\`\`${file.language}`,
          text,
          '```',
        ].filter(Boolean).join('\n')
      } catch (error) {
        return [
          `File: ${file.relativePath}`,
          `Absolute path: ${file.filePath}`,
          `Error: failed to read file content (${error instanceof Error ? error.message : 'unknown error'}).`,
        ].join('\n')
      }
    }),
  )

  return [
    '[Referenced files]',
    'IMPORTANT: These file contents are attached by the GUI for convenience. They do NOT satisfy Claude Code\'s read-before-edit requirement.',
    'If you need to modify any referenced file, call Read on that file path first in this request before using Edit, MultiEdit, or Write.',
    ...blocks,
  ].join('\n\n')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function getRecordString(record: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function getRecordNumber(record: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function getRecordBoolean(record: Record<string, unknown> | null, ...keys: string[]): boolean | null {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return null
}

function summarizeText(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function getToolTargetPath(rawInput: unknown): string | null {
  const record = asRecord(rawInput)
  return getRecordString(record, 'file_path', 'path', 'target_file', 'targetPath', 'absolute_path')
}

function getToolRangeSummary(rawInput: unknown): string | null {
  const record = asRecord(rawInput)
  const startLine = getRecordNumber(record, 'start_line', 'startLine', 'line')
  const endLine = getRecordNumber(record, 'end_line', 'endLine')
  if (startLine !== null && endLine !== null) {
    return `lines ${startLine}-${endLine}`
  }
  if (startLine !== null) {
    return `line ${startLine}`
  }

  const offset = getRecordNumber(record, 'offset')
  const limit = getRecordNumber(record, 'limit')
  if (offset !== null && limit !== null) {
    return `offset ${offset}, limit ${limit}`
  }
  return null
}

function getToolNavigationTarget(rawInput: unknown): { line: number; column: number; endLine?: number; endColumn?: number } | null {
  const record = asRecord(rawInput)
  const startLine = getRecordNumber(record, 'start_line', 'startLine', 'line')
  const endLine = getRecordNumber(record, 'end_line', 'endLine')
  const startColumn = getRecordNumber(record, 'start_column', 'startColumn', 'column') ?? 1
  const endColumn = getRecordNumber(record, 'end_column', 'endColumn') ?? startColumn
  if (startLine !== null) {
    return {
      line: Math.max(1, startLine),
      column: Math.max(1, startColumn),
      endLine: endLine !== null ? Math.max(1, endLine) : Math.max(1, startLine),
      endColumn: Math.max(1, endColumn),
    }
  }

  const offset = getRecordNumber(record, 'offset')
  const limit = getRecordNumber(record, 'limit')
  if (offset !== null) {
    return {
      line: Math.max(1, offset),
      column: 1,
      endLine: limit !== null ? Math.max(1, offset + Math.max(0, limit - 1)) : Math.max(1, offset),
      endColumn: 1,
    }
  }

  return null
}

function buildToolHeadline(message: ClaudeGuiMessage, rootPath: string | null): string {
  const filePath = getToolTargetPath(message.rawInput)
  if (!filePath) return message.toolName ?? 'Tool'
  return `${message.toolName ?? 'Tool'} ${toDisplayPath(filePath, rootPath)}`
}

function buildToolSummary(message: ClaudeGuiMessage, result?: ClaudeGuiMessage): string | null {
  if (result?.text?.trim()) return summarizeText(result.text)
  if (result?.hidden && result.text?.trim()) return summarizeText(result.text)
  if (message.status?.trim()) return summarizeText(message.status)
  return null
}

function buildToolLanguage(rawInput: unknown): string {
  const filePath = getToolTargetPath(rawInput)
  if (!filePath) return 'plaintext'
  return detectLanguage(filePath.split(/[\\/]/).pop() ?? filePath)
}

function getTraceSearchText(entry: TraceEntry): string {
  if (entry.kind === 'message') {
    const rawInput = entry.message.rawInput !== undefined ? stringifyInput(entry.message.rawInput) : ''
    return [entry.message.kind, entry.message.toolName, entry.message.text, rawInput].filter(Boolean).join('\n')
  }

  return [
    entry.tool.toolName,
    stringifyInput(entry.tool.rawInput),
    entry.tool.status,
    entry.result?.text,
  ].filter(Boolean).join('\n')
}

// ─── Inline diff rendering (Claude Code CLI style) ──────────────────────────
//
// Shows a unified line-level diff inline under Edit / Write / MultiEdit tool
// calls. Layout mirrors claude-code's StructuredDiff: right-aligned line
// number gutter + sigil (+/-) + code content, tinted green/red for adds/
// removes. Between hunks we draw a dotted separator (claude-code uses "...").

interface InlineEdit {
  oldString: string
  newString: string
}

/** Extract line-diffable edits from a tool's rawInput across Edit variants. */
function extractInlineEdits(rawInput: unknown): InlineEdit[] {
  const record = asRecord(rawInput)
  if (!record) return []

  // MultiEdit — sequence of { old_string, new_string } applied in order
  const edits = record.edits
  if (Array.isArray(edits) && edits.length > 0) {
    const out: InlineEdit[] = []
    for (const item of edits) {
      const rec = asRecord(item)
      if (!rec) continue
      const o = getRecordString(rec, 'old_string', 'oldText')
      const n = getRecordString(rec, 'new_string', 'newText')
      if (o === null && n === null) continue
      out.push({ oldString: o ?? '', newString: n ?? '' })
    }
    return out
  }

  // Edit — single old_string / new_string
  const oldStr = getRecordString(record, 'old_string', 'oldText')
  const newStr = getRecordString(record, 'new_string', 'newText')
  if (oldStr !== null || newStr !== null) {
    return [{ oldString: oldStr ?? '', newString: newStr ?? '' }]
  }

  // Write — full-file content (all new lines)
  const content = getRecordString(record, 'content', 'file_text')
  if (content !== null) {
    return [{ oldString: '', newString: content }]
  }

  return []
}

function buildHunks(edits: InlineEdit[]): StructuredPatchHunk[] {
  const hunks: StructuredPatchHunk[] = []
  for (const edit of edits) {
    // 2 lines of context before/after each change region — matches claude-code
    const patch = structuredPatch('a', 'b', edit.oldString, edit.newString, '', '', { context: 2 })
    hunks.push(...patch.hunks)
  }
  return hunks
}

interface DiffLineRow {
  sigil: '+' | '-' | ' '
  oldNum: number | null
  newNum: number | null
  code: string
}

function materializeHunk(hunk: StructuredPatchHunk): DiffLineRow[] {
  const rows: DiffLineRow[] = []
  let oldCursor = hunk.oldStart
  let newCursor = hunk.newStart
  for (const rawLine of hunk.lines) {
    if (rawLine === '\\ No newline at end of file') continue
    const sigilChar = rawLine.charAt(0)
    const code = rawLine.slice(1)
    if (sigilChar === '+') {
      rows.push({ sigil: '+', oldNum: null, newNum: newCursor, code })
      newCursor += 1
    } else if (sigilChar === '-') {
      rows.push({ sigil: '-', oldNum: oldCursor, newNum: null, code })
      oldCursor += 1
    } else {
      rows.push({ sigil: ' ', oldNum: oldCursor, newNum: newCursor, code })
      oldCursor += 1
      newCursor += 1
    }
  }
  return rows
}

function InlineDiff({ rawInput }: { rawInput: unknown }): JSX.Element | null {
  const edits = useMemo(() => extractInlineEdits(rawInput), [rawInput])
  const hunks = useMemo(() => buildHunks(edits), [edits])
  const language = useMemo(() => buildToolLanguage(rawInput), [rawInput])

  if (hunks.length === 0) return null

  const allRows = hunks.map(materializeHunk)
  let added = 0
  let removed = 0
  let maxLineNum = 1
  for (const rows of allRows) {
    for (const r of rows) {
      if (r.sigil === '+') added += 1
      if (r.sigil === '-') removed += 1
      const biggest = Math.max(r.oldNum ?? 0, r.newNum ?? 0)
      if (biggest > maxLineNum) maxLineNum = biggest
    }
  }
  const gutterWidth = String(maxLineNum).length

  const summaryParts: string[] = []
  if (added > 0) summaryParts.push(`Added ${added} ${added === 1 ? 'line' : 'lines'}`)
  if (removed > 0) summaryParts.push(`removed ${removed} ${removed === 1 ? 'line' : 'lines'}`)
  const summary = summaryParts.join(', ')

  return (
    <div className="mt-2 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]/50 bg-[var(--color-bg-primary)]/50">
      {summary && (
        <div className="border-b border-[var(--color-border)]/40 px-3 py-1 text-[11px] text-[var(--color-text-tertiary)]">
          {summary}
        </div>
      )}
      <div className="ai-summary-content overflow-x-auto font-mono text-[13px] leading-[20px]">
        {allRows.map((rows, hunkIdx) => (
          <div key={hunkIdx}>
            {hunkIdx > 0 && (
              <div className="select-none px-3 py-0.5 text-center text-[10px] text-[var(--color-text-tertiary)]/70">
                ⋯
              </div>
            )}
            {rows.map((row, rowIdx) => {
              const lineNum = row.sigil === '-' ? row.oldNum : row.newNum
              const numText = (lineNum != null ? String(lineNum) : '').padStart(gutterWidth, ' ')
              // Claude Code CLI uses a slightly saturated bg for changed lines
              // so the syntax-highlighted tokens still have enough contrast.
              const rowBg = row.sigil === '+'
                ? 'bg-[#7cd992]/18'
                : row.sigil === '-'
                  ? 'bg-[#f38ba8]/18'
                  : ''
              const highlighted = highlightCode(row.code || ' ', language)
              return (
                <div key={`${hunkIdx}-${rowIdx}`} className={cn('flex whitespace-pre', rowBg)}>
                  <span className="select-none shrink-0 px-2 text-[var(--color-text-tertiary)]/60">{numText}</span>
                  <span
                    className={cn(
                      'select-none shrink-0 pr-1 w-3 font-semibold',
                      row.sigil === '+' ? 'text-[#7cd992]' : row.sigil === '-' ? 'text-[#f38ba8]' : '',
                    )}
                  >
                    {row.sigil === ' ' ? '' : row.sigil}
                  </span>
                  <span
                    className="pr-3 text-[var(--color-text-primary)]"
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

type TraceEntry =
  | { kind: 'message'; id: string; message: ClaudeGuiMessage }
  | { kind: 'tool'; id: string; tool: ClaudeGuiMessage; result?: ClaudeGuiMessage }

function buildTraceEntries(messages: ClaudeGuiMessage[]): TraceEntry[] {
  const consumedResultIds = new Set<string>()
  const entries: TraceEntry[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]

    if (message.kind === 'tool-use') {
      let result: ClaudeGuiMessage | undefined
      for (let probe = index + 1; probe < messages.length; probe += 1) {
        const candidate = messages[probe]
        if (candidate.kind === 'tool-use') break
        if (candidate.kind !== 'tool-result') continue

        const sameToolUse = message.toolUseId && candidate.toolUseId === message.toolUseId
        const sameToolName = !message.toolUseId && candidate.toolName && candidate.toolName === message.toolName
        if (!sameToolUse && !sameToolName) continue

        consumedResultIds.add(candidate.id)
        result = candidate
        break
      }

      entries.push({ kind: 'tool', id: message.id, tool: message, result })
      continue
    }

    if (message.kind === 'tool-result' && consumedResultIds.has(message.id)) {
      continue
    }

    entries.push({ kind: 'message', id: message.id, message })
  }

  return entries
}

function TraceRail({ tone, isLast }: { tone: string; isLast: boolean }): JSX.Element {
  return (
    <div className="flex w-4 shrink-0 flex-col items-center">
      <div className={cn('mt-1.5 h-2.5 w-2.5 rounded-full border border-white/10', tone)} />
      {!isLast && <div className="mt-1 h-full w-px flex-1 bg-[var(--color-border)]/55" />}
    </div>
  )
}

function ToolSection({
  id,
  label,
  expanded,
  onToggle,
  collapsible = true,
  children,
}: {
  id: string
  label: string
  expanded: boolean
  onToggle: (id: string) => void
  collapsible?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <div className="mt-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/70">
      {collapsible ? (
        <button
          onClick={() => onToggle(id)}
          className="flex w-full items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]"
        >
          <span>{label}</span>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      ) : (
        <div className="flex w-full items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
          <span>{label}</span>
        </div>
      )}
      {expanded && children}
    </div>
  )
}

function MessageCard({ entry, conversation, rootPath, isLast, onOpenFile, onOpenPatchDiff, onRevertPatchFile, isSearchMatch, isActiveSearchMatch, requestPayload, failedToolName, onRetry, expandedSections, onToggleSection }: {
  entry: TraceEntry
  conversation: ClaudeGuiConversation
  rootPath: string | null
  isLast: boolean
  onOpenFile: (filePath: string, location?: { line: number; column: number; endLine?: number; endColumn?: number } | null) => void
  onOpenPatchDiff: (file: ClaudeGuiPatchFile) => void
  onRevertPatchFile: (review: ClaudeGuiPatchReview, filePath: string) => void
  isSearchMatch: boolean
  isActiveSearchMatch: boolean
  requestPayload?: ClaudeGuiRequestPayload
  failedToolName?: string | null
  onRetry: (requestId: string, mode: 'same' | 'failed') => void
  expandedSections: Record<string, boolean>
  onToggleSection: (id: string) => void
}): ReactNode {
  const matchClass = isActiveSearchMatch
    ? 'ring-1 ring-[var(--color-accent)]/80 ring-offset-0'
    : isSearchMatch
      ? 'ring-1 ring-[var(--color-accent)]/35 ring-offset-0'
      : ''
  const typography = getMessageTypography(conversation.preferences.messageTextSize)

  if (entry.kind === 'tool') {
    const summary = buildToolSummary(entry.tool, entry.result)
    const rangeSummary = getToolRangeSummary(entry.tool.rawInput)
    const isError = entry.result?.isError === true
    const targetPath = getToolTargetPath(entry.tool.rawInput)
    const targetLocation = getToolNavigationTarget(entry.tool.rawInput)
    const patchReview = entry.tool.toolUseId
      ? conversation.patchReviews.find((review) => review.toolUseId === entry.tool.toolUseId) ?? null
      : null

    return (
      <div id={`claude-trace-${entry.id}`} className={cn('mx-4 mb-4 flex gap-3 rounded-[var(--radius-lg)] px-0 pb-0', matchClass)}>
        <TraceRail tone={isError ? 'bg-[var(--color-error)]' : 'bg-[#7cd992]'} isLast={isLast} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
            {targetPath ? (
              <button
                onClick={() => onOpenFile(targetPath, targetLocation)}
                className="truncate text-left hover:text-[var(--color-accent)]"
                title={targetPath}
              >
                {buildToolHeadline(entry.tool, rootPath)}
              </button>
            ) : (
              <span>{buildToolHeadline(entry.tool, rootPath)}</span>
            )}
            {targetPath && (
              <button
                onClick={() => onOpenFile(targetPath, targetLocation)}
                className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
                title="打开文件"
              >
                <FolderOpen size={12} />
              </button>
            )}
            {rangeSummary && (
              <span className="rounded-full bg-[var(--color-bg-primary)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                {rangeSummary}
              </span>
            )}
          </div>
          {summary && (
            <div className={cn(
              'mt-1 text-[12px] leading-5',
              isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]',
            )}>
              {summary}
            </div>
          )}
          {/* Inline unified diff — rendered directly under Edit / Write /
              MultiEdit tool calls so users can see changes without expanding
              a collapsible section. Mirrors Claude Code CLI's diff layout. */}
          <InlineDiff rawInput={entry.tool.rawInput} />
          {/* Patch review (revert/diff buttons) — kept compact, no wrapping
              ToolSection. Useful actions stay one click away; the noisy
              Before/After diff column, Raw Input JSON dump, and Tool Result
              markdown rendering have all been removed per user feedback to
              match Claude Code CLI's minimal tool output style. */}
          {patchReview && (
            <div className="mt-1.5 space-y-1">
              {patchReview.files.map((file) => (
                <div key={file.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)]/60 bg-[var(--color-bg-secondary)]/40 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => onOpenFile(file.filePath, { line: 1, column: 1 })}
                    className="min-w-0 truncate text-left text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
                    title={file.filePath}
                  >
                    {file.relativePath}
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenPatchDiff(file)}
                      className="flex h-5 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[10px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                      title="查看 diff"
                    >
                      <Diff size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRevertPatchFile(patchReview, file.filePath)}
                      className="flex h-5 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[10px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]"
                      title="回滚此文件改动"
                    >
                      <RotateCcw size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const message = entry.message
  if (message.kind === 'stats') {
    return null
  }

  const tone =
    message.kind === 'user'
      ? 'bg-[var(--color-accent)]'
      : message.kind === 'assistant'
        ? 'bg-[#7cd992]'
        : message.kind === 'thinking'
          ? 'bg-[var(--color-text-tertiary)]'
          : message.kind === 'error'
            ? 'bg-[var(--color-error)]'
            : 'bg-[var(--color-text-tertiary)]'

  const label =
    message.kind === 'user'
      ? 'You'
      : message.kind === 'assistant'
        ? 'Claude'
        : message.kind === 'thinking'
          ? 'Thinking'
          : message.kind === 'error'
            ? 'Error'
            : message.toolName || 'System'

  const contentClass =
    message.kind === 'user'
      ? 'overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/78 px-4 py-3'
      : message.kind === 'error'
        ? 'overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-error)]/25 bg-[var(--color-error)]/10 px-4 py-3'
        : message.kind === 'system'
          ? 'overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-3'
          : ''

  if (message.kind === 'user') {
    const requestId = typeof message.meta?.requestId === 'string' ? message.meta.requestId : null
    return (
      <div id={`claude-trace-${entry.id}`} className={cn('mx-4 mb-4', matchClass)}>
        <div className="min-w-0">
          <div className={contentClass}>
            {message.text && (
              <div className={cn('whitespace-pre-wrap break-words text-[var(--color-text-primary)]', typography.body)}>{message.text}</div>
            )}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {message.attachments.map((attachment) => (
                  <span
                    key={attachment}
                    className="inline-flex max-w-full min-w-0 whitespace-normal break-all rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 text-left text-[10px] leading-4 text-[var(--color-text-secondary)]"
                  >
                    {attachment}
                  </span>
                ))}
              </div>
            )}
            {requestId && (
              <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                <button
                  onClick={() => onRetry(requestId, 'same')}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  title={requestPayload ? '基于相同上下文重新生成' : '使用当前可恢复上下文重试'}
                >
                  <RotateCcw size={10} />
                  Retry
                </button>
                {failedToolName && (
                  <button
                    onClick={() => onRetry(requestId, 'failed')}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-error)]/35 bg-[var(--color-error)]/10 px-2 py-1 text-[10px] text-[var(--color-error)]"
                  >
                    <Redo2 size={10} />
                    Retry Failed
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (message.kind === 'thinking') {
    const messageIndex = conversation.messages.findIndex((item) => item.id === message.id)
    const nextTimestamp = messageIndex >= 0
      ? conversation.messages.slice(messageIndex + 1).find((item) => item.kind !== 'thinking')?.createdAt ?? conversation.updatedAt
      : conversation.updatedAt
    const thoughtSeconds = Math.max(1, Math.floor((nextTimestamp - message.createdAt) / 1000))
    const thoughtKey = `thinking-${message.id}`
    const expanded = expandedSections[thoughtKey] === true

    return (
      <div id={`claude-trace-${entry.id}`} className={cn('mx-4 mb-3', matchClass)}>
        <button
          onClick={() => onToggleSection(thoughtKey)}
          className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
        >
          <span className="text-[16px] leading-none">•</span>
          <span>{`Thought for ${thoughtSeconds}s`}</span>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {expanded && message.text && (
          <div className={cn('ai-summary-content mt-2 pl-5 text-[var(--color-text-secondary)]', typography.thinking)} dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }} />
        )}
      </div>
    )
  }

  if (message.kind === 'assistant') {
    return (
      <div id={`claude-trace-${entry.id}`} className={cn('mx-4 mb-5', matchClass)}>
        {message.text && (
          <div
            className={cn('ai-summary-content text-[var(--color-text-primary)]', typography.assistant)}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
          />
        )}
      </div>
    )
  }

  return (
    <div id={`claude-trace-${entry.id}`} className={cn('mx-4 mb-4 flex gap-3 rounded-[var(--radius-lg)] px-0 pb-0', matchClass)}>
      <TraceRail tone={tone} isLast={isLast} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-tertiary)]">
          <span>{label}</span>
        </div>
        <div className={contentClass}>
          {message.text && (
            message.kind === 'tool-result'
              ? <div className={cn('ai-summary-content text-[var(--color-text-primary)]', typography.body)} dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }} />
              : <div className={cn('whitespace-pre-wrap break-words text-[var(--color-text-primary)]', typography.body)}>{message.text}</div>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {message.attachments.map((attachment) => (
                <span
                  key={attachment}
                  className="inline-flex max-w-full min-w-0 whitespace-normal break-all rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 text-left text-[10px] leading-4 text-[var(--color-text-secondary)]"
                >
                  {attachment}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface ClaudeCodePanelProps {
  sessionId?: string
}

function normalizeSlashToken(value: string): string {
  return value.trim().toLowerCase()
}

function canonicalLocalCommandName(value: string): string {
  const normalized = normalizeSlashToken(value)
  switch (normalized) {
    case '?':
      return 'help'
    case 'chat':
      return 'new'
    case 'chats':
      return 'history'
    case 'config':
      return 'settings'
    case 'usage':
      return 'stats'
    case 'file':
      return 'files'
    case 'reset':
      return 'clear'
    case 'thinking':
      return 'think'
    case 'language':
      return 'lang'
    case 'skills':
      return 'skill'
    default:
      return normalized
  }
}

function findLanguageOption(query: string): NonNullable<ClaudeGuiPreferences['language']> | null {
  const normalized = normalizeSlashToken(query)
  if (!normalized) return null

  const option = LANGUAGE_OPTIONS.find((item) => (
    item.value === normalized
    || item.label.toLowerCase() === normalized
  ))
  return option?.value ?? null
}

function findModelOption(query: string): string | null {
  const normalized = normalizeSlashToken(query)
  if (!normalized) return null

  const compactQuery = normalized.replace(/\s+/g, '')
  const option = MODEL_OPTIONS.find((item) => {
    const compactLabel = item.label.toLowerCase().replace(/\s+/g, '')
    return (
      item.value.toLowerCase() === normalized
      || item.label.toLowerCase() === normalized
      || compactLabel === compactQuery
      || item.value.toLowerCase().startsWith(normalized)
      || compactLabel.startsWith(compactQuery)
    )
  })

  return option?.value ?? null
}

function resolveToggleArg(value: string): boolean | null {
  const normalized = normalizeSlashToken(value)
  if (!normalized || normalized === 'toggle') return null
  if (['on', 'true', '1', 'enable', 'enabled'].includes(normalized)) return true
  if (['off', 'false', '0', 'disable', 'disabled'].includes(normalized)) return false
  return null
}

function findSkillEntry(skills: ClaudeGuiSkillCatalogEntry[], skillName: string): ClaudeGuiSkillCatalogEntry | null {
  const normalized = normalizeSlashToken(skillName)
  if (!normalized) return null
  return skills.find((skill) => normalizeSlashToken(skill.name) === normalized) ?? null
}

function extractSkillInvocation(
  parsed: NonNullable<ReturnType<typeof parseComposerSlashCommand>>,
  skills: ClaudeGuiSkillCatalogEntry[],
): { skill: ClaudeGuiSkillCatalogEntry; request: string } | null {
  if (parsed.normalizedName === 'skill' || parsed.normalizedName === 'skills') {
    if (!parsed.args.trim()) return null
    const [skillName, ...rest] = parsed.args.trim().split(/\s+/)
    const skill = findSkillEntry(skills, skillName ?? '')
    if (!skill) return null
    return {
      skill,
      request: rest.join(' ').trim(),
    }
  }

  const directSkill = findSkillEntry(skills, parsed.commandName)
  if (!directSkill) return null
  return {
    skill: directSkill,
    request: parsed.args.trim(),
  }
}

function buildSkillPromptText(skill: ClaudeGuiSkillCatalogEntry, request: string): string {
  const requestText = request.trim() || `Apply the ${skill.name} skill to the current task.`
  const skillSummary = skill.description.replace(/\s+/g, ' ').trim().slice(0, 600)
  return [
    '[Requested skill]',
    `The user intentionally invoked the "${skill.name}" skill from the GUI slash command palette.`,
    skillSummary ? `Skill summary: ${skillSummary}` : '',
    'If this skill is available in the current Claude environment, apply it faithfully.',
    'If the exact skill is not available, say so explicitly and continue with the best equivalent workflow instead of failing silently.',
    '',
    '[User request]',
    requestText,
  ].filter(Boolean).join('\n')
}

export function ClaudeCodePanel({ sessionId }: ClaudeCodePanelProps = {}): JSX.Element {
  const projects = useProjectsStore((state) => state.projects)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)
  const worktrees = useWorktreesStore((state) => state.worktrees)
  const hostSession = useSessionsStore((state) => (sessionId ? state.sessions.find((session) => session.id === sessionId) : undefined))
  const addSession = useSessionsStore((state) => state.addSession)
  const activeTabId = usePanesStore((state) => state.paneActiveSession[state.activePaneId] ?? null)
  const activePaneId = usePanesStore((state) => state.activePaneId)
  const addSessionToPane = usePanesStore((state) => state.addSessionToPane)
  const setPaneActiveSession = usePanesStore((state) => state.setPaneActiveSession)
  const lastFocusedTabId = useEditorsStore((state) => state.lastFocusedTabId)
  const cursorInfo = useEditorsStore((state) => state.cursorInfo)
  const conversations = useClaudeGuiStore((state) => state.conversations)
  const selectedConversationByScope = useClaudeGuiStore((state) => state.selectedConversationByScope)
  const defaultPreferences = useClaudeGuiStore((state) => state.preferences)
  const slashCommandUsage = useClaudeGuiStore((state) => state.slashCommandUsage)
  const recordSlashCommandUsage = useClaudeGuiStore((state) => state.recordSlashCommandUsage)
  const updatePreferences = useClaudeGuiStore((state) => state.updatePreferences)
  const updateConversationPreferences = useClaudeGuiStore((state) => state.updateConversationPreferences)
  const updateConversationMeta = useClaudeGuiStore((state) => state.updateConversationMeta)
  const createConversation = useClaudeGuiStore((state) => state.createConversation)
  const cloneConversation = useClaudeGuiStore((state) => state.cloneConversation)
  const selectConversation = useClaudeGuiStore((state) => state.selectConversation)
  const removeConversation = useClaudeGuiStore((state) => state.removeConversation)
  const beginRequest = useClaudeGuiStore((state) => state.beginRequest)
  const registerRequestPayload = useClaudeGuiStore((state) => state.registerRequestPayload)
  const requestPayloads = useClaudeGuiStore((state) => state.requestPayloads)
  const dismissPatchReview = useClaudeGuiStore((state) => state.dismissPatchReview)
  const dismissPatchReviewFile = useClaudeGuiStore((state) => state.dismissPatchReviewFile)
  const applyEvent = useClaudeGuiStore((state) => state.applyEvent)
  const addToast = useUIStore((state) => state.addToast)
  const openGlobalSettings = useUIStore((state) => state.openSettings)

  const [draft, setDraft] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  // Claude subscription usage panel (real /usage data from Anthropic API)
  const [usagePanel, setUsagePanel] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; data: ClaudeUtilization }
    | null
  >(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const deferredFileQuery = useDeferredValue(fileQuery)
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([])
  const [fileSearchLoading, setFileSearchLoading] = useState(false)
  const [fileSearchError, setFileSearchError] = useState<string | null>(null)
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null)
  const deferredMentionQuery = useDeferredValue(mentionMatch?.query ?? '')
  const [mentionResults, setMentionResults] = useState<FileSearchResult[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionError, setMentionError] = useState<string | null>(null)
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)
  const [composerCaret, setComposerCaret] = useState(0)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [discoveredSkills, setDiscoveredSkills] = useState<ClaudeGuiSkillCatalogEntry[]>([])
  const [skillCatalogLoading, setSkillCatalogLoading] = useState(false)
  const [skillCatalogError, setSkillCatalogError] = useState<string | null>(null)
  const [referencedFiles, setReferencedFiles] = useState<ReferencedFile[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [historyFilter, setHistoryFilter] = useState('')
  const [historyGroupFilter, setHistoryGroupFilter] = useState<string>('all')
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingConversationTitle, setEditingConversationTitle] = useState('')
  const [editingConversationGroup, setEditingConversationGroup] = useState('')
  const [isDropActive, setIsDropActive] = useState(false)
  const [processingNow, setProcessingNow] = useState(() => Date.now())
  const [historyNavigationIndex, setHistoryNavigationIndex] = useState<number | null>(null)
  const [historyNavigationDraft, setHistoryNavigationDraft] = useState<string | null>(null)
  const [permissionRequests, setPermissionRequests] = useState<ClaudeGuiPermissionRequest[]>([])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const filePickerInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const mentionResultRefs = useRef<Array<HTMLButtonElement | null>>([])
  const slashResultRefs = useRef<Array<HTMLButtonElement | null>>([])
  const fileSearchRunRef = useRef(0)
  const mentionSearchRunRef = useRef(0)

  const resolvedProjectId = sessionId ? hostSession?.projectId ?? null : selectedProjectId
  const resolvedWorktreeId = sessionId ? hostSession?.worktreeId ?? null : selectedWorktreeId
  const project = projects.find((item) => item.id === resolvedProjectId) ?? null
  const selectedWorktree = resolvedWorktreeId
    ? worktrees.find((item) => item.id === resolvedWorktreeId) ?? null
    : null
  const rootPath = selectedWorktree?.path ?? project?.path ?? null
  const worktreeScopeId = selectedWorktree && !selectedWorktree.isMain ? selectedWorktree.id : null
  const currentScopeKey = sessionId
    ? getClaudeSessionScopeKey(sessionId)
    : getClaudeScopeKey(resolvedProjectId, worktreeScopeId)
  const activeEditorTab = useEditorsStore((state) => {
    const candidateIds = [
      activeTabId?.startsWith('editor-') ? activeTabId : null,
      lastFocusedTabId,
    ].filter((value): value is string => Boolean(value))

    for (const candidateId of candidateIds) {
      const tab = state.tabs.find((item) => item.id === candidateId)
      if (
        tab
        && tab.projectId === resolvedProjectId
        && (tab.worktreeId ?? null) === worktreeScopeId
      ) {
        return tab
      }
    }
    return undefined
  })

  const scopedConversations = useMemo(
    () => scopeConversationList(conversations, currentScopeKey),
    [conversations, currentScopeKey],
  )

  const activeConversation = useMemo(() => {
    const selectedId = selectedConversationByScope[currentScopeKey]
    return scopedConversations.find((conversation) => conversation.id === selectedId) ?? scopedConversations[0] ?? null
  }, [currentScopeKey, scopedConversations, selectedConversationByScope])

  const activePreferences = activeConversation?.preferences ?? defaultPreferences
  const includeEditorContext = activePreferences.includeEditorContext
  const availableSkills = activeConversation?.availableSkills ?? []
  const mergedSkills = useMemo(
    () => mergeSkillCatalog(discoveredSkills, availableSkills),
    [availableSkills, discoveredSkills],
  )
  const slashContext = useMemo(
    () => getSlashSuggestionContext(draft, composerCaret),
    [composerCaret, draft],
  )
  const slashSuggestions = useMemo(
    () => buildSlashSuggestions({
      context: slashContext,
      skills: mergedSkills,
      usage: slashCommandUsage,
    }),
    [mergedSkills, slashCommandUsage, slashContext],
  )
  const discoveredSkillCount = mergedSkills.length
  const runtimeSkillCount = availableSkills.length

  useEffect(() => {
    if (!sessionId || !rootPath || scopedConversations.length > 0) return
    const conversationId = createConversation({
      projectId: resolvedProjectId,
      worktreeId: worktreeScopeId,
      cwd: rootPath,
      scopeKey: currentScopeKey,
      title: hostSession?.name ?? 'Claude GUI',
    })
    selectConversation(currentScopeKey, conversationId)
  }, [
    createConversation,
    currentScopeKey,
    hostSession?.name,
    resolvedProjectId,
    rootPath,
    scopedConversations.length,
    selectConversation,
    sessionId,
    worktreeScopeId,
  ])

  useEffect(() => {
    if (!activeConversation) return
    if (selectedConversationByScope[currentScopeKey] === activeConversation.id) return
    selectConversation(currentScopeKey, activeConversation.id)
  }, [activeConversation, currentScopeKey, selectConversation, selectedConversationByScope])

  useEffect(() => {
    const scopedConversationIds = new Set(scopedConversations.map((conversation) => conversation.id))

    const offRequest = window.api.session.onPermissionRequest((event) => {
      if (!event.conversationId || !scopedConversationIds.has(event.conversationId)) return
      const conversationId = event.conversationId
      setPermissionRequests((current) => (
        current.some((item) => item.id === event.id)
          ? current
          : [...current, {
              id: event.id,
              conversationId,
              toolName: event.toolName,
              detail: event.detail,
              suggestions: event.suggestions,
            }]
      ))
    })

    const offDismiss = window.api.session.onPermissionDismiss((event) => {
      setPermissionRequests((current) => current.filter((item) => item.id !== event.id))
    })

    return () => {
      offRequest()
      offDismiss()
    }
  }, [scopedConversations])

  useEffect(() => {
    if (!rootPath) {
      setDiscoveredSkills([])
      setSkillCatalogError(null)
      setSkillCatalogLoading(false)
      return
    }

    let cancelled = false
    setSkillCatalogLoading(true)
    setSkillCatalogError(null)

    void window.api.claudeGui.listSkills(rootPath)
      .then((skills) => {
        if (cancelled) return
        setDiscoveredSkills(skills)
        setSkillCatalogLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        setDiscoveredSkills([])
        setSkillCatalogLoading(false)
        setSkillCatalogError(error instanceof Error ? error.message : '技能目录读取失败')
      })

    return () => {
      cancelled = true
    }
  }, [rootPath])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [activeConversation?.messages.length])

  useEffect(() => {
    if (activeConversation?.status !== 'running') return

    setProcessingNow(Date.now())
    const timer = window.setInterval(() => {
      setProcessingNow(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [activeConversation?.currentRequestId, activeConversation?.status])

  useEffect(() => {
    setReferencedFiles([])
    setShowFilePicker(false)
    setFileQuery('')
    setFileResults([])
    setFileSearchError(null)
    setMentionMatch(null)
    setMentionResults([])
    setMentionError(null)
    setMentionSelectedIndex(0)
    setComposerCaret(0)
    setSlashSelectedIndex(0)
  }, [rootPath])

  useEffect(() => {
    if (!showFilePicker) return
    const timer = window.setTimeout(() => filePickerInputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [showFilePicker])

  useEffect(() => {
    if (!showFilePicker) return
    if (!rootPath) {
      setFileSearchLoading(false)
      setFileSearchError('先选择一个项目再搜索文件。')
      setFileResults([])
      return
    }

    const query = deferredFileQuery.trim()
    if (!query) {
      setFileSearchLoading(false)
      setFileSearchError(null)
      setFileResults([])
      return
    }

    const searchId = fileSearchRunRef.current + 1
    fileSearchRunRef.current = searchId
    setFileSearchLoading(true)
    setFileSearchError(null)

    void window.api.search.findFiles(rootPath, query, { limit: 40 })
      .then((results) => {
        if (fileSearchRunRef.current !== searchId) return
        setFileResults(results)
        setFileSearchLoading(false)
      })
      .catch((error) => {
        if (fileSearchRunRef.current !== searchId) return
        setFileResults([])
        setFileSearchLoading(false)
        setFileSearchError(error instanceof Error ? error.message : '文件搜索失败')
      })
  }, [deferredFileQuery, rootPath, showFilePicker])

  useEffect(() => {
    if (!mentionMatch) {
      setMentionLoading(false)
      setMentionResults([])
      setMentionError(null)
      return
    }

    if (!rootPath) {
      setMentionLoading(false)
      setMentionResults([])
      setMentionError('先选择一个项目再搜索文件。')
      return
    }

    const query = deferredMentionQuery.trim()
    if (!query) {
      setMentionLoading(false)
      setMentionResults([])
      setMentionError(null)
      return
    }

    const searchId = mentionSearchRunRef.current + 1
    mentionSearchRunRef.current = searchId
    setMentionLoading(true)
    setMentionError(null)

    void window.api.search.findFiles(rootPath, query, { limit: 12 })
      .then((results) => {
        if (mentionSearchRunRef.current !== searchId) return
        setMentionResults(results)
        setMentionLoading(false)
      })
      .catch((error) => {
        if (mentionSearchRunRef.current !== searchId) return
        setMentionResults([])
        setMentionLoading(false)
        setMentionError(error instanceof Error ? error.message : '文件搜索失败')
      })
  }, [deferredMentionQuery, mentionMatch, rootPath])

  useEffect(() => {
    setMentionSelectedIndex((current) => {
      if (mentionResults.length === 0) return 0
      return Math.min(current, mentionResults.length - 1)
    })
  }, [mentionResults])

  useEffect(() => {
    mentionResultRefs.current = mentionResultRefs.current.slice(0, mentionResults.length)
  }, [mentionResults.length])

  useEffect(() => {
    if (!mentionMatch || mentionResults.length === 0) return
    const target = mentionResultRefs.current[mentionSelectedIndex]
    target?.scrollIntoView({ block: 'nearest' })
  }, [mentionMatch, mentionResults, mentionSelectedIndex])

  useEffect(() => {
    setSlashSelectedIndex((current) => {
      if (slashSuggestions.length === 0) return 0
      return Math.min(current, slashSuggestions.length - 1)
    })
  }, [slashSuggestions])

  useEffect(() => {
    slashResultRefs.current = slashResultRefs.current.slice(0, slashSuggestions.length)
  }, [slashSuggestions.length])

  useEffect(() => {
    if (!slashContext || slashSuggestions.length === 0) return
    const target = slashResultRefs.current[slashSelectedIndex]
    target?.scrollIntoView({ block: 'nearest' })
  }, [slashContext, slashSelectedIndex, slashSuggestions])

  const activeSelection = activeEditorTab ? cursorInfo?.selection ?? null : null
  const activeSelections = activeEditorTab
    ? (cursorInfo?.selections?.filter((item) => !item.isEmpty) ?? [])
    : []
  const editorContextItems = useMemo(() => {
    if (!activeEditorTab) return null
    const displayPath = toDisplayPath(activeEditorTab.filePath, rootPath)
    if (activeSelections.length > 0) {
      return activeSelections.map((selection) => ({
        key: `${selection.startLine}:${selection.startColumn}:${selection.endLine}:${selection.endColumn}`,
        label: `${displayPath} · ${buildSelectionLabel(selection)}`,
      }))
    }
    if (activeSelection && !activeSelection.isEmpty) {
      return [{
        key: `${activeSelection.startLine}:${activeSelection.startColumn}:${activeSelection.endLine}:${activeSelection.endColumn}`,
        label: `${displayPath} · ${buildSelectionLabel(activeSelection)}`,
      }]
    }
    return [{ key: displayPath, label: displayPath }]
  }, [activeEditorTab, activeSelection, activeSelections, rootPath])

  const editorContextLabel = useMemo(() => {
    if (!includeEditorContext) return null
    if (!editorContextItems || editorContextItems.length === 0) return null
    const displayPath = editorContextItems[0]?.label.split(' · ')[0] ?? 'Editor'

    if (activeSelections.length > 0) {
      const ranges = activeSelections
        .slice(0, 2)
        .map((selection) => buildSelectionLineLabel(selection))
      const overflow = activeSelections.length > 2 ? ` +${activeSelections.length - 2} more` : ''
      return `${displayPath} · ${ranges.join(', ')}${overflow}`
    }

    if (activeSelection && !activeSelection.isEmpty) {
      return `${displayPath} · ${buildSelectionLineLabel(activeSelection)}`
    }

    return displayPath
  }, [activeEditorTab, activeSelection, activeSelections, editorContextItems, includeEditorContext])

  const closeMentionPicker = useCallback(() => {
    setMentionMatch(null)
    setMentionResults([])
    setMentionError(null)
    setMentionLoading(false)
    setMentionSelectedIndex(0)
  }, [])

  const updateMentionPicker = useCallback((text: string, caret: number) => {
    const nextMatch = getMentionMatch(text, caret)
    setMentionMatch((current) => {
      if (
        current?.start === nextMatch?.start
        && current?.end === nextMatch?.end
        && current?.query === nextMatch?.query
      ) {
        return current
      }
      return nextMatch
    })
    setMentionSelectedIndex(0)
  }, [])

  const updateActivePreferences = useCallback((updates: Partial<ClaudeGuiPreferences>) => {
    if (activeConversation) {
      updateConversationPreferences(activeConversation.id, updates)
      return
    }
    updatePreferences(updates)
  }, [activeConversation, updateConversationPreferences, updatePreferences])

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }, [])

  const openFileFromTrace = useCallback((filePath: string, location?: { line: number; column: number; endLine?: number; endColumn?: number } | null) => {
    const context = {
      projectId: resolvedProjectId,
      worktreeId: worktreeScopeId ?? null,
    }
    const tabId = location
      ? useEditorsStore.getState().openFileAtLocation(filePath, location, context)
      : useEditorsStore.getState().openFile(filePath, context)
    addSessionToPane(activePaneId, tabId)
    setPaneActiveSession(activePaneId, tabId)
  }, [activePaneId, addSessionToPane, resolvedProjectId, setPaneActiveSession, worktreeScopeId])

  const insertAtCursor = useCallback((textToInsert: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setDraft((current) => `${current}${textToInsert}`)
      setComposerCaret((current) => current + textToInsert.length)
      return
    }

    const selectionStart = textarea.selectionStart ?? draft.length
    const selectionEnd = textarea.selectionEnd ?? selectionStart
    const nextValue = `${draft.slice(0, selectionStart)}${textToInsert}${draft.slice(selectionEnd)}`
    setDraft(nextValue)
    setComposerCaret(selectionStart + textToInsert.length)

    requestAnimationFrame(() => {
      const nextCaret = selectionStart + textToInsert.length
      textarea.focus()
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }, [draft])

  const replaceComposerRange = useCallback((start: number, end: number, replacement: string) => {
    const safeStart = Math.max(0, start)
    const safeEnd = Math.max(safeStart, end)
    const nextValue = `${draft.slice(0, safeStart)}${replacement}${draft.slice(safeEnd)}`
    const nextCaret = safeStart + replacement.length

    setDraft(nextValue)
    setComposerCaret(nextCaret)

    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }, [draft])

  const applyComposerTemplate = useCallback((value: string) => {
    setDraft(value)
    setComposerCaret(value.length)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(value.length, value.length)
    })
  }, [])

  const addReferencedFile = useCallback(async (filePath: string, relativePath: string, fileName?: string): Promise<boolean> => {
    if (referencedFiles.some((item) => normalizePath(item.filePath) === normalizePath(filePath))) {
      return true
    }
    if (referencedFiles.length >= MAX_REFERENCED_FILES) {
      addToast({
        title: '引用文件过多',
        body: `一次最多附带 ${MAX_REFERENCED_FILES} 个文件，请先移除不需要的引用。`,
        type: 'warning',
      })
      return false
    }

    const resolved = await buildReferencedFileFromPath(filePath, rootPath)
    if (!resolved) {
      addToast({
        title: '引用文件失败',
        body: '无法读取该文件内容，不能加入上下文。',
        type: 'error',
      })
      return false
    }

    setReferencedFiles((current) => {
      if (current.some((item) => normalizePath(item.filePath) === normalizePath(filePath))) {
        return current
      }
      return [...current, {
        ...resolved,
        relativePath: relativePath || resolved.relativePath,
        fileName: fileName || resolved.fileName,
      }]
    })
    return true
  }, [addToast, referencedFiles, rootPath])

  const handleSelectReferencedFile = useCallback(async (result: FileSearchResult) => {
    const didAdd = await addReferencedFile(result.filePath, result.relativePath, result.fileName)
    if (!didAdd) return

    insertAtCursor(`@${result.relativePath} `)
    setShowFilePicker(false)
    setFileQuery('')
    setFileResults([])
    setFileSearchError(null)
  }, [addReferencedFile, insertAtCursor])

  const handleSelectMentionResult = useCallback(async (result: FileSearchResult) => {
    if (!mentionMatch) return
    const didAdd = await addReferencedFile(result.filePath, result.relativePath, result.fileName)
    if (!didAdd) return

    const replacement = `@${result.relativePath} `
    setDraft((current) => `${current.slice(0, mentionMatch.start)}${replacement}${current.slice(mentionMatch.end)}`)
    closeMentionPicker()
    setComposerCaret(mentionMatch.start + replacement.length)

    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const nextCaret = mentionMatch.start + replacement.length
      textarea.focus()
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }, [addReferencedFile, closeMentionPicker, mentionMatch])

  const promptHistory = useMemo(() => {
    const entries = scopedConversations
      .flatMap((conversation) => conversation.messages)
      .filter((message): message is ClaudeGuiMessage & { text: string } => (
        message.kind === 'user'
        && typeof message.text === 'string'
        && message.text.trim().length > 0
      ))
      .sort((left, right) => right.createdAt - left.createdAt)

    const seen = new Set<string>()
    const history: string[] = []

    for (const entry of entries) {
      const normalized = entry.text.trim()
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      history.push(normalized)
    }

    return history
  }, [scopedConversations])

  const clearComposer = useCallback(() => {
    setDraft('')
    setComposerCaret(0)
    setSlashSelectedIndex(0)
    setHistoryNavigationIndex(null)
    setHistoryNavigationDraft(null)
    setPendingImages([])
    setReferencedFiles([])
    setShowFilePicker(false)
    setFileQuery('')
    setFileResults([])
    setFileSearchError(null)
    closeMentionPicker()
  }, [closeMentionPicker])

  const applyDraftValue = useCallback((value: string) => {
    setDraft(value)
    setComposerCaret(value.length)
    closeMentionPicker()

    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(value.length, value.length)
    })
  }, [closeMentionPicker])

  const navigatePromptHistory = useCallback((direction: 'previous' | 'next') => {
    if (promptHistory.length === 0) return false

    if (direction === 'previous') {
      const nextIndex = historyNavigationIndex === null
        ? 0
        : Math.min(historyNavigationIndex + 1, promptHistory.length - 1)

      if (historyNavigationIndex === null) {
        setHistoryNavigationDraft(draft)
      }
      setHistoryNavigationIndex(nextIndex)
      applyDraftValue(promptHistory[nextIndex] ?? '')
      return true
    }

    if (historyNavigationIndex === null) return false

    const nextIndex = historyNavigationIndex - 1
    if (nextIndex >= 0) {
      setHistoryNavigationIndex(nextIndex)
      applyDraftValue(promptHistory[nextIndex] ?? '')
      return true
    }

    setHistoryNavigationIndex(null)
    applyDraftValue(historyNavigationDraft ?? '')
    setHistoryNavigationDraft(null)
    return true
  }, [applyDraftValue, draft, historyNavigationDraft, historyNavigationIndex, promptHistory])

  const handleNewConversation = (): void => {
    if (!rootPath) return
    const id = createConversation({
      projectId: resolvedProjectId,
      worktreeId: worktreeScopeId,
      cwd: rootPath,
      scopeKey: currentScopeKey,
      title: sessionId ? hostSession?.name ?? 'Claude GUI' : 'Claude Code Chat',
    })
    selectConversation(currentScopeKey, id)
    setShowHistory(false)
  }

  const handleSelectSlashSuggestion = useCallback((suggestion: ClaudeGuiSlashSuggestion) => {
    if (!slashContext) return

    const replacement = slashContext.kind === 'skill'
      ? `${suggestion.name} `
      : `/${suggestion.name} `

    replaceComposerRange(slashContext.start, slashContext.end, replacement)
    closeMentionPicker()
    setSlashSelectedIndex(0)
  }, [closeMentionPicker, replaceComposerRange, slashContext])

  const handleLocalSlashCommand = useCallback(async (
    parsed: NonNullable<ReturnType<typeof parseComposerSlashCommand>>,
  ): Promise<boolean> => {
    const commandName = parsed.normalizedName
    const usageKey = `command:${canonicalLocalCommandName(commandName)}`

    switch (commandName) {
      case 'help':
      case '?':
        applyComposerTemplate('/')
        recordSlashCommandUsage(usageKey)
        addToast({
          title: 'Slash 命令面板',
          body: '继续输入命令名，或输入 /skill 后搜索已安装技能。',
          type: 'info',
        })
        return true
      case 'skills':
        if (parsed.args) return false
        applyComposerTemplate('/skill ')
        recordSlashCommandUsage(usageKey)
        return true
      case 'skill':
        if (parsed.args) return false
        applyComposerTemplate('/skill ')
        recordSlashCommandUsage(usageKey)
        return true
      case 'new':
      case 'chat':
        handleNewConversation()
        clearComposer()
        recordSlashCommandUsage(usageKey)
        return true
      case 'history':
      case 'chats':
        setShowHistory(true)
        recordSlashCommandUsage(usageKey)
        return true
      case 'settings':
      case 'config':
        openGlobalSettings('claudeGui')
        recordSlashCommandUsage(usageKey)
        return true
      case 'stats':
      case 'cost':
        setShowStats(true)
        recordSlashCommandUsage(usageKey)
        return true
      case 'usage': {
        recordSlashCommandUsage(usageKey)
        setUsagePanel({ status: 'loading' })
        try {
          const data = await window.api.claudeGui.fetchUsage()
          setUsagePanel({ status: 'ready', data })
        } catch (err) {
          setUsagePanel({
            status: 'ready',
            data: { error: err instanceof Error ? err.message : String(err) },
          })
        }
        return true
      }
      case 'files':
      case 'file':
        setShowFilePicker(true)
        setFileQuery(parsed.args)
        recordSlashCommandUsage(usageKey)
        return true
      case 'clear':
      case 'reset':
        clearComposer()
        recordSlashCommandUsage(usageKey)
        return true
      case 'plan': {
        const nextValue = resolveToggleArg(parsed.args)
        const planMode = nextValue === null ? !activePreferences.planMode : nextValue
        updateActivePreferences({ planMode })
        recordSlashCommandUsage(usageKey)
        addToast({
          title: `Plan mode ${planMode ? 'on' : 'off'}`,
          body: '后续发送的普通请求会按当前 Plan First 偏好处理。',
          type: 'info',
        })
        return true
      }
      case 'think':
      case 'thinking': {
        const nextValue = resolveToggleArg(parsed.args)
        const thinkingMode = nextValue === null ? !activePreferences.thinkingMode : nextValue
        updateActivePreferences({ thinkingMode })
        recordSlashCommandUsage(usageKey)
        addToast({
          title: `Thinking ${thinkingMode ? 'on' : 'off'}`,
          body: '后续发送的普通请求会按当前 Thinking 偏好处理。',
          type: 'info',
        })
        return true
      }
      case 'lang':
      case 'language': {
        if (!parsed.args.trim()) {
          const languageMode = !activePreferences.languageMode
          updateActivePreferences({ languageMode })
          recordSlashCommandUsage(usageKey)
          return true
        }

        if (normalizeSlashToken(parsed.args) === 'off') {
          updateActivePreferences({ languageMode: false })
          recordSlashCommandUsage(usageKey)
          return true
        }

        const language = findLanguageOption(parsed.args)
        if (!language) {
          addToast({
            title: '无效语言',
            body: '可用值包括 zh, ja, ko, es, fr, de, ar，或 /lang off。',
            type: 'warning',
          })
          return true
        }

        updateActivePreferences({ languageMode: true, language })
        recordSlashCommandUsage(usageKey)
        return true
      }
      case 'model': {
        const nextModel = findModelOption(parsed.args)
        if (!nextModel) {
          addToast({
            title: '无效模型',
            body: '例如 /model sonnet、/model opus 或 /model claude-sonnet-4-6。',
            type: 'warning',
          })
          return true
        }

        updateActivePreferences({ selectedModel: nextModel })
        recordSlashCommandUsage(usageKey)
        return true
      }
      default:
        return false
    }
  }, [
    activePreferences.languageMode,
    activePreferences.planMode,
    activePreferences.thinkingMode,
    addToast,
    applyComposerTemplate,
    clearComposer,
    handleNewConversation,
    openGlobalSettings,
    recordSlashCommandUsage,
    updateActivePreferences,
  ])

  const handleOpenInTab = useCallback(() => {
    if (!rootPath || !resolvedProjectId || sessionId) return

    const nextSessionId = addSession(resolvedProjectId, 'claude-gui', worktreeScopeId ?? undefined)
    addSessionToPane(activePaneId, nextSessionId)

    if (!activeConversation) return

    const nextScopeKey = getClaudeSessionScopeKey(nextSessionId)
    const clonedConversationId = cloneConversation(activeConversation.id, {
      projectId: resolvedProjectId,
      worktreeId: worktreeScopeId,
      cwd: rootPath,
      scopeKey: nextScopeKey,
    })
    if (clonedConversationId) {
      selectConversation(nextScopeKey, clonedConversationId)
    }
  }, [
    activeConversation,
    activePaneId,
    addSession,
    addSessionToPane,
    cloneConversation,
    resolvedProjectId,
    rootPath,
    selectConversation,
    sessionId,
    worktreeScopeId,
  ])

  const handlePickImages = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return

    try {
      const nextImages = await Promise.all(
        Array.from(files).map(async (file) => {
          const dataUrl = await readAsDataUrl(file)
          const commaIndex = dataUrl.indexOf(',')
          return {
            id: `img-${generateId()}`,
            name: file.name,
            mediaType: file.type || 'image/png',
            preview: dataUrl,
            data: commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl,
          }
        }),
      )
      setPendingImages((current) => [...current, ...nextImages])
    } catch (error) {
      addToast({
        title: '图片读取失败',
        body: error instanceof Error ? error.message : '无法读取所选图片',
        type: 'error',
      })
    }
  }

  const startClaudeRequest = useCallback(async (payload: ClaudeGuiRequestPayload, meta?: Record<string, unknown>): Promise<void> => {
    beginRequest(payload.conversationId, {
      requestId: payload.requestId,
      text: payload.displayText,
      attachments: payload.attachments,
      meta,
    })
    registerRequestPayload(payload)

    try {
      await window.api.claudeGui.start({
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        cwd: payload.cwd,
        text: payload.effectiveText,
        sessionId: activeConversation?.sessionId ?? null,
        model: payload.preferences.selectedModel,
        computeMode: payload.preferences.computeMode,
        permissionMode: payload.preferences.permissionMode,
        planMode: payload.preferences.planMode,
        thinkingMode: payload.preferences.thinkingMode,
        languageMode: payload.preferences.languageMode,
        language: payload.preferences.language,
        onlyCommunicate: payload.preferences.onlyCommunicate,
        images: payload.images,
      })
    } catch (error) {
      applyEvent({
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        type: 'error',
        error: error instanceof Error ? error.message : '无法启动 Claude Code GUI',
      })
      applyEvent({
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        type: 'processing',
        active: false,
      })
      addToast({
        title: 'Claude Code 启动失败',
        body: error instanceof Error ? error.message : '无法启动 Claude Code GUI',
        type: 'error',
      })
      throw error
    }
  }, [activeConversation?.sessionId, addToast, applyEvent, beginRequest, registerRequestPayload])

  const handleRetry = useCallback(async (requestId: string, mode: 'same' | 'failed') => {
    if (!rootPath || !activeConversation || activeConversation.status === 'running') return

    const original = requestPayloads[requestId]
    const failedToolLabel = activeConversation.messages
      .find((message) => message.kind === 'tool-result' && message.isError && message.meta?.requestId === requestId)?.toolName

    const nextRequestId = `claude-req-${generateId()}`
    const sourceText = original?.effectiveText ?? activeConversation.messages.find((message) => message.kind === 'user' && message.meta?.requestId === requestId)?.text ?? ''
    const displayText = original?.displayText ?? sourceText
    const effectiveText = mode === 'failed'
      ? [
        '[Retry failed step]',
        failedToolLabel
          ? `Your previous attempt failed while executing tool "${failedToolLabel}". Re-evaluate the current workspace state and complete only the remaining failed step for the original request below.`
          : 'Your previous attempt failed during a tool call. Re-evaluate the current workspace state and complete only the remaining failed step for the original request below.',
        '',
        sourceText,
      ].join('\n')
      : [
        '[Retry same context]',
        'Please answer the original request again using the same GUI-provided context. Do not continue the previous answer; regenerate it from the same request.',
        '',
        sourceText,
      ].join('\n')

    try {
      await startClaudeRequest({
        requestId: nextRequestId,
        conversationId: activeConversation.id,
        cwd: rootPath,
        displayText,
        effectiveText,
        attachments: original?.attachments ?? [],
        images: original?.images ?? [],
        preferences: original?.preferences ?? activePreferences,
        createdAt: Date.now(),
      }, {
        retryOf: requestId,
        retryMode: mode,
      })
    } catch {
      // startClaudeRequest already reports the error.
    }
  }, [activeConversation, activePreferences, requestPayloads, rootPath, startClaudeRequest])

  const handleSend = async (): Promise<void> => {
    if (!rootPath) return
    if (!draft.trim() && pendingImages.length === 0) return
    if (activeConversation?.status === 'running') return

    const text = draft.trim()
    const parsedSlash = text ? parseComposerSlashCommand(text) : null
    if (parsedSlash) {
      const handledLocally = await handleLocalSlashCommand(parsedSlash)
      if (handledLocally) return
    }

    const skillInvocation = parsedSlash ? extractSkillInvocation(parsedSlash, mergedSkills) : null
    const isRawSlashCommand = Boolean(parsedSlash) && !skillInvocation

    const conversationId = activeConversation?.id ?? createConversation({
      projectId: resolvedProjectId,
      worktreeId: worktreeScopeId,
      cwd: rootPath,
      scopeKey: currentScopeKey,
      title: sessionId ? hostSession?.name ?? 'Claude GUI' : 'Claude Code Chat',
    })

    selectConversation(currentScopeKey, conversationId)

    const requestId = `claude-req-${generateId()}`
    const resolvedReferencedFiles = isRawSlashCommand
      ? referencedFiles
      : await resolveTypedMentionFiles(draft, rootPath, referencedFiles)
    if (resolvedReferencedFiles.length !== referencedFiles.length) {
      setReferencedFiles(resolvedReferencedFiles)
    }
    const editorContextText = !isRawSlashCommand && includeEditorContext
      ? buildEditorContextText(activeEditorTab, cursorInfo, rootPath)
      : null
    const referencedFilesText = !isRawSlashCommand
      ? await buildReferencedFilesText(resolvedReferencedFiles)
      : null
    const promptText = [editorContextText, referencedFilesText].filter(Boolean)
    const effectiveText = skillInvocation
      ? [...promptText, buildSkillPromptText(skillInvocation.skill, skillInvocation.request)].filter(Boolean).join('\n\n')
      : isRawSlashCommand
        ? text
        : (promptText.length > 0
            ? [...promptText, '[User request]', text || 'Please analyze the attached images.'].join('\n\n')
            : text)
    const attachmentNames = isRawSlashCommand
      ? pendingImages.map((item) => item.name)
      : [
          ...pendingImages.map((item) => item.name),
          ...resolvedReferencedFiles.map((item) => `@${item.relativePath}`),
          ...(editorContextLabel ? [`Editor: ${editorContextLabel}`] : []),
        ]
    const images = pendingImages.map((item) => ({
      name: item.name,
      mediaType: item.mediaType,
      data: item.data,
    }))

    try {
      if (skillInvocation) {
        recordSlashCommandUsage(`skill:${skillInvocation.skill.name}`)
      } else if (parsedSlash) {
        recordSlashCommandUsage(`command:${canonicalLocalCommandName(parsedSlash.normalizedName)}`)
      }

      await startClaudeRequest({
        requestId,
        conversationId,
        cwd: rootPath,
        displayText: text,
        effectiveText,
        attachments: attachmentNames,
        images,
        preferences: activePreferences,
        createdAt: Date.now(),
      }, {
        editorContextLabel,
        referencedFiles: resolvedReferencedFiles.map((item) => item.relativePath),
        imageCount: images.length,
      })
    } catch {
      return
    }

    clearComposer()
  }

  const activeMessages = activeConversation?.messages ?? []
  const traceEntries = useMemo(() => buildTraceEntries(activeMessages), [activeMessages])
  const headerTitle = sessionId ? (hostSession?.name ?? 'Claude GUI') : 'Claude Code Chat'
  const currentRequestId = activeConversation?.currentRequestId ?? null

  const activeProcessingState = useMemo(() => {
    if (!activeConversation || activeConversation.status !== 'running') return null

    const requestMessages = currentRequestId
      ? activeMessages.filter((message) => message.meta?.requestId === currentRequestId)
      : activeMessages

    const requestStart = [...requestMessages]
      .reverse()
      .find((message) => message.kind === 'user')
      ?.createdAt ?? activeConversation.updatedAt

    const latestToolUse = [...requestMessages]
      .reverse()
      .find((message) => message.kind === 'tool-use')

    const hasAssistantOutput = requestMessages.some((message) => (
      message.kind === 'assistant' || message.kind === 'thinking'
    ))

    const detail = latestToolUse?.status?.trim()
      || (hasAssistantOutput ? 'Streaming response' : 'Waiting for first output')

    return {
      verb: getSpinnerVerb(currentRequestId),
      elapsedSeconds: Math.max(0, Math.floor((processingNow - requestStart) / 1000)),
      detail: normalizeProcessingDetail(detail),
      stalled: processingNow - activeConversation.updatedAt > 3000,
    }
  }, [activeConversation, activeMessages, currentRequestId, processingNow])

  const visiblePermissionRequests = useMemo(
    () => activeConversation
      ? permissionRequests.filter((entry) => entry.conversationId === activeConversation.id)
      : [],
    [activeConversation, permissionRequests],
  )

  const requestFailureById = useMemo(() => {
    const failures: Record<string, string | null> = {}
    for (const message of activeMessages) {
      const requestId = typeof message.meta?.requestId === 'string' ? message.meta.requestId : null
      if (!requestId) continue
      if (message.kind === 'tool-result' && message.isError) {
        failures[requestId] = message.toolName ?? null
      }
    }
    return failures
  }, [activeMessages])

  const historyGroups = useMemo(() => (
    Array.from(new Set(scopedConversations.map((conversation) => conversation.group).filter((group): group is string => Boolean(group))))
      .sort((a, b) => a.localeCompare(b))
  ), [scopedConversations])

  const filteredConversations = useMemo(() => {
    const normalizedFilter = historyFilter.trim().toLowerCase()
    return scopedConversations.filter((conversation) => {
      if (historyGroupFilter === 'pinned' && !conversation.pinned) return false
      if (historyGroupFilter !== 'all' && historyGroupFilter !== 'pinned' && (conversation.group ?? '') !== historyGroupFilter) return false
      if (!normalizedFilter) return true
      const haystack = [
        conversation.title,
        conversation.group ?? '',
        ...conversation.messages.map((message) => [message.text, message.toolName].filter(Boolean).join(' ')),
      ].join('\n').toLowerCase()
      return haystack.includes(normalizedFilter)
    })
  }, [historyFilter, historyGroupFilter, scopedConversations])

  const searchMatches = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase()
    if (!normalized) return []
    return traceEntries
      .filter((entry) => getTraceSearchText(entry).toLowerCase().includes(normalized))
      .map((entry) => entry.id)
  }, [searchQuery, traceEntries])

  const activeSearchEntryId = searchMatches.length > 0
    ? searchMatches[Math.max(0, Math.min(activeSearchIndex, searchMatches.length - 1))]
    : null

  const contextBudget = useMemo(() => {
    const draftChars = draft.trim().length
    const editorChars = includeEditorContext
      ? activeSelections.reduce((total, selection) => total + selection.text.length, 0)
        || (activeSelection?.text.length ?? 0)
      : 0
    const fileChars = referencedFiles.reduce((total, file) => total + file.includedChars, 0)
    const imageBudget = pendingImages.length * 750
    const totalChars = draftChars + editorChars + fileChars + imageBudget
    const estimatedTokens = Math.ceil(totalChars / 4)
    const contributors = [
      ...referencedFiles.map((file) => ({
        key: file.filePath,
        label: `@${file.relativePath}`,
        chars: file.includedChars,
      })),
      ...(editorChars > 0 ? [{ key: 'editor', label: 'Editor context', chars: editorChars }] : []),
      ...(draftChars > 0 ? [{ key: 'draft', label: 'Draft message', chars: draftChars }] : []),
      ...(pendingImages.length > 0 ? [{ key: 'images', label: `${pendingImages.length} images`, chars: imageBudget }] : []),
    ].sort((a, b) => b.chars - a.chars)

    return {
      draftChars,
      editorChars,
      fileChars,
      imageBudget,
      totalChars,
      estimatedTokens,
      contributors: contributors.slice(0, 5),
    }
  }, [activeSelection?.text.length, activeSelections, draft, includeEditorContext, pendingImages.length, referencedFiles])

  const composerContextSummary = useMemo(() => {
    const parts: string[] = []
    if (includeEditorContext && editorContextLabel) parts.push(editorContextLabel)
    if (referencedFiles.length > 0) parts.push(`${referencedFiles.length} file${referencedFiles.length === 1 ? '' : 's'}`)
    if (pendingImages.length > 0) parts.push(`${pendingImages.length} image${pendingImages.length === 1 ? '' : 's'}`)
    return parts
  }, [editorContextLabel, includeEditorContext, pendingImages.length, referencedFiles.length])

  useEffect(() => {
    setActiveSearchIndex(0)
  }, [searchQuery])

  useEffect(() => {
    if (!showSearch) return
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [showSearch])

  useEffect(() => {
    if (!activeSearchEntryId) return
    const element = document.getElementById(`claude-trace-${activeSearchEntryId}`)
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeSearchEntryId])

  const handleConversationExport = useCallback(async (format: 'md' | 'json') => {
    if (!activeConversation) return

    const baseName = activeConversation.title || 'claude-gui'
    if (format === 'json') {
      const ok = await window.api.claudeGui.exportConversation({
        suggestedName: baseName,
        extension: 'json',
        content: JSON.stringify({
          exportedAt: new Date().toISOString(),
          conversation: activeConversation,
        }, null, 2),
      })
      if (ok) {
        addToast({ title: '已导出 JSON', body: activeConversation.title, type: 'success' })
      }
      return
    }

    const lines = [
      `# ${activeConversation.title}`,
      '',
      `- Scope: ${activeConversation.scopeKey}`,
      `- Updated: ${new Date(activeConversation.updatedAt).toLocaleString()}`,
      `- Requests: ${activeConversation.requestCount}`,
      `- Cost: ${formatMoney(activeConversation.totalCost)}`,
      '',
    ]

    for (const message of activeConversation.messages) {
      if (message.kind === 'stats') continue
      const label = message.kind === 'user'
        ? 'User'
        : message.kind === 'assistant'
          ? 'Claude'
          : message.kind === 'thinking'
            ? 'Thinking'
            : message.kind === 'tool-use'
              ? `Tool Use: ${message.toolName ?? 'unknown'}`
              : message.kind === 'tool-result'
                ? `Tool Result: ${message.toolName ?? 'unknown'}`
                : message.kind === 'error'
                  ? 'Error'
                  : 'System'
      lines.push(`## ${label}`)
      if (message.attachments && message.attachments.length > 0) {
        lines.push(`Attachments: ${message.attachments.join(', ')}`)
      }
      if (message.rawInput !== undefined) {
        lines.push('```json')
        lines.push(stringifyInput(message.rawInput))
        lines.push('```')
      }
      if (message.text) {
        lines.push(message.text)
      }
      lines.push('')
    }

    const ok = await window.api.claudeGui.exportConversation({
      suggestedName: baseName,
      extension: 'md',
      content: lines.join('\n'),
    })
    if (ok) {
      addToast({ title: '已导出 Markdown', body: activeConversation.title, type: 'success' })
    }
  }, [activeConversation, addToast])

  const handleStartConversationEdit = useCallback((conversation: ClaudeGuiConversation) => {
    setEditingConversationId(conversation.id)
    setEditingConversationTitle(conversation.title)
    setEditingConversationGroup(conversation.group ?? '')
  }, [])

  const handleCommitConversationEdit = useCallback(() => {
    if (!editingConversationId) return
    updateConversationMeta(editingConversationId, {
      title: editingConversationTitle,
      group: editingConversationGroup,
    })
    setEditingConversationId(null)
  }, [editingConversationGroup, editingConversationId, editingConversationTitle, updateConversationMeta])

  const handleApplyDroppedFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const entries = Array.from(files)
    const imageFiles = entries.filter((file) => file.type.startsWith('image/'))
    const normalFiles = entries.filter((file) => !file.type.startsWith('image/'))

    if (imageFiles.length > 0) {
      await handlePickImages({
        length: imageFiles.length,
        item: (index: number) => imageFiles[index] ?? null,
        [Symbol.iterator]: function* iterator() { yield* imageFiles },
      } as unknown as FileList)
    }

    for (const file of normalFiles) {
      const filePath = (file as File & { path?: string }).path
      if (!filePath) continue
      const relativePath = rootPath ? toDisplayPath(filePath, rootPath) : file.name
      // eslint-disable-next-line no-await-in-loop
      await addReferencedFile(filePath, relativePath, file.name)
    }
  }, [addReferencedFile, handlePickImages, rootPath])

  const handleRevertPatchReview = useCallback(async (review: ClaudeGuiPatchReview, filePath?: string) => {
    if (!activeConversation) return
    const targetFiles = filePath
      ? review.files.filter((file) => file.filePath === filePath)
      : review.files

    for (const file of targetFiles) {
      // eslint-disable-next-line no-await-in-loop
      await window.api.fs.writeFile(file.filePath, file.beforeContent)
      window.dispatchEvent(new CustomEvent('fastagents:file-saved', {
        detail: { filePath: file.filePath },
      }))
    }

    if (filePath) {
      dismissPatchReviewFile(activeConversation.id, review.id, filePath)
    } else {
      dismissPatchReview(activeConversation.id, review.id)
    }
    addToast({
      title: filePath ? '已回滚这个文件' : '已回滚这一组修改',
      body: filePath ? targetFiles[0]?.relativePath ?? '' : `${targetFiles.length} 个文件已回滚`,
      type: 'success',
    })
  }, [activeConversation, addToast, dismissPatchReview, dismissPatchReviewFile])

  const handleOpenPatchDiff = useCallback((file: ClaudeGuiPatchFile) => {
    const tabId = useEditorsStore.getState().openDiff(file.filePath, file.beforeContent, {
      projectId: resolvedProjectId,
      worktreeId: worktreeScopeId ?? null,
    })
    addSessionToPane(activePaneId, tabId)
    setPaneActiveSession(activePaneId, tabId)
  }, [activePaneId, addSessionToPane, resolvedProjectId, setPaneActiveSession, worktreeScopeId])

  if (!rootPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Bot size={28} className="text-[var(--color-text-tertiary)]" />
        <div className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">{sessionId ? '当前标签页没有可用工作区' : '先选择一个项目'}</div>
        <div className="max-w-[240px] text-[var(--ui-font-xs)] leading-6 text-[var(--color-text-tertiary)]">
          {sessionId
            ? '这个 Claude GUI 标签页还没有关联到可用的项目路径。'
            : 'Claude Code GUI 面板会绑定当前项目或当前 worktree，消息会按作用域分别保存。'}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-muted)]">
                <img src={claudeIcon} alt="Claude" className="h-5 w-5 object-contain" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[var(--ui-font-md)] font-semibold text-[var(--color-text-primary)]">{headerTitle}</div>
                <div className="truncate text-[10px] text-[var(--color-text-tertiary)]" title={rootPath}>{rootPath}</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {!sessionId && (
              <button onClick={handleOpenInTab} className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[10px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" title="在主标签页打开">
                <Plus size={13} />
                Open Tab
              </button>
            )}
            <button onClick={() => openGlobalSettings('claudeGui')} className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" title="设置">
              <Settings2 size={14} />
            </button>
            <button onClick={() => setShowHistory(true)} className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" title="历史">
              <History size={14} />
            </button>
            <button onClick={handleNewConversation} className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-2.5 text-[10px] font-semibold text-white hover:opacity-90">
              <Plus size={13} />
              New Chat
            </button>
          </div>
        </div>
      </div>

      <div ref={messagesRef} className="flex-1 overflow-y-auto py-4 select-text">
        {!activeConversation && (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 px-6 text-center">
            <Bot size={28} className="text-[var(--color-text-tertiary)]" />
            <div className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">还没有 Claude GUI 会话</div>
            <button onClick={handleNewConversation} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              新建一个对话
            </button>
          </div>
        )}

        {activeConversation && traceEntries.length === 0 && (
          <div className="px-6 py-8 text-center">
            <div className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">准备与 Claude Code 对话</div>
            <div className="mt-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">消息会通过 Claude CLI 的 stream-json 输出实时渲染成 trace 风格的 GUI 视图。</div>
          </div>
        )}

        {activeConversation && traceEntries.map((entry, index) => (
          <MessageCard
            key={entry.id}
            entry={entry}
            conversation={activeConversation}
            rootPath={rootPath}
            isLast={index === traceEntries.length - 1}
            onOpenFile={openFileFromTrace}
            onOpenPatchDiff={handleOpenPatchDiff}
            onRevertPatchFile={(review, filePath) => void handleRevertPatchReview(review, filePath)}
            isSearchMatch={searchMatches.includes(entry.id)}
            isActiveSearchMatch={activeSearchEntryId === entry.id}
            requestPayload={(() => {
              if (entry.kind !== 'message') return undefined
              const requestId = typeof entry.message.meta?.requestId === 'string' ? entry.message.meta.requestId : null
              return requestId ? requestPayloads[requestId] : undefined
            })()}
            failedToolName={entry.kind === 'message' && entry.message.kind === 'user'
              ? (() => {
                const requestId = typeof entry.message.meta?.requestId === 'string' ? entry.message.meta.requestId : null
                return requestId ? requestFailureById[requestId] ?? null : null
              })()
              : null}
            onRetry={handleRetry}
            expandedSections={expandedSections}
            onToggleSection={toggleSection}
          />
        ))}
      </div>

      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3">
        {activeProcessingState && (
          <div className="mb-3 flex items-center justify-between gap-3 px-1 transition-colors">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles
                size={14}
                className={cn(
                  'shrink-0 animate-pulse',
                  activeProcessingState.stalled
                    ? 'text-[var(--color-warning)]'
                    : 'text-[var(--color-accent)]',
                )}
              />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                  {activeProcessingState.verb}...
                </div>
                <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">
                  {activeProcessingState.detail}
                </div>
              </div>
            </div>
            <div className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
              {activeProcessingState.elapsedSeconds}s
            </div>
          </div>
        )}

        {visiblePermissionRequests.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            {visiblePermissionRequests.map((entry) => (
              <div key={entry.id} className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 p-3">
                <div className="flex items-center gap-2">
                  <Shield size={13} className="text-[var(--color-warning)]" />
                  <span className="text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-primary)]">Permission Request</span>
                  <span className="ml-auto rounded-full bg-[var(--color-bg-primary)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
                    {entry.toolName}
                  </span>
                </div>
                {entry.detail && (
                  <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 font-mono text-[11px] leading-5 text-[var(--color-text-secondary)] break-all">
                    {entry.detail}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      void window.api.session.respondPermission(entry.id, 'allow')
                      setPermissionRequests((current) => current.filter((item) => item.id !== entry.id))
                    }}
                    className="rounded-[var(--radius-sm)] bg-[var(--color-accent)]/12 px-2.5 py-1 text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/18"
                  >
                    本次允许
                  </button>
                  <button
                    onClick={() => {
                      void window.api.session.respondPermission(entry.id, 'deny')
                      setPermissionRequests((current) => current.filter((item) => item.id !== entry.id))
                    }}
                    className="rounded-[var(--radius-sm)] bg-[var(--color-error)]/12 px-2.5 py-1 text-[10px] text-[var(--color-error)] hover:bg-[var(--color-error)]/18"
                  >
                    拒绝
                  </button>
                  {entry.suggestions.map((label, index) => (
                    <button
                      key={`${entry.id}-${index}`}
                      onClick={() => {
                        void window.api.session.respondPermission(entry.id, 'allow', index)
                        setPermissionRequests((current) => current.filter((item) => item.id !== entry.id))
                      }}
                      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {showFilePicker && (
          <div className="mb-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/25">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
              <div className="text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-primary)]">@ 文件选择器</div>
              <button
                onClick={() => {
                  setShowFilePicker(false)
                  setFileQuery('')
                  setFileResults([])
                  setFileSearchError(null)
                }}
                className="text-[var(--color-text-secondary)]"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-accent)]">
                  <AtSign size={14} />
                </div>
                <input
                  ref={filePickerInputRef}
                  value={fileQuery}
                  onChange={(event) => setFileQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      if (fileResults[0]) void handleSelectReferencedFile(fileResults[0])
                      return
                    }
                    if (event.key === 'Escape') {
                      setShowFilePicker(false)
                      setFileQuery('')
                      setFileResults([])
                      setFileSearchError(null)
                    }
                  }}
                  placeholder="搜索文件名或路径..."
                  className={cn(INPUT, 'min-w-0 flex-1 bg-[var(--color-bg-primary)]')}
                />
                {fileSearchLoading && <LoaderCircle size={14} className="animate-spin text-[var(--color-accent)]" />}
              </div>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {!deferredFileQuery.trim() && (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-4 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                    输入文件名、相对路径或目录片段，然后选中一个文件插入 `@路径`。
                  </div>
                )}
                {fileSearchError && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-error)]">
                    {fileSearchError}
                  </div>
                )}
                {!fileSearchError && deferredFileQuery.trim() && !fileSearchLoading && fileResults.length === 0 && (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-4 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                    没找到匹配文件。
                  </div>
                )}
                {fileResults.map((result) => {
                  const alreadySelected = referencedFiles.some((item) => item.filePath === result.filePath)
                  return (
                    <button
                      key={result.id}
                      onClick={() => void handleSelectReferencedFile(result)}
                      className={cn(
                        'w-full rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors',
                        alreadySelected
                          ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/8'
                          : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-bg-secondary)]',
                      )}
                    >
                      <div className="truncate text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{result.fileName}</div>
                      <div className="mt-1 truncate text-[10px] text-[var(--color-text-tertiary)]">{result.relativePath}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {(composerContextSummary.length > 0 || referencedFiles.length > 0 || pendingImages.length > 0) && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-tertiary)]">
            {composerContextSummary.map((item) => (
              <span key={item} className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1">
                {item}
              </span>
            ))}
            {referencedFiles.map((file) => (
              <div
                key={file.id}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1"
              >
                <button
                  onClick={() => openFileFromTrace(file.filePath, { line: 1, column: 1 })}
                  className="truncate text-left text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
                  title={file.filePath}
                >
                  @{file.relativePath}
                </button>
                <button
                  onClick={() => setReferencedFiles((current) => current.filter((item) => item.filePath !== file.filePath))}
                  className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            {pendingImages.map((image) => (
              <div key={image.id} className="relative h-10 w-10 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                <img src={image.preview} alt={image.name} className="h-full w-full object-cover" />
                <button
                  onClick={() => setPendingImages((current) => current.filter((item) => item.id !== image.id))}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            'relative rounded-[var(--radius-md)] border transition-colors',
            isDropActive
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/8'
              : 'border-transparent',
          )}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDropActive(true)
          }}
          onDragLeave={() => setIsDropActive(false)}
          onDrop={(event) => {
            event.preventDefault()
            setIsDropActive(false)
            void handleApplyDroppedFiles(event.dataTransfer.files)
          }}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setHistoryNavigationIndex(null)
              setHistoryNavigationDraft(null)
              const nextCaret = event.target.selectionStart ?? event.target.value.length
              setComposerCaret(nextCaret)
              updateMentionPicker(event.target.value, nextCaret)
            }}
            onSelect={(event) => {
              const nextCaret = event.currentTarget.selectionStart ?? event.currentTarget.value.length
              setComposerCaret(nextCaret)
              updateMentionPicker(event.currentTarget.value, nextCaret)
            }}
            onKeyDown={(event) => {
              if (mentionMatch) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  if (mentionResults.length > 0) {
                    setMentionSelectedIndex((current) => (current + 1) % mentionResults.length)
                  }
                  return
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (mentionResults.length > 0) {
                    setMentionSelectedIndex((current) => (current - 1 + mentionResults.length) % mentionResults.length)
                  }
                  return
                }

                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  const result = mentionResults[mentionSelectedIndex]
                  if (result) {
                    void handleSelectMentionResult(result)
                  } else {
                    closeMentionPicker()
                  }
                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeMentionPicker()
                  return
                }
              }

              if (slashContext && !mentionMatch) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  if (slashSuggestions.length > 0) {
                    setSlashSelectedIndex((current) => (current + 1) % slashSuggestions.length)
                  }
                  return
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (slashSuggestions.length > 0) {
                    setSlashSelectedIndex((current) => (current - 1 + slashSuggestions.length) % slashSuggestions.length)
                  }
                  return
                }

                if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                  event.preventDefault()
                  const suggestion = slashSuggestions[slashSelectedIndex]
                  if (suggestion) {
                    handleSelectSlashSuggestion(suggestion)
                  }
                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  setDraft((current) => `${current.slice(0, slashContext.start)}${current.slice(slashContext.end)}`)
                  setComposerCaret(slashContext.start)
                  return
                }
              }

              if (
                (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                && !event.altKey
                && !event.ctrlKey
                && !event.metaKey
                && !event.shiftKey
              ) {
                const textarea = event.currentTarget
                const selectionStart = textarea.selectionStart ?? 0
                const selectionEnd = textarea.selectionEnd ?? selectionStart
                const hasSelection = selectionStart !== selectionEnd

                if (!hasSelection) {
                  const shouldHandle = event.key === 'ArrowUp'
                    ? (historyNavigationIndex !== null || isCaretOnFirstLine(textarea.value, selectionStart))
                    : (historyNavigationIndex !== null || isCaretOnLastLine(textarea.value, selectionStart))

                  if (shouldHandle) {
                    const moved = navigatePromptHistory(event.key === 'ArrowUp' ? 'previous' : 'next')
                    if (moved) {
                      event.preventDefault()
                      return
                    }
                  }
                }
              }

              if (event.key === 'Escape' && activeConversation?.status === 'running') {
                event.preventDefault()
                void window.api.claudeGui.stop()
                return
              }

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Type your message to Claude Code... 输入 / 打开命令与技能联想，输入 @ 联想文件，也可以直接把文件拖进来。"
            className="min-h-24 w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)]"
          />

          {slashContext && !mentionMatch && (
            <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-xl shadow-black/35">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                  {slashContext.kind === 'skill' ? '/skill' : 'Slash'}
                </div>
                {skillCatalogLoading && <LoaderCircle size={12} className="animate-spin text-[var(--color-accent)]" />}
              </div>
              <div className="max-h-56 overflow-y-auto p-2">
                {!slashContext.query.trim() && slashContext.kind === 'command' && (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                    输入命令名，或继续输入 `/skill ` 搜索已安装技能。
                  </div>
                )}
                {!slashContext.query.trim() && slashContext.kind === 'skill' && (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                    搜索已安装技能，回车插入，发送后会按技能语义转译为 Claude 请求。
                  </div>
                )}
                {skillCatalogError && slashContext.kind === 'skill' && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-error)]">
                    {skillCatalogError}
                  </div>
                )}
                {!skillCatalogError && slashSuggestions.length === 0 && slashContext.query.trim() && (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                    没找到匹配的命令或技能。
                  </div>
                )}
                {slashSuggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    ref={(node) => {
                      slashResultRefs.current[index] = node
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      handleSelectSlashSuggestion(suggestion)
                    }}
                    onMouseEnter={() => setSlashSelectedIndex(index)}
                    className={cn(
                      'mb-1 w-full rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors last:mb-0',
                      index === slashSelectedIndex
                        ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10'
                        : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/30 hover:bg-[var(--color-bg-secondary)]',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="truncate text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{suggestion.displayText}</div>
                      <span className="rounded-full bg-[var(--color-bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                        {suggestion.sourceLabel ? `${suggestion.tag} · ${suggestion.sourceLabel}` : suggestion.tag}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[10px] text-[var(--color-text-tertiary)]">{suggestion.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mentionMatch && (
            <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-xl shadow-black/35">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">@ Files</div>
                {mentionLoading && <LoaderCircle size={12} className="animate-spin text-[var(--color-accent)]" />}
              </div>
              <div className="max-h-56 overflow-y-auto p-2">
                {!deferredMentionQuery.trim() && (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                    继续输入文件名或路径，然后用上下键选择，按回车插入。
                  </div>
                )}
                {mentionError && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-error)]">
                    {mentionError}
                  </div>
                )}
                {!mentionError && deferredMentionQuery.trim() && !mentionLoading && mentionResults.length === 0 && (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                    没找到匹配文件。
                  </div>
                )}
                {mentionResults.map((result, index) => (
                  <button
                    key={result.id}
                    ref={(node) => {
                      mentionResultRefs.current[index] = node
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      void handleSelectMentionResult(result)
                    }}
                    onMouseEnter={() => setMentionSelectedIndex(index)}
                    className={cn(
                      'mb-1 w-full rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors last:mb-0',
                      index === mentionSelectedIndex
                        ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10'
                        : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/30 hover:bg-[var(--color-bg-secondary)]',
                    )}
                  >
                    <div className="truncate text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{result.fileName}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--color-text-tertiary)]">{result.relativePath}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowFilePicker((current) => !current)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border transition-colors',
              showFilePicker
                ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            )}
            title="插入文件引用"
          >
            <AtSign size={12} />
          </button>
          <button
            type="button"
            onClick={() => updateActivePreferences({ includeEditorContext: !includeEditorContext })}
            className={cn(
              'flex h-8 items-center rounded-[var(--radius-md)] border px-2.5 text-[10px] transition-colors',
              includeEditorContext
                ? 'border-[var(--color-accent)]/35 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-tertiary)]',
            )}
            title={includeEditorContext ? 'Disable editor context' : 'Enable editor context'}
          >
            Editor
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]"
            title="添加图片"
          >
            <ImagePlus size={14} />
          </button>
          <button
            onClick={() => applyComposerTemplate('/')}
            className="flex h-8 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 text-[10px] text-[var(--color-text-secondary)]"
            title="Slash commands"
          >
            /
          </button>
          <div className="ml-auto flex items-center gap-2">
            {/* Model picker — quick-switch between Sonnet / Opus / Haiku / default */}
            <div className="relative">
              <button
                onClick={() => setModelMenuOpen((v) => !v)}
                className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]"
                title="切换 Claude 模型"
              >
                <Bot size={12} />
                {(MODEL_OPTIONS.find((item) => item.value === activePreferences.selectedModel)?.label)
                  ?? activePreferences.selectedModel}
                <ChevronDown size={10} className="opacity-70" />
              </button>

              {modelMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setModelMenuOpen(false)} />
                  <div className="absolute bottom-full right-0 mb-1.5 z-[61] w-[220px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-1 shadow-lg shadow-black/40">
                    {MODEL_OPTIONS.map((item) => {
                      const active = activePreferences.selectedModel === item.value
                      return (
                        <button
                          key={item.value}
                          onClick={() => {
                            updateActivePreferences({ selectedModel: item.value })
                            setModelMenuOpen(false)
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left transition-colors',
                            active
                              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                          )}
                        >
                          <span className="text-[11px] font-medium">{item.label}</span>
                          <span className="text-[9px] text-[var(--color-text-tertiary)] tabular-nums">{item.value}</span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setPermissionMenuOpen((v) => !v)}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[10px] font-medium transition-colors',
                  activePreferences.permissionMode === 'bypassPermissions'
                    ? 'border-[var(--color-warning)]/45 bg-[var(--color-warning)]/12 text-[var(--color-warning)]'
                    : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
                )}
                title="切换权限模式"
              >
                {activePreferences.permissionMode === 'bypassPermissions' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] animate-pulse" />
                )}
                {getPermissionModeLabel(activePreferences.permissionMode)}
              </button>

              {permissionMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setPermissionMenuOpen(false)} />
                  <div className="absolute bottom-full right-0 mb-1.5 z-[61] w-[260px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-1 shadow-lg shadow-black/40">
                    {([
                      { mode: 'default' as const, label: 'Ask before edits', desc: '默认：所有改动需确认' },
                      { mode: 'acceptEdits' as const, label: 'Accept edits', desc: '文件修改自动通过，其他仍询问' },
                      { mode: 'plan' as const, label: 'Plan mode', desc: '只做规划，不实际执行' },
                      { mode: 'bypassPermissions' as const, label: 'Bypass permissions', desc: '跳过所有权限检查（可操作沙箱外文件）', danger: true },
                    ]).map((item) => {
                      const active = activePreferences.permissionMode === item.mode
                      return (
                        <button
                          key={item.mode}
                          onClick={() => {
                            updateActivePreferences({ permissionMode: item.mode })
                            setPermissionMenuOpen(false)
                          }}
                          className={cn(
                            'flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors',
                            active
                              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                          )}
                        >
                          <span className={cn('flex items-center gap-1.5 text-[11px] font-semibold', item.danger && !active && 'text-[var(--color-warning)]')}>
                            {item.danger && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />}
                            {item.label}
                            {active && <span className="ml-auto text-[9px] opacity-70">当前</span>}
                          </span>
                          <span className="text-[10px] leading-tight text-[var(--color-text-tertiary)]">{item.desc}</span>
                        </button>
                      )
                    })}
                    <button
                      onClick={() => {
                        openGlobalSettings('claudeGui')
                        setPermissionMenuOpen(false)
                      }}
                      className="mt-1 flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[10px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-secondary)]"
                    >
                      高级设置…
                    </button>
                  </div>
                </>
              )}
            </div>
            {activeConversation?.status === 'running' ? (
              <button
                onClick={() => void window.api.claudeGui.stop()}
                className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 text-[10px] font-semibold text-[var(--color-error)]"
              >
                <Square size={12} />
                Stop
              </button>
            ) : null}
            <button
              onClick={() => void handleSend()}
              disabled={!draft.trim() && pendingImages.length === 0}
              className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-[10px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={12} />
              Send
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void handlePickImages(event.target.files)
            event.currentTarget.value = ''
          }}
        />
      </div>

      {(showHistory || showStats || usagePanel) && (
        <>
          <div className="absolute inset-0 z-20 bg-black/35" onClick={() => {
            setShowHistory(false)
            setShowStats(false)
            setUsagePanel(null)
          }} />
          {showHistory && (
            <div className="absolute inset-x-3 top-3 z-30 max-h-[70%] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">Conversation History</div>
                <button onClick={() => setShowHistory(false)} className="text-[var(--color-text-secondary)]"><X size={14} /></button>
              </div>
              <div className="grid gap-2 border-b border-[var(--color-border)] px-3 py-2">
                <input
                  value={historyFilter}
                  onChange={(event) => setHistoryFilter(event.target.value)}
                  placeholder="搜索标题、tool、文件名或回复内容..."
                  className={INPUT}
                />
                <div className="flex items-center gap-2">
                  <select value={historyGroupFilter} onChange={(event) => setHistoryGroupFilter(event.target.value)} className={INPUT}>
                    <option value="all">全部分组</option>
                    <option value="pinned">仅固定</option>
                    {historyGroups.map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                  <div className="text-[10px] text-[var(--color-text-tertiary)]">{filteredConversations.length} conversations</div>
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto p-2">
                {filteredConversations.length === 0 && (
                  <div className="px-3 py-8 text-center text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">当前作用域还没有历史对话</div>
                )}
                {filteredConversations.map((conversation) => (
                  <div key={conversation.id} className={cn(
                    'mb-2 rounded-[var(--radius-md)] border p-3',
                    activeConversation?.id === conversation.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-primary)]',
                  )}>
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={() => {
                          selectConversation(currentScopeKey, conversation.id)
                          setShowHistory(false)
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          {conversation.pinned && <Pin size={12} className="text-[var(--color-warning)]" />}
                          <div className="truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">{conversation.title}</div>
                          {conversation.group && (
                            <span className="rounded-full bg-[var(--color-bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">{conversation.group}</span>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={() => updateConversationMeta(conversation.id, { pinned: !conversation.pinned })}
                        className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                        title={conversation.pinned ? '取消固定' : '固定对话'}
                      >
                        <Pin size={11} className={conversation.pinned ? 'text-[var(--color-warning)]' : ''} />
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        selectConversation(currentScopeKey, conversation.id)
                        setShowHistory(false)
                      }}
                      className="mt-2 w-full text-left"
                    >
                      <div className="mt-1 truncate text-[10px] text-[var(--color-text-tertiary)]">{getPreview(conversation.messages.find((item) => item.kind === 'assistant') ?? conversation.messages.find((item) => item.kind === 'user'))}</div>
                      <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
                        <span>{formatRelativeTime(conversation.updatedAt)}</span>
                        <span>{conversation.requestCount} req</span>
                        <span>{formatMoney(conversation.totalCost)}</span>
                      </div>
                    </button>
                    {editingConversationId === conversation.id ? (
                      <div className="mt-2 grid gap-2">
                        <input
                          value={editingConversationTitle}
                          onChange={(event) => setEditingConversationTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') handleCommitConversationEdit()
                            if (event.key === 'Escape') setEditingConversationId(null)
                          }}
                          placeholder="对话标题"
                          className={INPUT}
                        />
                        <input
                          value={editingConversationGroup}
                          onChange={(event) => setEditingConversationGroup(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') handleCommitConversationEdit()
                            if (event.key === 'Escape') setEditingConversationId(null)
                          }}
                          placeholder="分组名称"
                          className={INPUT}
                        />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingConversationId(null)} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">取消</button>
                          <button onClick={handleCommitConversationEdit} className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-1 text-[10px] text-white">保存</button>
                        </div>
                      </div>
                    ) : (
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => handleStartConversationEdit(conversation)}
                        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]"
                      >
                        重命名 / 分组
                      </button>
                      <button
                        onClick={() => removeConversation(conversation.id)}
                        className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
                      >
                        <Trash2 size={11} />
                        删除
                      </button>
                    </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {usagePanel && (
            <div className="absolute inset-x-3 top-3 z-40 max-h-[85%] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4 shadow-lg shadow-black/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 size={14} className="text-[var(--color-accent)]" />
                  <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">Claude 订阅使用量</div>
                </div>
                <button onClick={() => setUsagePanel(null)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"><X size={14} /></button>
              </div>

              {usagePanel.status === 'loading' && (
                <div className="mt-4 flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
                  <LoaderCircle size={14} className="animate-spin text-[var(--color-accent)]" />
                  正在向 Anthropic API 查询使用量…
                </div>
              )}

              {usagePanel.status === 'ready' && usagePanel.data.error && (
                <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-[12px] text-[var(--color-text-primary)]">
                  {usagePanel.data.error}
                </div>
              )}

              {usagePanel.status === 'ready' && !usagePanel.data.error && (
                <div className="mt-4 space-y-4">
                  {renderUsageBar('本次会话（5 小时窗口）', usagePanel.data.fiveHour)}
                  {renderUsageBar('本周（全部模型，7 天窗口）', usagePanel.data.sevenDay)}
                  {renderUsageBar('本周（Opus，7 天窗口）', usagePanel.data.sevenDayOpus)}
                  {renderUsageBar('本周（Sonnet，7 天窗口）', usagePanel.data.sevenDaySonnet)}
                  {usagePanel.data.extraUsage && usagePanel.data.extraUsage.isEnabled && (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="font-semibold text-[var(--color-text-primary)]">额外用量（按量付费）</span>
                        <span className="tabular-nums text-[var(--color-text-secondary)]">
                          {usagePanel.data.extraUsage.utilization != null ? `${Math.round(usagePanel.data.extraUsage.utilization)}%` : '—'}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-primary)]">
                        <div
                          className="h-full rounded-full bg-[var(--color-warning)] transition-all"
                          style={{ width: `${Math.max(0, Math.min(100, usagePanel.data.extraUsage.utilization ?? 0))}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                        {usagePanel.data.extraUsage.usedCredits != null && usagePanel.data.extraUsage.monthlyLimit != null
                          ? `$${usagePanel.data.extraUsage.usedCredits.toFixed(2)} / $${usagePanel.data.extraUsage.monthlyLimit.toFixed(2)} 已使用`
                          : null}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 border-t border-[var(--color-border)] pt-3 text-[10px] text-[var(--color-text-tertiary)]">
                数据来自 Anthropic 官方 OAuth usage 接口，和 Claude Code CLI 里的 <code>/usage</code> 同源。
              </div>
            </div>
          )}

          {showStats && activeConversation && (
            <div className="absolute inset-x-3 top-3 z-30 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-3 shadow-lg shadow-black/30">
              <div className="flex items-center justify-between">
                <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">Usage Statistics</div>
                <button onClick={() => setShowStats(false)} className="text-[var(--color-text-secondary)]"><X size={14} /></button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
                  <div className="text-[10px] text-[var(--color-text-tertiary)]">Total Cost</div>
                  <div className="mt-1 text-[var(--ui-font-sm)] font-semibold text-[var(--color-warning)]">{formatMoney(activeConversation.totalCost)}</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
                  <div className="text-[10px] text-[var(--color-text-tertiary)]">Requests</div>
                  <div className="mt-1 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">{activeConversation.requestCount}</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
                  <div className="text-[10px] text-[var(--color-text-tertiary)]">Input Tokens</div>
                  <div className="mt-1 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">{activeConversation.totalTokensInput.toLocaleString()}</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
                  <div className="text-[10px] text-[var(--color-text-tertiary)]">Output Tokens</div>
                  <div className="mt-1 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">{activeConversation.totalTokensOutput.toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
