import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { SessionCreateOptions, SessionCreateResult } from '@shared/types'

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

  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
