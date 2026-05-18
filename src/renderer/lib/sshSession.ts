import { parseCustomSessionArgs } from '@/lib/createSession'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'

export const SSH_NEW_SESSION_OPTION_ID = 'ssh'
export const SSH_SESSION_LABEL = 'SSH'

export const sshSessionIcon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="4" fill="#14213d"/><path d="M8 9.25h8M8 14.75h8M9.75 7.5l-2.5 8.75M16.75 7.5l-2.5 8.75" stroke="#67e8f9" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="2.3" fill="#a78bfa"/></svg>',
)}`

export interface SshConnectionDraft {
  name: string
  host: string
  user: string
  port: string
  identityFile: string
  extraArgs: string
}

export interface CreateSshSessionOptions {
  projectId: string
  worktreeId?: string
  draft: SshConnectionDraft
}

export interface OpenSshConnectionPromptOptions {
  projectId: string
  worktreeId?: string
  onCreated: (sessionId: string) => void
  onCancel?: () => void
}

interface NormalizedSshConnection {
  args: string[]
  name: string
}

export const DEFAULT_SSH_CONNECTION_DRAFT: SshConnectionDraft = {
  name: '',
  host: '',
  user: '',
  port: '22',
  identityFile: '',
  extraArgs: '',
}

export function normalizeSshDestination(user: string, host: string): string {
  const trimmedHost = host.trim()
  const trimmedUser = user.trim()
  return trimmedUser ? `${trimmedUser}@${trimmedHost}` : trimmedHost
}

export function validateSshConnectionDraft(draft: SshConnectionDraft): string | null {
  const host = draft.host.trim()
  const user = draft.user.trim()
  const port = draft.port.trim()

  if (!host) return '请输入主机地址'
  if (/\s/.test(host)) return '主机地址不能包含空格'
  if (user && host.includes('@')) return '主机地址里已包含用户名，请清空用户名或移除 @ 前缀'
  if (user && /\s/.test(user)) return '用户名不能包含空格'
  if (port) {
    const portNumber = Number(port)
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return '端口必须是 1-65535 之间的整数'
    }
  }

  return null
}

function normalizeSshConnection(draft: SshConnectionDraft): NormalizedSshConnection {
  const host = draft.host.trim()
  const user = draft.user.trim()
  const port = draft.port.trim()
  const identityFile = draft.identityFile.trim()
  const destination = normalizeSshDestination(user, host)
  const args: string[] = []

  if (port) args.push('-p', port)
  if (identityFile) args.push('-i', identityFile)
  args.push(...parseCustomSessionArgs(draft.extraArgs))
  args.push(destination)

  return {
    args,
    name: draft.name.trim() || `${SSH_SESSION_LABEL} ${destination}`,
  }
}

export function createSshSession(options: CreateSshSessionOptions): string {
  const validationError = validateSshConnectionDraft(options.draft)
  if (validationError) throw new Error(validationError)

  const normalized = normalizeSshConnection(options.draft)
  return useSessionsStore.getState().addSession(
    options.projectId,
    'terminal',
    options.worktreeId,
    normalized.name,
    {
      customSessionLabel: SSH_SESSION_LABEL,
      customSessionIcon: sshSessionIcon,
      customSessionCommand: 'ssh',
      customSessionArgs: normalized.args,
    },
  )
}

export function openSshConnectionPrompt(options: OpenSshConnectionPromptOptions): void {
  useUIStore.getState().setSshConnectionPrompt({
    projectId: options.projectId,
    worktreeId: options.worktreeId,
    onCreated: options.onCreated,
    onCancel: options.onCancel ?? (() => {}),
  })
}
