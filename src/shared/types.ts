// ─── Data Models ───

export interface Group {
  id: string
  name: string
  color: string
  collapsed: boolean
  projectIds: string[]
}

export interface Project {
  id: string
  name: string
  path: string
  groupId: string
}

export type SessionType = 'claude-code' | 'claude-code-yolo' | 'codex' | 'codex-yolo' | 'opencode' | 'terminal'

/** Returns true for any Claude Code variant (normal or yolo mode) */
export function isClaudeCodeType(type: SessionType): boolean {
  return type === 'claude-code' || type === 'claude-code-yolo'
}
export type SessionStatus = 'running' | 'idle' | 'waiting-input' | 'stopped'
export type OutputState = 'idle' | 'outputting' | 'unread'

export interface Session {
  id: string
  projectId: string
  type: SessionType
  name: string
  status: SessionStatus
  ptyId: string | null
  initialized: boolean // true after first PTY launch, used for --resume
  resumeUUID: string | null // UUID captured from `claude --resume <uuid>` on exit
  pinned: boolean
  createdAt: number
  updatedAt: number
  worktreeId?: string   // bound to specific worktree; undefined = main worktree
}

// ─── IPC Types ───

export interface SessionCreateOptions {
  cwd: string
  type: SessionType
  sessionId?: string   // unique session id for agent resume
  resume?: boolean     // true = resume previous session
  resumeUUID?: string  // UUID from claude --resume output
  command?: string
  args?: string[]
  cols?: number
  rows?: number
}

export interface SessionCreateResult {
  ptyId: string
}

export interface SessionDataEvent {
  ptyId: string
  data: string
}

export interface SessionExitEvent {
  ptyId: string
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

// ─── Session Template Types ───

export interface SessionTemplateItem {
  type: SessionType
  name: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  prompt?: string
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
  type: SessionType
  name: string
  prompt: string
  env?: Record<string, string>
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
}

// ─── IPC Channels ───

export const IPC = {
  SESSION_CREATE: 'session:create',
  SESSION_WRITE: 'session:write',
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

  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_RESPOND: 'permission:respond',
  PERMISSION_DISMISS: 'permission:dismiss',

  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_CLICK: 'notification:click',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  DIALOG_SELECT_FOLDER: 'dialog:select-folder',
  SHELL_OPEN_PATH: 'shell:open-path',
} as const

// ─── Session Type Labels ───

export const SESSION_TYPE_CONFIG: Record<
  SessionType,
  { label: string; command: string; icon: string }
> = {
  'claude-code': { label: 'Claude Code', command: 'claude', icon: 'brain' },
  'claude-code-yolo': { label: 'Claude Code YOLO', command: 'claude', icon: 'brain' },
  codex: { label: 'Codex', command: 'codex', icon: 'cpu' },
  'codex-yolo': { label: 'Codex YOLO', command: 'codex', icon: 'cpu' },
  opencode: { label: 'OpenCode', command: 'opencode', icon: 'code' },
  terminal: { label: 'Terminal', command: '', icon: 'terminal' },
}
