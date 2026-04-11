import { exec, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { EXTERNAL_IDE_OPTIONS, type ExternalIdeId, type ExternalIdeOption, type OpenIdeResult } from '@shared/types'

const execAsync = promisify(exec)

interface IdeLauncherConfig {
  commands: string[]
  windowsPaths: string[]
  wrapperExeRelative?: string[]
  windowsSearches?: Array<{
    root: string
    depth: number
    match: (dirName: string) => boolean
    relativeExe: string[]
  }>
}

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? ''
const PROGRAMFILES = process.env.PROGRAMFILES ?? ''
const PROGRAMFILES_X86 = process.env['PROGRAMFILES(X86)'] ?? ''

const IDE_LAUNCHERS: Record<ExternalIdeId, IdeLauncherConfig> = {
  cursor: {
    commands: ['cursor', 'cursor.cmd', 'cursor.exe'],
    windowsPaths: [
      path.join(LOCALAPPDATA, 'Programs', 'Cursor', 'Cursor.exe'),
    ],
  },
  vscode: {
    commands: ['code', 'code.cmd', 'code.exe'],
    windowsPaths: [
      path.join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
    ],
    wrapperExeRelative: ['..', 'Code.exe'],
  },
  trae: {
    commands: ['trae', 'trae.cmd', 'trae.exe'],
    windowsPaths: [
      path.join(LOCALAPPDATA, 'Programs', 'Trae', 'Trae.exe'),
    ],
    wrapperExeRelative: ['..', 'Trae.exe'],
  },
  rider: {
    commands: ['rider', 'rider64.exe', 'rider.exe'],
    windowsPaths: [
      path.join(LOCALAPPDATA, 'Programs', 'Rider', 'bin', 'rider64.exe'),
      path.join(LOCALAPPDATA, 'Programs', 'Rider', 'bin', 'rider.exe'),
    ],
    windowsSearches: [
      {
        root: path.join(LOCALAPPDATA, 'JetBrains', 'Toolbox', 'apps', 'Rider'),
        depth: 2,
        match: () => true,
        relativeExe: ['bin', 'rider64.exe'],
      },
      {
        root: PROGRAMFILES,
        depth: 1,
        match: (dirName) => /^JetBrains Rider\b/i.test(dirName),
        relativeExe: ['bin', 'rider64.exe'],
      },
      {
        root: PROGRAMFILES_X86,
        depth: 1,
        match: (dirName) => /^JetBrains Rider\b/i.test(dirName),
        relativeExe: ['bin', 'rider64.exe'],
      },
    ],
  },
}

function getPathext(): string[] {
  if (process.platform !== 'win32') return ['']
  const raw = process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM'
  return raw
    .split(';')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function resolveFromPath(command: string): string | null {
  if (!command) return null

  if (path.isAbsolute(command)) {
    return existsSync(command) ? command : null
  }

  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)

  const ext = path.extname(command)
  const suffixes = ext ? [''] : getPathext()

  for (const dir of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, ext ? command : `${command}${suffix}`)
      if (existsSync(candidate)) return candidate
    }
  }

  return null
}

function findExecutableInSearch(root: string, depth: number, match: (dirName: string) => boolean, relativeExe: string[]): string | null {
  if (!root || !existsSync(root)) return null

  const visit = (currentPath: string, remainingDepth: number): string | null => {
    let entries: string[]
    try {
      entries = readdirSync(currentPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return null
    }

    for (const dirName of entries) {
      const fullPath = path.join(currentPath, dirName)
      if (match(dirName)) {
        const candidate = path.join(fullPath, ...relativeExe)
        if (existsSync(candidate)) return candidate
      }
      if (remainingDepth > 0) {
        const nested = visit(fullPath, remainingDepth - 1)
        if (nested) return nested
      }
    }

    return null
  }

  return visit(root, depth)
}

function preferGuiExecutable(launcher: IdeLauncherConfig, resolved: string): string {
  if (!/\.(cmd|bat)$/i.test(resolved) || !launcher.wrapperExeRelative) {
    return resolved
  }

  const candidate = path.resolve(path.dirname(resolved), ...launcher.wrapperExeRelative)
  return existsSync(candidate) ? candidate : resolved
}

function resolveIdeExecutable(ide: ExternalIdeId): string | null {
  const launcher = IDE_LAUNCHERS[ide]
  const candidates = [...launcher.windowsPaths, ...launcher.commands]
  for (const candidate of candidates) {
    const resolved = resolveFromPath(candidate)
    if (resolved) return preferGuiExecutable(launcher, resolved)
  }
  for (const search of launcher.windowsSearches ?? []) {
    const resolved = findExecutableInSearch(search.root, search.depth, search.match, search.relativeExe)
    if (resolved) return resolved
  }
  return null
}

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

async function launchDetached(_launcher: IdeLauncherConfig, executable: string, targetPath: string): Promise<void> {
  if (process.platform === 'win32') {
    const escapedExe = escapePowerShellSingleQuoted(executable)
    const escapedPath = escapePowerShellSingleQuoted(targetPath)
    await execAsync(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Start-Process -FilePath '${escapedExe}' -ArgumentList '${escapedPath}'"`,
      { windowsHide: true },
    )
    return
  }

  await new Promise<void>((resolve, reject) => {
    const isCmdLauncher = /\.(cmd|bat)$/i.test(executable)
    const child = isCmdLauncher
      ? spawn('sh', ['-lc', `${quoteForCmd(executable)} ${quoteForCmd(targetPath)}`], {
          detached: true,
          stdio: 'ignore',
        })
      : spawn(executable, [targetPath], {
          detached: true,
          stdio: 'ignore',
        })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export async function openProjectInIde(ide: ExternalIdeId, targetPath: string): Promise<OpenIdeResult> {
  if (!targetPath || !existsSync(targetPath)) {
    return { ok: false, error: '目标项目路径不存在。' }
  }

  const executable = resolveIdeExecutable(ide)
  if (!executable) {
    return { ok: false, error: '未找到该 IDE，请确认已安装或已加入 PATH。' }
  }

  try {
    await launchDetached(IDE_LAUNCHERS[ide], executable, targetPath)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '启动 IDE 失败。',
    }
  }
}

export function getAvailableIdes(): ExternalIdeOption[] {
  return EXTERNAL_IDE_OPTIONS.filter((option) => resolveIdeExecutable(option.id) !== null)
}
