import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

export function buildAgentCommand(
  type: 'claude-code' | 'claude-code-yolo' | 'claude-gui' | 'codex' | 'codex-yolo' | 'opencode' | 'terminal',
  _sessionId?: string,
  resume?: boolean,
  resumeUUID?: string,
): { command: string; args: string[] } | null {
  if (type === 'terminal' || type === 'claude-gui') {
    return null
  }

  if (type === 'claude-code' || type === 'claude-code-yolo') {
    const baseArgs = type === 'claude-code-yolo' ? ['--dangerously-skip-permissions'] : []
    if (resume && resumeUUID) {
      return { command: 'claude', args: [...baseArgs, '--resume', resumeUUID] }
    }
    return { command: 'claude', args: baseArgs }
  }

  if (type === 'codex') {
    return { command: 'codex', args: [] }
  }

  if (type === 'codex-yolo') {
    return { command: 'codex', args: ['--dangerously-bypass-approvals-and-sandbox'] }
  }

  if (type === 'opencode') {
    return { command: 'opencode', args: [] }
  }

  return null
}
