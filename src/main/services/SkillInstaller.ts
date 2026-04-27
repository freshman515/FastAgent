import { app } from 'electron'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const BUNDLED_SKILLS = ['fastagents-orchestration'] as const
const USER_SKILL_ROOTS = [
  ['.codex', 'skills'],
  ['.claude', 'skills'],
] as const

function resolveBundledSkillPath(skillName: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'skills', skillName)
  }

  const candidates = [
    join(app.getAppPath(), 'resources', 'skills', skillName),
    join(__dirname, '..', '..', '..', 'resources', 'skills', skillName),
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

function installSkillIfMissing(sourcePath: string, targetPath: string): void {
  if (existsSync(targetPath)) return

  mkdirSync(dirname(targetPath), { recursive: true })
  cpSync(sourcePath, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
  })
}

export function installBundledSkills(): void {
  for (const skillName of BUNDLED_SKILLS) {
    const sourcePath = resolveBundledSkillPath(skillName)
    if (!existsSync(sourcePath)) {
      console.warn(`[skills] bundled skill not found: ${sourcePath}`)
      continue
    }

    for (const skillRoot of USER_SKILL_ROOTS) {
      const targetPath = join(homedir(), ...skillRoot, skillName)
      try {
        installSkillIfMissing(sourcePath, targetPath)
      } catch (err) {
        console.warn(`[skills] failed to install ${skillName} to ${targetPath}:`, err)
      }
    }
  }
}
