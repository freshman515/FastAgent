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

export type SessionType = 'claude-code' | 'codex' | 'opencode' | 'terminal'
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

// ─── IPC Channels ───

export const IPC = {
  SESSION_CREATE: 'session:create',
  SESSION_WRITE: 'session:write',
  SESSION_RESIZE: 'session:resize',
  SESSION_KILL: 'session:kill',
  SESSION_ACTIVITY: 'session:activity',
  SESSION_EXPORT: 'session:export',
  SESSION_DATA: 'session:data',
  SESSION_EXIT: 'session:exit',
  SESSION_GRACEFUL_SHUTDOWN: 'session:graceful-shutdown',

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
  codex: { label: 'Codex', command: 'codex', icon: 'cpu' },
  opencode: { label: 'OpenCode', command: 'opencode', icon: 'code' },
  terminal: { label: 'Terminal', command: '', icon: 'terminal' },
}
