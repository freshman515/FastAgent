import { create } from 'zustand'
import { DEFAULT_FUNASR_WS_ENDPOINT, LEGACY_DEFAULT_VOICE_API_ENDPOINT } from '@shared/types'
import type { SessionType, TerminalShellMode, ToastNotification, VoiceApiBodyMode, VoiceInputMode, WorkspaceLayout } from '@shared/types'
import { generateId } from '@/lib/utils'
import { applyTerminalThemeToApp, clearTerminalThemeFromApp, registerCustomThemes, type GhosttyTheme } from '@/lib/ghosttyTheme'
import { restoreSelectedProjectPaneLayout } from '@/lib/project-context'
import { usePanesStore } from './panes'

export type VisualizerMode = 'melody' | 'bars'
export type DockSide = 'left' | 'right'
export type DockPanelId = 'projects' | 'recentSessions' | 'sessionHistory' | 'agent' | 'agentBoard' | 'tasks' | 'commands' | 'prompts' | 'promptOptimizer' | 'todo' | 'files' | 'search' | 'timeline' | 'git' | 'ai' | 'claude'
export type TodoPriority = 'low' | 'medium' | 'high'
export type AgentBoardStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type AgentBoardPriority = 'low' | 'medium' | 'high'
export type GitChangesViewMode = 'flat' | 'tree'
export type GitReviewMode = 'claude-gui' | SessionType | `custom:${string}`
export type GitReviewFixMode = 'claude-gui' | 'claude-code-cli'
export type CanvasArrangeMode = 'free' | 'grid' | 'rowFlow' | 'colFlow'
export type AppChromeStyle = 'floating' | 'joined'
export type PaneUiMode = 'separated' | 'classic'
export type TabUiMode = 'rounded' | 'square'
export type PaneDensityMode = 'comfortable' | 'compact'

export const CANVAS_SESSION_CARD_WIDTH_MIN = 480
export const CANVAS_SESSION_CARD_WIDTH_MAX = 2400
export const CANVAS_SESSION_CARD_HEIGHT_MIN = 320
export const CANVAS_SESSION_CARD_HEIGHT_MAX = 1600
export const CANVAS_FOCUS_FONT_PX_MIN = 8
export const CANVAS_FOCUS_FONT_PX_MAX = 48
export const CANVAS_FOCUS_FONT_TARGET_DEFAULT = 17
export const CANVAS_FOCUS_FONT_RANGE_MIN_DEFAULT = 14
export const CANVAS_FOCUS_FONT_RANGE_MAX_DEFAULT = 20

const GIT_REVIEW_SESSION_TYPES = new Set<SessionType>([
  'claude-code',
  'claude-code-yolo',
  'claude-code-wsl',
  'claude-code-yolo-wsl',
  'codex',
  'codex-yolo',
  'codex-wsl',
  'codex-yolo-wsl',
  'gemini',
  'gemini-yolo',
  'opencode',
])

function normalizeGitReviewMode(raw: unknown): GitReviewMode | null {
  if (raw === 'claude-code-cli') return 'claude-code'
  if (raw === 'claude-gui') return 'claude-gui'
  if (typeof raw !== 'string') return null
  if (raw.startsWith('custom:') && raw.slice('custom:'.length).trim()) {
    return raw as GitReviewMode
  }
  return GIT_REVIEW_SESSION_TYPES.has(raw as SessionType) ? raw as GitReviewMode : null
}

function normalizeTerminalShellMode(raw: unknown): TerminalShellMode {
  return raw === 'auto'
    || raw === 'pwsh'
    || raw === 'powershell'
    || raw === 'cmd'
    || raw === 'gitbash'
    || raw === 'custom'
    ? raw
    : DEFAULT_SETTINGS.terminalShellMode
}

function normalizeVoiceInputMode(raw: unknown): VoiceInputMode {
  return raw === 'system' || raw === 'api' ? raw : DEFAULT_SETTINGS.voiceInputMode
}

function normalizeVoiceApiBodyMode(raw: unknown): VoiceApiBodyMode {
  return raw === 'multipart' || raw === 'raw' ? raw : DEFAULT_SETTINGS.voiceApiBodyMode
}

function normalizeVoiceApiTimeoutMs(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.max(1000, Math.min(120000, Math.round(raw)))
    : DEFAULT_SETTINGS.voiceApiTimeoutMs
}

export const DOCK_PANEL_IDS: DockPanelId[] = [
  'projects',
  'recentSessions',
  'sessionHistory',
  'agent',
  'agentBoard',
  'tasks',
  'commands',
  'prompts',
  'promptOptimizer',
  'todo',
  'files',
  'search',
  'timeline',
  'git',
  'ai',
  'claude',
]

export const DEFAULT_DOCK_PANEL_ORDER: Record<DockSide, DockPanelId[]> = {
  left: ['projects', 'recentSessions', 'sessionHistory', 'git', 'files'],
  right: ['agent', 'agentBoard', 'tasks', 'commands', 'prompts', 'promptOptimizer', 'todo', 'search', 'timeline', 'ai', 'claude'],
}

const DEFAULT_DOCK_PANEL_ACTIVE: Record<DockSide, DockPanelId | null> = {
  left: 'projects',
  right: 'agent',
}

const DEFAULT_DOCK_PANEL_COLLAPSED: Record<DockSide, boolean> = {
  left: false,
  right: true,
}

const DEFAULT_DOCK_PANEL_WIDTH: Record<DockSide, number> = {
  left: 260,
  right: 300,
}

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

export interface TodoItem {
  id: string
  text: string
  completed: boolean
  createdAt: number
  updatedAt: number
  priority: TodoPriority
}

export interface AgentBoardItem {
  id: string
  projectId: string | null
  worktreeId?: string
  title: string
  description: string
  status: AgentBoardStatus
  priority: AgentBoardPriority
  sessionType: Exclude<SessionType, 'browser' | 'claude-gui'>
  sessionId?: string
  createdAt: number
  updatedAt: number
  launchedAt?: number
  completedAt?: number
  error?: string
}

export interface PromptItem {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  favorite: boolean
}

export interface CustomSessionDefinition {
  id: string
  name: string
  icon: string
  command: string
  args: string
}

