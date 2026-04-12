import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_DIR = join(app.getPath('userData'), 'config')
const CONFIG_FILE = join(CONFIG_DIR, 'data.json')

interface ConfigData {
  groups: unknown[]
  projects: unknown[]
  sessions: unknown[]
  editors: unknown[]
  worktrees: unknown[]
  templates: unknown[]
  activeTasks: unknown[]
  ui: Record<string, unknown>
  panes: Record<string, unknown>
  claudeGui: Record<string, unknown>
  customThemes: Record<string, unknown>
}

const DEFAULT_DATA: ConfigData = {
  groups: [],
  projects: [],
  sessions: [],
  editors: [],
  worktrees: [],
  templates: [],
  activeTasks: [],
  ui: {},
  panes: {},
  claudeGui: {},
  customThemes: {},
}

let cache: ConfigData | null = null

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

export function readConfig(): ConfigData {
  if (cache) return cache

  ensureDir()

  if (!existsSync(CONFIG_FILE)) {
    cache = { ...DEFAULT_DATA }
    return cache
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    cache = {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      editors: Array.isArray(parsed.editors) ? parsed.editors : [],
      worktrees: Array.isArray(parsed.worktrees) ? parsed.worktrees : [],
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
      activeTasks: Array.isArray(parsed.activeTasks) ? parsed.activeTasks : [],
      ui: parsed.ui && typeof parsed.ui === 'object' ? parsed.ui : {},
      panes: parsed.panes && typeof parsed.panes === 'object' ? parsed.panes : {},
      claudeGui: parsed.claudeGui && typeof parsed.claudeGui === 'object' ? parsed.claudeGui : {},
      customThemes: parsed.customThemes && typeof parsed.customThemes === 'object' && !Array.isArray(parsed.customThemes) ? parsed.customThemes : {},
    }
    return cache
  } catch {
    cache = { ...DEFAULT_DATA }
    return cache
  }
}

export function writeConfig(key: keyof ConfigData, value: unknown): void {
  const data = readConfig()
  ;(data as Record<string, unknown>)[key] = value
  cache = data

  ensureDir()
  // Atomic write: write to .tmp then rename
  const tmpFile = CONFIG_FILE + '.tmp'
  writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8')
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

export function getConfigPath(): string {
  return CONFIG_FILE
}
