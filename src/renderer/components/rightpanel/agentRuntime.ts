export interface SessionRuntimeStats {
  inputCount: number
  outputBytes: number
  lastInputAt: number | null
  lastOutputAt: number | null
}

export interface AgentStatusData {
  model: string | null
  contextWindow: { used: number; total: number; percentage: number } | null
  cost: { total: string; session: string } | null
  workspace: { current_dir: string } | null
  updatedAt: number
}

const runtimeStats = new Map<string, SessionRuntimeStats>()
const statusData = new Map<string, AgentStatusData>()
let statusListeners: Array<() => void> = []

function notifyStatusListeners(): void {
  for (const fn of statusListeners) fn()
}

function ensureRuntime(sessionId: string): SessionRuntimeStats {
  const existing = runtimeStats.get(sessionId)
  if (existing) return existing

  const created: SessionRuntimeStats = {
    inputCount: 0,
    outputBytes: 0,
    lastInputAt: null,
    lastOutputAt: null,
  }
  runtimeStats.set(sessionId, created)
  return created
}

export function trackSessionInput(sessionId: string): void {
  const stats = ensureRuntime(sessionId)
  stats.inputCount++
  stats.lastInputAt = Date.now()
  runtimeStats.set(sessionId, stats)
}

export function trackSessionOutput(sessionId: string, bytes: number): void {
  const stats = ensureRuntime(sessionId)
  stats.outputBytes += bytes
  stats.lastOutputAt = Date.now()
  runtimeStats.set(sessionId, stats)
}

export function getSessionRuntimeStats(sessionId: string | null | undefined): SessionRuntimeStats | undefined {
  if (!sessionId) return undefined
  return runtimeStats.get(sessionId)
}

export function updateAgentStatus(sessionId: string, data: Partial<AgentStatusData>): void {
  const existing = statusData.get(sessionId) ?? {
    model: null, contextWindow: null, cost: null, workspace: null, updatedAt: 0,
  }
  statusData.set(sessionId, { ...existing, ...data, updatedAt: Date.now() })
  notifyStatusListeners()
}

export function getAgentStatus(sessionId: string | null | undefined): AgentStatusData | undefined {
  if (!sessionId) return undefined
  return statusData.get(sessionId)
}

export function onStatusUpdate(fn: () => void): () => void {
  statusListeners.push(fn)
  return () => { statusListeners = statusListeners.filter((l) => l !== fn) }
}
