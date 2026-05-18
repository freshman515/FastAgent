import type { LaunchAdminTerminalOptions, SessionType } from '@shared/types'
import { useLaunchesStore, type LaunchProfile } from '@/stores/launches'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { parseCustomSessionArgs } from '@/lib/createSession'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { startLaunchCompletionWatcher } from '@/lib/launchCompletionWatcher'

type LaunchShellFamily = 'powershell' | 'cmd' | 'posix'

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

function inferShellFamily(shell: string | null | undefined): LaunchShellFamily {
  const name = shell?.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (name === 'cmd' || name === 'cmd.exe') return 'cmd'
  if (name === 'bash' || name === 'bash.exe' || name === 'zsh' || name === 'zsh.exe' || name === 'sh' || name === 'sh.exe') return 'posix'
  return 'powershell'
}

async function resolveLaunchShellFamily(): Promise<LaunchShellFamily> {
  const settings = useUIStore.getState().settings
  if (settings.terminalShellMode === 'cmd') return 'cmd'
  if (settings.terminalShellMode === 'gitbash') return 'posix'
  if (settings.terminalShellMode === 'pwsh' || settings.terminalShellMode === 'powershell') return 'powershell'
  if (settings.terminalShellMode === 'custom') return inferShellFamily(settings.terminalShellCommand)

  try {
    const availability = await window.api.shell.resolveTerminalShell(settings.terminalShellMode)
    return inferShellFamily(availability.shell)
  } catch {
    return 'powershell'
  }
}

function splitCompletionMarker(marker: string): [string, string] {
  const pivot = Math.ceil(marker.length / 2)
  return [marker.slice(0, pivot), marker.slice(pivot)]
}

function appendCompletionMarker(command: string, marker: string, family: LaunchShellFamily): string {
  const [left, right] = splitCompletionMarker(marker)
  if (family === 'cmd') {
    return `${command} & set "__pdLaunchA=${left}" & set "__pdLaunchB=${right}" & echo %__pdLaunchA%%__pdLaunchB%`
  }
  if (family === 'posix') {
    return `${command}; __pdLaunchA='${left}'; __pdLaunchB='${right}'; printf '\\033]1337;PragmaLaunchDone=%s\\a' "$__pdLaunchA$__pdLaunchB"`
  }
  return `${command}; $__pdLaunchA=${quotePowerShellValue(left)}; $__pdLaunchB=${quotePowerShellValue(right)}; Write-Host -NoNewline ([char]27 + ']1337;PragmaLaunchDone=' + ($__pdLaunchA + $__pdLaunchB) + [char]7)`
}

function createCompletionMarker(sessionId: string): string {
  return `PRAGMA_DESK_LAUNCH_DONE_${sessionId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function getAdminTerminalLaunchOptions(initialCommand: string): LaunchAdminTerminalOptions {
  const settings = useUIStore.getState().settings
  return {
    terminalShellMode: settings.terminalShellMode,
    terminalShellCommand: settings.terminalShellMode === 'custom' ? settings.terminalShellCommand : undefined,
    terminalShellArgs: settings.terminalShellMode === 'custom'
      ? parseCustomSessionArgs(settings.terminalShellArgs)
      : undefined,
    initialCommand,
  }
}

function waitAndSubmitCommand(sessionId: string, command: string, completionMarker?: string, attempts = 0): void {
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
    if (!completionMarker) {
      void window.api.session.submit(session.ptyId, command, true)
      return
    }

    startLaunchCompletionWatcher(sessionId, completionMarker)
    void resolveLaunchShellFamily()
      .then((family) => window.api.session.submit(session.ptyId!, appendCompletionMarker(command, completionMarker, family), true))
      .catch(() => window.api.session.submit(session.ptyId!, appendCompletionMarker(command, completionMarker, 'powershell'), true))
    return
  }

  window.setTimeout(() => waitAndSubmitCommand(sessionId, command, completionMarker, attempts + 1), 250)
}

function createEmbeddedLaunchSession(
  profile: LaunchProfile,
  launchCwd: string,
  command: string,
  worktreeId: string | null | undefined,
  focus: boolean,
  sessionType: Extract<SessionType, 'terminal' | 'terminal-admin'>,
  watchCompletion = true,
): string {
  const sessionStore = useSessionsStore.getState()
  const previousActiveSessionId = sessionStore.activeSessionId
  const targetWorktreeId = worktreeId ?? getDefaultWorktreeIdForProject(profile.projectId)
  const sessionId = sessionStore.addSession(profile.projectId, sessionType, targetWorktreeId)
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

  const completionMarker = watchCompletion ? createCompletionMarker(sessionId) : undefined
  window.setTimeout(() => waitAndSubmitCommand(sessionId, command, completionMarker), 300)
  return sessionId
}

async function runAdminLaunchProfile(
  profile: LaunchProfile,
  launchCwd: string,
  command: string,
  worktreeId: string | null | undefined,
  focus: boolean,
): Promise<void> {
  const ui = useUIStore.getState()

  try {
    if (await window.api.shell.isElevated()) {
      const sessionId = createEmbeddedLaunchSession(profile, launchCwd, command, worktreeId, focus, 'terminal-admin', false)
      ui.addToast({
        type: 'success',
        title: '管理员运行已启动',
        body: focus ? profile.name : `${profile.name} 已在后台运行，点击跳转到运行会话。`,
        sessionId,
        projectId: profile.projectId,
        duration: 9000,
      })
      return
    }

    const result = await window.api.shell.openAdminTerminal(launchCwd, getAdminTerminalLaunchOptions(command))
    if (result.ok) {
      ui.addToast({
        type: 'success',
        title: '已打开管理员终端',
        body: profile.name,
        projectId: profile.projectId,
        duration: 5000,
      })
      return
    }

    ui.addToast({
      type: 'error',
      title: '管理员运行启动失败',
      body: result.error ?? '无法打开管理员终端。',
      projectId: profile.projectId,
    })
  } catch (error) {
    ui.addToast({
      type: 'error',
      title: '管理员运行启动失败',
      body: error instanceof Error ? error.message : String(error),
      projectId: profile.projectId,
    })
  }
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
  if (profile.runAsAdmin && window.api.platform === 'win32') {
    void runAdminLaunchProfile(profile, launchCwd, command, worktreeId, focus)
    return null
  }

  return createEmbeddedLaunchSession(profile, launchCwd, command, worktreeId, focus, 'terminal')
}