export interface InstalledPlugin {
  id: string
  name: string
  version: string
  description?: string
  installedAt: number
  contributions: {
    customSessions: number
    quickCommands: number
    prompts: number
  }
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

const DEFAULT_QUICK_COMMAND_IDS: Set<string> = new Set(DEFAULT_QUICK_COMMANDS.map((cmd) => cmd.id))
const NEW_SESSION_MENU_PRESET_VERSION = 1
export const DEFAULT_HIDDEN_NEW_SESSION_OPTION_IDS = [
  'terminal-wsl',
  'claude-code-wsl',
  'claude-code-yolo-wsl',
  'claude-gui',
  'codex-wsl',
  'codex-yolo-wsl',
] as const

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
  visibleProjectId: string | null // null = show all projects
  defaultSessionType: 'browser' | 'claude-code' | 'claude-code-yolo' | 'claude-code-wsl' | 'claude-code-yolo-wsl' | 'terminal' | 'terminal-wsl' | 'codex' | 'codex-yolo' | 'codex-wsl' | 'codex-yolo-wsl' | 'gemini' | 'gemini-yolo' | 'opencode'
  /** When set, default creation uses a custom launcher instead of defaultSessionType. */
  defaultCustomSessionId: string | null
  customSessionDefinitions: CustomSessionDefinition[]
  installedPlugins: InstalledPlugin[]
  /** New session menu option ids hidden by the user. Built-ins use SessionType, custom launchers use custom:<id>. */
  hiddenNewSessionOptionIds: string[]
  /** Internal preset marker for default new-session menu visibility migrations. */
  newSessionMenuPresetVersion: number
  /** New session menu option order. Built-ins use SessionType, custom launchers use custom:<id>. */
  newSessionOptionOrder: string[]
  /** Pop up a naming dialog when creating a new session */
  promptSessionNameOnCreate: boolean
  /** Windows shell used for new Terminal and non-WSL agent PTYs. */
  terminalShellMode: TerminalShellMode
  /** Custom shell executable/path when terminalShellMode is custom. */
  terminalShellCommand: string
  /** Custom shell arguments when terminalShellMode is custom. */
  terminalShellArgs: string
  /** Default voice input mode from terminal context menu. */
  voiceInputMode: VoiceInputMode
  /** Local ASR API endpoint used by voiceInputMode=api. */
  voiceApiUrl: string
  /** How audio should be sent to the ASR API. */
  voiceApiBodyMode: VoiceApiBodyMode
  /** Multipart field name for the audio file. */
  voiceApiFileFieldName: string
  /** Dot path used to read recognized text from the JSON response. */
  voiceApiResponseTextPath: string
  /** Request timeout for local ASR API. */
  voiceApiTimeoutMs: number
  /** Optional Authorization header value for ASR API. */
  voiceApiAuthorization: string
  wslDistroName: string
  wslShell: string
  wslUseLoginShell: boolean
  wslPathPrefix: string
  wslInitScript: string
  wslEnvVars: string
  recentPaths: string[]
  visualizerMode: VisualizerMode
  showMusicPlayer: boolean
  showTitleBarSearch: boolean
  showActivePaneBorder: boolean
  titleBarMenuVisibility: 'always' | 'hover'
  titleBarSearchScope: 'project' | 'all-projects'
  startupWindowState: 'maximized' | 'normal'
  gitChangesViewMode: GitChangesViewMode
  gitReviewMode: GitReviewMode
  gitReviewFixMode: GitReviewFixMode
  /** Last visited settings dialog page — persisted so reopening lands on the previous tab */
  lastSettingsPage: string
  /** Global shell treatment: floating rounded panels, or connected square panels. */
  appChromeStyle: AppChromeStyle
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
  /** Show in-app toast / system notification when an agent task completes */
  notificationToastEnabled: boolean
  /** Play a sound when an agent task completes */
  notificationSoundEnabled: boolean
  /** Notification sound volume, 0..1 */
  notificationSoundVolume: number
  quickCommandGroups: QuickCommandGroup[]
  quickCommands: QuickCommand[]
  todoItems: TodoItem[]
  agentBoardItems: AgentBoardItem[]
  promptItems: PromptItem[]
  terminalTheme: string
  customThemes: Record<string, GhosttyTheme>
  // AI Summary settings
  aiProvider: 'openai' | 'anthropic' | 'minimax' | 'custom'
  aiBaseUrl: string
  aiApiKey: string
  aiModel: string
  aiSystemPrompt: string
  // Session history panel — remembered filter selections
  sessionHistorySourceFilter: 'all' | 'claude-code' | 'codex'
  sessionHistoryOnlyCurrentProject: boolean
  // ─── Canvas workspace ───
  /** 'panes' = classic BSP split tabs, 'canvas' = infinite canvas with free-form cards */
  workspaceLayout: WorkspaceLayout
  /** Visual treatment for classic split panes. */
  paneUiMode: PaneUiMode
  /** Visual treatment for session/editor tabs. */
  tabUiMode: TabUiMode
  /** Density for classic pane chrome and tab bars. */
  paneDensityMode: PaneDensityMode
  /** Show the grid background on the canvas */
  canvasGridEnabled: boolean
  /** Snap card movement to the grid / sibling edges */
  canvasSnapEnabled: boolean
  /** 'free' = cards may overlap, 'avoid' = cards push each other away while dragging */
  canvasOverlapMode: 'free' | 'avoid'
  /** Current visible canvas arrangement mode. */
  canvasArrangeMode: CanvasArrangeMode
  /** Show the minimap overlay on the canvas */
  canvasShowMinimap: boolean
  /** Prevent accidental canvas layout edits such as dragging, resizing, deleting, or nudging cards */
  canvasLayoutLocked: boolean
  /** Default width for newly-created canvas session / terminal cards */
  canvasSessionCardWidth: number
  /** Default height for newly-created canvas session / terminal cards */
  canvasSessionCardHeight: number
  /** Current visual font size lower bound where clicking a canvas card only centers it */
  canvasFocusReadableFontMinPx: number
  /** Current visual font size upper bound where clicking a canvas card only centers it */
  canvasFocusReadableFontMaxPx: number
  /** Visual font size to zoom to when a canvas card is outside the readable range */
  canvasFocusTargetFontPx: number
}

const DEFAULT_SETTINGS: AppSettings = {
  uiFontSize: 15,
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
  visibleProjectId: null,
  defaultSessionType: 'claude-code',
  defaultCustomSessionId: null,
  customSessionDefinitions: [],
  installedPlugins: [],
  hiddenNewSessionOptionIds: [...DEFAULT_HIDDEN_NEW_SESSION_OPTION_IDS],
  newSessionMenuPresetVersion: NEW_SESSION_MENU_PRESET_VERSION,
  newSessionOptionOrder: [],
  promptSessionNameOnCreate: false,
  terminalShellMode: 'auto',
  terminalShellCommand: '',
  terminalShellArgs: '',
  voiceInputMode: 'system',
  voiceApiUrl: DEFAULT_FUNASR_WS_ENDPOINT,
  voiceApiBodyMode: 'multipart',
  voiceApiFileFieldName: 'file',
  voiceApiResponseTextPath: 'text',
  voiceApiTimeoutMs: 30000,
  voiceApiAuthorization: '',
  wslDistroName: '',
  wslShell: 'bash',
  wslUseLoginShell: false,
  wslPathPrefix: '',
  wslInitScript: 'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi',
  wslEnvVars: '',
  recentPaths: [],
  visualizerMode: 'melody',
  showMusicPlayer: false,
  showTitleBarSearch: false,
  showActivePaneBorder: false,
  titleBarMenuVisibility: 'always',
  titleBarSearchScope: 'project',
  startupWindowState: 'maximized',
  gitChangesViewMode: 'tree',
  gitReviewMode: 'codex',
  gitReviewFixMode: 'claude-gui',
  lastSettingsPage: 'general',
  appChromeStyle: 'floating',
  visualizerWidth: 192,
  showPlayerControls: true,
  showTrackInfo: true,
  popoutWidth: 800,
  popoutHeight: 600,
  popoutPosition: 'cursor',
  notificationToastEnabled: true,
  notificationSoundEnabled: true,
  notificationSoundVolume: 0.6,
  quickCommandGroups: [],
  quickCommands: [...DEFAULT_QUICK_COMMANDS],
  todoItems: [],
  agentBoardItems: [],
  promptItems: [],
  terminalTheme: 'Catppuccin Mocha',
  customThemes: {},
  aiProvider: 'openai',
  aiBaseUrl: 'https://api.openai.com/v1',
  aiApiKey: '',
  aiModel: 'gpt-4o-mini',
  aiSystemPrompt: `You are a concise terminal output analyzer. Summarize the terminal output in 3-5 bullet points:
- What commands were run
- Key results or errors
- Current status
Keep it brief and actionable. Use the same language as the terminal output.`,
  sessionHistorySourceFilter: 'all',
  sessionHistoryOnlyCurrentProject: false,
  workspaceLayout: 'panes',
  paneUiMode: 'separated',
  tabUiMode: 'rounded',
  paneDensityMode: 'comfortable',
  canvasGridEnabled: true,
  canvasSnapEnabled: true,
  canvasOverlapMode: 'free',
  canvasArrangeMode: 'free',
  canvasShowMinimap: true,
  canvasLayoutLocked: false,
  canvasSessionCardWidth: 1040,
  canvasSessionCardHeight: 660,
  canvasFocusReadableFontMinPx: CANVAS_FOCUS_FONT_RANGE_MIN_DEFAULT,
  canvasFocusReadableFontMaxPx: CANVAS_FOCUS_FONT_RANGE_MAX_DEFAULT,
  canvasFocusTargetFontPx: CANVAS_FOCUS_FONT_TARGET_DEFAULT,
}

