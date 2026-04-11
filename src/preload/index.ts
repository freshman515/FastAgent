import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { Session, SessionCreateOptions, SessionCreateResult } from '@shared/types'

const api = {
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED) as Promise<boolean>,
  },

  dialog: {
    selectFolder: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_FOLDER) as Promise<string | null>,
  },

  shell: {
    openPath: (path: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, path),
  },

  session: {
    create: (options: SessionCreateOptions) =>
      ipcRenderer.invoke(IPC.SESSION_CREATE, options) as Promise<SessionCreateResult>,
    write: (ptyId: string, data: string) => ipcRenderer.invoke(IPC.SESSION_WRITE, ptyId, data),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.SESSION_RESIZE, ptyId, cols, rows),
    kill: (ptyId: string) => ipcRenderer.invoke(IPC.SESSION_KILL, ptyId),
    getReplay: (ptyId: string) =>
      ipcRenderer.invoke(IPC.SESSION_REPLAY, ptyId) as Promise<string>,
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
    onData: (callback: (event: { ptyId: string; data: string }) => void) => {
      const handler = (_: unknown, event: { ptyId: string; data: string }) => callback(event)
      ipcRenderer.on(IPC.SESSION_DATA, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_DATA, handler)
    },
    onExit: (callback: (event: { ptyId: string; exitCode: number }) => void) => {
      const handler = (_: unknown, event: { ptyId: string; exitCode: number }) => callback(event)
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
    onPermissionRequest: (callback: (event: { id: string; sessionId: string | null; toolName: string; detail: string; suggestions: string[] }) => void) => {
      const handler = (_: unknown, event: { id: string; sessionId: string | null; toolName: string; detail: string; suggestions: string[] }) => callback(event)
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
  },

  media: {
    get: () => ipcRenderer.invoke('media:get') as Promise<{
      title: string
      artist: string
      artwork: string
      status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
    }>,
    command: (cmd: 'play-pause' | 'next' | 'prev') => ipcRenderer.invoke('media:command', cmd),
    onUpdate: (callback: (info: { title: string; artist: string; status: string }) => void) => {
      const handler = (_: unknown, info: { title: string; artist: string; status: string }) => callback(info)
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
        ui: Record<string, unknown>
        panes?: Record<string, unknown>
      }>,
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
    create: (sessionIds: string[], title: string, sessionData?: unknown[], position?: { x: number; y: number }, size?: { width: number; height: number }) =>
      ipcRenderer.invoke('detach:create', sessionIds, title, sessionData ?? [], position, size) as Promise<string>,
    minimize: () => ipcRenderer.invoke('detach:minimize'),
    maximize: () => ipcRenderer.invoke('detach:maximize'),
    close: () => ipcRenderer.invoke('detach:close'),
    onClosed: (callback: (data: { id: string; sessionIds: string[]; sessions: Session[] }) => void) => {
      const handler = (_: unknown, data: { id: string; sessionIds: string[]; sessions: Session[] }) => callback(data)
      ipcRenderer.on('detach:closed', handler)
      return () => ipcRenderer.removeListener('detach:closed', handler)
    },
    getSessions: (windowId: string) =>
      ipcRenderer.invoke('detach:get-sessions', windowId) as Promise<unknown[]>,
    updateSessionIds: (windowId: string, sessionIds: string[]) =>
      ipcRenderer.invoke('detach:update-session-ids', windowId, sessionIds),
    updateSessions: (windowId: string, sessions: Session[]) =>
      ipcRenderer.invoke('detach:update-sessions', windowId, sessions),
    getWindowId: () => new URLSearchParams(window.location.search).get('windowId') ?? '',
    isDetached: new URLSearchParams(window.location.search).get('detached') === 'true',
    getSessionIds: () => {
      const raw = new URLSearchParams(window.location.search).get('sessionIds') ?? ''
      return raw ? raw.split(',') : []
    },
    getTitle: () => new URLSearchParams(window.location.search).get('title') ?? 'FastAgents',
  },

  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
