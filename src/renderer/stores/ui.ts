import { create } from 'zustand'
import type { ToastNotification } from '@shared/types'
import { generateId } from '@/lib/utils'

export type VisualizerMode = 'melody' | 'bars'

export interface QuickCommandGroup {
  id: string
  name: string
}

export interface QuickCommand {
  id: string
  name: string
  command: string
  groupId?: string | null
}

const DEFAULT_QUICK_COMMANDS = [
  { id: 'qc-default-ls', name: 'ls', command: 'ls' },
  { id: 'qc-default-pwd', name: 'pwd', command: 'pwd' },
  { id: 'qc-default-git-status', name: 'git status', command: 'git status' },
  { id: 'qc-default-git-diff-stat', name: 'git diff --stat', command: 'git diff --stat' },
  { id: 'qc-default-git-diff', name: 'git diff', command: 'git diff' },
  { id: 'qc-default-git-branch', name: 'git branch', command: 'git branch -vv' },
  { id: 'qc-default-git-head', name: 'git show HEAD', command: 'git show --stat --oneline HEAD' },
  { id: 'qc-default-git-stash', name: 'git stash list', command: 'git stash list' },
  { id: 'qc-default-git-log', name: 'git log', command: 'git log --oneline -10' },
] as const

const DEFAULT_QUICK_COMMAND_IDS = new Set(DEFAULT_QUICK_COMMANDS.map((cmd) => cmd.id))

export interface AppSettings {
  uiFontSize: number
  uiFontFamily: string
  terminalFontSize: number
  terminalFontFamily: string
  editorFontSize: number
  editorFontFamily: string
  editorWordWrap: boolean
  editorMinimap: boolean
  editorLineNumbers: boolean
  editorStickyScroll: boolean
  editorFontLigatures: boolean
  visibleGroupId: string | null // null = show all groups
  defaultSessionType: 'claude-code' | 'claude-code-yolo' | 'terminal' | 'codex' | 'codex-yolo' | 'opencode'
  recentPaths: string[]
  visualizerMode: VisualizerMode
  showMusicPlayer: boolean
  showTitleBarSearch: boolean
  titleBarSearchScope: 'project' | 'all-projects'
  /** Visualizer canvas width in px (shared by melody and bars) */
  visualizerWidth: number
  /** Show play/pause/prev/next control buttons */
  showPlayerControls: boolean
  /** Show track info (artist - title) and artwork */
  showTrackInfo: boolean
  /** Pop-out window default width */
  popoutWidth: number
  /** Pop-out window default height */
  popoutHeight: number
  /** Pop-out window position: 'cursor' follows mouse, 'center' centers on screen */
  popoutPosition: 'cursor' | 'center'
  quickCommandGroups: QuickCommandGroup[]
  quickCommands: QuickCommand[]
  // AI Summary settings
  aiProvider: 'openai' | 'anthropic' | 'minimax' | 'custom'
  aiBaseUrl: string
  aiApiKey: string
  aiModel: string
  aiSystemPrompt: string
}

const DEFAULT_SETTINGS: AppSettings = {
  uiFontSize: 13,
  uiFontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  terminalFontSize: 18,
  terminalFontFamily: "'JetBrainsMono Nerd Font', ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace",
  editorFontSize: 16,
  editorFontFamily: "'JetBrainsMono Nerd Font', ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace",
  editorWordWrap: false,
  editorMinimap: true,
  editorLineNumbers: true,
  editorStickyScroll: true,
  editorFontLigatures: true,
  visibleGroupId: null,
  defaultSessionType: 'claude-code',
  recentPaths: [],
  visualizerMode: 'melody',
  showMusicPlayer: true,
  showTitleBarSearch: false,
  titleBarSearchScope: 'project',
  visualizerWidth: 192,
  showPlayerControls: true,
  showTrackInfo: true,
  popoutWidth: 800,
  popoutHeight: 600,
  popoutPosition: 'cursor',
  quickCommandGroups: [],
  quickCommands: [...DEFAULT_QUICK_COMMANDS],
  aiProvider: 'openai',
  aiBaseUrl: 'https://api.openai.com/v1',
  aiApiKey: '',
  aiModel: 'gpt-4o-mini',
  aiSystemPrompt: `You are a concise terminal output analyzer. Summarize the terminal output in 3-5 bullet points:
- What commands were run
- Key results or errors
- Current status
Keep it brief and actionable. Use the same language as the terminal output.`,
}

interface UIState {
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  rightPanelWidth: number
  setRightPanelWidth: (width: number) => void
  rightPanelCollapsed: boolean
  toggleRightPanel: () => void
  rightPanelTab: string
  setRightPanelTab: (tab: string) => void

  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void

  settings: AppSettings
  _loadSettings: (raw: Record<string, unknown>) => void
  updateSettings: (updates: Partial<AppSettings>) => void
  addRecentPath: (path: string) => void

  toasts: ToastNotification[]
  addToast: (toast: Omit<ToastNotification, 'id' | 'createdAt'>) => string
  removeToast: (id: string) => void
  clearToasts: () => void
}

