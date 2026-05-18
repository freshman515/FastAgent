import type { LaunchAdminTerminalOptions, SessionType } from '@shared/types'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore, type CustomSessionDefinition } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'
import { normalizeSessionTypeForCurrentPlatform } from '@/lib/platformSessionTypes'

export interface CreateSessionOptions {
  projectId: string
  type?: SessionType
  customSessionDefinitionId?: string
  worktreeId?: string
  /** Skip the prompt even when the setting is enabled (for built-in flows like templates / launches that provide their own name). */
  forceName?: string
  /** Bypass the prompt and always use the auto-generated name. */
  skipPrompt?: boolean
}

export function parseCustomSessionArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\' && quote) {
      escaping = true
      continue
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (escaping) current += '\\'
  if (current) args.push(current)
  return args
}

function getCustomSessionDefinition(id: string | undefined, definitions: CustomSessionDefinition[]): CustomSessionDefinition | null {
  if (!id) return null
  return definitions.find((definition) => definition.id === id) ?? null
}

function resolveSessionCwd(projectId: string, worktreeId: string | undefined): string | null {
  const project = useProjectsStore.getState().projects.find((item) => item.id === projectId)
  if (!project) return null

  if (worktreeId) {
    const worktree = useWorktreesStore.getState().worktrees.find(
      (item) => item.id === worktreeId && item.projectId === projectId,
    )
    if (worktree?.path) return worktree.path
  }

  return project.path
}

function getAdminTerminalLaunchOptions(): LaunchAdminTerminalOptions {
  const settings = useUIStore.getState().settings
  return {
    terminalShellMode: settings.terminalShellMode,
    terminalShellCommand: settings.terminalShellMode === 'custom' ? settings.terminalShellCommand : undefined,
    terminalShellArgs: settings.terminalShellMode === 'custom'
      ? parseCustomSessionArgs(settings.terminalShellArgs)
      : undefined,
  }
}

async function openExternalAdminTerminal(projectId: string, worktreeId: string | undefined): Promise<void> {
  const ui = useUIStore.getState()
  const targetPath = resolveSessionCwd(projectId, worktreeId)
  if (!targetPath) {
    ui.addToast({
      type: 'error',
      title: '管理员终端',
      body: '无法找到当前项目目录。',
      projectId,
    })
    return
  }

  ui.addToast({
    type: 'info',
    title: '管理员终端',
    body: '正在请求 Windows 管理员权限。',
    projectId,
    duration: 2200,
  })

  try {
    const result = await window.api.shell.openAdminTerminal(targetPath, getAdminTerminalLaunchOptions())
    if (result.ok) {
      ui.addToast({
        type: 'success',
        title: '已打开管理员终端',
        body: targetPath,
        projectId,
        duration: 2600,
      })
      return
    }

    ui.addToast({
      type: 'error',
      title: '管理员终端启动失败',
      body: result.error ?? '无法打开管理员终端。',
      projectId,
    })
  } catch (error) {
    ui.addToast({
      type: 'error',
      title: '管理员终端启动失败',
      body: error instanceof Error ? error.message : String(error),
      projectId,
    })
  }
}

/**
 * Create a session, optionally showing a naming dialog when
 * settings.promptSessionNameOnCreate is enabled. The new session id is
 * delivered via onCreated so callers can wire it into panes, etc. When the
 * user cancels the dialog, onCreated is not invoked.
 */
export function createSessionWithPrompt(
  options: CreateSessionOptions,
  onCreated: (sessionId: string) => void,
): void {
  const { projectId, worktreeId, forceName, skipPrompt } = options
  const sessions = useSessionsStore.getState()
  const ui = useUIStore.getState()
  const customDefinition = getCustomSessionDefinition(options.customSessionDefinitionId, ui.settings.customSessionDefinitions)
  const type = normalizeSessionTypeForCurrentPlatform(options.type ?? 'terminal')

  const doCreate = (name?: string): void => {
    const id = sessions.addSession(projectId, customDefinition ? 'terminal' : type, worktreeId, name, customDefinition ? {
      customSessionDefinitionId: customDefinition.id,
      customSessionLabel: customDefinition.name,
      customSessionIcon: customDefinition.icon,
      customSessionCommand: customDefinition.command,
      customSessionArgs: parseCustomSessionArgs(customDefinition.args),
    } : undefined)
    onCreated(id)
  }

  const createEmbeddedSession = (): void => {
    if (forceName !== undefined) {
      doCreate(forceName)
      return
    }

    if (skipPrompt || !ui.settings.promptSessionNameOnCreate) {
      doCreate()
      return
    }

    const defaultName = customDefinition
      ? sessions.generateDefaultSessionName(projectId, 'terminal', customDefinition.name)
      : sessions.generateDefaultSessionName(projectId, type)
    ui.setSessionNamePrompt({
      defaultName,
      sessionType: type,
      onSubmit: (name) => doCreate(name),
      onUseDefault: () => doCreate(),
      onCancel: () => {},
    })
  }

  if (!customDefinition && type === 'terminal-admin') {
    void window.api.shell.isElevated()
      .then((elevated) => {
        if (elevated) {
          createEmbeddedSession()
          return
        }
        void openExternalAdminTerminal(projectId, worktreeId)
      })
      .catch(() => {
        void openExternalAdminTerminal(projectId, worktreeId)
      })
    return
  }

  createEmbeddedSession()
}
