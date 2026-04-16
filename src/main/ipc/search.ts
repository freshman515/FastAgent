import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { ipcMain } from 'electron'
import type { FileSearchResult, ProjectSearchMatch, SearchQueryOptions } from '@shared/types'

const DEFAULT_TEXT_LIMIT = 200
const DEFAULT_FILE_LIMIT = 80
const MAX_FILE_BYTES = 1024 * 1024
const IGNORED_DIRS = new Set([
  '.git',
  '.idea',
  '.next',
  '.vscode',
  'bin',
  'build',
  'dist',
  'node_modules',
  'obj',
  'out',
  'target',
  '__pycache__',
])

type FileFilterToken =
  | { kind: 'extension'; value: string }
  | { kind: 'glob'; value: string; regex: RegExp }
  | { kind: 'substring'; value: string }

interface ParsedFileFilter {
  tokens: FileFilterToken[]
  ripgrepGlobs: string[]
}

function normalizeRelativePath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).replace(/\\/g, '/')
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback
  return Math.max(1, Math.min(limit ?? fallback, 500))
}

function createMatchId(filePath: string, line: number, column: number, endColumn: number): string {
  return createHash('sha1')
    .update(`${filePath}:${line}:${column}:${endColumn}`)
    .digest('hex')
    .slice(0, 12)
}

function createFileId(filePath: string): string {
  return createHash('sha1')
    .update(filePath)
    .digest('hex')
    .slice(0, 12)
}

function buildMatch(
  rootPath: string,
  filePath: string,
  line: number,
  column: number,
  lineText: string,
  matchText: string,
): ProjectSearchMatch {
  const safeMatchText = matchText || ''
  const endColumn = column + safeMatchText.length
  return {
    id: createMatchId(filePath, line, column, endColumn),
    filePath,
    relativePath: normalizeRelativePath(rootPath, filePath),
    line,
    column,
    endColumn,
    lineText,
    matchText: safeMatchText,
  }
}

function buildFileResult(rootPath: string, filePath: string): FileSearchResult {
  const relativePath = normalizeRelativePath(rootPath, filePath)
  return {
    id: createFileId(filePath),
    rootPath,
    filePath,
    fileName: basename(filePath),
    relativePath,
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/')
  let source = '^'

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const nextChar = normalized[index + 1]

    if (char === '*') {
      if (nextChar === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
      continue
    }

    if (char === '?') {
      source += '.'
      continue
    }

    source += escapeRegex(char)
  }

  source += '$'
  return new RegExp(source, 'i')
}

function parseFileFilter(filterText?: string): ParsedFileFilter {
  if (!filterText?.trim()) {
    return { tokens: [], ripgrepGlobs: [] }
  }

  const parts = filterText
    .split(/[,\n;]+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const seen = new Set<string>()
  const tokens: FileFilterToken[] = []
  const ripgrepGlobs: string[] = []

  for (const rawPart of parts) {
    const part = rawPart.replace(/^["']|["']$/g, '')
    if (!part) continue

    if (/^\.[^/\\*?\s]+$/.test(part)) {
      const ext = part.toLowerCase()
      if (seen.has(`ext:${ext}`)) continue
      seen.add(`ext:${ext}`)
      tokens.push({ kind: 'extension', value: ext })
      ripgrepGlobs.push(`**/*${ext}`)
      continue
    }

    if (/[*?]/.test(part)) {
      const glob = part.replace(/\\/g, '/')
      if (seen.has(`glob:${glob.toLowerCase()}`)) continue
      seen.add(`glob:${glob.toLowerCase()}`)
      tokens.push({ kind: 'glob', value: glob, regex: globToRegExp(glob) })
      ripgrepGlobs.push(glob)
      continue
    }

    const substring = part.replace(/\\/g, '/').toLowerCase()
    if (seen.has(`substr:${substring}`)) continue
    seen.add(`substr:${substring}`)
    tokens.push({ kind: 'substring', value: substring })
  }

  return { tokens, ripgrepGlobs }
}

function matchesFileFilter(relativePath: string, filters: ParsedFileFilter): boolean {
  if (filters.tokens.length === 0) return true

  const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase()
  return filters.tokens.some((token) => {
    if (token.kind === 'extension') {
      return normalizedPath.endsWith(token.value)
    }
    if (token.kind === 'glob') {
      return token.regex.test(normalizedPath)
    }
    return normalizedPath.includes(token.value)
  })
}

function createExecPromise(command: string, args: string[], cwd: string, maxBuffer: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, windowsHide: true, maxBuffer }, (error, stdout) => {
      if (!error) {
        resolve(stdout)
        return
      }

      const code = (error as { code?: unknown }).code
      if (code === 1 || code === '1') {
        resolve('')
        return
      }

      reject(error)
    })
  })
}

