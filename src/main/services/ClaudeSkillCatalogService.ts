import type { Dirent } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeGuiSkillCatalogEntry, ClaudeGuiSkillSource } from '@shared/types'

interface SkillRootSpec {
  source: Exclude<ClaudeGuiSkillSource, 'runtime'>
  scope: 'project' | 'user'
  path: string
}

const SKILL_FILE_NAME = 'SKILL.md'
const IGNORED_DIRS = new Set(['skills'])

function buildSkillRoots(cwd: string): SkillRootSpec[] {
  const home = homedir()

  return [
    { source: 'project-claude', scope: 'project', path: join(cwd, '.claude', 'skills') },
    { source: 'project-codex', scope: 'project', path: join(cwd, '.codex', 'skills') },
    { source: 'user-claude', scope: 'user', path: join(home, '.claude', 'skills') },
    { source: 'user-codex', scope: 'user', path: join(home, '.codex', 'skills') },
  ]
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function extractFrontmatter(text: string): string | null {
  const normalized = text.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return match?.[1] ?? null
}

function extractYamlValue(frontmatter: string | null, key: string): string | null {
  if (!frontmatter) return null

  const lines = frontmatter.split(/\r?\n/)
  const prefix = `${key}:`

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (!trimmed.startsWith(prefix)) continue

    const rawValue = trimmed.slice(prefix.length).trim()
    if (!rawValue) return null

    if (rawValue === '>-'
      || rawValue === '>'
      || rawValue === '|-'
      || rawValue === '|') {
      const collected: string[] = []
      for (let inner = index + 1; inner < lines.length; inner += 1) {
        const continuation = lines[inner] ?? ''
        if (!continuation.startsWith(' ') && !continuation.startsWith('\t')) break
        collected.push(continuation.trim())
      }
      const joined = collected.join(' ').trim()
      return joined || null
    }

    return rawValue.replace(/^['"]|['"]$/g, '').trim() || null
  }

  return null
}

function extractBodyPreview(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '')
  const withoutFrontmatter = normalized.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = withoutFrontmatter
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (line.startsWith('#')) continue
    if (line.startsWith('```')) continue
    return line
  }

  return ''
}

async function readSkillMetadata(skillDirPath: string, fallbackName: string): Promise<{ name: string; description: string }> {
  const skillFilePath = join(skillDirPath, SKILL_FILE_NAME)
  if (!await pathExists(skillFilePath)) {
    return { name: fallbackName, description: '' }
  }

  try {
    const content = await readFile(skillFilePath, 'utf-8')
    const frontmatter = extractFrontmatter(content)
    const name = extractYamlValue(frontmatter, 'name') ?? fallbackName
    const description = extractYamlValue(frontmatter, 'description') ?? extractBodyPreview(content)

    return {
      name: name.trim() || fallbackName,
      description: description.trim(),
    }
  } catch {
    return { name: fallbackName, description: '' }
  }
}

function skillSortKey(entry: ClaudeGuiSkillCatalogEntry): string {
  const sourceRank = entry.scope === 'project'
    ? (entry.source === 'project-claude' ? '0' : '1')
    : (entry.source === 'user-claude' ? '2' : '3')

  return `${sourceRank}:${entry.name.toLowerCase()}`
}

export async function listClaudeGuiSkills(cwd: string): Promise<ClaudeGuiSkillCatalogEntry[]> {
  const results: ClaudeGuiSkillCatalogEntry[] = []

  for (const root of buildSkillRoots(cwd)) {
    if (!await pathExists(root.path)) continue

    let entries: Dirent<string>[]
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (IGNORED_DIRS.has(entry.name)) continue

      const skillDirPath = join(root.path, entry.name)
      const skillFilePath = join(skillDirPath, SKILL_FILE_NAME)
      if (!await pathExists(skillFilePath)) continue

      const metadata = await readSkillMetadata(skillDirPath, entry.name)
      results.push({
        id: `${root.source}:${metadata.name}`,
        name: metadata.name,
        description: metadata.description,
        path: skillDirPath,
        source: root.source,
        scope: root.scope,
      })
    }
  }

  return results.sort((left, right) => skillSortKey(left).localeCompare(skillSortKey(right)))
}
