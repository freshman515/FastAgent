import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import { buildClaudeCodeArgs, type ClaudeSessionLaunchMode } from '@shared/claudeSession'
import { isClaudeCodeType, isCodexType, isTerminalSessionType, type SessionType, type TerminalShellAvailability, type TerminalShellMode } from '@shared/types'

const isWindows = process.platform === 'win32'

export interface ShellInfo {
  shell: string
  args: string[]
  family: 'powershell' | 'cmd' | 'posix'
}

export interface ShellDetectionOptions {
  mode?: TerminalShellMode
  customCommand?: string
  customArgs?: string[]
}

export function detectShell(options: ShellDetectionOptions = {}): ShellInfo {
  if (isWindows) {
    return detectWindowsShell(options)
  }
  return detectUnixShell()
}

function findOnPath(command: string): string | null {
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  const pathExts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean)
  const hasExt = /\.[A-Za-z0-9]+$/.test(command)

  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    const candidates = hasExt
      ? [join(dir, command)]
      : pathExts.map((ext) => join(dir, `${command}${ext}`))
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }

  return null
}

function inferWindowsShellFamily(shell: string): ShellInfo['family'] {
  const name = basename(shell).toLowerCase()
  if (name === 'cmd' || name === 'cmd.exe') return 'cmd'
  if (name === 'pwsh' || name === 'pwsh.exe' || name === 'powershell' || name === 'powershell.exe') return 'powershell'
  if (name === 'bash' || name === 'bash.exe' || name === 'zsh' || name === 'zsh.exe' || name === 'sh' || name === 'sh.exe') return 'posix'
  return 'powershell'
}

function resolvePwshShell(): ShellInfo {
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
      return { shell: p, args: ['-NoLogo'], family: 'powershell' }
    }
  }

  const fromPath = findOnPath('pwsh.exe') ?? findOnPath('pwsh')
  return { shell: fromPath ?? 'pwsh.exe', args: ['-NoLogo'], family: 'powershell' }
}

function resolveWindowsPowerShell(): ShellInfo {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const powershellPath = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return {
    shell: existsSync(powershellPath) ? powershellPath : 'powershell.exe',
    args: ['-NoLogo'],
    family: 'powershell',
  }
}

function resolveCmdShell(): ShellInfo {
  const comspec = process.env['COMSPEC']
  return { shell: comspec || 'cmd.exe', args: [], family: 'cmd' }
}

function resolveGitBashShell(): ShellInfo {
  const gitBashPaths = [
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'bash.exe'),
    join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Git',
      'bin',
      'bash.exe',
    ),
    join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Git',
      'usr',
      'bin',
      'bash.exe',
    ),
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean)

  for (const p of gitBashPaths) {
    if (existsSync(p)) {
      return { shell: p, args: ['--login', '-i'], family: 'posix' }
    }
  }

  const fromPath = findOnPath('bash.exe') ?? findOnPath('bash')
  return { shell: fromPath ?? 'bash.exe', args: ['--login', '-i'], family: 'posix' }
}

export function detectTerminalShellAvailability(mode: TerminalShellMode): TerminalShellAvailability {
  if (!isWindows) {
    const shell = process.env.SHELL
    return shell
      ? { available: true, shell }
      : { available: false, shell: null, reason: '没有找到系统 SHELL 环境变量' }
  }

  if (mode === 'auto') {
    const detected = detectWindowsShell({ mode: 'auto' })
    return { available: true, shell: detected.shell }
  }

  if (mode === 'custom') {
    return { available: true, shell: null }
  }

  const detected = detectWindowsShell({ mode })
  const isPathLike = detected.shell.includes('\\') || detected.shell.includes('/')
  const available = isPathLike ? existsSync(detected.shell) : Boolean(findOnPath(detected.shell))
  if (available) return { available: true, shell: detected.shell }

  const label = mode === 'gitbash'
    ? 'Git Bash'
    : mode === 'pwsh'
      ? 'PowerShell 7'
      : mode === 'powershell'
        ? 'Windows PowerShell'
        : 'CMD'
  return {
    available: false,
    shell: detected.shell,
    reason: `没有找到 ${label}，请先安装或选择其他 Shell。`,
  }
}

function detectWindowsShell(options: ShellDetectionOptions): ShellInfo {
  const mode = options.mode ?? 'auto'

  if (mode === 'custom') {
    const customCommand = options.customCommand?.trim()
    if (customCommand) {
      return {
        shell: customCommand,
        args: options.customArgs ?? [],
        family: inferWindowsShellFamily(customCommand),
      }
    }
  }

  if (mode === 'pwsh') return resolvePwshShell()
  if (mode === 'powershell') return resolveWindowsPowerShell()
  if (mode === 'cmd') return resolveCmdShell()
  if (mode === 'gitbash') return resolveGitBashShell()

  const pwsh = resolvePwshShell()
  if (existsSync(pwsh.shell) || basename(pwsh.shell).toLowerCase() !== 'pwsh.exe') {
    return pwsh
  }

  return resolveCmdShell()
}

function detectUnixShell(): ShellInfo {
  const userShell = process.env['SHELL']
  if (userShell) {
    return { shell: userShell, args: ['-l'], family: 'posix' }
  }

  const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh']
  for (const s of fallbacks) {
    if (existsSync(s)) {
      return { shell: s, args: ['-l'], family: 'posix' }
    }
  }

  return { shell: '/bin/sh', args: [], family: 'posix' }
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
