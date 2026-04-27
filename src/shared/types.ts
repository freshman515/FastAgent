// ─── Data Models ───

export interface Group {
  id: string
  name: string
  color: string
  collapsed: boolean
  projectIds: string[]
}

export interface SessionGroup {
  id: string
  name: string
  color: string
  collapsed: boolean
  sessionIds: string[]
}

export interface Project {
  id: string
  name: string
  path: string
  groupId: string
}

export const UNGROUPED_PROJECT_GROUP_ID = '__ungrouped__'
export const ANONYMOUS_PROJECT_ID = '__anonymous_project__'
export const ANONYMOUS_PROJECT_NAME = 'Anonymous'
export const ANONYMOUS_PROJECT_DIR_NAME = 'anonymous-workspace'

export function isAnonymousProjectId(projectId: string): boolean {
  return projectId === ANONYMOUS_PROJECT_ID
}

export type SessionType = 'browser' | 'claude-code' | 'claude-code-yolo' | 'claude-code-wsl' | 'claude-code-yolo-wsl' | 'claude-gui' | 'codex' | 'codex-yolo' | 'codex-wsl' | 'codex-yolo-wsl' | 'gemini' | 'gemini-yolo' | 'opencode' | 'terminal' | 'terminal-wsl'
export type AgentSessionType = Exclude<SessionType, 'browser' | 'claude-gui' | 'terminal' | 'terminal-wsl'>
export type McpCreatableSessionType = Exclude<SessionType, 'browser' | 'claude-gui'>
export const DEFAULT_BROWSER_URL = 'https://www.google.com/'

/** Returns true for any Claude Code variant (normal or yolo mode) */
export function isClaudeCodeType(type: SessionType): boolean {
  return type === 'claude-code' || type === 'claude-code-yolo' || type === 'claude-code-wsl' || type === 'claude-code-yolo-wsl'
}

export function isCodexType(type: SessionType): boolean {
  return type === 'codex' || type === 'codex-yolo' || type === 'codex-wsl' || type === 'codex-yolo-wsl'
}

export function isWslSessionType(type: SessionType): boolean {
  return type === 'terminal-wsl' || type === 'claude-code-wsl' || type === 'claude-code-yolo-wsl' || type === 'codex-wsl' || type === 'codex-yolo-wsl'
}

export function isTerminalSessionType(type: SessionType): boolean {
  return type === 'terminal' || type === 'terminal-wsl'
}

export function isGeminiType(type: SessionType): boolean {
  return type === 'gemini' || type === 'gemini-yolo'
}

export type SessionStatus = 'running' | 'idle' | 'waiting-input' | 'stopped'
export type OutputState = 'idle' | 'outputting' | 'unread'
/**
 * Agent activity derived from hook events:
 * - running: tool is executing
 * - thinking: model is reasoning (between prompt submit and first tool, or between tools)
 * - completed: Stop hook just fired (high-visibility window, decays to idle)
 * - idle: no activity / waiting for user input
 */
export type SessionActivity = 'running' | 'thinking' | 'idle' | 'completed'

export interface Session {
  id: string
  projectId: string
  type: SessionType
  name: string
  status: SessionStatus
  ptyId: string | null
  initialized: boolean // true after first PTY launch, used for agent resume
  resumeUUID: string | null // session id / UUID captured from agent exit output
  pinned: boolean
  createdAt: number
  updatedAt: number
  worktreeId?: string   // bound to specific worktree; undefined = main worktree
  color?: string        // color tag for visual grouping (hex)
  label?: string        // short label (e.g. "前端", "API")
  cwd?: string          // resolved working directory override (set by MCP bridge / history resume)
  /** Codex rollout id to resume on next spawn. */
  codexResumeId?: string
  /** Gemini session UUID to resume on next spawn. */
  geminiResumeId?: string
  /** Last URL loaded by the built-in browser tab. */
  browserUrl?: string
  /** Custom launcher definition copied from settings at creation time. */
  customSessionDefinitionId?: string
  customSessionLabel?: string
  customSessionIcon?: string
  customSessionCommand?: string
  customSessionArgs?: string[]
}

// ─── Canvas Mode ───
//
// Parallel layout engine to the BSP panes tree. When `AppSettings.workspaceLayout`
// is 'canvas', MainPanel renders `CanvasWorkspace` instead of `SplitContainer`.
// State is stored per "layout key" — same key shape as pane `projectLayouts`
// (projectId / worktreeId / SESSIONS_LAYOUT_KEY), so switching scope restores
// the right canvas. Canvas and panes states coexist — switching workspaceLayout
// does NOT destroy the other side's layout.

