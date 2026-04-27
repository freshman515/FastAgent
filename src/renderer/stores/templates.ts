import { create } from 'zustand'
import type { SessionTemplate, SessionTemplateItem, SessionType } from '@shared/types'
import { generateId } from '@/lib/utils'

const VALID_SESSION_TYPES: SessionType[] = [
  'browser', 'claude-code', 'claude-code-yolo', 'claude-code-wsl', 'claude-code-yolo-wsl', 'claude-gui', 'codex', 'codex-yolo', 'codex-wsl', 'codex-yolo-wsl', 'gemini', 'gemini-yolo', 'opencode', 'terminal', 'terminal-wsl',
]

function sanitizeItem(item: unknown): SessionTemplateItem | null {
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  if (typeof obj.name !== 'string') return null
  if (!VALID_SESSION_TYPES.includes(obj.type as SessionType)) return null
  return {
    type: obj.type as SessionType,
    name: obj.name,
    command: typeof obj.command === 'string' ? obj.command : undefined,
    args: Array.isArray(obj.args) ? obj.args.filter((a): a is string => typeof a === 'string') : undefined,
    env: obj.env && typeof obj.env === 'object' ? obj.env as Record<string, string> : undefined,
    prompt: typeof obj.prompt === 'string' ? obj.prompt : undefined,
  }
}

function sanitizeTemplate(t: unknown): SessionTemplate | null {
  if (!t || typeof t !== 'object') return null
  const obj = t as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return null
  if (!Array.isArray(obj.items)) return null
  const items = obj.items.map(sanitizeItem).filter((i): i is SessionTemplateItem => i !== null)
  if (items.length === 0) return null
  return {
    id: obj.id,
    name: obj.name,
    projectId: typeof obj.projectId === 'string' ? obj.projectId : null,
    items,
  }
}

function persist(templates: SessionTemplate[]): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('templates', templates)
}

interface TemplatesState {
  templates: SessionTemplate[]
  _loaded: boolean
  _loadFromConfig: (raw: unknown[]) => void
  addTemplate: (name: string, projectId: string | null, items: SessionTemplateItem[]) => string
  removeTemplate: (id: string) => void
  updateTemplate: (id: string, updates: Partial<Omit<SessionTemplate, 'id'>>) => void
}

export const useTemplatesStore = create<TemplatesState>((set) => ({
  templates: [],
  _loaded: false,

  _loadFromConfig: (raw) => {
    const templates = (Array.isArray(raw) ? raw : [])
      .map(sanitizeTemplate)
      .filter((t): t is SessionTemplate => t !== null)
    set({ templates, _loaded: true })
  },

  addTemplate: (name, projectId, items) => {
    const id = generateId()
    const template: SessionTemplate = { id, name, projectId, items }
    set((state) => {
      const templates = [...state.templates, template]
      persist(templates)
      return { templates }
    })
    return id
  },

  removeTemplate: (id) =>
    set((state) => {
      const templates = state.templates.filter((t) => t.id !== id)
      persist(templates)
      return { templates }
    }),

  updateTemplate: (id, updates) =>
    set((state) => {
      const templates = state.templates.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      )
      persist(templates)
      return { templates }
    }),
}))
