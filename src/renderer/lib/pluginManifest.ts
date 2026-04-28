import type { CustomSessionDefinition, InstalledPlugin, PromptItem, QuickCommand, QuickCommandGroup } from '@/stores/ui'

interface PluginSessionContribution {
  id: string
  name: string
  icon: string
  command: string
  args: string
}

interface PluginQuickCommandContribution {
  id: string
  name: string
  command: string
}

interface PluginPromptContribution {
  id: string
  title: string
  content: string
  tags: string[]
}

interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  sessions: PluginSessionContribution[]
  quickCommands: PluginQuickCommandContribution[]
  prompts: PluginPromptContribution[]
}

export interface PreparedPluginInstall {
  plugin: InstalledPlugin
  customSessions: CustomSessionDefinition[]
  quickCommandGroup: QuickCommandGroup | null
  quickCommands: QuickCommand[]
  prompts: PromptItem[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(obj: Record<string, unknown>, key: string): string {
  return typeof obj[key] === 'string' ? (obj[key] as string).trim() : ''
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)))
}

function normalizePluginId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function normalizeContributionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function isPluginContributionId(id: string, pluginId: string): boolean {
  return id.startsWith(`plugin:${pluginId}:`)
}

export function parsePluginManifest(text: string): PluginManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('插件清单不是有效 JSON')
  }

  const obj = asRecord(parsed)
  if (!obj) throw new Error('插件清单必须是 JSON object')

  const id = normalizePluginId(readString(obj, 'id'))
  const name = readString(obj, 'name')
  const version = readString(obj, 'version') || '0.0.0'
  if (!id) throw new Error('插件缺少 id')
  if (!name) throw new Error('插件缺少 name')

  const rawSessions = Array.isArray(obj.sessions)
    ? obj.sessions
    : (Array.isArray(obj.sessionDefinitions) ? obj.sessionDefinitions : [])
  const sessions = rawSessions.flatMap((item): PluginSessionContribution[] => {
    const entry = asRecord(item)
    if (!entry) return []
    const localId = normalizeContributionId(readString(entry, 'id') || readString(entry, 'name'))
    const sessionName = readString(entry, 'name')
    const command = readString(entry, 'command')
    if (!localId || !sessionName || !command) return []
    return [{
      id: localId,
      name: sessionName,
      icon: readString(entry, 'icon') || 'terminal',
      command,
      args: readString(entry, 'args'),
    }]
  })

  const rawQuickCommands = Array.isArray(obj.quickCommands) ? obj.quickCommands : []
  const quickCommands = rawQuickCommands.flatMap((item): PluginQuickCommandContribution[] => {
    const entry = asRecord(item)
    if (!entry) return []
    const localId = normalizeContributionId(readString(entry, 'id') || readString(entry, 'name'))
    const commandName = readString(entry, 'name')
    const command = readString(entry, 'command')
    if (!localId || !commandName || !command) return []
    return [{ id: localId, name: commandName, command }]
  })

  const rawPrompts = Array.isArray(obj.prompts) ? obj.prompts : []
  const prompts = rawPrompts.flatMap((item): PluginPromptContribution[] => {
    const entry = asRecord(item)
    if (!entry) return []
    const localId = normalizeContributionId(readString(entry, 'id') || readString(entry, 'title'))
    const title = readString(entry, 'title')
    const content = readString(entry, 'content')
    if (!localId || !title || !content) return []
    return [{ id: localId, title, content, tags: readStringArray(entry.tags) }]
  })

  if (sessions.length + quickCommands.length + prompts.length === 0) {
    throw new Error('插件没有可安装的贡献项')
  }

  return {
    id,
    name,
    version,
    description: readString(obj, 'description') || undefined,
    sessions,
    quickCommands,
    prompts,
  }
}

export function preparePluginInstall(manifest: PluginManifest): PreparedPluginInstall {
  const now = Date.now()
  const quickCommandGroup: QuickCommandGroup | null = manifest.quickCommands.length > 0
    ? { id: `plugin:${manifest.id}:quick-command-group`, name: manifest.name }
    : null

  const customSessions = manifest.sessions.map((item) => ({
    id: `plugin:${manifest.id}:session:${item.id}`,
    name: item.name,
    icon: item.icon,
    command: item.command,
    args: item.args,
  }))

  const quickCommands = manifest.quickCommands.map((item) => ({
    id: `plugin:${manifest.id}:quick-command:${item.id}`,
    name: item.name,
    command: item.command,
    groupId: quickCommandGroup?.id,
  }))

  const prompts = manifest.prompts.map((item) => ({
    id: `plugin:${manifest.id}:prompt:${item.id}`,
    title: item.title,
    content: item.content,
    tags: Array.from(new Set(['plugin', manifest.name, ...item.tags].filter(Boolean))),
    favorite: false,
    createdAt: now,
    updatedAt: now,
  }))

  return {
    plugin: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      installedAt: now,
      contributions: {
        customSessions: customSessions.length,
        quickCommands: quickCommands.length,
        prompts: prompts.length,
      },
    },
    customSessions,
    quickCommandGroup,
    quickCommands,
    prompts,
  }
}
