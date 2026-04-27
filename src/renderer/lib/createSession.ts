import type { SessionType } from '@shared/types'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore, type CustomSessionDefinition } from '@/stores/ui'

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
  const type = options.type ?? 'terminal'

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
