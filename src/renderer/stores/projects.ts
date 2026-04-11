import { create } from 'zustand'
import type { Project } from '@shared/types'
import { generateId } from '@/lib/utils'

function sanitizeProject(p: unknown): Project | null {
  if (!p || typeof p !== 'object') return null
  const obj = p as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.path !== 'string' || typeof obj.groupId !== 'string')
    return null
  return {
    id: obj.id,
    name: typeof obj.name === 'string' ? obj.name : basename(obj.path),
    path: obj.path,
    groupId: obj.groupId,
  }
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

function persist(projects: Project[]): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('projects', projects)
}

interface ProjectsState {
  projects: Project[]
  selectedProjectId: string | null
  _loaded: boolean
  _loadFromConfig: (raw: unknown[]) => void
  addProject: (path: string, groupId: string) => string
  upsertProject: (project: Project) => void
  removeProject: (id: string) => void
  moveProject: (id: string, toGroupId: string) => void
  selectProject: (id: string | null) => void
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  _loaded: false,

  _loadFromConfig: (raw) => {
    const projects = (Array.isArray(raw) ? raw : [])
      .map(sanitizeProject)
      .filter((p): p is Project => p !== null)
    set({ projects, _loaded: true })
  },

  addProject: (path, groupId) => {
    const id = generateId()
    const newProject: Project = {
      id,
      name: basename(path),
      path,
      groupId,
    }
    set((state) => {
      const projects = [...state.projects, newProject]
      persist(projects)
      return { projects }
    })
    return id
  },

  upsertProject: (project) =>
    set((state) => {
      const existingIndex = state.projects.findIndex((item) => item.id === project.id)
      const projects = existingIndex === -1
        ? [...state.projects, project]
        : state.projects.map((item) => (item.id === project.id ? project : item))
      persist(projects)
      return { projects }
    }),

  removeProject: (id) =>
    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id)
      persist(projects)
      return {
        projects,
        selectedProjectId: state.selectedProjectId === id ? null : state.selectedProjectId,
      }
    }),

  moveProject: (id, toGroupId) =>
    set((state) => {
      const projects = state.projects.map((p) =>
        p.id === id ? { ...p, groupId: toGroupId } : p,
      )
      persist(projects)
      return { projects }
    }),

  selectProject: (id) => set({ selectedProjectId: id }),
}))
