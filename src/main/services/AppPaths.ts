import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

let configuredProfileId: string | null = null
let configuredUserDataDir: string | null = null
let configuredSessionDataDir: string | null = null

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\.+$/g, '').trim() || 'workspace'
}

function getWorkspaceProfileId(): string {
  const cwd = process.cwd()
  const workspaceName = sanitizePathSegment(basename(cwd))
  const workspaceHash = createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 8)
  return `${workspaceName}-${workspaceHash}`
}

function getDevProfileDir(): string {
  const override = process.env.FASTAGENTS_USER_DATA_DIR?.trim()
  if (override) return override

  return join(app.getPath('appData'), 'FastAgents Dev', getWorkspaceProfileId())
}

export function configureAppPaths(): void {
  if (configuredProfileId) return

  if (app.isPackaged) {
    configuredProfileId = 'stable'
    configuredUserDataDir = app.getPath('userData')
    configuredSessionDataDir = app.getPath('sessionData')
    return
  }

  const userDataDir = getDevProfileDir()
  const sessionDataDir = process.env.FASTAGENTS_SESSION_DATA_DIR?.trim() || join(userDataDir, 'session-data')

  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(sessionDataDir, { recursive: true })

  app.setPath('userData', userDataDir)
  app.setPath('sessionData', sessionDataDir)

  configuredProfileId = `dev-${getWorkspaceProfileId()}`
  configuredUserDataDir = userDataDir
  configuredSessionDataDir = sessionDataDir

  console.log(`[app-paths] dev userData: ${userDataDir}`)
  console.log(`[app-paths] dev sessionData: ${sessionDataDir}`)
}

export function getAppProfileId(): string {
  return configuredProfileId ?? (app.isPackaged ? 'stable' : `dev-${getWorkspaceProfileId()}`)
}

export function getAppProfileLabel(): string {
  return app.isPackaged ? 'stable' : 'dev'
}

export function getConfiguredUserDataDir(): string {
  return configuredUserDataDir ?? app.getPath('userData')
}

export function getConfiguredSessionDataDir(): string {
  return configuredSessionDataDir ?? app.getPath('sessionData')
}

export function shouldRegisterGlobalAgentConfig(): boolean {
  const override = process.env.FASTAGENTS_REGISTER_GLOBAL_AGENT_CONFIG?.trim()
  if (override === '1' || override?.toLowerCase() === 'true') return true
  if (override === '0' || override?.toLowerCase() === 'false') return false
  return app.isPackaged
}
