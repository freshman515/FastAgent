import { create } from 'zustand'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'

export interface EditorTab {
  id: string
  filePath: string
  fileName: string
  language: string
  modified: boolean
  isDiff: boolean           // diff view mode
  originalContent?: string  // for diff: the git HEAD content
  projectId: string
  worktreeId?: string
}

export interface EditorCursorInfo {
  line: number
  column: number
  selection: EditorSelectionInfo | null
  selections: EditorSelectionInfo[]
}

export interface EditorSelectionInfo {
  lines: number
  chars: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  isEmpty: boolean
  text: string
}

export interface EditorNavigationTarget {
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

interface EditorsState {
  tabs: EditorTab[]
  cursorInfo: EditorCursorInfo | null
  lastFocusedTabId: string | null
  navigationTargets: Record<string, EditorNavigationTarget>
  _loadFromConfig: (raw: unknown[]) => void
  upsertTabs: (tabs: EditorTab[]) => void
  openFile: (filePath: string, context?: { projectId?: string | null; worktreeId?: string | null }) => string
  openFileAtLocation: (
    filePath: string,
    location: EditorNavigationTarget,
    context?: { projectId?: string | null; worktreeId?: string | null },
  ) => string
  openDiff: (filePath: string, originalContent: string, context?: { projectId?: string | null; worktreeId?: string | null }) => string
  closeTab: (id: string) => void
  setModified: (id: string, modified: boolean) => void
  setCursorInfo: (info: EditorCursorInfo | null) => void
  setLastFocusedTabId: (id: string | null) => void
  clearNavigationTarget: (id: string) => void
  getTab: (id: string) => EditorTab | undefined
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml', svg: 'xml', xaml: 'xml', axaml: 'xml', yaml: 'yaml', yml: 'yaml',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', sh: 'shell', bash: 'shell',
  sql: 'sql', graphql: 'graphql', toml: 'toml', ini: 'ini',
  dockerfile: 'dockerfile', gitignore: 'plaintext',
  vue: 'html', svelte: 'html', astro: 'html',
  prisma: 'plaintext', env: 'plaintext',
}

export function detectLanguage(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  const ext = lower.split('.').pop() ?? ''
  return EXT_LANG_MAP[ext] ?? 'plaintext'
}

function resolveStoredLanguage(fileName: string, storedLanguage: unknown): string {
  const detectedLanguage = detectLanguage(fileName)
  if (typeof storedLanguage !== 'string') return detectedLanguage
  if (storedLanguage === 'plaintext' && detectedLanguage !== 'plaintext') {
    return detectedLanguage
  }
  return storedLanguage
}

function resolveEditorContext(context?: { projectId?: string | null; worktreeId?: string | null }): { projectId: string; worktreeId?: string } | null {
  const selectedProjectId = useProjectsStore.getState().selectedProjectId
  const selectedWorktree = useWorktreesStore.getState().worktrees.find(
    (worktree) => worktree.id === useWorktreesStore.getState().selectedWorktreeId,
  )

  const projectId = context?.projectId ?? selectedProjectId
  if (!projectId) return null

  const worktreeId = context?.worktreeId ?? (selectedWorktree && !selectedWorktree.isMain && selectedWorktree.projectId === projectId
    ? selectedWorktree.id
    : undefined)

  return {
    projectId,
    worktreeId: worktreeId ?? undefined,
  }
}

export function sanitizeEditorTab(
  raw: unknown,
  fallbackContext?: { projectId: string; worktreeId?: string },
): EditorTab | null {
  if (!raw || typeof raw !== 'object') return null
  const tab = raw as Record<string, unknown>
  const projectId = typeof tab.projectId === 'string' ? tab.projectId : fallbackContext?.projectId
  const worktreeId = typeof tab.worktreeId === 'string' ? tab.worktreeId : fallbackContext?.worktreeId
  if (
    typeof tab.id !== 'string'
    || typeof tab.filePath !== 'string'
    || typeof tab.fileName !== 'string'
    || typeof projectId !== 'string'
  ) {
    return null
  }

  return {
    id: tab.id,
    filePath: tab.filePath,
    fileName: tab.fileName,
    language: resolveStoredLanguage(tab.fileName, tab.language),
    modified: false,
    isDiff: Boolean(tab.isDiff),
    originalContent: typeof tab.originalContent === 'string' ? tab.originalContent : undefined,
    projectId,
    worktreeId,
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(tabs: EditorTab[]): void {
  if (window.api.detach.isDetached) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    window.api.config.write('editors', tabs)
  }, 300)
}

// File type icon mapping
export const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  typescript: { icon: 'TS', color: '#3178c6' },
  typescriptreact: { icon: 'TSX', color: '#3178c6' },
  javascript: { icon: 'JS', color: '#f7df1e' },
  javascriptreact: { icon: 'JSX', color: '#f7df1e' },
  c: { icon: 'C', color: '#5fa0f5' },
  cpp: { icon: 'C++', color: '#659ad2' },
  python: { icon: 'PY', color: '#3572a5' },
  rust: { icon: 'RS', color: '#dea584' },
  go: { icon: 'GO', color: '#00add8' },
  json: { icon: '{}', color: '#f0a23b' },
  markdown: { icon: 'MD', color: '#5fa0f5' },
  css: { icon: 'CSS', color: '#563d7c' },
  scss: { icon: 'SC', color: '#c6538c' },
  html: { icon: '<>', color: '#e34c26' },
  yaml: { icon: 'YML', color: '#cb171e' },
  shell: { icon: 'SH', color: '#3ecf7b' },
  csharp: { icon: 'C#', color: '#68217a' },
  java: { icon: 'JV', color: '#b07219' },
  sql: { icon: 'SQL', color: '#e38c00' },
  xml: { icon: 'XML', color: '#e34c26' },
  plaintext: { icon: 'TXT', color: '#8e8e96' },
}

