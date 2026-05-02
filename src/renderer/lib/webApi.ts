import type { ElectronAPI } from '../../preload'
import type {
  AppInfo,
  ClaudeCodeContext,
  ClaudeCodeLocalUsage,
  ConfigChangedEvent,
  ClaudeDiffReviewOptions,
  ClaudeDiffReviewResult,
  ClaudeGuiEvent,
  ClaudeGuiRequestOptions,
  ClaudeGuiSkillCatalogEntry,
  ClaudePromptOptimizeOptions,
  ClaudePromptOptimizeResult,
  ClaudeUtilization,
  ExternalIdeId,
  ExternalIdeOption,
  FileSearchResult,
  HistoricalSessionDeleteResult,
  HistoricalSessionListResult,
  ManagedSessionInfo,
  McpCloseSessionRequest,
  McpCloseSessionResponse,
  McpCreateSessionRequest,
  McpCreateSessionResponse,
  McpSessionInfo,
  OpenIdeResult,
  ProjectSearchMatch,
  SearchQueryOptions,
  Session,
  SessionCreateOptions,
  SessionCreateResult,
  SessionDataEvent,
  SessionExitEvent,
  SessionReplayPayload,
  TerminalShellAvailability,
  TerminalShellMode,
  UpdaterEvent,
  VoiceLocalAsrServiceRequest,
  VoiceLocalAsrServiceResult,
  VoiceStreamChunkPayload,
  VoiceStreamEvent,
  VoiceStreamStartRequest,
  VoiceStreamStartResult,
  VoiceStreamStopRequest,
  VoiceStreamWarmupRequest,
  VoiceStreamWarmupResult,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
  WebUiInfo,
} from '@shared/types'

type EventCallback<T> = (event: T) => void
type Unsubscribe = () => void

interface OpencodeRequest {
  directory: string
  model?: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
}

interface OpencodeSubscriptionRequest {
  directory: string
  model?: string
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) as unknown : null
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data
      ? String((data as { error: unknown }).error)
      : response.statusText
    throw new Error(message)
  }
  return data as T
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

function noopUnsubscribe(): Unsubscribe {
  return () => {}
}

function unsupported<T>(message: string): Promise<T> {
  return Promise.reject(new Error(message))
}

class WebEventHub {
  private source: EventSource | null = null

  subscribe<T>(eventName: string, callback: EventCallback<T>): Unsubscribe {
    this.ensureSource()
    const handler = (event: MessageEvent<string>): void => {
      try {
        callback(JSON.parse(event.data) as T)
      } catch {
        // Ignore malformed events.
      }
    }
    this.source?.addEventListener(eventName, handler as EventListener)
    return () => {
      this.source?.removeEventListener(eventName, handler as EventListener)
    }
  }

  private ensureSource(): void {
    if (this.source) return
    this.source = new EventSource('/events', { withCredentials: true })
  }
}

class PtySocket {
  private socket: WebSocket | null = null

  send(payload: unknown): boolean {
    const socket = this.ensureSocket()
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(payload))
    return true
  }

  private ensureSocket(): WebSocket | null {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return this.socket
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      this.socket = new WebSocket(`${protocol}//${window.location.host}/pty`)
      return this.socket
    } catch {
      this.socket = null
      return null
    }
  }
}

const events = new WebEventHub()
const ptySocket = new PtySocket()