function execRipgrep(cwd: string, query: string, filters: ParsedFileFilter): Promise<string> {
  const args = [
    '--line-number',
    '--column',
    '--color=never',
    '--no-heading',
    '--fixed-strings',
    '--smart-case',
    ...filters.ripgrepGlobs.flatMap((glob) => ['-g', glob]),
    query,
    '.',
  ]

  return createExecPromise('rg', args, cwd, 8 * 1024 * 1024)
}

function execRipgrepFiles(cwd: string, filters: ParsedFileFilter): Promise<string> {
  const args = [
    '--files',
    ...filters.ripgrepGlobs.flatMap((glob) => ['-g', glob]),
  ]

  return createExecPromise('rg', args, cwd, 8 * 1024 * 1024)
}

function parseRipgrepOutput(
  rootPath: string,
  query: string,
  output: string,
  filters: ParsedFileFilter,
  limit: number,
): ProjectSearchMatch[] {
  const matches: ProjectSearchMatch[] = []
  const lines = output.split(/\r?\n/)

  for (const entry of lines) {
    if (!entry) continue
    const match = entry.match(/^(.+?):(\d+):(\d+):(.*)$/)
    if (!match) continue

    const [, relativePath, lineValue, columnValue, lineText] = match
    const filePath = join(rootPath, relativePath)
    const searchMatch = buildMatch(rootPath, filePath, Number(lineValue), Number(columnValue), lineText, query)
    if (!matchesFileFilter(searchMatch.relativePath, filters)) continue

    matches.push(searchMatch)
    if (matches.length >= limit) break
  }

  return matches
}

function isProbablyText(content: string): boolean {
  return !content.includes('\u0000')
}

function normalizeLineText(lineText: string): string {
  return lineText.replace(/\t/g, '  ')
}

function findLineMatches(
  rootPath: string,
  filePath: string,
  query: string,
  content: string,
  limit: number,
): ProjectSearchMatch[] {
  const matches: ProjectSearchMatch[] = []
  const caseSensitive = /[A-Z]/.test(query)
  const needle = caseSensitive ? query : query.toLowerCase()
  const lines = content.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index]
    const haystack = caseSensitive ? lineText : lineText.toLowerCase()
    let cursor = 0

    while (cursor <= haystack.length) {
      const position = haystack.indexOf(needle, cursor)
      if (position === -1) break

      matches.push(buildMatch(
        rootPath,
        filePath,
        index + 1,
        position + 1,
        normalizeLineText(lineText),
        lineText.slice(position, position + query.length),
      ))

      if (matches.length >= limit) return matches
      cursor = position + Math.max(needle.length, 1)
    }
  }

  return matches
}

async function walkDirectory<T>(
  rootPath: string,
  dirPath: string,
  limit: number,
  visitFile: (filePath: string, remainingLimit: number) => Promise<T[]>,
): Promise<T[]> {
  let entries: Dirent<string>[]
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const results: T[] = []

  for (const entry of entries) {
    if (results.length >= limit) break
    if (entry.name.startsWith('.') && entry.name !== '.env') continue

    const entryPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const nested = await walkDirectory(rootPath, entryPath, limit - results.length, visitFile)
      results.push(...nested)
      continue
    }

    if (!entry.isFile()) continue
    const fileMatches = await visitFile(entryPath, limit - results.length)
    results.push(...fileMatches.slice(0, limit - results.length))
  }

  return results
}

async function fallbackSearch(
  rootPath: string,
  query: string,
  filters: ParsedFileFilter,
  limit: number,
): Promise<ProjectSearchMatch[]> {
  return await walkDirectory(rootPath, rootPath, limit, async (filePath, remainingLimit) => {
    const relativePath = normalizeRelativePath(rootPath, filePath)
    if (!matchesFileFilter(relativePath, filters)) return []

    try {
      const fileStat = await stat(filePath)
      if (fileStat.size > MAX_FILE_BYTES) return []

      const content = await readFile(filePath, 'utf-8')
      if (!isProbablyText(content)) return []

      return findLineMatches(rootPath, filePath, query, content, remainingLimit)
    } catch {
      return []
    }
  })
}

