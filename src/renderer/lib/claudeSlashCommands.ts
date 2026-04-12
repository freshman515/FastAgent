import type { ClaudeGuiSkillCatalogEntry } from '@shared/types'
import type { ClaudeGuiSlashCommandUsage } from '@/stores/claudeGui'

export interface ClaudeGuiSlashCommandDefinition {
  kind: 'command'
  name: string
  aliases: string[]
  description: string
  tag: string
}

export interface ClaudeGuiSlashSuggestion {
  id: string
  kind: 'command' | 'skill'
  name: string
  displayText: string
  description: string
  tag: string
  sourceLabel?: string
  aliases: string[]
  usageKey: string
}

export interface ClaudeGuiSlashContext {
  kind: 'command' | 'skill'
  query: string
  start: number
  end: number
}

export interface ParsedComposerSlashCommand {
  commandName: string
  normalizedName: string
  args: string
}

const HALF_LIFE_DAYS = 7

export const BUILTIN_SLASH_COMMANDS: ClaudeGuiSlashCommandDefinition[] = [
  { kind: 'command', name: 'help', aliases: ['?'], description: 'Open the slash command palette in the composer.', tag: 'local' },
  { kind: 'command', name: 'new', aliases: ['chat'], description: 'Create a new conversation in the current scope.', tag: 'local' },
  { kind: 'command', name: 'history', aliases: ['chats'], description: 'Open conversation history for the current scope.', tag: 'local' },
  { kind: 'command', name: 'settings', aliases: ['config'], description: 'Open Claude GUI settings.', tag: 'local' },
  { kind: 'command', name: 'stats', aliases: ['usage'], description: 'Open usage statistics for the active conversation.', tag: 'local' },
  { kind: 'command', name: 'files', aliases: ['file'], description: 'Open the file picker and prefill it with an optional query.', tag: 'local' },
  { kind: 'command', name: 'clear', aliases: ['reset'], description: 'Clear the current draft, referenced files, and pending images.', tag: 'local' },
  { kind: 'command', name: 'plan', aliases: [], description: 'Toggle plan mode, or pass on/off.', tag: 'mode' },
  { kind: 'command', name: 'think', aliases: ['thinking'], description: 'Toggle thinking mode, or pass on/off.', tag: 'mode' },
  { kind: 'command', name: 'lang', aliases: ['language'], description: 'Set UI language mode, for example /lang zh or /lang off.', tag: 'mode' },
  { kind: 'command', name: 'model', aliases: [], description: 'Switch the Claude model, for example /model sonnet.', tag: 'mode' },
  { kind: 'command', name: 'skill', aliases: ['skills'], description: 'Search installed skills and run one against the current request.', tag: 'skill' },
]

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function getUsageScore(usage: ClaudeGuiSlashCommandUsage | undefined): number {
  if (!usage) return 0

  const daysSinceUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24)
  const recencyFactor = Math.max(Math.pow(0.5, daysSinceUse / HALF_LIFE_DAYS), 0.1)
  return usage.count * recencyFactor
}

function scoreMatch(query: string, name: string, aliases: string[], description: string): number | null {
  if (!query) return 500

  const normalizedName = normalizeQuery(name)
  const normalizedAliases = aliases.map(normalizeQuery)
  const normalizedDescription = normalizeQuery(description)

  if (normalizedName === query) return 0
  if (normalizedAliases.includes(query)) return 10
  if (normalizedName.startsWith(query)) return 20 + normalizedName.length * 0.01

  const aliasPrefix = normalizedAliases.find((alias) => alias.startsWith(query))
  if (aliasPrefix) return 30 + aliasPrefix.length * 0.01

  const nameIndex = normalizedName.indexOf(query)
  if (nameIndex >= 0) return 40 + nameIndex + normalizedName.length * 0.01

  const aliasIndex = normalizedAliases.findIndex((alias) => alias.includes(query))
  if (aliasIndex >= 0) return 60 + aliasIndex

  if (normalizedDescription.includes(query)) return 90
  return null
}

function sourceToLabel(skill: ClaudeGuiSkillCatalogEntry): string {
  switch (skill.source) {
    case 'project-claude':
      return 'project'
    case 'project-codex':
      return 'project'
    case 'user-claude':
      return 'user'
    case 'user-codex':
      return 'user'
    case 'runtime':
      return 'runtime'
  }
}

function createCommandSuggestion(command: ClaudeGuiSlashCommandDefinition): ClaudeGuiSlashSuggestion {
  return {
    id: `command:${command.name}`,
    kind: 'command',
    name: command.name,
    displayText: `/${command.name}`,
    description: command.description,
    tag: command.tag,
    aliases: command.aliases,
    usageKey: `command:${command.name}`,
  }
}

