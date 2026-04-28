import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/types'
import type {
  ClaudeCodeContext,
  ClaudeCodeLocalUsage,
  UpdaterEvent,
  ClaudeDiffReviewOptions,
  ClaudeDiffReviewResult,
  ClaudeGuiEvent,
  ClaudeGuiSkillCatalogEntry,
  ClaudePromptOptimizeOptions,
  ClaudePromptOptimizeResult,
  ClaudeGuiRequestOptions,
  ClaudeUtilization,
  ExternalIdeId,
  ExternalIdeOption,
  FileSearchResult,
  HistoricalSessionDeleteResult,
  HistoricalSessionListResult,
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
} from '@shared/types'

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

const api = {
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED) as Promise<boolean>,
    setFullscreen: (fullscreen: boolean) => ipcRenderer.invoke(IPC.WINDOW_SET_FULLSCREEN, fullscreen) as Promise<boolean>,
    isFullscreen: () => ipcRenderer.invoke(IPC.WINDOW_IS_FULLSCREEN) as Promise<boolean>,
    startVoiceInput: () =>
      ipcRenderer.invoke(IPC.WINDOW_START_VOICE_INPUT) as Promise<{ ok: boolean; error?: string }>,
  },

  shortcuts: {
    setCanvasBookmarkShortcutsActive: (active: boolean) =>
      ipcRenderer.send('shortcuts:set-canvas-bookmark-shortcuts-active', active),
    onCanvasBookmarkShortcut: (callback: (index: number) => void) => {
      const handler = (_: unknown, index: number) => callback(index)
      ipcRenderer.on('shortcuts:canvas-bookmark', handler)
      return () => ipcRenderer.removeListener('shortcuts:canvas-bookmark', handler)
    },
    onCanvasFitAllShortcut: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('shortcuts:canvas-fit-all', handler)
      return () => ipcRenderer.removeListener('shortcuts:canvas-fit-all', handler)
    },
  },

  dialog: {
    selectFolder: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_FOLDER) as Promise<string | null>,
  },

  shell: {
    openPath: (path: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, path),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),
    openInIde: (ide: ExternalIdeId, path: string) =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_IN_IDE, ide, path) as Promise<OpenIdeResult>,
    listIdes: () =>
      ipcRenderer.invoke(IPC.SHELL_LIST_IDES) as Promise<ExternalIdeOption[]>,
  },

  session: {
    create: (options: SessionCreateOptions) =>
      ipcRenderer.invoke(IPC.SESSION_CREATE, options) as Promise<SessionCreateResult>,
    write: (ptyId: string, data: string) => ipcRenderer.invoke(IPC.SESSION_WRITE, ptyId, data),
    submit: (ptyId: string, input: string, submit = true) =>
      ipcRenderer.invoke(IPC.SESSION_SUBMIT, ptyId, { input, submit }),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.SESSION_RESIZE, ptyId, cols, rows),
    kill: (ptyId: string) => ipcRenderer.invoke(IPC.SESSION_KILL, ptyId),
    getReplay: (ptyId: string) =>
      ipcRenderer.invoke(IPC.SESSION_REPLAY, ptyId) as Promise<SessionReplayPayload>,
    getActivity: (ptyId: string) =>
      ipcRenderer.invoke(IPC.SESSION_ACTIVITY, ptyId) as Promise<boolean>,
    export: (ptyId: string, name: string) =>
      ipcRenderer.invoke(IPC.SESSION_EXPORT, ptyId, name) as Promise<boolean>,
    gracefulShutdown: () =>
      ipcRenderer.invoke(IPC.SESSION_GRACEFUL_SHUTDOWN) as Promise<Record<string, string>>,
    onResumeUUIDs: (callback: (uuids: Record<string, string>) => void) => {
      const handler = (_: unknown, uuids: Record<string, string>) => callback(uuids)
      ipcRenderer.on('session:resume-uuids', handler)
      return () => ipcRenderer.removeListener('session:resume-uuids', handler)
    },
    onData: (callback: (event: SessionDataEvent) => void) => {
      const handler = (_: unknown, event: SessionDataEvent) => callback(event)
      ipcRenderer.on(IPC.SESSION_DATA, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_DATA, handler)
    },
    onExit: (callback: (event: SessionExitEvent) => void) => {
      const handler = (_: unknown, event: SessionExitEvent) => callback(event)
      ipcRenderer.on(IPC.SESSION_EXIT, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_EXIT, handler)
    },
    onFocus: (callback: (event: { sessionId: string }) => void) => {
      const handler = (_: unknown, event: { sessionId: string }) => callback(event)
      ipcRenderer.on(IPC.SESSION_FOCUS, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_FOCUS, handler)
    },
    onIdleToast: (callback: (event: { sessionId?: string | null }) => void) => {
      const handler = (_: unknown, event: { sessionId?: string | null }) => callback(event)
      ipcRenderer.on(IPC.SESSION_IDLE_TOAST, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_IDLE_TOAST, handler)
    },
    onActivityStatus: (callback: (event: { sessionId: string; activity: 'running' | 'thinking' | 'idle' | 'completed'; source: 'claude' | 'codex'; ts: number }) => void) => {
      const handler = (_: unknown, event: { sessionId: string; activity: 'running' | 'thinking' | 'idle' | 'completed'; source: 'claude' | 'codex'; ts: number }) => callback(event)
      ipcRenderer.on(IPC.SESSION_ACTIVITY_UPDATE, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_ACTIVITY_UPDATE, handler)
    },
    onStatusUpdate: (callback: (data: { sessionId: string | null; model?: string; contextWindow?: unknown; cost?: unknown; workspace?: unknown }) => void) => {
      const handler = (_: unknown, data: { sessionId: string | null; model?: string; contextWindow?: unknown; cost?: unknown; workspace?: unknown }) => callback(data)
      ipcRenderer.on('agent:status-update', handler)
      return () => ipcRenderer.removeListener('agent:status-update', handler)
    },
    onPermissionRequest: (callback: (event: { id: string; sessionId: string | null; conversationId?: string | null; toolName: string; detail: string; suggestions: string[] }) => void) => {
      const handler = (_: unknown, event: { id: string; sessionId: string | null; conversationId?: string | null; toolName: string; detail: string; suggestions: string[] }) => callback(event)
      ipcRenderer.on(IPC.PERMISSION_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.PERMISSION_REQUEST, handler)
    },
    onPermissionDismiss: (callback: (event: { id: string }) => void) => {
      const handler = (_: unknown, event: { id: string }) => callback(event)
      ipcRenderer.on(IPC.PERMISSION_DISMISS, handler)
      return () => ipcRenderer.removeListener(IPC.PERMISSION_DISMISS, handler)
    },
    respondPermission: (id: string, behavior: 'allow' | 'deny', suggestionIndex?: number) =>
      ipcRenderer.invoke(IPC.PERMISSION_RESPOND, id, behavior, suggestionIndex),
  },

  // ─── FastAgents MCP bridge (Meta-Agent) ───
  mcp: {
    onListSessionsRequest: (callback: (req: { requestId: string }) => void) => {
      const handler = (_: unknown, req: { requestId: string }) => callback(req)
      ipcRenderer.on(IPC.MCP_LIST_SESSIONS_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.MCP_LIST_SESSIONS_REQUEST, handler)
    },
    respondListSessions: (payload: { requestId: string; sessions: McpSessionInfo[] }) =>
      ipcRenderer.send(IPC.MCP_LIST_SESSIONS_RESPONSE, payload),
    onCreateSessionRequest: (callback: (req: McpCreateSessionRequest) => void) => {
      const handler = (_: unknown, req: McpCreateSessionRequest) => callback(req)
      ipcRenderer.on(IPC.MCP_CREATE_SESSION_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.MCP_CREATE_SESSION_REQUEST, handler)
    },
    respondCreateSession: (payload: McpCreateSessionResponse) =>
      ipcRenderer.send(IPC.MCP_CREATE_SESSION_RESPONSE, payload),
  },

  sessionHistory: {
    list: () =>
      ipcRenderer.invoke(IPC.SESSION_HISTORY_LIST) as Promise<HistoricalSessionListResult>,
    delete: (paths: string[]) =>
      ipcRenderer.invoke(IPC.SESSION_HISTORY_DELETE, paths) as Promise<HistoricalSessionDeleteResult>,
  },

  claudeGui: {
    start: (options: ClaudeGuiRequestOptions) =>
      ipcRenderer.invoke(IPC.CLAUDE_GUI_START, options) as Promise<void>,
    stop: () => ipcRenderer.invoke(IPC.CLAUDE_GUI_STOP) as Promise<void>,
    optimizePrompt: (options: ClaudePromptOptimizeOptions) =>
      ipcRenderer.invoke(IPC.CLAUDE_PROMPT_OPTIMIZE, options) as Promise<ClaudePromptOptimizeResult>,
    reviewDiff: (options: ClaudeDiffReviewOptions) =>
      ipcRenderer.invoke(IPC.CLAUDE_DIFF_REVIEW, options) as Promise<ClaudeDiffReviewResult>,
    exportConversation: (options: {
      suggestedName: string
      extension: 'md' | 'json'
      content: string
    }) => ipcRenderer.invoke(IPC.CLAUDE_GUI_EXPORT, options) as Promise<boolean>,
    listSkills: (cwd: string) =>
      ipcRenderer.invoke(IPC.CLAUDE_GUI_LIST_SKILLS, cwd) as Promise<ClaudeGuiSkillCatalogEntry[]>,
    fetchUsage: () =>
      ipcRenderer.invoke(IPC.CLAUDE_GUI_FETCH_USAGE) as Promise<ClaudeUtilization>,
    fetchContext: (payload: { cwd: string; sessionStartedAt?: number }) =>
      ipcRenderer.invoke(IPC.CLAUDE_CODE_FETCH_CONTEXT, payload) as Promise<ClaudeCodeContext>,
    fetchLocalUsage: () =>
      ipcRenderer.invoke(IPC.CLAUDE_CODE_FETCH_LOCAL_USAGE) as Promise<ClaudeCodeLocalUsage>,
    onEvent: (callback: (event: ClaudeGuiEvent) => void) => {
      const handler = (_: unknown, event: ClaudeGuiEvent) => callback(event)
      ipcRenderer.on(IPC.CLAUDE_GUI_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.CLAUDE_GUI_EVENT, handler)
    },
  },

  updater: {
    check: () => ipcRenderer.invoke(IPC.UPDATER_CHECK) as Promise<void>,
    download: () => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD) as Promise<void>,
    install: () => ipcRenderer.invoke(IPC.UPDATER_INSTALL) as Promise<void>,
    onEvent: (callback: (event: UpdaterEvent) => void) => {
      const handler = (_: unknown, event: UpdaterEvent) => callback(event)
      ipcRenderer.on(IPC.UPDATER_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.UPDATER_EVENT, handler)
    },
  },

  notification: {
    show: (options: { title: string; body?: string; sessionId?: string; projectId?: string }) =>
      ipcRenderer.invoke(IPC.NOTIFICATION_SHOW, options),
    onClick: (callback: (data: { sessionId?: string; projectId?: string }) => void) => {
      const handler = (_: unknown, data: { sessionId?: string; projectId?: string }) =>
        callback(data)
      ipcRenderer.on(IPC.NOTIFICATION_CLICK, handler)
      return () => ipcRenderer.removeListener(IPC.NOTIFICATION_CLICK, handler)
    },
  },

  git: {
    getStatus: (path: string) => ipcRenderer.invoke('git:get-status', path) as Promise<{
      current: string
      branches: string[]
      isDirty: boolean
    }>,
    init: (path: string) => ipcRenderer.invoke('git:init', path) as Promise<void>,
    createBranch: (path: string, name: string) => ipcRenderer.invoke('git:create-branch', path, name) as Promise<void>,
    checkoutBranch: (path: string, name: string) => ipcRenderer.invoke('git:checkout-branch', path, name) as Promise<void>,
    listWorktrees: (path: string) => ipcRenderer.invoke('git:worktree-list', path) as Promise<Array<{
      path: string
      branch: string
      isMain: boolean
    }>>,
    addWorktree: (cwd: string, path: string, branch: string) => ipcRenderer.invoke('git:worktree-add', cwd, path, branch) as Promise<void>,
    removeWorktree: (cwd: string, path: string) => ipcRenderer.invoke('git:worktree-remove', cwd, path) as Promise<void>,
    status: (path: string) => ipcRenderer.invoke('git:file-status', path) as Promise<Array<{ path: string; status: string; staged: boolean }>>,
    diff: (cwd: string, filePath: string) => ipcRenderer.invoke('git:diff', cwd, filePath) as Promise<string>,
    reviewDiff: (cwd: string) => ipcRenderer.invoke('git:review-diff', cwd) as Promise<string>,
    stage: (cwd: string, filePath: string) => ipcRenderer.invoke('git:stage', cwd, filePath) as Promise<void>,
    unstage: (cwd: string, filePath: string) => ipcRenderer.invoke('git:unstage', cwd, filePath) as Promise<void>,
    commit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message) as Promise<void>,
    discard: (cwd: string, filePath: string) => ipcRenderer.invoke('git:discard', cwd, filePath) as Promise<void>,
    showHead: (cwd: string, filePath: string) => ipcRenderer.invoke('git:show-head', cwd, filePath) as Promise<string>,
  },

  ai: {
    chat: (options: { baseUrl: string; apiKey: string; model: string; provider: string; messages: Array<{ role: string; content: string }>; maxTokens?: number }) =>
      ipcRenderer.invoke('ai:chat', options) as Promise<{ content: string; tokens?: number; error?: string }>,
  },

  opencode: {
    request: (payload: OpencodeRequest) =>
      ipcRenderer.invoke('opencode:request', payload) as Promise<unknown>,
    listModels: (directory: string) =>
      ipcRenderer.invoke('opencode:list-models', directory) as Promise<string[]>,
    subscribe: async (
      payload: OpencodeSubscriptionRequest,
      callback: (event: { subscriptionId: string; type: 'event' | 'error'; event?: unknown; error?: string }) => void,
    ) => {
      const subscriptionId = await ipcRenderer.invoke('opencode:subscribe', payload) as string
      const handler = (
        _: unknown,
        event: { subscriptionId: string; type: 'event' | 'error'; event?: unknown; error?: string },
      ) => {
        if (event.subscriptionId !== subscriptionId) return
        callback(event)
      }
      ipcRenderer.on('opencode:event', handler)
      return () => {
        ipcRenderer.removeListener('opencode:event', handler)
        void ipcRenderer.invoke('opencode:unsubscribe', subscriptionId)
      }
    },
  },

  ide: {
    selectionChanged: (params: {
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
    }) =>
      ipcRenderer.send('ide:selection-changed', params),
    updateWorkspace: (folders: string[]) => ipcRenderer.send('ide:update-workspace', folders),
    getPort: () => ipcRenderer.invoke('ide:get-port') as Promise<number | null>,
  },

  files: {
    /**
     * Resolve the absolute filesystem path of a File object obtained from a
     * drag-and-drop / file input event. Uses Electron's webUtils (newer) or
     * the legacy File.path property as a fallback.
     */
    getPathForFile: (file: File): string | null => {
      try {
        const legacy = (file as unknown as { path?: string }).path
        if (typeof legacy === 'string' && legacy.length > 0) return legacy
      } catch { /* ignore */ }
      try {
        return webUtils.getPathForFile(file) || null
      } catch {
        return null
      }
    },
  },

  fs: {
    readDir: (path: string) => ipcRenderer.invoke('fs:read-dir', path) as Promise<Array<{ name: string; isDir: boolean }>>,
    readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path) as Promise<string>,
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:write-file', path, content) as Promise<void>,
    createFile: (path: string) => ipcRenderer.invoke('fs:create-file', path) as Promise<void>,
    createDir: (path: string) => ipcRenderer.invoke('fs:create-dir', path) as Promise<void>,
    move: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('fs:move', sourcePath, targetPath) as Promise<void>,
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path) as Promise<void>,
    writeTempFile: (suggestedName: string, content: string, extension = 'txt') =>
      ipcRenderer.invoke('fs:write-temp-file', suggestedName, content, extension) as Promise<string>,
    writeTempDataUrl: (suggestedName: string, dataUrl: string, extension = 'png') =>
      ipcRenderer.invoke('fs:write-temp-data-url', suggestedName, dataUrl, extension) as Promise<string>,
  },

  search: {
    findInFiles: (rootPath: string, query: string, options?: SearchQueryOptions) =>
      ipcRenderer.invoke('search:find-in-files', rootPath, query, options) as Promise<ProjectSearchMatch[]>,
    findFiles: (rootPath: string, query: string, options?: SearchQueryOptions) =>
      ipcRenderer.invoke('search:find-files', rootPath, query, options) as Promise<FileSearchResult[]>,
  },

  media: {
    get: () => ipcRenderer.invoke('media:get') as Promise<{
      title: string
      artist: string
      albumTitle: string
      albumArtist: string
      sourceAppId: string
      trackNumber: number | null
      artwork: string
      status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
    }>,
    command: (cmd: 'play-pause' | 'next' | 'prev') => ipcRenderer.invoke('media:command', cmd),
    onUpdate: (callback: (info: {
      title: string
      artist: string
      albumTitle: string
      albumArtist: string
      sourceAppId: string
      trackNumber: number | null
      artwork: string
      status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
    }) => void) => {
      const handler = (_: unknown, info: {
        title: string
        artist: string
        albumTitle: string
        albumArtist: string
        sourceAppId: string
        trackNumber: number | null
        artwork: string
        status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
      }) => callback(info)
      ipcRenderer.on('media:update', handler)
      return () => ipcRenderer.removeListener('media:update', handler)
    },
  },

  config: {
    read: () =>
      ipcRenderer.invoke('config:read') as Promise<{
        groups: unknown[]
        projects: unknown[]
        sessions: unknown[]
        editors?: unknown[]
        worktrees?: unknown[]
        templates?: unknown[]
        activeTasks?: unknown[]
        ui: Record<string, unknown>
        panes?: Record<string, unknown>
        canvas?: Record<string, unknown>
        claudeGui?: Record<string, unknown>
      }>,
    getAnonymousWorkspace: () =>
      ipcRenderer.invoke('config:get-anonymous-workspace') as Promise<string>,
    write: (key: string, value: unknown) => ipcRenderer.invoke('config:write', key, value),
  },

  overlay: {
    sendToast: (toast: unknown) => ipcRenderer.send('overlay:toast', toast),
    removeToast: (id: string) => ipcRenderer.send('overlay:toast-remove', id),
    sendAction: (action: unknown) => ipcRenderer.send('overlay:action', action),
    setIgnoreMouse: (ignore: boolean) => ipcRenderer.send('overlay:set-ignore-mouse', ignore),
    onToast: (callback: (toast: unknown) => void) => {
      const handler = (_: unknown, toast: unknown) => callback(toast)
      ipcRenderer.on('overlay:toast', handler)
      return () => ipcRenderer.removeListener('overlay:toast', handler)
    },
    onToastRemove: (callback: (id: string) => void) => {
      const handler = (_: unknown, id: string) => callback(id)
      ipcRenderer.on('overlay:toast-remove', handler)
      return () => ipcRenderer.removeListener('overlay:toast-remove', handler)
    },
    onAction: (callback: (action: unknown) => void) => {
      const handler = (_: unknown, action: unknown) => callback(action)
      ipcRenderer.on('overlay:action', handler)
      return () => ipcRenderer.removeListener('overlay:action', handler)
    },
    isOverlay: new URLSearchParams(window.location.search).get('overlay') === 'true',
  },

  detach: {
    create: (
      tabIds: string[],
      title: string,
      sessionData?: unknown[],
      editorData?: unknown[],
      context?: { projectId: string | null; worktreeId: string | null },
      position?: { x: number; y: number },
      size?: { width: number; height: number },
    ) =>
      ipcRenderer.invoke('detach:create', tabIds, title, sessionData ?? [], editorData ?? [], context ?? null, position, size) as Promise<string>,
    minimize: () => ipcRenderer.invoke('detach:minimize'),
    maximize: () => ipcRenderer.invoke('detach:maximize'),
    close: () => ipcRenderer.invoke('detach:close'),
    setPosition: (x: number, y: number) => ipcRenderer.invoke('detach:set-position', x, y),
    onClosed: (callback: (data: {
      id: string
      tabIds: string[]
      sessions: Session[]
      editors: unknown[]
      projectId: string | null
      worktreeId: string | null
    }) => void) => {
      const handler = (_: unknown, data: {
        id: string
        tabIds: string[]
        sessions: Session[]
        editors: unknown[]
        projectId: string | null
        worktreeId: string | null
      }) => callback(data)
      ipcRenderer.on('detach:closed', handler)
      return () => ipcRenderer.removeListener('detach:closed', handler)
    },
    getSessions: (windowId: string) =>
      ipcRenderer.invoke('detach:get-sessions', windowId) as Promise<unknown[]>,
    getEditors: (windowId: string) =>
      ipcRenderer.invoke('detach:get-editors', windowId) as Promise<unknown[]>,
    updateSessionIds: (windowId: string, tabIds: string[]) =>
      ipcRenderer.invoke('detach:update-session-ids', windowId, tabIds),
    updateSessions: (windowId: string, sessions: Session[]) =>
      ipcRenderer.invoke('detach:update-sessions', windowId, sessions),
    updateEditors: (windowId: string, editors: unknown[]) =>
      ipcRenderer.invoke('detach:update-editors', windowId, editors),
    updateContext: (windowId: string, context: { projectId: string | null; worktreeId: string | null }) =>
      ipcRenderer.invoke('detach:update-context', windowId, context),
    registerTabDrag: (token: string, payload: unknown) =>
      ipcRenderer.sendSync('detach:tab-drag-register', token, payload) as boolean,
    claimTabDrag: (token: string, targetWindowId: string) =>
      ipcRenderer.sendSync('detach:tab-drag-claim', token, targetWindowId) as
        | unknown
        | null,
    finishTabDrag: (token: string) =>
      ipcRenderer.sendSync('detach:tab-drag-finish', token) as
        | { claimed: boolean; targetWindowId: string | null }
        | null,
    getActiveTabDrag: () =>
      ipcRenderer.sendSync('detach:tab-drag-get-active') as string | null,
    getWindowId: () => new URLSearchParams(window.location.search).get('windowId') ?? '',
    isDetached: new URLSearchParams(window.location.search).get('detached') === 'true',
    getSessionIds: () => {
      const raw = new URLSearchParams(window.location.search).get('sessionIds') ?? ''
      return raw ? raw.split(',') : []
    },
    getTabIds: () => {
      const raw = new URLSearchParams(window.location.search).get('sessionIds') ?? ''
      return raw ? raw.split(',') : []
    },
    getTitle: () => new URLSearchParams(window.location.search).get('title') ?? 'FastAgents',
  },

  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