interface UIState {
  windowFullscreen: boolean
  setWindowFullscreen: (fullscreen: boolean) => void
  projectDetailOpenProjectId: string | null
  setProjectDetailOpenProjectId: (projectId: string | null) => void

  dockPanelOrder: Record<DockSide, DockPanelId[]>
  dockPanelActiveTab: Record<DockSide, DockPanelId | null>
  dockPanelCollapsed: Record<DockSide, boolean>
  dockPanelWidth: Record<DockSide, number>
  setDockPanelWidth: (side: DockSide, width: number, persist?: boolean) => void
  toggleDockPanel: (side: DockSide) => void
  setDockPanelTab: (side: DockSide, tab: DockPanelId) => void
  activateDockPanel: (tab: DockPanelId) => void
  moveDockPanel: (
    panelId: DockPanelId,
    toSide: DockSide,
    targetPanelId?: DockPanelId,
    position?: 'before' | 'after',
  ) => void
  resetDockPanels: () => void

  settingsOpen: boolean
  settingsPage: string
  openSettings: (page?: string) => void
  setSettingsPage: (page: string) => void
  closeSettings: () => void

  settings: AppSettings
  _loadSettings: (raw: Record<string, unknown>, customThemesOverride?: Record<string, unknown>) => void
  updateSettings: (updates: Partial<AppSettings>) => void
  addRecentPath: (path: string) => void

  toasts: ToastNotification[]
  addToast: (toast: Omit<ToastNotification, 'id' | 'createdAt'>) => string
  removeToast: (id: string) => void
  clearToasts: () => void

  sessionNamePrompt: SessionNamePromptRequest | null
  setSessionNamePrompt: (prompt: SessionNamePromptRequest | null) => void
}

export interface SessionNamePromptRequest {
  defaultName: string
  title?: string
  description?: string
  /** Session type — controls the icon shown in the dialog header. */
  sessionType?: SessionType
  onSubmit: (name: string) => void
  onUseDefault: () => void
  onCancel: () => void
}

type UIPersistedState = Pick<
  UIState,
  'settings' | 'dockPanelOrder' | 'dockPanelActiveTab' | 'dockPanelCollapsed' | 'dockPanelWidth'
>

function persistUI(state: UIPersistedState): void {
  if (window.api.detach.isDetached) return
  // Save customThemes to its own top-level key — isolated from ui settings
  // so that HMR store resets or any ui overwrite cannot wipe user themes.
  void window.api.config.write('customThemes', state.settings.customThemes)
  window.api.config.write('ui', {
    ...state.settings,
    dockPanelOrder: state.dockPanelOrder,
    dockPanelActiveTab: state.dockPanelActiveTab,
    dockPanelCollapsed: state.dockPanelCollapsed,
    dockPanelWidth: state.dockPanelWidth,
  })
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

function normalizeCustomSessionDefinitions(raw: unknown): { definitions: CustomSessionDefinition[]; seeded: boolean } {
  if (!Array.isArray(raw)) return { definitions: [], seeded: false }

  let seeded = false
  const seenIds = new Set<string>()
  const definitions: CustomSessionDefinition[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      seeded = true
      continue
    }

    const obj = item as Record<string, unknown>
    const rawId = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : generateId()
    const name = typeof obj.name === 'string' ? obj.name.trim() : ''
    const command = typeof obj.command === 'string' ? obj.command.trim() : ''
    if (!name || !command || seenIds.has(rawId)) {
      seeded = true
      continue
    }

    const icon = typeof obj.icon === 'string' && obj.icon.trim() ? obj.icon.trim() : '⚙'
    const args = typeof obj.args === 'string' ? obj.args.trim() : ''
    if (rawId !== obj.id || name !== obj.name || command !== obj.command || icon !== obj.icon || args !== obj.args) {
      seeded = true
    }

    seenIds.add(rawId)
    definitions.push({ id: rawId, name, icon, command, args })
  }

  return { definitions, seeded }
}

function normalizeHiddenNewSessionOptionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
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

function normalizeTodoItems(raw: unknown): { items: TodoItem[]; seeded: boolean } {
  if (!Array.isArray(raw)) return { items: [], seeded: false }

  let seeded = false
  const seenIds = new Set<string>()
  const items: TodoItem[] = []

  for (const item of raw) {
    if (
      !item
      || typeof item !== 'object'
      || typeof (item as { id?: unknown }).id !== 'string'
      || typeof (item as { text?: unknown }).text !== 'string'
    ) {
      seeded = true
      continue
    }

    const id = (item as { id: string }).id
    if (seenIds.has(id)) {
      seeded = true
      continue
    }

    const text = (item as { text: string }).text.trim()
    if (!text) {
      seeded = true
      continue
    }

    if (text !== (item as { text: string }).text) seeded = true
    if (typeof (item as { updatedAt?: unknown }).updatedAt !== 'number') seeded = true
    if (
      (item as { priority?: unknown }).priority !== 'low'
      && (item as { priority?: unknown }).priority !== 'medium'
      && (item as { priority?: unknown }).priority !== 'high'
    ) {
      seeded = true
    }

    seenIds.add(id)
    items.push({
      id,
      text,
      completed: typeof (item as { completed?: unknown }).completed === 'boolean'
        ? (item as { completed: boolean }).completed
        : false,
      createdAt: typeof (item as { createdAt?: unknown }).createdAt === 'number'
        ? (item as { createdAt: number }).createdAt
        : Date.now(),
      updatedAt: typeof (item as { updatedAt?: unknown }).updatedAt === 'number'
        ? (item as { updatedAt: number }).updatedAt
        : (typeof (item as { createdAt?: unknown }).createdAt === 'number'
            ? (item as { createdAt: number }).createdAt
            : Date.now()),
      priority:
        (item as { priority?: unknown }).priority === 'low'
        || (item as { priority?: unknown }).priority === 'medium'
        || (item as { priority?: unknown }).priority === 'high'
          ? (item as { priority: TodoPriority }).priority
          : 'medium',
    })
  }

  return { items, seeded }
}

function isAgentBoardStatus(value: unknown): value is AgentBoardStatus {
  return value === 'todo' || value === 'in_progress' || value === 'review' || value === 'done'
}

