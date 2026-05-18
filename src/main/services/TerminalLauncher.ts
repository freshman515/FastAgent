import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { LaunchAdminTerminalOptions, ShellLaunchResult } from '@shared/types'
import { detectShell } from './ShellDetector'

const execFileAsync = promisify(execFile)
export const ADMIN_RELAUNCH_ARG = '--pragma-desk-admin-relaunch'

export function isCurrentProcessElevated(): boolean {
  if (process.platform !== 'win32') {
    return typeof process.getuid === 'function' ? process.getuid() === 0 : true
  }

  try {
    execFileSync('fltmc.exe', [], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

function powerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function powerShellArray(values: string[]): string {
  if (values.length === 0) return '@()'
  return `@(${values.map(powerShellString).join(', ')})`
}

function quoteCmdValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function buildAdminShellArgs(
  targetPath: string,
  shell: ReturnType<typeof detectShell>,
  initialCommand?: string,
): string[] {
  const command = initialCommand?.trim()
  if (shell.family === 'powershell') {
    const startupCommand = [
      `Set-Location -LiteralPath ${powerShellString(targetPath)}`,
      command,
    ].filter(Boolean).join('; ')
    return [
      ...shell.args,
      '-NoExit',
      '-Command',
      startupCommand,
    ]
  }

  if (shell.family === 'cmd') {
    const cwdCommand = `cd /d ${quoteCmdValue(targetPath)}`
    return ['/K', command ? `${cwdCommand} && ${command}` : cwdCommand]
  }

  if (command) {
    return [...shell.args, '-lc', `${command}; exec bash -i`]
  }

  return shell.args
}

export async function openAdminTerminal(
  targetPath: string,
  options: LaunchAdminTerminalOptions = {},
): Promise<ShellLaunchResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: '管理员终端仅支持 Windows。' }
  }

  if (!targetPath || !existsSync(targetPath)) {
    return { ok: false, error: '目标目录不存在。' }
  }

  const shell = detectShell({
    mode: options.terminalShellMode,
    customCommand: options.terminalShellCommand,
    customArgs: options.terminalShellArgs,
  })
  const args = buildAdminShellArgs(targetPath, shell, options.initialCommand)
  const script = [
    '$ErrorActionPreference = "Stop"',
    `Start-Process -FilePath ${powerShellString(shell.shell)} -ArgumentList ${powerShellArray(args)} -WorkingDirectory ${powerShellString(targetPath)} -Verb RunAs`,
  ].join('; ')

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], { windowsHide: true })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '启动管理员终端失败。',
    }
  }
}

export async function relaunchCurrentApplicationAsAdmin(): Promise<ShellLaunchResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: '管理员启动仅支持 Windows。' }
  }

  const relaunchArgs = [
    ...process.argv.slice(1).filter((arg) => arg !== ADMIN_RELAUNCH_ARG),
    ADMIN_RELAUNCH_ARG,
  ]
  const script = [
    '$ErrorActionPreference = "Stop"',
    `Start-Process -FilePath ${powerShellString(process.execPath)} -ArgumentList ${powerShellArray(relaunchArgs)} -WorkingDirectory ${powerShellString(process.cwd())} -Verb RunAs`,
  ].join('; ')

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], { windowsHide: true })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '以管理员身份重启失败。',
    }
  }
}
