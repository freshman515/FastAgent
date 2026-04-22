import type { SessionType } from '@shared/types'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'

export interface CreateSessionOptions {
  projectId: string
  type: SessionType
  worktreeId?: string
  /** Skip the prompt even when the setting is enabled (for built-in flows like templates / launches that provide their own name). */
  forceName?: string
  /** Bypass the prompt and always use the auto-generated name. */
  skipPrompt?: boolean
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
  const { projectId, type, worktreeId, forceName, skipPrompt } = options
  const sessions = useSessionsStore.getState()
  const ui = useUIStore.getState()

  const doCreate = (name?: string): void => {
    const id = sessions.addSession(projectId, type, worktreeId, name)
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

  const defaultName = sessions.generateDefaultSessionName(projectId, type)
  ui.setSessionNamePrompt({
    defaultName,
    sessionType: type,
    onSubmit: (name) => doCreate(name),
    onUseDefault: () => doCreate(),
    onCancel: () => {},
  })
}