export type WorkspaceLayout = 'panes' | 'canvas'

export type CanvasCardKind = 'session' | 'terminal' | 'note' | 'frame'

export interface CanvasCard {
  id: string
  kind: CanvasCardKind
  /** Session id for kind='session'|'terminal'; null for note cards. */
  refId: string | null
  x: number
  y: number
  width: number
  height: number
  expandedWidth?: number
  expandedHeight?: number
  zIndex: number
  collapsed: boolean
  collapsedPreview?: string[]
  /** Hidden from the canvas surface but still available in the canvas session list. */
  hidden?: boolean
  /** Hidden because a parent frame/group is folded. */
  hiddenByFrameId?: string
  /** Marked important in canvas surfaces and lists. */
  favorite?: boolean
  /** Per-card geometry/content snapshots. */
  cardSnapshots?: CanvasCardSnapshot[]
  /** Per-frame workspace snapshots. */
  frameSnapshots?: CanvasFrameSnapshot[]
  /** Optional per-canvas label shown after the session name. */
  sessionRemark?: string
  /** Note-card body (plain text). */
  noteBody?: string
  /** Note-card accent color token (e.g. 'yellow' | 'blue' | 'green' | 'pink'). */
  noteColor?: string
  /** Frame-card title. */
  frameTitle?: string
  /** Frame-card accent color token. */
  frameColor?: string
  /** Stable group membership for frame cards. */
  frameMemberIds?: string[]
  createdAt: number
  updatedAt: number
}

export interface CanvasViewport {
  scale: number
  offsetX: number
  offsetY: number
}

export interface CanvasBookmark {
  id: string
  name: string
  viewport: CanvasViewport
  /** Optional target card/frame. When present, bookmark navigation focuses this card. */
  cardId?: string
  createdAt: number
  updatedAt: number
}

export interface CanvasRelation {
  id: string
  fromCardId: string
  toCardId: string
  createdAt: number
  updatedAt: number
}

export interface CanvasFrameSnapshot {
  id: string
  name: string
  frame: CanvasCard
  cards: CanvasCard[]
  relations: CanvasRelation[]
  createdAt: number
  updatedAt: number
}

export interface CanvasCardSnapshot {
  id: string
  name: string
  card: CanvasCard
  createdAt: number
  updatedAt: number
}

export interface CanvasLayoutSnapshot {
  id: string
  name: string
  cards: CanvasCard[]
  viewport: CanvasViewport
  relations: CanvasRelation[]
  createdAt: number
  updatedAt: number
}

export interface CanvasLayout {
  cards: CanvasCard[]
  viewport: CanvasViewport
  bookmarks: CanvasBookmark[]
  recentCardIds: string[]
  relations: CanvasRelation[]
  snapshots: CanvasLayoutSnapshot[]
}

export interface CanvasPersistedState {
  schemaVersion: number
  layouts: Record<string, CanvasLayout>
}

export const CANVAS_SCHEMA_VERSION = 2
export const CANVAS_MIN_SCALE = 0.1
export const CANVAS_MAX_SCALE = 8

// ─── IPC Types ───

export interface SessionCreateOptions {
  cwd: string
  type: SessionType
  sessionId?: string   // unique session id for agent resume
  resume?: boolean     // true = resume previous session
  resumeUUID?: string  // session id / UUID from agent resume output
  /** Codex rollout UUID to resume — when set, launches `codex resume <id>` instead of plain `codex`. */
  codexResumeId?: string
  /** Gemini session UUID to resume — when set, launches `gemini --resume <id>` instead of plain `gemini`. */
  geminiResumeId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  wslDistroName?: string
  wslShell?: string
  wslUseLoginShell?: boolean
  wslPathPrefix?: string
  wslInitScript?: string
  wslEnvVars?: string
  cols?: number
  rows?: number
}

export interface SessionCreateResult {
  ptyId: string
  resumeUUID?: string | null
}

export interface SessionDataEvent {
  ptyId: string
  data: string
  seq: number
}

export interface SessionExitEvent {
  ptyId: string
  exitCode: number
  resumeUUID?: string | null
}

export interface SessionReplayPayload {
  data: string
  seq: number
}