function isAgentBoardPriority(value: unknown): value is AgentBoardPriority {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isAgentBoardSessionType(value: unknown): value is AgentBoardItem['sessionType'] {
  return value === 'claude-code'
    || value === 'claude-code-yolo'
    || value === 'claude-code-wsl'
    || value === 'claude-code-yolo-wsl'
    || value === 'codex'
    || value === 'codex-yolo'
    || value === 'codex-wsl'
    || value === 'codex-yolo-wsl'
    || value === 'gemini'
    || value === 'gemini-yolo'
    || value === 'opencode'
    || value === 'terminal'
    || value === 'terminal-wsl'
}

function normalizeAgentBoardItems(raw: unknown): { items: AgentBoardItem[]; seeded: boolean } {
  if (!Array.isArray(raw)) return { items: [], seeded: false }

  let seeded = false
  const seenIds = new Set<string>()
  const items: AgentBoardItem[] = []

  for (const item of raw) {
    if (
      !item
      || typeof item !== 'object'
      || typeof (item as { id?: unknown }).id !== 'string'
      || typeof (item as { title?: unknown }).title !== 'string'
    ) {
      seeded = true
      continue
    }

    const id = (item as { id: string }).id
    if (seenIds.has(id)) {
      seeded = true
      continue
    }

    const title = (item as { title: string }).title.trim()
    if (!title) {
      seeded = true
      continue
    }

    const rawDescription = typeof (item as { description?: unknown }).description === 'string'
      ? (item as { description: string }).description
      : ''
    const description = rawDescription.trim()
    const projectId = typeof (item as { projectId?: unknown }).projectId === 'string'
      ? (item as { projectId: string }).projectId
      : null
    const worktreeId = typeof (item as { worktreeId?: unknown }).worktreeId === 'string'
      ? (item as { worktreeId: string }).worktreeId
      : undefined
    const sessionId = typeof (item as { sessionId?: unknown }).sessionId === 'string'
      ? (item as { sessionId: string }).sessionId
      : undefined
    const now = Date.now()

    if (title !== (item as { title: string }).title) seeded = true
    if (description !== rawDescription) seeded = true
    if (!isAgentBoardStatus((item as { status?: unknown }).status)) seeded = true
    if (!isAgentBoardPriority((item as { priority?: unknown }).priority)) seeded = true
    if (!isAgentBoardSessionType((item as { sessionType?: unknown }).sessionType)) seeded = true

    seenIds.add(id)
    items.push({
      id,
      projectId,
      worktreeId,
      title,
      description,
      status: isAgentBoardStatus((item as { status?: unknown }).status)
        ? (item as { status: AgentBoardStatus }).status
        : 'todo',
      priority: isAgentBoardPriority((item as { priority?: unknown }).priority)
        ? (item as { priority: AgentBoardPriority }).priority
        : 'medium',
      sessionType: isAgentBoardSessionType((item as { sessionType?: unknown }).sessionType)
        ? (item as { sessionType: AgentBoardItem['sessionType'] }).sessionType
        : 'claude-code',
      sessionId,
      createdAt: typeof (item as { createdAt?: unknown }).createdAt === 'number'
        ? (item as { createdAt: number }).createdAt
        : now,
      updatedAt: typeof (item as { updatedAt?: unknown }).updatedAt === 'number'
        ? (item as { updatedAt: number }).updatedAt
        : now,
      launchedAt: typeof (item as { launchedAt?: unknown }).launchedAt === 'number'
        ? (item as { launchedAt: number }).launchedAt
        : undefined,
      completedAt: typeof (item as { completedAt?: unknown }).completedAt === 'number'
        ? (item as { completedAt: number }).completedAt
        : undefined,
      error: typeof (item as { error?: unknown }).error === 'string'
        ? (item as { error: string }).error
        : undefined,
    })
  }

  return { items, seeded }
}

function normalizePromptItems(raw: unknown): { items: PromptItem[]; seeded: boolean } {
  if (!Array.isArray(raw)) return { items: [], seeded: false }

  let seeded = false
  const seenIds = new Set<string>()
  const items: PromptItem[] = []

  for (const item of raw) {
    if (
      !item
      || typeof item !== 'object'
      || typeof (item as { id?: unknown }).id !== 'string'
      || typeof (item as { title?: unknown }).title !== 'string'
      || typeof (item as { content?: unknown }).content !== 'string'
    ) {
      seeded = true
      continue
    }

    const id = (item as { id: string }).id
    if (seenIds.has(id)) {
      seeded = true
      continue
    }

    const title = (item as { title: string }).title.trim()
    const content = (item as { content: string }).content.trim()
    if (!title || !content) {
      seeded = true
      continue
    }

    const rawTags = Array.isArray((item as { tags?: unknown }).tags)
      ? (item as { tags: unknown[] }).tags
      : []
    const tags = Array.from(new Set(rawTags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)))

    if (title !== (item as { title: string }).title || content !== (item as { content: string }).content) seeded = true
    if (tags.length !== rawTags.length) seeded = true

    seenIds.add(id)
    items.push({
      id,
      title,
      content,
      tags,
      createdAt: typeof (item as { createdAt?: unknown }).createdAt === 'number'
        ? (item as { createdAt: number }).createdAt
        : Date.now(),
      updatedAt: typeof (item as { updatedAt?: unknown }).updatedAt === 'number'
        ? (item as { updatedAt: number }).updatedAt
        : Date.now(),
      favorite: (item as { favorite?: unknown }).favorite === true,
    })
  }

  return { items, seeded }
}

function normalizeInstalledPlugins(raw: unknown): { plugins: InstalledPlugin[]; seeded: boolean } {
  if (!Array.isArray(raw)) return { plugins: [], seeded: false }

  let seeded = false
  const seenIds = new Set<string>()
  const plugins: InstalledPlugin[] = []

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

    const id = (item as { id: string }).id.trim()
    const name = (item as { name: string }).name.trim()
    if (!id || !name || seenIds.has(id)) {
      seeded = true
      continue
    }

    const contributions = (item as { contributions?: unknown }).contributions
    const contributionObj = contributions && typeof contributions === 'object'
      ? contributions as Record<string, unknown>
      : {}

    seenIds.add(id)
    plugins.push({
      id,
      name,
      version: typeof (item as { version?: unknown }).version === 'string'
        ? (item as { version: string }).version.trim() || '0.0.0'
        : '0.0.0',
      description: typeof (item as { description?: unknown }).description === 'string'
        ? (item as { description: string }).description.trim() || undefined
        : undefined,
      installedAt: typeof (item as { installedAt?: unknown }).installedAt === 'number'
        ? (item as { installedAt: number }).installedAt
        : Date.now(),
      contributions: {
        customSessions: typeof contributionObj.customSessions === 'number' ? Math.max(0, contributionObj.customSessions) : 0,
        quickCommands: typeof contributionObj.quickCommands === 'number' ? Math.max(0, contributionObj.quickCommands) : 0,
        prompts: typeof contributionObj.prompts === 'number' ? Math.max(0, contributionObj.prompts) : 0,
      },
    })
  }

  return { plugins, seeded }
}

function isDockPanelId(value: unknown): value is DockPanelId {
  return typeof value === 'string' && DOCK_PANEL_IDS.includes(value as DockPanelId)
}

function getDockPanelSide(order: Record<DockSide, DockPanelId[]>, panelId: DockPanelId): DockSide | null {
  if (order.left.includes(panelId)) return 'left'
  if (order.right.includes(panelId)) return 'right'
  return null
}

function getDefaultDockPanelActive(side: DockSide, order: Record<DockSide, DockPanelId[]>): DockPanelId | null {
  const preferred = DEFAULT_DOCK_PANEL_ACTIVE[side]
  if (preferred && order[side].includes(preferred)) return preferred
  return order[side][0] ?? null
}

function ensureDockPanelActiveTabs(
  order: Record<DockSide, DockPanelId[]>,
  active: Record<DockSide, DockPanelId | null>,
): Record<DockSide, DockPanelId | null> {
  return {
    left: active.left && order.left.includes(active.left) ? active.left : getDefaultDockPanelActive('left', order),
    right: active.right && order.right.includes(active.right) ? active.right : getDefaultDockPanelActive('right', order),
  }
}

function clampDockPanelWidth(side: DockSide, width: number): number {
  const min = side === 'left' ? 200 : 240
  return Math.max(min, Math.min(600, width))
}

function clampCanvasSessionCardWidth(width: number): number {
  return Math.round(Math.max(CANVAS_SESSION_CARD_WIDTH_MIN, Math.min(CANVAS_SESSION_CARD_WIDTH_MAX, width)))
}

function clampCanvasSessionCardHeight(height: number): number {
  return Math.round(Math.max(CANVAS_SESSION_CARD_HEIGHT_MIN, Math.min(CANVAS_SESSION_CARD_HEIGHT_MAX, height)))
}

function clampCanvasFocusFontPx(size: number): number {
  return Math.round(Math.max(CANVAS_FOCUS_FONT_PX_MIN, Math.min(CANVAS_FOCUS_FONT_PX_MAX, size)))
}

