import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  isClaudeSessionCwdMatch,
  isClaudeSessionUuid,
  type ClaudeSessionLaunchMode,
} from '@shared/claudeSession'

interface ClaudeSessionValidation {
  valid: boolean
  reason?: 'invalid-uuid' | 'not-found' | 'cwd-mismatch'
  sessionFile?: string
  sessionCwd?: string
}

export interface ClaudeSessionLaunchResolution {
  mode: Extract<ClaudeSessionLaunchMode, 'resume' | 'session-id'>
  sessionUUID: string
  replacedUUID: string | null
  replacementReason: ClaudeSessionValidation['reason'] | null
}

function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects')
}

function findClaudeSessionFile(sessionUUID: string): string | null {
  const projectsDir = getClaudeProjectsDir()
  if (!existsSync(projectsDir)) return null

  try {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const sessionFile = join(projectsDir, entry.name, `${sessionUUID}.jsonl`)
      if (existsSync(sessionFile)) return sessionFile
    }
  } catch {
    return null
  }

  return null
}

function readClaudeSessionCwd(sessionFile: string): string | null {
  try {
    const lines = readFileSync(sessionFile, 'utf-8').split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      const parsed = JSON.parse(line) as { cwd?: unknown }
      if (typeof parsed.cwd === 'string' && parsed.cwd) return parsed.cwd
    }
  } catch {
    return null
  }

  return null
}

export function validateClaudeSessionForCwd(
  sessionUUID: unknown,
  cwd: string,
): ClaudeSessionValidation {
  if (!isClaudeSessionUuid(sessionUUID)) {
    return { valid: false, reason: 'invalid-uuid' }
  }

  const sessionFile = findClaudeSessionFile(sessionUUID)
  if (!sessionFile) {
    return { valid: false, reason: 'not-found' }
  }

  const sessionCwd = readClaudeSessionCwd(sessionFile)
  if (!sessionCwd || !isClaudeSessionCwdMatch(cwd, sessionCwd, process.platform === 'win32')) {
    return { valid: false, reason: 'cwd-mismatch', sessionFile, sessionCwd: sessionCwd ?? undefined }
  }

  return { valid: true, sessionFile, sessionCwd }
}

export function resolveClaudeSessionLaunch(
  cwd: string,
  resume: boolean | undefined,
  resumeUUID: unknown,
): ClaudeSessionLaunchResolution {
  const requestedUUID = isClaudeSessionUuid(resumeUUID) ? resumeUUID : null

  if (resume && requestedUUID) {
    const validation = validateClaudeSessionForCwd(requestedUUID, cwd)
    if (validation.valid) {
      return {
        mode: 'resume',
        sessionUUID: requestedUUID,
        replacedUUID: null,
        replacementReason: null,
      }
    }

    return {
      mode: 'session-id',
      sessionUUID: randomUUID(),
      replacedUUID: requestedUUID,
      replacementReason: validation.reason ?? null,
    }
  }

  if (requestedUUID) {
    const validation = validateClaudeSessionForCwd(requestedUUID, cwd)
    if (validation.valid || validation.reason === 'not-found') {
      return {
        mode: 'session-id',
        sessionUUID: requestedUUID,
        replacedUUID: null,
        replacementReason: null,
      }
    }

    return {
      mode: 'session-id',
      sessionUUID: randomUUID(),
      replacedUUID: requestedUUID,
      replacementReason: validation.reason ?? null,
    }
  }

  return {
    mode: 'session-id',
    sessionUUID: randomUUID(),
    replacedUUID: null,
    replacementReason: 'invalid-uuid',
  }
}
