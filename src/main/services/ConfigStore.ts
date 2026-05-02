import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConfigChangedEvent, ConfigSyncKey } from '@shared/types'

function getConfigDir(): string {
  return join(app.getPath('userData'), 'config')
}

function getConfigFile(): string {
  return join(getConfigDir(), 'data.json')
}

interface ConfigData {
  groups: unknown[]
  sessionGroups: unknown[]
  projects: unknown[]
  sessions: unknown[]
  editors: unknown[]
  worktrees: unknown[]
  templates: unknown[]
  activeTasks: unknown[]
  infiniteTasks: Record<string, unknown>
  ui: Record<string, unknown>
  panes: Record<string, unknown>
  canvas: Record<string, unknown>
  claudeGui: Record<string, unknown>
  customThemes: Record<string, unknown>
  launches: unknown[]
}

const DEFAULT_DATA: ConfigData = {
  groups: [],
  sessionGroups: [],
  projects: [],
  sessions: [],
  editors: [],
  worktrees: [],
  templates: [],
  activeTasks: [],
  infiniteTasks: {},
  ui: {},
  panes: {},
  canvas: {},
  claudeGui: {},
  customThemes: {},
  launches: [],
}

let cache: ConfigData | null = null
let configVersion = 0
const observers = new Set<(event: ConfigChangedEvent) => void>()

function ensureDir(): void {
  const configDir = getConfigDir()
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
}

export function readConfig(): ConfigData {
  if (cache) return cache

  ensureDir()

  const configFile = getConfigFile()
  if (!existsSync(configFile)) {
    cache = { ...DEFAULT_DATA }
    return cache
  }

  try {
    const raw = readFileSync(configFile, 'utf-8')
    const parsed = JSON.parse(raw)
    cache = {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      sessionGroups: Array.isArray(parsed.sessionGroups) ? parsed.sessionGroups : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      editors: Array.isArray(parsed.editors) ? parsed.editors : [],
      worktrees: Array.isArray(parsed.worktrees) ? parsed.worktrees : [],
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
      activeTasks: Array.isArray(parsed.activeTasks) ? parsed.activeTasks : [],
      infiniteTasks: parsed.infiniteTasks && typeof parsed.infiniteTasks === 'object' && !Array.isArray(parsed.infiniteTasks) ? parsed.infiniteTasks : {},
      ui: parsed.ui && typeof parsed.ui === 'object' ? parsed.ui : {},
      panes: parsed.panes && typeof parsed.panes === 'object' ? parsed.panes : {},
      canvas: parsed.canvas && typeof parsed.canvas === 'object' ? parsed.canvas : {},
      claudeGui: parsed.claudeGui && typeof parsed.claudeGui === 'object' ? parsed.claudeGui : {},
      customThemes: parsed.customThemes && typeof parsed.customThemes === 'object' && !Array.isArray(parsed.customThemes) ? parsed.customThemes : {},
      launches: Array.isArray(parsed.launches) ? parsed.launches : [],
    }
    return cache
  } catch {
    cache = { ...DEFAULT_DATA }
    return cache
  }
}

export function writeConfig(key: ConfigSyncKey, value: unknown): ConfigChangedEvent {
  const data = readConfig()
  ;(data as unknown as Record<ConfigSyncKey, unknown>)[key] = value
  cache = data

  ensureDir()
  // Atomic write: write to .tmp then rename
  const configFile = getConfigFile()
  const tmpFile = configFile + '.tmp'
  writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8')
  writeFileSync(configFile, JSON.stringify(data, null, 2), 'utf-8')
  const event: ConfigChangedEvent = {
    key,
    value,
    version: ++configVersion,
    updatedAt: Date.now(),
  }
  for (const observer of observers) {
    try {
      observer(event)
    } catch (error) {
      console.warn('[config] observer failed:', error)
    }
  }
  return event
}

export function getConfigPath(): string {
  return getConfigFile()
}

export function addConfigObserver(observer: (event: ConfigChangedEvent) => void): () => void {
  observers.add(observer)
  return () => {
    observers.delete(observer)
  }
}
