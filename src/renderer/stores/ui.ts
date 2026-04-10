import { create } from 'zustand'
import type { ToastNotification } from '@shared/types'
import { generateId } from '@/lib/utils'

export type VisualizerMode = 'melody' | 'bars'

export interface AppSettings {
  uiFontSize: number
  uiFontFamily: string
  terminalFontSize: number
  terminalFontFamily: string
  visibleGroupId: string | null // null = show all groups
  defaultSessionType: 'claude-code' | 'claude-code-yolo' | 'terminal' | 'codex' | 'codex-yolo' | 'opencode'
  recentPaths: string[]
  visualizerMode: VisualizerMode
  showMusicPlayer: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  uiFontSize: 13,
  uiFontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  terminalFontSize: 18,
  terminalFontFamily: "'JetBrainsMono Nerd Font', ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace",
  visibleGroupId: null,
  defaultSessionType: 'claude-code',
  recentPaths: [],
  visualizerMode: 'melody',
  showMusicPlayer: true,
}

interface UIState {
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void

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
  window.api.config.write('ui', settings)
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarWidth: 260,
  sidebarCollapsed: false,

  setSidebarWidth: (width) => {
    set({ sidebarWidth: width })
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  settings: { ...DEFAULT_SETTINGS },

  _loadSettings: (raw) => {
    const s = { ...DEFAULT_SETTINGS }
    if (raw && typeof raw === 'object') {
      if (typeof raw.uiFontSize === 'number') s.uiFontSize = raw.uiFontSize
      if (typeof raw.uiFontFamily === 'string') s.uiFontFamily = raw.uiFontFamily
      if (typeof raw.terminalFontSize === 'number') s.terminalFontSize = raw.terminalFontSize
      if (typeof raw.terminalFontFamily === 'string') s.terminalFontFamily = raw.terminalFontFamily
      if (raw.visibleGroupId === null || typeof raw.visibleGroupId === 'string') s.visibleGroupId = raw.visibleGroupId as string | null
      if (typeof raw.defaultSessionType === 'string' && ['claude-code', 'claude-code-yolo', 'terminal', 'codex', 'codex-yolo', 'opencode'].includes(raw.defaultSessionType)) s.defaultSessionType = raw.defaultSessionType as AppSettings['defaultSessionType']
      if (Array.isArray(raw.recentPaths)) s.recentPaths = raw.recentPaths.filter((p) => typeof p === 'string').slice(0, 10) as string[]
      if (raw.visualizerMode === 'melody' || raw.visualizerMode === 'bars') s.visualizerMode = raw.visualizerMode
      if (typeof raw.showMusicPlayer === 'boolean') s.showMusicPlayer = raw.showMusicPlayer
      if (typeof raw.sidebarWidth === 'number') set({ sidebarWidth: raw.sidebarWidth })
    }
    set({ settings: s })
    applyUIFont(s)
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