function installWebApi(): void {
  const existingApi = (window as unknown as {
    api?: Partial<ElectronAPI> & { webUi?: { isWebRuntime?: boolean } }
  }).api
  if (existingApi?.webUi?.isWebRuntime === false) return
  const isBrowserPage = window.location.protocol === 'http:' || window.location.protocol === 'https:'
  if (existingApi && !isBrowserPage) return

  const api = {
    app: {
      getInfo: async (): Promise<AppInfo> => {
        const info = await request<{ platform: string; version: string }>('/api/web/info')
        return {
          name: 'fast-agents',
          productName: 'FastAgents',
          version: info.version,
          appId: 'com.fastagents.app',
          platform: info.platform,
          arch: '',
          isPackaged: false,
          electronVersion: '',
          chromeVersion: '',
          nodeVersion: '',
          repository: {
            provider: 'github',
            owner: 'fastagents',
            repo: 'fastagents',
            url: '',
          },
          updateFeed: '',
        }
      },
    },

    webUi: {
      isWebRuntime: true,
      getInfo: (): Promise<WebUiInfo> => Promise.resolve({
        url: window.location.href,
        lanUrls: [],
        port: Number(window.location.port) || null,
        host: window.location.hostname || null,
      }),
    },

    window: {
      minimize: () => Promise.resolve(),
      maximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
      isMaximized: () => Promise.resolve(false),
      setFullscreen: async (fullscreen: boolean) => {
        if (fullscreen && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen().catch(() => undefined)
        } else if (!fullscreen && document.exitFullscreen) {
          await document.exitFullscreen().catch(() => undefined)
        }
        return Boolean(document.fullscreenElement)
      },
      isFullscreen: () => Promise.resolve(Boolean(document.fullscreenElement)),
      startVoiceInput: () => Promise.resolve({ ok: false, error: 'Web UI does not support system voice input.' }),
      manageVoiceLocalAsrService: (_options: VoiceLocalAsrServiceRequest): Promise<VoiceLocalAsrServiceResult> =>
        Promise.resolve({ ok: false, action: _options.action, error: 'Web UI does not manage local ASR services.' }),
      transcribeVoiceInput: (_options: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> =>
        unsupported('Web UI voice transcription is not available yet.'),
      startVoiceInputStream: (_options: VoiceStreamStartRequest): Promise<VoiceStreamStartResult> =>
        Promise.resolve({ ok: false, error: 'Web UI voice streaming is not available yet.' }),
      warmupVoiceInputStream: (_options: VoiceStreamWarmupRequest): Promise<VoiceStreamWarmupResult> =>
        Promise.resolve({ ok: false, error: 'Web UI voice streaming is not available yet.' }),
      sendVoiceInputStreamChunk: (_payload: VoiceStreamChunkPayload) => {},
      stopVoiceInputStream: (_payload: VoiceStreamStopRequest) => Promise.resolve({ ok: false, error: 'Web UI voice streaming is not available yet.' }),
      cancelVoiceInputStream: (_payload: VoiceStreamStopRequest) => Promise.resolve({ ok: false, error: 'Web UI voice streaming is not available yet.' }),
      onVoiceInputStreamEvent: (_callback: EventCallback<VoiceStreamEvent>) => noopUnsubscribe(),
    },

    shortcuts: {
      setCanvasBookmarkShortcutsActive: (_active: boolean) => {},
      onCanvasBookmarkShortcut: (_callback: (index: number) => void) => noopUnsubscribe(),
      onCanvasFitAllShortcut: (_callback: () => void) => noopUnsubscribe(),
    },

    dialog: {
      selectFolder: () => Promise.resolve(null),
    },

    shell: {
      openPath: (path: string) => post('/api/shell/open-path', { path }),
      openExternal: (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer')
        return post('/api/shell/open-external', { url }).catch(() => undefined)
      },
      openInIde: (_ide: ExternalIdeId, path: string): Promise<OpenIdeResult> =>
        post('/api/shell/open-path', { path }).then(() => ({ ok: true })),
      listIdes: () => request<ExternalIdeOption[]>('/api/shell/list-ides'),
      resolveTerminalShell: (mode: TerminalShellMode) =>
        post<TerminalShellAvailability>('/api/shell/resolve-terminal-shell', { mode }),
    },

    session: {
      create: (options: SessionCreateOptions) =>
        post<SessionCreateResult>('/api/session/create', options),
      write: (ptyId: string, data: string) => {
        if (ptySocket.send({ type: 'input', ptyId, data })) return Promise.resolve()
        return post('/api/session/write', { ptyId, data })
      },
      submit: (ptyId: string, input: string, submit = true) =>
        post('/api/session/submit', { ptyId, input, submit }),
      resize: (ptyId: string, cols: number, rows: number) => {
        if (ptySocket.send({ type: 'resize', ptyId, cols, rows })) return Promise.resolve()
        return post('/api/session/resize', { ptyId, cols, rows })
      },
      kill: (ptyId: string) => post('/api/session/kill', { ptyId }),
      getReplay: (ptyId: string) =>
        request<SessionReplayPayload>(`/api/session/replay?ptyId=${encodeURIComponent(ptyId)}`),
      getActivity: (ptyId: string) =>
        request<boolean>(`/api/session/activity?ptyId=${encodeURIComponent(ptyId)}`),
      getManaged: (sessionId: string) =>
        request<ManagedSessionInfo | null>(`/api/session/managed?sessionId=${encodeURIComponent(sessionId)}`),
      export: (_ptyId: string, _name: string) => Promise.resolve(false),
      gracefulShutdown: () => post<Record<string, string>>('/api/session/graceful-shutdown', {}),
      onResumeUUIDs: (_callback: (uuids: Record<string, string>) => void) => noopUnsubscribe(),
      onData: (callback: EventCallback<SessionDataEvent>) => events.subscribe('session:data', callback),
      onExit: (callback: EventCallback<SessionExitEvent>) => events.subscribe('session:exit', callback),
      onFocus: (_callback: EventCallback<{ sessionId: string }>) => noopUnsubscribe(),
      onIdleToast: (_callback: EventCallback<{ sessionId?: string | null }>) => noopUnsubscribe(),
      onActivityStatus: (_callback: EventCallback<{ sessionId: string; activity: 'running' | 'thinking' | 'idle' | 'completed'; source: 'claude' | 'codex'; ts: number }>) => noopUnsubscribe(),
      onStatusUpdate: (_callback: EventCallback<{ sessionId: string | null; model?: string; contextWindow?: unknown; cost?: unknown; workspace?: unknown }>) => noopUnsubscribe(),
      onPermissionRequest: (_callback: EventCallback<{ id: string; sessionId: string | null; conversationId?: string | null; toolName: string; detail: string; suggestions: string[] }>) => noopUnsubscribe(),
      onPermissionDismiss: (_callback: EventCallback<{ id: string }>) => noopUnsubscribe(),
      respondPermission: (_id: string, _behavior: 'allow' | 'deny', _suggestionIndex?: number) => Promise.resolve(),
    },

    mcp: {
      onListSessionsRequest: (_callback: (req: { requestId: string }) => void) => noopUnsubscribe(),
      respondListSessions: (_payload: { requestId: string; sessions: McpSessionInfo[] }) => {},
      onCreateSessionRequest: (_callback: (req: McpCreateSessionRequest) => void) => noopUnsubscribe(),
      respondCreateSession: (_payload: McpCreateSessionResponse) => {},
      onCloseSessionRequest: (_callback: (req: McpCloseSessionRequest) => void) => noopUnsubscribe(),
      respondCloseSession: (_payload: McpCloseSessionResponse) => {},
    },

    sessionHistory: {
      list: (): Promise<HistoricalSessionListResult> => Promise.resolve({ sessions: [], errors: [] }),
      delete: (_paths: string[]): Promise<HistoricalSessionDeleteResult> => Promise.resolve({ deleted: [], failed: [] }),
    },

    claudeGui: {
      start: (_options: ClaudeGuiRequestOptions) => Promise.resolve(),
      stop: () => Promise.resolve(),
      optimizePrompt: (_options: ClaudePromptOptimizeOptions): Promise<ClaudePromptOptimizeResult> =>
        unsupported('Claude GUI prompt optimization is not available in Web UI yet.'),
      reviewDiff: (_options: ClaudeDiffReviewOptions): Promise<ClaudeDiffReviewResult> =>
        unsupported('Claude GUI diff review is not available in Web UI yet.'),
      exportConversation: (_options: { suggestedName: string; extension: 'md' | 'json'; content: string }) => Promise.resolve(false),
      listSkills: (_cwd: string): Promise<ClaudeGuiSkillCatalogEntry[]> => Promise.resolve([]),
      fetchUsage: (): Promise<ClaudeUtilization> => Promise.resolve({ notAuthenticated: true }),
      fetchContext: (_payload: { cwd: string; sessionStartedAt?: number }): Promise<ClaudeCodeContext> =>
        Promise.resolve({ contextTokens: 0, model: null, sessionFile: null, error: 'Unavailable in Web UI.' }),
      fetchLocalUsage: (): Promise<ClaudeCodeLocalUsage> =>
        Promise.resolve({ entries: [], totalCostUsd: 0, totalTokens: 0, error: 'Unavailable in Web UI.' } as ClaudeCodeLocalUsage),
      onEvent: (_callback: EventCallback<ClaudeGuiEvent>) => noopUnsubscribe(),
    },

    updater: {
      check: () => Promise.resolve(),
      download: () => Promise.resolve(),
      install: () => Promise.resolve(),
      onEvent: (_callback: EventCallback<UpdaterEvent>) => noopUnsubscribe(),
    },

    notification: {
      show: (_options: { title: string; body?: string; sessionId?: string; projectId?: string }) => Promise.resolve(),
      onClick: (_callback: EventCallback<{ sessionId?: string; projectId?: string }>) => noopUnsubscribe(),
    },

    git: {
      getStatus: (path: string) => post('/api/git/status', { path }),
      init: (path: string) => post('/api/git/init', { path }),
      createBranch: (path: string, name: string) => post('/api/git/create-branch', { path, name }),
      checkoutBranch: (path: string, name: string) => post('/api/git/checkout-branch', { path, name }),
      listWorktrees: (path: string) => post('/api/git/worktree-list', { path }),
      addWorktree: (cwd: string, path: string, branch: string) => post('/api/git/worktree-add', { cwd, targetPath: path, branch }),
      removeWorktree: (cwd: string, path: string) => post('/api/git/worktree-remove', { cwd, targetPath: path }),
      status: (cwd: string) => post('/api/git/file-status', { cwd }),
      diff: (cwd: string, filePath: string) => post('/api/git/diff', { cwd, filePath }),
      reviewDiff: (cwd: string) => post('/api/git/review-diff', { cwd }),
      stage: (cwd: string, filePath: string) => post('/api/git/stage', { cwd, filePath }),
      unstage: (cwd: string, filePath: string) => post('/api/git/unstage', { cwd, filePath }),
      commit: (cwd: string, message: string) => post('/api/git/commit', { cwd, message }),
      discard: (cwd: string, filePath: string) => post('/api/git/discard', { cwd, filePath }),
      showHead: (cwd: string, filePath: string) => post('/api/git/show-head', { cwd, filePath }),
    },

    ai: {
      chat: (_options: { baseUrl: string; apiKey: string; model: string; provider: string; messages: Array<{ role: string; content: string }>; maxTokens?: number }) =>
        unsupported('AI chat proxy is not available in Web UI yet.'),
    },

    opencode: {
      request: (_payload: OpencodeRequest): Promise<unknown> => unsupported('OpenCode panel is not available in Web UI yet.'),
      listModels: (_directory: string): Promise<string[]> => Promise.resolve([]),
      subscribe: async (
        _payload: OpencodeSubscriptionRequest,
        _callback: EventCallback<{ subscriptionId: string; type: 'event' | 'error'; event?: unknown; error?: string }>,
      ) => noopUnsubscribe(),
    },

    ide: {
      selectionChanged: (_params: {
        text: string
        filePath: string
        fileUrl: string
        fileName: string
        language: string
        cursorLine: number
        cursorColumn: number
        selection: {
          start: { line: number; character: number }
          end: { line: number; character: number }
          isEmpty: boolean
        }
      }) => {},
      updateWorkspace: (_folders: string[]) => {},
      getPort: () => Promise.resolve(null),
    },

    files: {
      getPathForFile: (_file: File) => null,
    },

    fs: {
      readDir: (path: string) => post('/api/fs/read-dir', { path }),
      stat: (path: string) => post('/api/fs/stat', { path }),
      readFile: (path: string) => post('/api/fs/read-file', { path }),
      writeFile: (path: string, content: string) => post('/api/fs/write-file', { path, content }),
      createFile: (path: string) => post('/api/fs/create-file', { path }),
      createDir: (path: string) => post('/api/fs/create-dir', { path }),
      move: (sourcePath: string, targetPath: string) => post('/api/fs/move', { sourcePath, targetPath }),
      delete: (path: string) => post('/api/fs/delete', { path }),
      writeTempFile: (suggestedName: string, content: string, extension = 'txt') =>
        post('/api/fs/write-temp-file', { suggestedName, content, extension }),
      writeTempDataUrl: (suggestedName: string, dataUrl: string, extension = 'png') =>
        post('/api/fs/write-temp-data-url', { suggestedName, dataUrl, extension }),
    },

    search: {
      findInFiles: (rootPath: string, query: string, options?: SearchQueryOptions) =>
        post<ProjectSearchMatch[]>('/api/search/find-in-files', { rootPath, query, options }),
      findFiles: (rootPath: string, query: string, options?: SearchQueryOptions) =>
        post<FileSearchResult[]>('/api/search/find-files', { rootPath, query, options }),
    },

    media: {
      get: () => Promise.resolve({
        title: '',
        artist: '',
        albumTitle: '',
        albumArtist: '',
        sourceAppId: '',
        trackNumber: null,
        artwork: '',
        status: 'Unknown' as const,
      }),
      command: (_cmd: 'play-pause' | 'next' | 'prev') => Promise.resolve(),
      onUpdate: (_callback: EventCallback<{
        title: string
        artist: string
        albumTitle: string
        albumArtist: string
        sourceAppId: string
        trackNumber: number | null
        artwork: string
        status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
      }>) => noopUnsubscribe(),
    },

    config: {
      read: () => request('/api/config') as ReturnType<ElectronAPI['config']['read']>,
      write: (key: string, value: unknown) => post('/api/config', { key, value }),
      onChanged: (callback: EventCallback<ConfigChangedEvent>) => events.subscribe('config:changed', callback),
    },

    overlay: {
      sendToast: (_toast: unknown) => {},
      removeToast: (_id: string) => {},
      sendAction: (_action: unknown) => {},
      setIgnoreMouse: (_ignore: boolean) => {},
      onToast: (_callback: EventCallback<unknown>) => noopUnsubscribe(),
      onToastRemove: (_callback: EventCallback<string>) => noopUnsubscribe(),
      onAction: (_callback: EventCallback<unknown>) => noopUnsubscribe(),
      isOverlay: false,
    },

    detach: {
      create: (_tabIds: string[], _title: string, _sessionData?: unknown[], _editorData?: unknown[], _context?: { projectId: string | null; worktreeId: string | null }, _position?: { x: number; y: number }, _size?: { width: number; height: number }) => Promise.resolve(''),
      minimize: () => Promise.resolve(),
      maximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
      setPosition: (_x: number, _y: number) => Promise.resolve(),
      onClosed: (_callback: EventCallback<{
        id: string
        tabIds: string[]
        sessions: Session[]
        editors: unknown[]
        projectId: string | null
        worktreeId: string | null
      }>) => noopUnsubscribe(),
      getSessions: (_windowId: string) => Promise.resolve([]),
      getEditors: (_windowId: string) => Promise.resolve([]),
      updateSessionIds: (_windowId: string, _tabIds: string[]) => Promise.resolve(),
      updateSessions: (_windowId: string, _sessions: Session[]) => Promise.resolve(),
      updateEditors: (_windowId: string, _editors: unknown[]) => Promise.resolve(),
      updateContext: (_windowId: string, _context: { projectId: string | null; worktreeId: string | null }) => Promise.resolve(),
      registerTabDrag: (_token: string, _payload: unknown) => false,
      claimTabDrag: (_token: string, _targetWindowId: string) => null,
      finishTabDrag: (_token: string) => null,
      getActiveTabDrag: () => null,
      getWindowId: () => 'web',
      isDetached: false,
      getSessionIds: () => [],
      getTabIds: () => [],
      getTitle: () => 'FastAgents',
    },

    platform: navigator.platform.toLowerCase().includes('win') ? 'win32' : navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'linux',
  } as unknown as ElectronAPI

  window.api = api
}

installWebApi()