function getSearchIndex(text: string, query: string): number {
  const caseSensitive = /[A-Z]/.test(query)
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  return haystack.indexOf(needle)
}

function matchesFileQuery(relativePath: string, query: string): boolean {
  return getSearchIndex(relativePath.replace(/\\/g, '/'), query) !== -1
}

function scoreFileResult(result: FileSearchResult, query: string): number {
  const fileNameIndex = getSearchIndex(result.fileName, query)
  const pathIndex = getSearchIndex(result.relativePath, query)

  let score = 1000
  if (fileNameIndex !== -1) {
    score = fileNameIndex
    if (fileNameIndex === 0) score -= 50
    if (result.fileName.length === query.length) score -= 80
  } else if (pathIndex !== -1) {
    score = 200 + pathIndex
  }

  return score + result.relativePath.length * 0.01
}

function parseRipgrepFileResults(
  rootPath: string,
  query: string,
  output: string,
  filters: ParsedFileFilter,
  limit: number,
): FileSearchResult[] {
  const results = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((relativePath) => buildFileResult(rootPath, join(rootPath, relativePath)))
    .filter((result) => matchesFileFilter(result.relativePath, filters) && matchesFileQuery(result.relativePath, query))

  results.sort((left, right) => scoreFileResult(left, query) - scoreFileResult(right, query))
  return results.slice(0, limit)
}

async function fallbackFileSearch(
  rootPath: string,
  query: string,
  filters: ParsedFileFilter,
  limit: number,
): Promise<FileSearchResult[]> {
  const results = await walkDirectory(rootPath, rootPath, limit * 2, async (filePath) => {
    const result = buildFileResult(rootPath, filePath)
    if (!matchesFileFilter(result.relativePath, filters)) return []
    if (!matchesFileQuery(result.relativePath, query)) return []
    return [result]
  })

  results.sort((left, right) => scoreFileResult(left, query) - scoreFileResult(right, query))
  return results.slice(0, limit)
}

async function searchInProject(rootPath: string, query: string, options: SearchQueryOptions): Promise<ProjectSearchMatch[]> {
  const trimmedQuery = query.trim()
  if (!rootPath || !trimmedQuery) return []

  const filters = parseFileFilter(options.fileFilter)

  try {
    const output = await execRipgrep(rootPath, trimmedQuery, filters)
    return parseRipgrepOutput(rootPath, trimmedQuery, output, filters, normalizeLimit(options.limit, DEFAULT_TEXT_LIMIT))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT') throw error
    return await fallbackSearch(rootPath, trimmedQuery, filters, normalizeLimit(options.limit, DEFAULT_TEXT_LIMIT))
  }
}

async function searchFiles(rootPath: string, query: string, options: SearchQueryOptions): Promise<FileSearchResult[]> {
  const trimmedQuery = query.trim()
  if (!rootPath || !trimmedQuery) return []

  const filters = parseFileFilter(options.fileFilter)
  const safeLimit = normalizeLimit(options.limit, DEFAULT_FILE_LIMIT)

  try {
    const output = await execRipgrepFiles(rootPath, filters)
    return parseRipgrepFileResults(rootPath, trimmedQuery, output, filters, safeLimit)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT') throw error
    return await fallbackFileSearch(rootPath, trimmedQuery, filters, safeLimit)
  }
}

function normalizeSearchOptions(
  rawOptions: SearchQueryOptions | number | undefined,
  defaultLimit: number,
): SearchQueryOptions {
  if (typeof rawOptions === 'number') {
    return { limit: normalizeLimit(rawOptions, defaultLimit) }
  }

  if (!rawOptions || typeof rawOptions !== 'object') {
    return { limit: defaultLimit }
  }

  return {
    limit: normalizeLimit(rawOptions.limit, defaultLimit),
    fileFilter: typeof rawOptions.fileFilter === 'string' ? rawOptions.fileFilter : '',
  }
}

export function registerSearchHandlers(): void {
  ipcMain.handle('search:find-in-files', async (_event, rootPath: string, query: string, rawOptions?: SearchQueryOptions | number) => {
    return await searchInProject(rootPath, query, normalizeSearchOptions(rawOptions, DEFAULT_TEXT_LIMIT))
  })

  ipcMain.handle('search:find-files', async (_event, rootPath: string, query: string, rawOptions?: SearchQueryOptions | number) => {
    return await searchFiles(rootPath, query, normalizeSearchOptions(rawOptions, DEFAULT_FILE_LIMIT))
  })
}
