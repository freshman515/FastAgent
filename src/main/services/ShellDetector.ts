import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildClaudeCodeArgs, type ClaudeSessionLaunchMode } from '@shared/claudeSession'
import { isClaudeCodeType, isCodexType, isTerminalSessionType, type SessionType } from '@shared/types'

const isWindows = process.platform === 'win32'

export interface ShellInfo {
  shell: string
  args: string[]
}

export function detectShell(): ShellInfo {
  if (isWindows) {
    return detectWindowsShell()
  }
  return detectUnixShell()
}

function detectWindowsShell(): ShellInfo {
  // Prefer pwsh (PowerShell 7+) over legacy powershell
  const pwshPaths = [
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'PowerShell',
      '7',
      'pwsh.exe',
    ),
  ]

  for (const p of pwshPaths) {
    if (existsSync(p)) {
      return { shell: p, args: ['-NoLogo'] }
    }
  }

  // Try pwsh from PATH
  const comspec = process.env['COMSPEC']
  if (comspec) {
    return { shell: comspec, args: [] }
  }

  return { shell: 'cmd.exe', args: [] }
}

function detectUnixShell(): ShellInfo {
  const userShell = process.env['SHELL']
  if (userShell) {
    return { shell: userShell, args: ['-l'] }
  }

  const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh']
  for (const s of fallbacks) {
    if (existsSync(s)) {
      return { shell: s, args: ['-l'] }
    }
  }

  return { shell: '/bin/sh', args: [] }
}

const CODEX_RESUME_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GEMINI_RESUME_ID_RE = CODEX_RESUME_ID_RE

export interface BuildAgentCommandOptions {
  sessionId?: string
  resume?: boolean
  resumeUUID?: string
  claudeLaunchMode?: ClaudeSessionLaunchMode
  /** Codex rollout id — when present, runs `codex resume <id>` (and `--dangerously-bypass-approvals-and-sandbox` for codex-yolo). */
  codexResumeId?: string
  /** Gemini session id — when present, runs `gemini --resume <id>` (and `--yolo` for gemini-yolo). */
  geminiResumeId?: string
}

export function buildAgentCommand(
  type: SessionType,
  options: BuildAgentCommandOptions = {},
): { command: string; args: string[] } | null {
  if (isTerminalSessionType(type) || type === 'claude-gui' || type === 'browser') {
    return null
  }

  if (isClaudeCodeType(type)) {
    const mode = options.claudeLaunchMode ?? (options.resume && options.resumeUUID ? 'resume' : 'plain')
    return { command: 'claude', args: buildClaudeCodeArgs(type, mode, options.resumeUUID) }
  }

  if (isCodexType(type)) {
    const baseArgs = type === 'codex-yolo' || type === 'codex-yolo-wsl'
      ? ['--dangerously-bypass-approvals-and-sandbox']
      : []
    if (options.codexResumeId && CODEX_RESUME_ID_RE.test(options.codexResumeId)) {
      // `codex resume` is a subcommand — it must be the FIRST positional arg,
      // followed by the session id. Flags like `--dangerously-bypass-...` still
      // apply and belong after the subcommand per Codex's CLI parser.
      return { command: 'codex', args: ['resume', options.codexResumeId, ...baseArgs] }
    }
    return { command: 'codex', args: baseArgs }
  }

  if (type === 'gemini' || type === 'gemini-yolo') {
    const baseArgs = type === 'gemini-yolo' ? ['--yolo'] : []
    if (options.geminiResumeId && GEMINI_RESUME_ID_RE.test(options.geminiResumeId)) {
      return { command: 'gemini', args: ['--resume', options.geminiResumeId, ...baseArgs] }
    }
    return { command: 'gemini', args: baseArgs }
  }

  if (type === 'opencode') {
    return { command: 'opencode', args: [] }
  }

  return null
}