export interface SessionSubmitOptions {
  input: string
  submit?: boolean
}

// ─── Meta-Agent (FastAgents MCP) ───
// The orchestrator HTTP server in main bridges to the renderer's stores for
// actions that require renderer state (creating sessions, listing sessions
// with their full metadata). Everything else (read / write / wait_for_idle)
// is served directly by main using PtyManager.

export interface McpSessionInfo {
  /** Renderer session id (same value shown in UI tabs). */
  id: string
  name: string
  type: SessionType
  status: SessionStatus
  cwd: string | null
  projectId: string | null
  worktreeId: string | null
  paneId: string | null
  /** True when this session is the agent that owns the MCP bridge — never act on self. */
  isSelf: boolean
  /** True when the PTY backing this session is alive. */
  hasPty: boolean
}

export interface McpCreateSessionRequest {
  requestId: string
  sourceSessionId: string | null
  type: McpCreatableSessionType
  /** Absolute working directory. Empty string = inherit from source session / project. */
  cwd: string
  projectId?: string | null
  worktreeId?: string | null
  /** Create a new git worktree before launching the session. */
  isolateWorktree?: boolean
  /** Optional branch name when isolateWorktree is enabled. */
  branchName?: string | null
  name?: string | null
  activate?: boolean
  initialInput?: string | null
}

export interface McpCreateSessionResponse {
  requestId: string
  ok: boolean
  sessionId?: string
  worktreeFallback?: boolean
  worktreeError?: string
  error?: string
}

export interface McpListSessionsResponse {
  requestId: string
  sessions: McpSessionInfo[]
}

export type ClaudeGuiComputeMode = 'auto' | 'max'
export type ClaudeGuiLanguage = 'zh' | 'es' | 'ar' | 'fr' | 'de' | 'ja' | 'ko'
export type ClaudeGuiPermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'
export type ClaudeGuiSkillSource = 'project-claude' | 'project-codex' | 'user-claude' | 'user-codex' | 'runtime'

export interface ClaudeGuiImagePayload {
  name: string
  mediaType: string
  data: string
}

export interface ClaudeGuiSkillCatalogEntry {
  id: string
  name: string
  description: string
  path: string
  source: ClaudeGuiSkillSource
  scope: 'project' | 'user' | 'runtime'
}

export interface ClaudeGuiRequestOptions {
  requestId: string
  conversationId: string
  cwd: string
  text: string
  sessionId?: string | null
  model: string
  computeMode?: ClaudeGuiComputeMode
  permissionMode?: ClaudeGuiPermissionMode
  planMode?: boolean
  thinkingMode?: boolean
  languageMode?: boolean
  language?: ClaudeGuiLanguage | null
  onlyCommunicate?: boolean
  images?: ClaudeGuiImagePayload[]
}

export interface ClaudePromptOptimizeOptions {
  prompt: string
  instruction?: string
  cwd?: string | null
}

export interface ClaudePromptOptimizeResult {
  content: string
}

export interface ClaudeDiffReviewFile {
  path: string
  status: string
  staged: boolean
}

export interface ClaudeDiffReviewOptions {
  cwd: string
  diff: string
  files: ClaudeDiffReviewFile[]
  branch?: string | null
}

export interface ClaudeDiffReviewResult {
  content: string
}

// ─── Claude Code `/usage` response ───
// Mirrors the `Utilization` shape from the official Claude CLI's
// `GET /api/oauth/usage` endpoint so we can render the same bars locally.

export interface ClaudeRateLimit {
  utilization: number | null
  resetsAt: string | null
}

export interface ClaudeExtraUsage {
  isEnabled: boolean
  monthlyLimit: number | null
  usedCredits: number | null
  utilization: number | null
}

/** Local-only usage aggregation from `~/.claude/projects/**` transcripts.
 *  Mirrors the approach used by Claude-Code-Usage-Monitor: no OAuth, no API
 *  calls, pure file-walking. Stable across refresh-token churn. */
export interface ClaudeCodeLocalUsage {
  /** Tokens consumed in the current 5-hour session block (active or most recent). */
  fiveHourTokens: number
  /** Soft upper-bound for the active plan (see `plan` field). */
  fiveHourLimit: number
  /** Block end timestamp (ISO string) — when the 5h window resets. */
  fiveHourResetsAt: string | null
  /** Tokens across all blocks in the last 7 days. */
  sevenDayTokens: number
  /** Inferred subscription plan. */
  plan: 'pro' | 'max5' | 'max20' | 'unknown'
  /** Model attribution for the latest transcript entry (optional hint). */
  latestModel: string | null
  error?: string
}