function normalizeCanvasFocusFontSettings(settings: AppSettings): AppSettings {
  const minPx = clampCanvasFocusFontPx(settings.canvasFocusReadableFontMinPx)
  const maxPx = clampCanvasFocusFontPx(settings.canvasFocusReadableFontMaxPx)
  const rangeMin = Math.min(minPx, maxPx)
  const rangeMax = Math.max(minPx, maxPx)
  const targetPx = Math.max(rangeMin, Math.min(rangeMax, clampCanvasFocusFontPx(settings.canvasFocusTargetFontPx)))
  return {
    ...settings,
    canvasFocusReadableFontMinPx: rangeMin,
    canvasFocusReadableFontMaxPx: rangeMax,
    canvasFocusTargetFontPx: targetPx,
  }
}

function normalizeDockPanelOrder(raw: unknown): {
  order: Record<DockSide, DockPanelId[]>
  seeded: boolean
} {
  const order: Record<DockSide, DockPanelId[]> = { left: [], right: [] }
  const seen = new Set<DockPanelId>()
  let seeded = false

  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null

  for (const side of ['left', 'right'] as const) {
    const value = input?.[side]
    if (value === undefined) continue
    if (!Array.isArray(value)) {
      seeded = true
      continue
    }

    for (const item of value) {
      if (!isDockPanelId(item) || seen.has(item)) {
        seeded = true
        continue
      }
      seen.add(item)
      order[side].push(item)
    }
  }

  for (const side of ['left', 'right'] as const) {
    for (const panelId of DEFAULT_DOCK_PANEL_ORDER[side]) {
      if (seen.has(panelId)) continue
      order[side].push(panelId)
      seen.add(panelId)
      if (input) seeded = true
    }
  }

  return { order, seeded }
}

function normalizeDockPanelActiveTab(
  raw: unknown,
  order: Record<DockSide, DockPanelId[]>,
  legacyRightPanelTab: unknown,
): {
  active: Record<DockSide, DockPanelId | null>
  seeded: boolean
} {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  let seeded = false

  const leftCandidate = input?.left
  const rightCandidate = input?.right ?? legacyRightPanelTab
  const active: Record<DockSide, DockPanelId | null> = {
    left: isDockPanelId(leftCandidate) && order.left.includes(leftCandidate)
      ? leftCandidate
      : getDefaultDockPanelActive('left', order),
    right: isDockPanelId(rightCandidate) && order.right.includes(rightCandidate)
      ? rightCandidate
      : getDefaultDockPanelActive('right', order),
  }

  if (leftCandidate !== undefined && leftCandidate !== active.left) seeded = true
  if (rightCandidate !== undefined && rightCandidate !== active.right) seeded = true

  return { active, seeded }
}

function normalizeDockPanelCollapsed(
  raw: unknown,
  legacySidebarCollapsed: unknown,
  legacyRightPanelCollapsed: unknown,
): {
  collapsed: Record<DockSide, boolean>
  seeded: boolean
} {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  let seeded = false

  const leftValue = input?.left ?? legacySidebarCollapsed
  const rightValue = input?.right ?? legacyRightPanelCollapsed

  const collapsed: Record<DockSide, boolean> = {
    left: typeof leftValue === 'boolean' ? leftValue : DEFAULT_DOCK_PANEL_COLLAPSED.left,
    right: typeof rightValue === 'boolean' ? rightValue : DEFAULT_DOCK_PANEL_COLLAPSED.right,
  }

  if (leftValue !== undefined && typeof leftValue !== 'boolean') seeded = true
  if (rightValue !== undefined && typeof rightValue !== 'boolean') seeded = true

  return { collapsed, seeded }
}

function normalizeDockPanelWidth(
  raw: unknown,
  legacySidebarWidth: unknown,
  legacyRightPanelWidth: unknown,
): {
  width: Record<DockSide, number>
  seeded: boolean
} {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  let seeded = false

  const leftValue = input?.left ?? legacySidebarWidth
  const rightValue = input?.right ?? legacyRightPanelWidth

  const width: Record<DockSide, number> = {
    left: typeof leftValue === 'number'
      ? clampDockPanelWidth('left', leftValue)
      : DEFAULT_DOCK_PANEL_WIDTH.left,
    right: typeof rightValue === 'number'
      ? clampDockPanelWidth('right', rightValue)
      : DEFAULT_DOCK_PANEL_WIDTH.right,
  }

  if (typeof leftValue === 'number' && width.left !== leftValue) seeded = true
  if (typeof rightValue === 'number' && width.right !== rightValue) seeded = true
  if (leftValue !== undefined && typeof leftValue !== 'number') seeded = true
  if (rightValue !== undefined && typeof rightValue !== 'number') seeded = true

  return { width, seeded }
}

function persistNextUI(state: UIPersistedState, overrides: Partial<UIPersistedState>): void {
  persistUI({
    settings: overrides.settings ?? state.settings,
    dockPanelOrder: overrides.dockPanelOrder ?? state.dockPanelOrder,
    dockPanelActiveTab: overrides.dockPanelActiveTab ?? state.dockPanelActiveTab,
    dockPanelCollapsed: overrides.dockPanelCollapsed ?? state.dockPanelCollapsed,
    dockPanelWidth: overrides.dockPanelWidth ?? state.dockPanelWidth,
  })
}

function getDefaultDockPanelsState(): Pick<
  UIState,
  'dockPanelOrder' | 'dockPanelActiveTab' | 'dockPanelCollapsed' | 'dockPanelWidth'
> {
  return {
    dockPanelOrder: {
      left: [...DEFAULT_DOCK_PANEL_ORDER.left],
      right: [...DEFAULT_DOCK_PANEL_ORDER.right],
    },
    dockPanelActiveTab: { ...DEFAULT_DOCK_PANEL_ACTIVE },
    dockPanelCollapsed: { ...DEFAULT_DOCK_PANEL_COLLAPSED },
    dockPanelWidth: { ...DEFAULT_DOCK_PANEL_WIDTH },
  }
}

function moveDockPanelLayout(
  order: Record<DockSide, DockPanelId[]>,
  active: Record<DockSide, DockPanelId | null>,
  panelId: DockPanelId,
  toSide: DockSide,
  targetPanelId?: DockPanelId,
  position: 'before' | 'after' = 'before',
): {
  order: Record<DockSide, DockPanelId[]>
  active: Record<DockSide, DockPanelId | null>
  fromSide: DockSide | null
} {
  const fromSide = getDockPanelSide(order, panelId)
  if (!fromSide) {
    return { order, active, fromSide: null }
  }

  if (fromSide === toSide && targetPanelId === panelId) {
    return { order, active, fromSide }
  }

  const nextOrder: Record<DockSide, DockPanelId[]> = {
    left: [...order.left],
    right: [...order.right],
  }

  nextOrder[fromSide] = nextOrder[fromSide].filter((id) => id !== panelId)

  const nextTargetOrder = [...nextOrder[toSide]]
  let insertIndex = nextTargetOrder.length
  if (targetPanelId && nextTargetOrder.includes(targetPanelId)) {
    const targetIndex = nextTargetOrder.indexOf(targetPanelId)
    insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
  }

  nextTargetOrder.splice(insertIndex, 0, panelId)
  nextOrder[toSide] = nextTargetOrder

  const nextActive = ensureDockPanelActiveTabs(nextOrder, {
    ...active,
    [toSide]: panelId,
    [fromSide]: active[fromSide] === panelId ? null : active[fromSide],
  })

  return { order: nextOrder, active: nextActive, fromSide }
}