export const useEditorsStore = create<EditorsState>((set, get) => ({
  tabs: [],
  cursorInfo: null,
  lastFocusedTabId: null,
  navigationTargets: {},

  _loadFromConfig: (raw) => {
    const tabs = Array.isArray(raw)
      ? raw.map(sanitizeEditorTab).filter((tab): tab is EditorTab => tab !== null)
      : []
    set({ tabs, navigationTargets: {} })
  },

  upsertTabs: (incomingTabs) => set((state) => {
    if (incomingTabs.length === 0) return state
    const byId = new Map(state.tabs.map((tab) => [tab.id, tab]))
    for (const tab of incomingTabs) {
      byId.set(tab.id, { ...tab, modified: false })
    }
    const tabs = Array.from(byId.values())
    schedulePersist(tabs)
    return { tabs }
  }),

  openFile: (filePath, context) => {
    const existing = get().tabs.find((t) => t.filePath === filePath && !t.isDiff)
    if (existing) {
      const nextLanguage = resolveStoredLanguage(existing.fileName, existing.language)
      if (nextLanguage !== existing.language) {
        set((state) => {
          const tabs = state.tabs.map((tab) =>
            tab.id === existing.id ? { ...tab, language: nextLanguage } : tab,
          )
          schedulePersist(tabs)
          return { tabs }
        })
      }
      return existing.id
    }

    const resolvedContext = resolveEditorContext(context)
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath
    const id = `editor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const tab: EditorTab = {
      id, filePath, fileName,
      language: detectLanguage(fileName),
      modified: false, isDiff: false,
      projectId: resolvedContext?.projectId ?? 'unknown',
      worktreeId: resolvedContext?.worktreeId,
    }
    set((s) => {
      const tabs = [...s.tabs, tab]
      schedulePersist(tabs)
      return { tabs }
    })
    return id
  },

  openFileAtLocation: (filePath, location, context) => {
    const id = get().openFile(filePath, context)
    set((state) => ({
      navigationTargets: {
        ...state.navigationTargets,
        [id]: location,
      },
    }))
    return id
  },

  openDiff: (filePath, originalContent, context) => {
    // Reuse existing diff tab for same file
    const existing = get().tabs.find((t) => t.filePath === filePath && t.isDiff)
    if (existing) {
      set((s) => {
        const tabs = s.tabs.map((t) => t.id === existing.id ? {
          ...t,
          originalContent,
          language: resolveStoredLanguage(t.fileName, t.language),
        } : t)
        schedulePersist(tabs)
        return { tabs }
      })
      return existing.id
    }

    const resolvedContext = resolveEditorContext(context)
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath
    const id = `editor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const tab: EditorTab = {
      id, filePath, fileName: `${fileName} (diff)`,
      language: detectLanguage(fileName),
      modified: false, isDiff: true, originalContent,
      projectId: resolvedContext?.projectId ?? 'unknown',
      worktreeId: resolvedContext?.worktreeId,
    }
    set((s) => {
      const tabs = [...s.tabs, tab]
      schedulePersist(tabs)
      return { tabs }
    })
    return id
  },

  closeTab: (id) => set((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id)
    schedulePersist(tabs)
    const { [id]: _ignored, ...navigationTargets } = s.navigationTargets
    return { tabs, navigationTargets }
  }),

  setModified: (id, modified) => set((s) => {
    const current = s.tabs.find((t) => t.id === id)
    if (!current || current.modified === modified) return s
    const tabs = s.tabs.map((t) => t.id === id ? { ...t, modified } : t)
    schedulePersist(tabs)
    return { tabs }
  }),

  setCursorInfo: (info) => set({ cursorInfo: info }),

  setLastFocusedTabId: (id) => set({ lastFocusedTabId: id }),

  clearNavigationTarget: (id) => set((state) => {
    if (!state.navigationTargets[id]) return state
    const { [id]: _ignored, ...navigationTargets } = state.navigationTargets
    return { navigationTargets }
  }),

  getTab: (id) => get().tabs.find((t) => t.id === id),
}))
