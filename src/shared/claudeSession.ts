import type { SessionType } from './types'

export type ClaudeSessionLaunchMode = 'plain' | 'resume' | 'session-id'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isClaudeSessionUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function buildClaudeCodeArgs(
  type: SessionType,
  mode: ClaudeSessionLaunchMode,
  sessionUUID?: string | null,
): string[] {
  const args = type === 'claude-code-yolo' || type === 'claude-code-yolo-wsl'
    ? ['--dangerously-skip-permissions']
    : []

  if (!isClaudeSessionUuid(sessionUUID)) {
    return args
  }

  if (mode === 'resume') {
    return [...args, '--resume', sessionUUID]
  }

  if (mode === 'session-id') {
    return [...args, '--session-id', sessionUUID]
  }

  return args
}

export function normalizeClaudeSessionPath(path: string, caseInsensitive = true): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')

  return caseInsensitive ? normalized.toLowerCase() : normalized
}

export function isClaudeSessionCwdMatch(
  expectedCwd: string,
  sessionCwd: string,
  caseInsensitive = true,
): boolean {
  const expected = normalizeClaudeSessionPath(expectedCwd, caseInsensitive)
  const actual = normalizeClaudeSessionPath(sessionCwd, caseInsensitive)

  return actual === expected || actual.startsWith(`${expected}/`)
}