export const useUIStore = create<UIState>((set, get) => ({
  windowFullscreen: false,
  setWindowFullscreen: (fullscreen) => set({ windowFullscreen: fullscreen }),
  projectDetailOpenProjectId: null,
  setProjectDetailOpenProjectId: (projectId) => set({ projectDetailOpenProjectId: projectId }),

  ...getDefaultDockPanelsState(),

  setDockPanelWidth: (side, width, persist = true) =>
    set((state) => {
      const nextWidth = clampDockPanelWidth(side, width)
      if (state.dockPanelWidth[side] === nextWidth) return state

      const dockPanelWidth = {
        ...state.dockPanelWidth,
        [side]: nextWidth,
      }
      if (persist) {
        persistNextUI(state, { dockPanelWidth })
      }
      return { dockPanelWidth }
    }),

  toggleDockPanel: (side) =>
    set((state) => {
      const dockPanelCollapsed = {
        ...state.dockPanelCollapsed,
        [side]: !state.dockPanelCollapsed[side],
      }
      persistNextUI(state, { dockPanelCollapsed })
      return { dockPanelCollapsed }
    }),

  setDockPanelTab: (side, tab) => {
    // Left-side tab toggles the workspace mode: 'recentSessions' swaps to the
    // free-form sessions layout, 'projects' swaps back to the per-project layout.
    if (side === 'left') {
      if (tab === 'recentSessions') {
        usePanesStore.getState().setWorkspaceMode('sessions')
      } else if (tab === 'projects') {
        const paneStore = usePanesStore.getState()
        // Restore in one panes update when coming from sessions mode, avoiding
        // the intermediate empty project layout that remounts terminals.
        const restored = paneStore.workspaceMode === 'sessions' && restoreSelectedProjectPaneLayout()
        if (!restored) {
          paneStore.setWorkspaceMode('project')
        }
      }
    }

    set((state) => {
      const currentSide = getDockPanelSide(state.dockPanelOrder, tab)
      const dockPanelCollapsed = {
        ...state.dockPanelCollapsed,
        [side]: false,
      }

      if (currentSide === side) {
        const dockPanelActiveTab = ensureDockPanelActiveTabs(state.dockPanelOrder, {
          ...state.dockPanelActiveTab,
          [side]: tab,
        })
        persistNextUI(state, { dockPanelActiveTab, dockPanelCollapsed })
        return { dockPanelActiveTab, dockPanelCollapsed }
      }

      const moved = moveDockPanelLayout(state.dockPanelOrder, state.dockPanelActiveTab, tab, side)
      persistNextUI(state, {
        dockPanelOrder: moved.order,
        dockPanelActiveTab: moved.active,
        dockPanelCollapsed,
      })
      return {
        dockPanelOrder: moved.order,
        dockPanelActiveTab: moved.active,
        dockPanelCollapsed,
      }
    })
  },

  activateDockPanel: (tab) =>
    set((state) => {
      const side = getDockPanelSide(state.dockPanelOrder, tab)
      if (!side) return {}

      const dockPanelActiveTab = ensureDockPanelActiveTabs(state.dockPanelOrder, {
        ...state.dockPanelActiveTab,
        [side]: tab,
      })
      const dockPanelCollapsed = {
        ...state.dockPanelCollapsed,
        [side]: false,
      }
      persistNextUI(state, { dockPanelActiveTab, dockPanelCollapsed })
      return { dockPanelActiveTab, dockPanelCollapsed }
    }),

  moveDockPanel: (panelId, toSide, targetPanelId, position = 'before') =>
    set((state) => {
      const moved = moveDockPanelLayout(
        state.dockPanelOrder,
        state.dockPanelActiveTab,
        panelId,
        toSide,
        targetPanelId,
        position,
      )

      const dockPanelCollapsed = {
        ...state.dockPanelCollapsed,
        [toSide]: false,
      }

      persistNextUI(state, {
        dockPanelOrder: moved.order,
        dockPanelActiveTab: moved.active,
        dockPanelCollapsed,
      })

      return {
        dockPanelOrder: moved.order,
        dockPanelActiveTab: moved.active,
        dockPanelCollapsed,
      }
    }),

  resetDockPanels: () =>
    set((state) => {
      const dockPanels = getDefaultDockPanelsState()
      persistNextUI(state, dockPanels)
      return dockPanels
    }),

  settingsOpen: false,
  settingsPage: 'general',
  openSettings: (page) => {
    const resolved = page ?? get().settings.lastSettingsPage ?? 'general'
    set({ settingsOpen: true, settingsPage: resolved })
    if (!page) return
    // Explicit page request — remember it for next time
    const settings = { ...get().settings, lastSettingsPage: resolved }
    set({ settings })
    persistUI({
      settings,
      dockPanelOrder: get().dockPanelOrder,
      dockPanelActiveTab: get().dockPanelActiveTab,
      dockPanelCollapsed: get().dockPanelCollapsed,
      dockPanelWidth: get().dockPanelWidth,
    })
  },
  setSettingsPage: (page) => {
    set({ settingsPage: page })
    const current = get().settings
    if (current.lastSettingsPage === page) return
    const settings = { ...current, lastSettingsPage: page }
    set({ settings })
    persistUI({
      settings,
      dockPanelOrder: get().dockPanelOrder,
      dockPanelActiveTab: get().dockPanelActiveTab,
      dockPanelCollapsed: get().dockPanelCollapsed,
      dockPanelWidth: get().dockPanelWidth,
    })
  },
  closeSettings: () => set({ settingsOpen: false }),

  settings: { ...DEFAULT_SETTINGS },

  _loadSettings: (raw, customThemesOverride) => {
    let s = { ...DEFAULT_SETTINGS }
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
      if (raw.visibleProjectId === null || typeof raw.visibleProjectId === 'string') s.visibleProjectId = raw.visibleProjectId as string | null
      if (typeof raw.defaultSessionType === 'string' && ['browser', 'claude-code', 'claude-code-yolo', 'claude-code-wsl', 'claude-code-yolo-wsl', 'terminal', 'terminal-wsl', 'codex', 'codex-yolo', 'codex-wsl', 'codex-yolo-wsl', 'gemini', 'gemini-yolo', 'opencode'].includes(raw.defaultSessionType)) s.defaultSessionType = raw.defaultSessionType as AppSettings['defaultSessionType']
      if (raw.customSessionDefinitions !== undefined) {
        const normalizedCustomSessions = normalizeCustomSessionDefinitions(raw.customSessionDefinitions)
        s.customSessionDefinitions = normalizedCustomSessions.definitions
        shouldPersistSettings ||= normalizedCustomSessions.seeded
      }
      if (raw.installedPlugins !== undefined) {
        const normalizedInstalledPlugins = normalizeInstalledPlugins(raw.installedPlugins)
        s.installedPlugins = normalizedInstalledPlugins.plugins
        shouldPersistSettings ||= normalizedInstalledPlugins.seeded
      }
      if (raw.hiddenNewSessionOptionIds !== undefined) {
        s.hiddenNewSessionOptionIds = normalizeHiddenNewSessionOptionIds(raw.hiddenNewSessionOptionIds)
      }
      const newSessionMenuPresetVersion = typeof raw.newSessionMenuPresetVersion === 'number' && Number.isFinite(raw.newSessionMenuPresetVersion)
        ? Math.max(0, Math.round(raw.newSessionMenuPresetVersion))
        : 0
      s.newSessionMenuPresetVersion = newSessionMenuPresetVersion
      if (newSessionMenuPresetVersion < NEW_SESSION_MENU_PRESET_VERSION) {
        const oldDefaultVisibility = raw.hiddenNewSessionOptionIds === undefined
          || (Array.isArray(raw.hiddenNewSessionOptionIds) && normalizeHiddenNewSessionOptionIds(raw.hiddenNewSessionOptionIds).length === 0)
        if (oldDefaultVisibility) {
          s.hiddenNewSessionOptionIds = [...DEFAULT_HIDDEN_NEW_SESSION_OPTION_IDS]
        }
        s.newSessionMenuPresetVersion = NEW_SESSION_MENU_PRESET_VERSION
        shouldPersistSettings = true
      }
      if (raw.newSessionOptionOrder !== undefined) {
        s.newSessionOptionOrder = normalizeHiddenNewSessionOptionIds(raw.newSessionOptionOrder)
      }
      if (raw.defaultCustomSessionId === null || typeof raw.defaultCustomSessionId === 'string') {
        s.defaultCustomSessionId = raw.defaultCustomSessionId
      }
      if (s.defaultCustomSessionId && !s.customSessionDefinitions.some((definition) => definition.id === s.defaultCustomSessionId)) {
        s.defaultCustomSessionId = null
        shouldPersistSettings = true
      }
      if (typeof raw.promptSessionNameOnCreate === 'boolean') s.promptSessionNameOnCreate = raw.promptSessionNameOnCreate
      s.terminalShellMode = normalizeTerminalShellMode(raw.terminalShellMode)
      if (typeof raw.terminalShellCommand === 'string') s.terminalShellCommand = raw.terminalShellCommand.trim()
      if (typeof raw.terminalShellArgs === 'string') s.terminalShellArgs = raw.terminalShellArgs
      s.voiceInputMode = normalizeVoiceInputMode(raw.voiceInputMode)
      if (typeof raw.voiceApiUrl === 'string') {
        const voiceApiUrl = raw.voiceApiUrl.trim()
        if (voiceApiUrl === LEGACY_DEFAULT_VOICE_API_ENDPOINT) {
          s.voiceApiUrl = DEFAULT_SETTINGS.voiceApiUrl
          shouldPersistSettings = true
        } else {
          s.voiceApiUrl = voiceApiUrl
        }
      }
      s.voiceApiBodyMode = normalizeVoiceApiBodyMode(raw.voiceApiBodyMode)
      if (typeof raw.voiceApiFileFieldName === 'string') s.voiceApiFileFieldName = raw.voiceApiFileFieldName.trim() || DEFAULT_SETTINGS.voiceApiFileFieldName
      if (typeof raw.voiceApiResponseTextPath === 'string') s.voiceApiResponseTextPath = raw.voiceApiResponseTextPath.trim() || DEFAULT_SETTINGS.voiceApiResponseTextPath
      s.voiceApiTimeoutMs = normalizeVoiceApiTimeoutMs(raw.voiceApiTimeoutMs)
      if (typeof raw.voiceApiAuthorization === 'string') s.voiceApiAuthorization = raw.voiceApiAuthorization.trim()
      if (typeof raw.wslDistroName === 'string') s.wslDistroName = raw.wslDistroName.trim()
      if (typeof raw.wslShell === 'string') s.wslShell = raw.wslShell.trim() || DEFAULT_SETTINGS.wslShell
      if (typeof raw.wslUseLoginShell === 'boolean') s.wslUseLoginShell = raw.wslUseLoginShell
      if (typeof raw.wslPathPrefix === 'string') s.wslPathPrefix = raw.wslPathPrefix.trim()
      if (typeof raw.wslInitScript === 'string') s.wslInitScript = raw.wslInitScript
      if (typeof raw.wslEnvVars === 'string') s.wslEnvVars = raw.wslEnvVars
      if (Array.isArray(raw.recentPaths)) s.recentPaths = raw.recentPaths.filter((p) => typeof p === 'string').slice(0, 10) as string[]
      if (raw.visualizerMode === 'melody' || raw.visualizerMode === 'bars') s.visualizerMode = raw.visualizerMode
      if (typeof raw.showMusicPlayer === 'boolean') s.showMusicPlayer = raw.showMusicPlayer
      if (typeof raw.showTitleBarSearch === 'boolean') s.showTitleBarSearch = raw.showTitleBarSearch
      if (typeof raw.showActivePaneBorder === 'boolean') s.showActivePaneBorder = raw.showActivePaneBorder
      if (raw.titleBarMenuVisibility === 'always' || raw.titleBarMenuVisibility === 'hover') {
        s.titleBarMenuVisibility = raw.titleBarMenuVisibility
      }
      if (raw.titleBarSearchScope === 'project' || raw.titleBarSearchScope === 'all-projects') {
        s.titleBarSearchScope = raw.titleBarSearchScope
      }
      if (raw.startupWindowState === 'maximized' || raw.startupWindowState === 'normal') {
        s.startupWindowState = raw.startupWindowState
      }
      if (raw.gitChangesViewMode === 'flat' || raw.gitChangesViewMode === 'tree') {
        s.gitChangesViewMode = raw.gitChangesViewMode
      }
      {
        const normalizedGitReviewMode = normalizeGitReviewMode(raw.gitReviewMode)
        if (normalizedGitReviewMode) s.gitReviewMode = normalizedGitReviewMode
      }
      if (raw.gitReviewFixMode === 'claude-gui' || raw.gitReviewFixMode === 'claude-code-cli') {
        s.gitReviewFixMode = raw.gitReviewFixMode
      }
      if (typeof raw.lastSettingsPage === 'string' && raw.lastSettingsPage) {
        s.lastSettingsPage = raw.lastSettingsPage
      }
      if (typeof raw.visualizerWidth === 'number') s.visualizerWidth = Math.max(80, Math.min(7680, raw.visualizerWidth))
      if (typeof raw.showPlayerControls === 'boolean') s.showPlayerControls = raw.showPlayerControls
      if (typeof raw.showTrackInfo === 'boolean') s.showTrackInfo = raw.showTrackInfo
      if (typeof raw.popoutWidth === 'number') s.popoutWidth = Math.max(400, Math.min(1920, raw.popoutWidth))
      if (typeof raw.popoutHeight === 'number') s.popoutHeight = Math.max(300, Math.min(1080, raw.popoutHeight))
      if (raw.popoutPosition === 'cursor' || raw.popoutPosition === 'center') s.popoutPosition = raw.popoutPosition
      if (typeof raw.notificationToastEnabled === 'boolean') s.notificationToastEnabled = raw.notificationToastEnabled
      if (typeof raw.notificationSoundEnabled === 'boolean') s.notificationSoundEnabled = raw.notificationSoundEnabled
      if (typeof raw.notificationSoundVolume === 'number') {
        s.notificationSoundVolume = Math.max(0, Math.min(1, raw.notificationSoundVolume))
      }
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
      if (raw.todoItems !== undefined) {
        const normalizedTodoItems = normalizeTodoItems(raw.todoItems)
        s.todoItems = normalizedTodoItems.items
        shouldPersistSettings ||= normalizedTodoItems.seeded
      }
      if (raw.agentBoardItems !== undefined) {
        const normalizedAgentBoardItems = normalizeAgentBoardItems(raw.agentBoardItems)
        s.agentBoardItems = normalizedAgentBoardItems.items
        shouldPersistSettings ||= normalizedAgentBoardItems.seeded
      }
      if (raw.promptItems !== undefined) {
        const normalizedPromptItems = normalizePromptItems(raw.promptItems)
        s.promptItems = normalizedPromptItems.items
        shouldPersistSettings ||= normalizedPromptItems.seeded
      }
      const normalizedDockPanelOrder = normalizeDockPanelOrder(raw.dockPanelOrder)
      const normalizedDockPanelActiveTab = normalizeDockPanelActiveTab(
        raw.dockPanelActiveTab,
        normalizedDockPanelOrder.order,
        raw.rightPanelTab,
      )
      const normalizedDockPanelCollapsed = normalizeDockPanelCollapsed(
        raw.dockPanelCollapsed,
        raw.sidebarCollapsed,
        raw.rightPanelCollapsed,
      )
      const normalizedDockPanelWidth = normalizeDockPanelWidth(
        raw.dockPanelWidth,
        raw.sidebarWidth,
        raw.rightPanelWidth,
      )
      shouldPersistSettings ||= normalizedDockPanelOrder.seeded
      shouldPersistSettings ||= normalizedDockPanelActiveTab.seeded
      shouldPersistSettings ||= normalizedDockPanelCollapsed.seeded
      shouldPersistSettings ||= normalizedDockPanelWidth.seeded
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
      if (raw.sessionHistorySourceFilter === 'all' || raw.sessionHistorySourceFilter === 'claude-code' || raw.sessionHistorySourceFilter === 'codex') {
        s.sessionHistorySourceFilter = raw.sessionHistorySourceFilter
      }
      if (typeof raw.sessionHistoryOnlyCurrentProject === 'boolean') {
        s.sessionHistoryOnlyCurrentProject = raw.sessionHistoryOnlyCurrentProject
      }
      if (raw.workspaceLayout === 'panes' || raw.workspaceLayout === 'canvas') {
        s.workspaceLayout = raw.workspaceLayout
      }
      if (raw.appChromeStyle === 'floating' || raw.appChromeStyle === 'joined') {
        s.appChromeStyle = raw.appChromeStyle
      }
      if (raw.paneUiMode === 'separated' || raw.paneUiMode === 'classic') {
        s.paneUiMode = raw.paneUiMode
      }
      if (raw.tabUiMode === 'rounded' || raw.tabUiMode === 'square') {
        s.tabUiMode = raw.tabUiMode
      }
      if (raw.paneDensityMode === 'comfortable' || raw.paneDensityMode === 'compact') {
        s.paneDensityMode = raw.paneDensityMode
      }
      if (typeof raw.canvasGridEnabled === 'boolean') s.canvasGridEnabled = raw.canvasGridEnabled
      if (typeof raw.canvasSnapEnabled === 'boolean') s.canvasSnapEnabled = raw.canvasSnapEnabled
      if (raw.canvasOverlapMode === 'free' || raw.canvasOverlapMode === 'avoid') s.canvasOverlapMode = raw.canvasOverlapMode
      if (raw.canvasArrangeMode === 'free' || raw.canvasArrangeMode === 'grid' || raw.canvasArrangeMode === 'rowFlow' || raw.canvasArrangeMode === 'colFlow') {
        s.canvasArrangeMode = raw.canvasArrangeMode
      }
      if (typeof raw.canvasShowMinimap === 'boolean') s.canvasShowMinimap = raw.canvasShowMinimap
      if (typeof raw.canvasLayoutLocked === 'boolean') s.canvasLayoutLocked = raw.canvasLayoutLocked
      if (typeof raw.canvasSessionCardWidth === 'number') s.canvasSessionCardWidth = clampCanvasSessionCardWidth(raw.canvasSessionCardWidth)
      if (typeof raw.canvasSessionCardHeight === 'number') s.canvasSessionCardHeight = clampCanvasSessionCardHeight(raw.canvasSessionCardHeight)
      if (typeof raw.canvasFocusReadableFontMinPx === 'number') s.canvasFocusReadableFontMinPx = raw.canvasFocusReadableFontMinPx
      if (typeof raw.canvasFocusReadableFontMaxPx === 'number') s.canvasFocusReadableFontMaxPx = raw.canvasFocusReadableFontMaxPx
      if (typeof raw.canvasFocusTargetFontPx === 'number') s.canvasFocusTargetFontPx = raw.canvasFocusTargetFontPx
      s = normalizeCanvasFocusFontSettings(s)
      if (typeof raw.terminalTheme === 'string') s.terminalTheme = raw.terminalTheme
      // Prefer the dedicated top-level customThemes key (more robust against ui-settings resets)
      const themesSource = (customThemesOverride && Object.keys(customThemesOverride).length > 0)
        ? customThemesOverride
        : raw.customThemes
      if (themesSource && typeof themesSource === 'object' && !Array.isArray(themesSource)) {
        s.customThemes = themesSource as Record<string, GhosttyTheme>
      }
      set({
        dockPanelOrder: normalizedDockPanelOrder.order,
        dockPanelActiveTab: normalizedDockPanelActiveTab.active,
        dockPanelCollapsed: normalizedDockPanelCollapsed.collapsed,
        dockPanelWidth: normalizedDockPanelWidth.width,
      })
    } else {
      set(getDefaultDockPanelsState())
    }
    set({ settings: s })
    applyUIFont(s)
    applyAppChromeStyle(s)
    registerCustomThemes(s.customThemes)
    applyTerminalThemeToApp(s.terminalTheme)
    if (shouldPersistSettings) {
      persistUI({
        settings: s,
        dockPanelOrder: get().dockPanelOrder,
        dockPanelActiveTab: get().dockPanelActiveTab,
        dockPanelCollapsed: get().dockPanelCollapsed,
        dockPanelWidth: get().dockPanelWidth,
      })
    }
  },

  updateSettings: (updates) => {
    const settings = normalizeCanvasFocusFontSettings({ ...get().settings, ...updates })
    settings.terminalShellMode = normalizeTerminalShellMode(settings.terminalShellMode)
    settings.terminalShellCommand = settings.terminalShellCommand.trim()
    settings.voiceInputMode = normalizeVoiceInputMode(settings.voiceInputMode)
    settings.voiceApiUrl = settings.voiceApiUrl.trim()
    settings.voiceApiBodyMode = normalizeVoiceApiBodyMode(settings.voiceApiBodyMode)
    settings.voiceApiFileFieldName = settings.voiceApiFileFieldName.trim() || DEFAULT_SETTINGS.voiceApiFileFieldName
    settings.voiceApiResponseTextPath = settings.voiceApiResponseTextPath.trim() || DEFAULT_SETTINGS.voiceApiResponseTextPath
    settings.voiceApiTimeoutMs = normalizeVoiceApiTimeoutMs(settings.voiceApiTimeoutMs)
    settings.voiceApiAuthorization = settings.voiceApiAuthorization.trim()
    settings.hiddenNewSessionOptionIds = normalizeHiddenNewSessionOptionIds(settings.hiddenNewSessionOptionIds)
    settings.newSessionMenuPresetVersion = Math.max(NEW_SESSION_MENU_PRESET_VERSION, Math.round(settings.newSessionMenuPresetVersion || 0))
    settings.newSessionOptionOrder = normalizeHiddenNewSessionOptionIds(settings.newSessionOptionOrder)
    if (
      settings.defaultCustomSessionId
      && !settings.customSessionDefinitions.some((definition) => definition.id === settings.defaultCustomSessionId)
    ) {
      settings.defaultCustomSessionId = null
    }
    set({ settings })
    persistUI({
      settings,
      dockPanelOrder: get().dockPanelOrder,
      dockPanelActiveTab: get().dockPanelActiveTab,
      dockPanelCollapsed: get().dockPanelCollapsed,
      dockPanelWidth: get().dockPanelWidth,
    })
    applyUIFont(settings)
    applyAppChromeStyle(settings)
    if (updates.customThemes !== undefined) {
      registerCustomThemes(updates.customThemes)
    }
    if (updates.terminalTheme !== undefined) {
      if (updates.terminalTheme) {
        applyTerminalThemeToApp(updates.terminalTheme)
      } else {
        clearTerminalThemeFromApp()
      }
    }
  },

  addRecentPath: (path) => {
    const settings = get().settings
    const paths = [path, ...settings.recentPaths.filter((p) => p !== path)].slice(0, 10)
    const updated = { ...settings, recentPaths: paths }
    set({ settings: updated })
    persistUI({
      settings: updated,
      dockPanelOrder: get().dockPanelOrder,
      dockPanelActiveTab: get().dockPanelActiveTab,
      dockPanelCollapsed: get().dockPanelCollapsed,
      dockPanelWidth: get().dockPanelWidth,
    })
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

  sessionNamePrompt: null,
  setSessionNamePrompt: (prompt) => set({ sessionNamePrompt: prompt }),
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

function applyAppChromeStyle(settings: AppSettings): void {
  const root = document.documentElement
  root.classList.toggle('app-chrome-joined', settings.appChromeStyle === 'joined')
  root.classList.toggle('app-chrome-floating', settings.appChromeStyle === 'floating')
}