function persistSettings(settings: AppSettings): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('ui', settings)
}

function normalizeQuickCommandGroups(raw: unknown): { groups: QuickCommandGroup[]; seeded: boolean } {
  if (!Array.isArray(raw)) return { groups: [], seeded: false }

  let seeded = false
  const seenIds = new Set<string>()
  const groups: QuickCommandGroup[] = []

  for (const item of raw) {
    if (
      !item
      || typeof item !== 'object'
      || typeof (item as { id?: unknown }).id !== 'string'
      || typeof (item as { name?: unknown }).name !== 'string'
    ) {
      seeded = true
      continue
    }

    const id = (item as { id: string }).id
    const name = (item as { name: string }).name.trim()
    if (!name || seenIds.has(id)) {
      seeded = true
      continue
    }

    if (name !== (item as { name: string }).name) seeded = true
    seenIds.add(id)
    groups.push({ id, name })
  }

  return { groups, seeded }
}

function normalizeQuickCommands(
  raw: unknown,
  validGroupIds: Set<string>,
): { commands: AppSettings['quickCommands']; seeded: boolean } {
  if (!Array.isArray(raw)) {
    return { commands: [...DEFAULT_QUICK_COMMANDS], seeded: false }
  }

  let seeded = false
  const seenIds = new Set<string>()
  const commands: QuickCommand[] = []

  for (const item of raw) {
    if (
      !item
      || typeof item !== 'object'
      || typeof (item as { id?: unknown }).id !== 'string'
      || typeof (item as { name?: unknown }).name !== 'string'
      || typeof (item as { command?: unknown }).command !== 'string'
    ) {
      seeded = true
      continue
    }

    const id = (item as { id: string }).id
    if (seenIds.has(id)) {
      seeded = true
      continue
    }

    const name = (item as { name: string }).name.trim()
    const command = (item as { command: string }).command.trim()
    if (!name || !command) {
      seeded = true
      continue
    }

    const rawGroupId = typeof (item as { groupId?: unknown }).groupId === 'string'
      ? (item as { groupId: string }).groupId
      : null
    const groupId = rawGroupId && validGroupIds.has(rawGroupId) ? rawGroupId : undefined

    if (name !== (item as { name: string }).name || command !== (item as { command: string }).command) seeded = true
    if (rawGroupId && !groupId) seeded = true

    seenIds.add(id)
    commands.push({ id, name, command, groupId })
  }

  if (commands.length === 0) {
    return { commands: [...DEFAULT_QUICK_COMMANDS], seeded: true }
  }

  const existingIds = new Set(commands.map((command) => command.id))
  const missingDefaults = DEFAULT_QUICK_COMMANDS.filter((command) => !existingIds.has(command.id))

  if (missingDefaults.length === 0) {
    return { commands, seeded }
  }

  return {
    commands: commands.some((command) => DEFAULT_QUICK_COMMAND_IDS.has(command.id))
      ? [...commands, ...missingDefaults]
      : [...DEFAULT_QUICK_COMMANDS, ...commands],
    seeded: true,
  }
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarWidth: 260,
  sidebarCollapsed: false,

  setSidebarWidth: (width) => {
    set({ sidebarWidth: width })
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  rightPanelWidth: 300,
  rightPanelCollapsed: true,
  rightPanelTab: 'agent',
  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
  toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab, rightPanelCollapsed: false }),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  settings: { ...DEFAULT_SETTINGS },

  _loadSettings: (raw) => {
    const s = { ...DEFAULT_SETTINGS }
    let shouldPersistSettings = false
    if (raw && typeof raw === 'object') {
      if (typeof raw.uiFontSize === 'number') s.uiFontSize = raw.uiFontSize
      if (typeof raw.uiFontFamily === 'string') s.uiFontFamily = raw.uiFontFamily
      if (typeof raw.terminalFontSize === 'number') s.terminalFontSize = raw.terminalFontSize
      if (typeof raw.terminalFontFamily === 'string') s.terminalFontFamily = raw.terminalFontFamily
      if (typeof raw.editorFontSize === 'number') s.editorFontSize = Math.max(10, Math.min(28, raw.editorFontSize))
      if (typeof raw.editorFontFamily === 'string') s.editorFontFamily = raw.editorFontFamily
      if (typeof raw.editorWordWrap === 'boolean') s.editorWordWrap = raw.editorWordWrap
      if (typeof raw.editorMinimap === 'boolean') s.editorMinimap = raw.editorMinimap
      if (typeof raw.editorLineNumbers === 'boolean') s.editorLineNumbers = raw.editorLineNumbers
      if (typeof raw.editorStickyScroll === 'boolean') s.editorStickyScroll = raw.editorStickyScroll
      if (typeof raw.editorFontLigatures === 'boolean') s.editorFontLigatures = raw.editorFontLigatures
      if (raw.visibleGroupId === null || typeof raw.visibleGroupId === 'string') s.visibleGroupId = raw.visibleGroupId as string | null
      if (typeof raw.defaultSessionType === 'string' && ['claude-code', 'claude-code-yolo', 'terminal', 'codex', 'codex-yolo', 'opencode'].includes(raw.defaultSessionType)) s.defaultSessionType = raw.defaultSessionType as AppSettings['defaultSessionType']
      if (Array.isArray(raw.recentPaths)) s.recentPaths = raw.recentPaths.filter((p) => typeof p === 'string').slice(0, 10) as string[]
      if (raw.visualizerMode === 'melody' || raw.visualizerMode === 'bars') s.visualizerMode = raw.visualizerMode
      if (typeof raw.showMusicPlayer === 'boolean') s.showMusicPlayer = raw.showMusicPlayer
      if (typeof raw.showTitleBarSearch === 'boolean') s.showTitleBarSearch = raw.showTitleBarSearch
      if (raw.titleBarSearchScope === 'project' || raw.titleBarSearchScope === 'all-projects') {
        s.titleBarSearchScope = raw.titleBarSearchScope
      }
      if (typeof raw.visualizerWidth === 'number') s.visualizerWidth = Math.max(80, Math.min(7680, raw.visualizerWidth))
      if (typeof raw.showPlayerControls === 'boolean') s.showPlayerControls = raw.showPlayerControls
      if (typeof raw.showTrackInfo === 'boolean') s.showTrackInfo = raw.showTrackInfo
      if (typeof raw.popoutWidth === 'number') s.popoutWidth = Math.max(400, Math.min(1920, raw.popoutWidth))
      if (typeof raw.popoutHeight === 'number') s.popoutHeight = Math.max(300, Math.min(1080, raw.popoutHeight))
      if (raw.popoutPosition === 'cursor' || raw.popoutPosition === 'center') s.popoutPosition = raw.popoutPosition
      if (raw.quickCommandGroups !== undefined) {
        const normalizedQuickCommandGroups = normalizeQuickCommandGroups(raw.quickCommandGroups)
        s.quickCommandGroups = normalizedQuickCommandGroups.groups
        shouldPersistSettings ||= normalizedQuickCommandGroups.seeded
      }
      if (raw.quickCommands !== undefined) {
        const normalizedQuickCommands = normalizeQuickCommands(raw.quickCommands, new Set(s.quickCommandGroups.map((group) => group.id)))
        s.quickCommands = normalizedQuickCommands.commands
        shouldPersistSettings ||= normalizedQuickCommands.seeded
      }
      if (typeof raw.aiBaseUrl === 'string') s.aiBaseUrl = raw.aiBaseUrl
      if (raw.aiProvider === 'openai' || raw.aiProvider === 'anthropic' || raw.aiProvider === 'minimax' || raw.aiProvider === 'custom') {
        s.aiProvider = raw.aiProvider
      }
      if (s.aiProvider === 'custom' && s.aiBaseUrl.trim().toLowerCase().includes('minimax')) {
        s.aiProvider = 'minimax'
      }
      if (typeof raw.aiApiKey === 'string') s.aiApiKey = raw.aiApiKey
      if (typeof raw.aiModel === 'string') s.aiModel = raw.aiModel
      if (typeof raw.aiSystemPrompt === 'string') s.aiSystemPrompt = raw.aiSystemPrompt
      if (typeof raw.sidebarWidth === 'number') set({ sidebarWidth: raw.sidebarWidth })
    }
    set({ settings: s })
    applyUIFont(s)
    if (shouldPersistSettings) {
      persistSettings(s)
    }
  },

  updateSettings: (updates) => {
    const settings = { ...get().settings, ...updates }
    set({ settings })
    persistSettings(settings)
    applyUIFont(settings)
  },

  addRecentPath: (path) => {
    const settings = get().settings
    const paths = [path, ...settings.recentPaths.filter((p) => p !== path)].slice(0, 10)
    const updated = { ...settings, recentPaths: paths }
    set({ settings: updated })
    persistSettings(updated)
  },

  toasts: [],

  addToast: (toast) => {
    const id = generateId()
    const notification: ToastNotification = {
      ...toast,
      id,
      createdAt: Date.now(),
    }

    set((state) => ({
      toasts: [...state.toasts, notification],
    }))

    const duration = toast.duration ?? (toast.type === 'error' ? 10000 : 5000)
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }))
      }, duration)
    }

    return id
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearToasts: () => set({ toasts: [] }),
}))

function applyUIFont(settings: AppSettings): void {
  const root = document.documentElement
  const base = settings.uiFontSize
  const scale = base / 13

  // Proportionally scaled text sizes (base design = 13px)
  root.style.setProperty('--ui-font-2xs', `${Math.round(10 * scale)}px`)  // labels, badges
  root.style.setProperty('--ui-font-xs', `${Math.round(11 * scale)}px`)   // secondary text
  root.style.setProperty('--ui-font-sm', `${Math.round(12 * scale)}px`)   // body text
  root.style.setProperty('--ui-font-base', `${base}px`)                   // primary text
  root.style.setProperty('--ui-font-md', `${Math.round(14 * scale)}px`)   // headings
  root.style.setProperty('--ui-font-family', settings.uiFontFamily)
}