function createSkillSuggestion(skill: ClaudeGuiSkillCatalogEntry): ClaudeGuiSlashSuggestion {
  return {
    id: `skill:${skill.name}:${skill.source}`,
    kind: 'skill',
    name: skill.name,
    displayText: `/${skill.name}`,
    description: skill.description || `Run the ${skill.name} skill`,
    tag: 'skill',
    sourceLabel: sourceToLabel(skill),
    aliases: [],
    usageKey: `skill:${skill.name}`,
  }
}

export function parseComposerSlashCommand(input: string): ParsedComposerSlashCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const withoutSlash = trimmed.slice(1)
  const firstWhitespace = withoutSlash.search(/\s/)
  const commandName = firstWhitespace === -1 ? withoutSlash : withoutSlash.slice(0, firstWhitespace)
  if (!commandName.trim()) return null

  const args = firstWhitespace === -1 ? '' : withoutSlash.slice(firstWhitespace + 1).trim()
  return {
    commandName,
    normalizedName: normalizeQuery(commandName),
    args,
  }
}

export function getSlashSuggestionContext(text: string, caret: number): ClaudeGuiSlashContext | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length))
  const prefix = text.slice(0, safeCaret)

  const skillMatch = prefix.match(/(?:^|[\s\r\n])\/skills?\s+([^\s]*)$/i)
  if (skillMatch) {
    const query = skillMatch[1] ?? ''
    return {
      kind: 'skill',
      query,
      start: safeCaret - query.length,
      end: safeCaret,
    }
  }

  const commandMatch = prefix.match(/(?:^|[\s\r\n])\/([a-zA-Z0-9_:-]*)$/)
  if (!commandMatch) return null

  const query = commandMatch[1] ?? ''
  return {
    kind: 'command',
    query,
    start: safeCaret - query.length - 1,
    end: safeCaret,
  }
}

export function mergeSkillCatalog(
  catalog: ClaudeGuiSkillCatalogEntry[],
  runtimeSkills: string[],
): ClaudeGuiSkillCatalogEntry[] {
  const merged = new Map<string, ClaudeGuiSkillCatalogEntry>()

  for (const skill of catalog) {
    merged.set(normalizeQuery(skill.name), skill)
  }

  for (const skillName of runtimeSkills) {
    const key = normalizeQuery(skillName)
    if (merged.has(key)) continue
    merged.set(key, {
      id: `runtime:${skillName}`,
      name: skillName,
      description: 'Available in the active Claude session.',
      path: '',
      source: 'runtime',
      scope: 'runtime',
    })
  }

  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name))
}

export function buildSlashSuggestions(options: {
  context: ClaudeGuiSlashContext | null
  skills: ClaudeGuiSkillCatalogEntry[]
  usage: Record<string, ClaudeGuiSlashCommandUsage>
}): ClaudeGuiSlashSuggestion[] {
  const { context, skills, usage } = options
  if (!context) return []

  const query = normalizeQuery(context.query)
  const baseSuggestions = context.kind === 'skill'
    ? skills.map(createSkillSuggestion)
    : [
      ...BUILTIN_SLASH_COMMANDS.map(createCommandSuggestion),
      ...skills.map(createSkillSuggestion),
    ]

  const ranked = baseSuggestions
    .map((suggestion) => {
      const matchScore = scoreMatch(query, suggestion.name, suggestion.aliases, suggestion.description)
      if (matchScore === null) return null
      return {
        suggestion,
        matchScore,
        usageScore: getUsageScore(usage[suggestion.usageKey]),
      }
    })
    .filter((item): item is { suggestion: ClaudeGuiSlashSuggestion; matchScore: number; usageScore: number } => item !== null)
    .sort((left, right) => {
      if (left.matchScore !== right.matchScore) return left.matchScore - right.matchScore
      if (Math.abs(left.usageScore - right.usageScore) > 0.001) return right.usageScore - left.usageScore
      if (left.suggestion.kind !== right.suggestion.kind) return left.suggestion.kind === 'command' ? -1 : 1
      if (left.suggestion.name.length !== right.suggestion.name.length) return left.suggestion.name.length - right.suggestion.name.length
      return left.suggestion.name.localeCompare(right.suggestion.name)
    })

  return ranked.slice(0, 12).map((item) => item.suggestion)
}

export function isBuiltInSlashCommand(name: string): boolean {
  const normalized = normalizeQuery(name)
  return BUILTIN_SLASH_COMMANDS.some((command) => (
    command.name === normalized || command.aliases.some((alias) => normalizeQuery(alias) === normalized)
  ))
}