// ─── App auto-updater ────────────────────────────────────────────────────

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseNotes: string | null; releaseDate?: string }
  | { type: 'not-available'; currentVersion: string; latestVersion: string; dev?: boolean }
  | { type: 'progress'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; error: string }

export interface ClaudeCodeContext {
  /** Total tokens present in the current model context (input + cache_create + cache_read). */
  contextTokens: number
  /** Model id from the latest assistant message (used to pick 200k vs 1M limits). */
  model: string | null
  /** Absolute path of the session file we pulled the numbers from. */
  sessionFile: string | null
  error?: string
}

export interface ClaudeUtilization {
  fiveHour?: ClaudeRateLimit | null
  sevenDay?: ClaudeRateLimit | null
  sevenDayOpus?: ClaudeRateLimit | null
  sevenDaySonnet?: ClaudeRateLimit | null
  extraUsage?: ClaudeExtraUsage | null
  /** Present when the token file was found but the API call failed or auth is missing. */
  error?: string
  /** True when no credentials.json was found (user hasn't logged in via `claude login`). */
  notAuthenticated?: boolean
}

// ─── Session History (Claude Code + Codex persisted transcripts) ─────────
// Read-only snapshots built by scanning each CLI's on-disk session stores:
//   - Claude Code: ~/.claude/projects/<sanitized-cwd>/*.jsonl
//   - Codex:       ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl
// Used by the "历史会话" sidebar panel to let the user browse past conversations
// across both CLIs and one-click resume them into a new pane.

export type HistoricalSessionSource = 'claude-code' | 'codex'

export interface HistoricalSession {
  /** CLI this transcript belongs to. */
  source: HistoricalSessionSource
  /** Conversation/session UUID — used with `claude --resume <id>` / `codex resume <id>`. */
  id: string
  /** Absolute on-disk path of the transcript file (for debug / open-in-editor). */
  filePath: string
  /** Absolute working directory the original session was run in. */
  cwd: string
  /** ISO timestamp of the first entry in the transcript. */
  startedAt: string | null
  /** ISO timestamp of the last entry in the transcript. */
  updatedAt: string | null
  /** First non-injected user message, trimmed to a short preview. */
  firstUserPrompt: string | null
  /** Real user turns — only messages the user typed, excluding tool_result
   *  entries, injected system reminders, and agent metadata lines. */
  userTurns: number
}

export interface HistoricalSessionListResult {
  sessions: HistoricalSession[]
  /** Per-source error hints (e.g., missing directory, permission denied). */
  errors: Partial<Record<HistoricalSessionSource, string>>
}

export interface HistoricalSessionDeleteResult {
  deleted: number
  errors: Array<{ path: string; error: string }>
}

export interface ClaudeGuiUsage {
  totalTokensInput: number
  totalTokensOutput: number
  currentInputTokens: number
  currentOutputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}

export interface ClaudeGuiResultPayload {
  sessionId?: string
  totalCost?: number
  duration?: number
  turns?: number
  totalTokensInput: number
  totalTokensOutput: number
  requestCount: number
  currentTokensInput: number
  currentTokensOutput: number
}

export type ClaudeGuiEvent =
  | {
    requestId: string
    conversationId: string
    type: 'processing'
    active: boolean
  }
  | {
    requestId: string
    conversationId: string
    type: 'connected'
    sessionId?: string
    model?: string
    tools?: string[]
    skills?: string[]
  }
  | {
    requestId: string
    conversationId: string
    type: 'assistant'
    messageId: string
    text: string
  }
  | {
    requestId: string
    conversationId: string
    type: 'thinking'
    messageId: string
    text: string
  }
  | {
    requestId: string
    conversationId: string
    type: 'system'
    messageId: string
    text: string
  }
  | {
    requestId: string
    conversationId: string
    type: 'tool-use'
    messageId: string
    toolUseId: string
    toolName: string
    rawInput?: unknown
  }
  | {
    requestId: string
    conversationId: string
    type: 'tool-status'
    toolUseId?: string
    toolName: string
    status: string
  }
  | {
    requestId: string
    conversationId: string
    type: 'tool-result'
    toolUseId?: string
    toolName?: string
    text: string
    isError?: boolean
    hidden?: boolean
  }
  | {
    requestId: string
    conversationId: string
    type: 'usage'
    usage: ClaudeGuiUsage
  }
  | {
    requestId: string
    conversationId: string
    type: 'result'
    result: ClaudeGuiResultPayload
  }
  | {
    requestId: string
    conversationId: string
    type: 'error'
    error: string
  }
  | {
    requestId: string
    conversationId: string
    type: 'plan-mode'
    active: boolean
  }
  | {
    requestId: string
    conversationId: string
    type: 'closed'
    exitCode: number
  }

