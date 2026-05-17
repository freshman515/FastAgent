import { useLaunchesStore, type LaunchProfile } from '@/stores/launches'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { focusSessionTarget } from '@/lib/focusSessionTarget'

interface RunLaunchProfileOptions {
  profile: LaunchProfile
  projectPath: string
  worktreeId?: string | null
  focus?: boolean
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

function joinLaunchCwd(basePath: string, relativePath: string): string {
  const trimmedRelative = relativePath.trim()
  if (!trimmedRelative) return basePath
  if (isAbsolutePath(trimmedRelative)) return trimmedRelative

  const separator = basePath.includes('\\') && !basePath.includes('/') ? '\\' : '/'
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${trimmedRelative.replace(/^[\\/]+/, '')}`
}

function quotePowerShellValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function parseLaunchEnv(env: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of env.split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    result[key] = line.slice(eq + 1).trim()
  }
  return result
}

function buildCommand(profile: LaunchProfile): string {
  return [profile.command.trim(), profile.args.trim()].filter(Boolean).join(' ')
}

function buildShellInput(profile: LaunchProfile): string {
  const envMap = parseLaunchEnv(profile.env)
  const envCommands = Object.entries(envMap)
    .map(([key, value]) => `$env:${key}=${quotePowerShellValue(value)}`)
    .join('; ')
  return [envCommands, buildCommand(profile)].filter(Boolean).join('; ')
}

function waitAndSubmitCommand(sessionId: string, command: string, attempts = 0): void {
  if (attempts > 40) {
    useUIStore.getState().addToast({
      type: 'error',
      title: '运行失败',
      body: '终端启动超时，未能发送运行命令。',
    })
    return
  }

  const session = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
  if (session?.ptyId) {
    void window.api.session.submit(session.ptyId, command, true)
    return
  }

  window.setTimeout(() => waitAndSubmitCommand(sessionId, command, attempts + 1), 250)
}

export function runLaunchProfile({ profile, projectPath, worktreeId, focus = true }: RunLaunchProfileOptions): string | null {
  const command = buildShellInput(profile)
  if (!command.trim()) {
    useUIStore.getState().addToast({
      type: 'warning',
      title: '运行命令为空',
      body: '请先设置运行命令。',
    })
    return null
  }

  const launchCwd = joinLaunchCwd(projectPath, profile.cwd)
  const sessionStore = useSessionsStore.getState()
  const previousActiveSessionId = sessionStore.activeSessionId
  const targetWorktreeId = worktreeId ?? getDefaultWorktreeIdForProject(profile.projectId)
  const sessionId = sessionStore.addSession(profile.projectId, 'terminal', targetWorktreeId)
  sessionStore.updateSession(sessionId, {
    name: `${profile.icon} ${profile.name}`.trim(),
    color: profile.color,
    cwd: launchCwd,
  })

  const paneStore = usePanesStore.getState()
  const targetPaneId = paneStore.activePaneId
  const previousPaneActiveSessionId = paneStore.paneActiveSession[targetPaneId] ?? null
  paneStore.addSessionToPane(targetPaneId, sessionId)
  if (focus) {
    paneStore.setPaneActiveSession(targetPaneId, sessionId)
    sessionStore.setActive(sessionId)
  } else {
    paneStore.setPaneActiveSession(targetPaneId, previousPaneActiveSessionId)
    sessionStore.setActive(previousActiveSessionId)
  }
  useLaunchesStore.getState().setProjectRunningSession(profile.projectId, {
    profileId: profile.id,
    sessionId,
    startedAt: Date.now(),
  })
  if (focus) {
    useProjectsStore.getState().selectProject(profile.projectId)
    focusSessionTarget(sessionId)
  }

  window.setTimeout(() => waitAndSubmitCommand(sessionId, command), 300)
  return sessionId
}
