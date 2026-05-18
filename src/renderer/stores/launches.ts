import { create } from 'zustand'

export interface LaunchProfile {
  id: string
  projectId: string
  name: string
  command: string
  args: string
  cwd: string        // relative to project path, empty = project root
  env: string         // KEY=VALUE per line
  runAsAdmin: boolean // run with elevated privileges on Windows
  focusOnStart: boolean // focus the created terminal after starting
  icon: string        // emoji or short label
  color: string       // hex color
}

export interface LaunchRunState {
  profileId: string
  sessionId: string
  startedAt: number
}

interface LaunchesState {
  profiles: LaunchProfile[]
  runningByProject: Record<string, LaunchRunState>
  _loaded: boolean
  _loadFromConfig: (raw: unknown[]) => void
  addProfile: (profile: Omit<LaunchProfile, 'id'>) => string
  updateProfile: (id: string, updates: Partial<LaunchProfile>) => void
  removeProfile: (id: string) => void
  setProjectRunningSession: (projectId: string, state: LaunchRunState) => void
  clearProjectRunningSession: (projectId: string, sessionId?: string) => void
  clearRunningSession: (sessionId: string) => void
  getProjectProfiles: (projectId: string) => LaunchProfile[]
}

function persist(profiles: LaunchProfile[]): void {
  if (window.api.detach.isDetached) return
  window.api.config.write('launches', profiles)
}

function sanitize(raw: unknown): LaunchProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.projectId !== 'string' || typeof o.name !== 'string') return null
  return {
    id: o.id,
    projectId: o.projectId,
    name: o.name,
    command: typeof o.command === 'string' ? o.command : '',
    args: typeof o.args === 'string' ? o.args : '',
    cwd: typeof o.cwd === 'string' ? o.cwd : '',
    env: typeof o.env === 'string' ? o.env : '',
    runAsAdmin: o.runAsAdmin === true,
    focusOnStart: o.focusOnStart === true,
    icon: typeof o.icon === 'string' ? o.icon : '▶',
    color: typeof o.color === 'string' ? o.color : '#3ecf7b',
  }
}

export const useLaunchesStore = create<LaunchesState>((set, get) => ({
  profiles: [],
  runningByProject: {},
  _loaded: false,

  _loadFromConfig: (raw) => {
    const profiles = Array.isArray(raw) ? raw.map(sanitize).filter(Boolean) as LaunchProfile[] : []
    set({ profiles, _loaded: true })
  },

  addProfile: (profile) => {
    const id = `launch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const full: LaunchProfile = { ...profile, id }
    set((s) => {
      const profiles = [...s.profiles, full]
      persist(profiles)
      return { profiles }
    })
    return id
  },

  updateProfile: (id, updates) => set((s) => {
    const profiles = s.profiles.map((p) => p.id === id ? { ...p, ...updates } : p)
    persist(profiles)
    return { profiles }
  }),

  removeProfile: (id) => set((s) => {
    const profiles = s.profiles.filter((p) => p.id !== id)
    persist(profiles)
    return { profiles }
  }),

  setProjectRunningSession: (projectId, state) => set((s) => ({
    runningByProject: {
      ...s.runningByProject,
      [projectId]: state,
    },
  })),

  clearProjectRunningSession: (projectId, sessionId) => set((s) => {
    const current = s.runningByProject[projectId]
    if (!current || (sessionId && current.sessionId !== sessionId)) return s
    const { [projectId]: _removed, ...runningByProject } = s.runningByProject
    return { runningByProject }
  }),

  clearRunningSession: (sessionId) => set((s) => {
    let touched = false
    const runningByProject: Record<string, LaunchRunState> = {}
    for (const [projectId, state] of Object.entries(s.runningByProject)) {
      if (state.sessionId === sessionId) {
        touched = true
      } else {
        runningByProject[projectId] = state
      }
    }
    return touched ? { runningByProject } : s
  }),

  getProjectProfiles: (projectId) => get().profiles.filter((p) => p.projectId === projectId),
}))

// Preset templates for common project types
export const LAUNCH_PRESETS: Array<{ name: string; icon: string; color: string; command: string; args: string }> = [
  { name: 'React Dev', icon: '⚛', color: '#61dafb', command: 'npm', args: 'run dev' },
  { name: 'Vite Dev', icon: '⚡', color: '#646cff', command: 'npx', args: 'vite' },
  { name: 'Next.js', icon: '▲', color: '#ffffff', command: 'npx', args: 'next dev' },
  { name: 'npm start', icon: '📦', color: '#cb3837', command: 'npm', args: 'start' },
  { name: 'npm test', icon: '🧪', color: '#f0a23b', command: 'npm', args: 'test' },
  { name: 'npm build', icon: '🔨', color: '#3ecf7b', command: 'npm', args: 'run build' },
  { name: 'dotnet run', icon: '🟣', color: '#512bd4', command: 'dotnet', args: 'run' },
  { name: 'dotnet watch', icon: '🟣', color: '#512bd4', command: 'dotnet', args: 'watch run' },
  { name: 'WPF Debug', icon: '🖼', color: '#68217a', command: 'dotnet', args: 'run --project . --configuration Debug' },
  { name: 'Avalonia', icon: '🅰', color: '#8b44ac', command: 'dotnet', args: 'run' },
  { name: 'Python', icon: '🐍', color: '#3572a5', command: 'python', args: 'main.py' },
  { name: 'Go Run', icon: '🔵', color: '#00add8', command: 'go', args: 'run .' },
  { name: 'Cargo Run', icon: '🦀', color: '#dea584', command: 'cargo', args: 'run' },
  { name: 'Custom', icon: '⚙', color: '#8e8e96', command: '', args: '' },
]