export interface ToastNotification {
  id: string
  title: string
  body: string
  type: 'info' | 'success' | 'warning' | 'error'
  sessionId?: string
  projectId?: string
  duration?: number
  createdAt: number
}

// ─── Git Types ───

export interface GitBranchInfo {
  current: string
  branches: string[]
  isDirty: boolean
}

export interface Worktree {
  id: string
  projectId: string
  branch: string
  path: string       // filesystem path (main worktree = project.path)
  isMain: boolean    // true for the project dir itself
}

export interface GitWorktreeInfo {
  path: string
  branch: string
  isMain: boolean
}

export type ExternalIdeId = 'cursor' | 'vscode' | 'trae' | 'rider'

export interface ExternalIdeOption {
  id: ExternalIdeId
  label: string
}

export interface OpenIdeResult {
  ok: boolean
  error?: string
}

export interface ProjectSearchMatch {
  id: string
  filePath: string
  relativePath: string
  line: number
  column: number
  endColumn: number
  lineText: string
  matchText: string
}

export interface SearchQueryOptions {
  limit?: number
  fileFilter?: string
}

export interface FileSearchResult {
  id: string
  rootPath: string
  filePath: string
  fileName: string
  relativePath: string
}

export const EXTERNAL_IDE_OPTIONS: ExternalIdeOption[] = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'trae', label: 'Trae' },
  { id: 'rider', label: 'Rider' },
]

// ─── Session Template Types ───

export interface SessionTemplateItem {
  type: SessionType
  name: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  prompt?: string
}

export interface WorkerTemplate {
  id: string
  name: string
  description: string
  type: AgentSessionType
  defaultName: string
  prompt: string
  ownershipHint?: string
  resultContract: string
  isolatedWorktree: boolean
}

export interface SessionTemplate {
  id: string
  name: string
  projectId: string | null  // null = global template
  items: SessionTemplateItem[]
}

// ─── Task Bundle Types ───

export type TaskBundleType = 'fix-bug' | 'new-feature' | 'code-review' | 'release-check' | 'custom'

export interface TaskBundleStep {
  id?: string
  type: SessionType
  name: string
  prompt: string
  env?: Record<string, string>
  dependsOn?: string[]
  ownership?: string[]
  isolatedWorktree?: boolean
  templateId?: string
}

export interface TaskBundle {
  id: string
  type: TaskBundleType
  name: string
  description: string
  steps: TaskBundleStep[]
  branchPrefix?: string
}

export interface ActiveTask {
  id: string
  bundleId: string
  projectId: string
  branch?: string
  description: string
  sessionIds: string[]
  status: 'active' | 'completed' | 'cancelled'
  createdAt: number
  graphNodes?: TaskGraphNode[]
  reports?: Record<string, StructuredWorkerReport>
}

export type TaskGraphNodeStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed'

export interface TaskGraphNode {
  id: string
  templateId?: string
  name: string
  type: AgentSessionType
  prompt: string
  dependsOn: string[]
  ownership: string[]
  isolatedWorktree: boolean
  sessionId?: string
  worktreeId?: string
  status: TaskGraphNodeStatus
}

export interface StructuredWorkerReport {
  status: string
  filesChanged: string[]
  verification: string
  risks: string
  blockers: string
  suggestedNextAction: string
  raw: string
  updatedAt: number
}

// ─── IPC Channels ───

export const IPC = {
  SESSION_CREATE: 'session:create',
  SESSION_WRITE: 'session:write',
  SESSION_SUBMIT: 'session:submit',
  SESSION_RESIZE: 'session:resize',
  SESSION_KILL: 'session:kill',
  SESSION_ACTIVITY: 'session:activity',
  SESSION_EXPORT: 'session:export',
  SESSION_REPLAY: 'session:replay',
  SESSION_DATA: 'session:data',
  SESSION_EXIT: 'session:exit',
  SESSION_GRACEFUL_SHUTDOWN: 'session:graceful-shutdown',
  SESSION_FOCUS: 'session:focus',
  SESSION_IDLE_TOAST: 'session:idle-toast',
  SESSION_ACTIVITY_UPDATE: 'session:activity-update',

  // ─── Meta-Agent / MCP bridge ───
  // main → renderer: ask renderer to perform an action requested by the
  // FastAgents MCP server (called by an agent acting as orchestrator).
  // renderer → main: reply with the result keyed by requestId.
  MCP_LIST_SESSIONS_REQUEST: 'mcp:list-sessions-request',
  MCP_LIST_SESSIONS_RESPONSE: 'mcp:list-sessions-response',
  MCP_CREATE_SESSION_REQUEST: 'mcp:create-session-request',
  MCP_CREATE_SESSION_RESPONSE: 'mcp:create-session-response',

  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_RESPOND: 'permission:respond',
  PERMISSION_DISMISS: 'permission:dismiss',

  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_CLICK: 'notification:click',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_SET_FULLSCREEN: 'window:set-fullscreen',
  WINDOW_IS_FULLSCREEN: 'window:is-fullscreen',
  WINDOW_START_VOICE_INPUT: 'window:start-voice-input',

  DIALOG_SELECT_FOLDER: 'dialog:select-folder',
  SHELL_OPEN_PATH: 'shell:open-path',
  SHELL_OPEN_EXTERNAL: 'shell:open-external',
  SHELL_OPEN_IN_IDE: 'shell:open-in-ide',
  SHELL_LIST_IDES: 'shell:list-ides',

  CLAUDE_GUI_START: 'claude-gui:start',
  CLAUDE_GUI_STOP: 'claude-gui:stop',
  CLAUDE_GUI_EVENT: 'claude-gui:event',
  CLAUDE_GUI_EXPORT: 'claude-gui:export',
  CLAUDE_GUI_LIST_SKILLS: 'claude-gui:list-skills',
  CLAUDE_GUI_FETCH_USAGE: 'claude-gui:fetch-usage',
  CLAUDE_CODE_FETCH_CONTEXT: 'claude-code:fetch-context',
  CLAUDE_CODE_FETCH_LOCAL_USAGE: 'claude-code:fetch-local-usage',
  SESSION_HISTORY_LIST: 'session-history:list',
  SESSION_HISTORY_DELETE: 'session-history:delete',

  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_EVENT: 'updater:event',
  CLAUDE_PROMPT_OPTIMIZE: 'claude-prompt:optimize',
  CLAUDE_DIFF_REVIEW: 'claude-diff:review',
} as const

// ─── Session Type Labels ───

export const SESSION_TYPE_CONFIG: Record<
  SessionType,
  { label: string; command: string; icon: string }
> = {
  browser: { label: 'Browser', command: '', icon: 'globe' },
  'claude-code': { label: 'Claude Code', command: 'claude', icon: 'brain' },
  'claude-code-yolo': { label: 'Claude Code YOLO', command: 'claude', icon: 'brain' },
  'claude-code-wsl': { label: 'Claude Code(WSL)', command: 'wsl.exe claude', icon: 'brain' },
  'claude-code-yolo-wsl': { label: 'Claude Code YOLO(WSL)', command: 'wsl.exe claude --dangerously-skip-permissions', icon: 'brain' },
  'claude-gui': { label: 'Claude GUI', command: '', icon: 'brain' },
  codex: { label: 'Codex', command: 'codex', icon: 'cpu' },
  'codex-yolo': { label: 'Codex YOLO', command: 'codex', icon: 'cpu' },
  'codex-wsl': { label: 'Codex(WSL)', command: 'wsl.exe codex', icon: 'cpu' },
  'codex-yolo-wsl': { label: 'Codex YOLO(WSL)', command: 'wsl.exe codex --dangerously-bypass-approvals-and-sandbox', icon: 'cpu' },
  gemini: { label: 'Gemini', command: 'gemini', icon: 'sparkles' },
  'gemini-yolo': { label: 'Gemini YOLO', command: 'gemini', icon: 'sparkles' },
  opencode: { label: 'OpenCode', command: 'opencode', icon: 'code' },
  terminal: { label: 'Terminal', command: '', icon: 'terminal' },
  'terminal-wsl': { label: 'Terminal(WSL)', command: 'wsl.exe', icon: 'terminal' },
}
