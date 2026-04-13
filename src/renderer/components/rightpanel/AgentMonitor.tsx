import {
  BarChart3,
  Circle,
  Clock,
  Cpu,
  Folder,
  GitBranch,
  Hash,
  Layers3,
  PlaySquare,
  Tag,
  TimerReset,
  Wallet,
  Waypoints,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session, SessionStatus, SessionType } from '@shared/types'
import { SESSION_TYPE_CONFIG } from '@shared/types'
import { cn } from '@/lib/utils'
import { getTerminalBufferText } from '@/hooks/useXterm'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useWorktreesStore } from '@/stores/worktrees'
import { getSessionRuntimeStats, getAgentStatus, onStatusUpdate } from './agentRuntime'

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatRelativeTime(ts: number | null | undefined, now: number): string {
  if (!ts) return '—'
  const diff = Math.max(0, now - ts)
  const s = Math.floor(diff / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

function truncateMiddle(value: string, max = 42): string {
  if (value.length <= max) return value
  const keep = Math.max(8, Math.floor((max - 1) / 2))
  return `${value.slice(0, keep)}…${value.slice(-keep)}`
}

function sanitizeDisplayText(value: string): string {
  return value
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getRecentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => sanitizeDisplayText(line))
    .filter(Boolean)
}

function findLastLine(lines: string[], predicate: (line: string) => boolean): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (predicate(lines[i])) return lines[i]
  }
  return null
}

function extractModel(lines: string[]): string | null {
  const modelPattern = /\b(claude-[a-z0-9.-]+|codex(?:-[a-z0-9.-]+)?|gpt-\d(?:\.\d+)?(?:-[a-z0-9-]+)?|gemini(?:-[a-z0-9.-]+)?|(?:sonnet|opus|haiku)\s*\d*(?:\.\d+)?)\b/i
  const modelLine = findLastLine(lines, (line) => /model/i.test(line) && modelPattern.test(line))
  if (modelLine) {
    const match = modelLine.match(modelPattern)
    if (match) return match[1]
  }

  const fallbackLine = findLastLine(lines, (line) => modelPattern.test(line))
  if (!fallbackLine) return null
  const match = fallbackLine.match(modelPattern)
  return match?.[1] ?? null
}

function extractContext(lines: string[]): string | null {
  const line = findLastLine(
    lines,
    (entry) => /context|compact|remaining|left|window/i.test(entry) && (/%|token/i.test(entry)),
  )
  if (!line) return null

  const percent = line.match(/(\d{1,3})\s*%/)
  if (percent) {
    return `${percent[1]}%`
  }

  return truncateMiddle(line, 38)
}

function extractUsage(lines: string[]): string | null {
  const line = findLastLine(lines, (entry) => /usage|token|cost|spent|\$\s*\d/i.test(entry))
  if (!line) return null

  const compactLine = line.replace(/^\W*usage[:\s-]*/i, '')
  return truncateMiddle(compactLine, 56)
}

function getWorktreeInfo(session: Session, worktrees: ReturnType<typeof useWorktreesStore.getState>['worktrees']): {
  branch: string
  path: string | null
} {
  if (session.worktreeId) {
    const worktree = worktrees.find((item) => item.id === session.worktreeId)
    return {
      branch: worktree?.branch ?? 'unknown',
      path: worktree?.path ?? null,
    }
  }

  const mainWorktree = worktrees.find((item) => item.projectId === session.projectId && item.isMain)
  return {
    branch: mainWorktree?.branch ?? 'main',
    path: mainWorktree?.path ?? null,
  }
}

function getSessionPath(session: Session, projectPath: string | undefined, worktreePath: string | null): string {
  return worktreePath ?? projectPath ?? '—'
}

function getAgentMode(session: Session): string | null {
  if (session.type === 'claude-code' || session.type === 'codex') return 'standard'
  if (session.type === 'claude-code-yolo' || session.type === 'codex-yolo') return 'yolo'
  return null
}

function getStatusLabel(status: SessionStatus): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'idle':
      return 'Idle'
    case 'waiting-input':
      return 'Waiting Input'
    case 'stopped':
      return 'Stopped'
    default:
      return status
  }
}

function getSessionTypeLabel(type: SessionType): string {
  return SESSION_TYPE_CONFIG[type]?.label ?? type
}

/** Parse rate limit info from Claude Code's /usage output or status bar in terminal */
function extractRateLimits(lines: string[]): {
  sessionPercent: number | null
  weekAllPercent: number | null
  weekSonnetPercent: number | null
  extraUsage: string | null
} {
  const result = { sessionPercent: null as number | null, weekAllPercent: null as number | null, weekSonnetPercent: null as number | null, extraUsage: null as string | null }

  for (const line of lines) {
    const lower = line.toLowerCase()
    // Match "/usage" output format
    if (lower.includes('current session') || lower.includes('当前会话')) {
      const m = line.match(/(\d{1,3})\s*%/)
      if (m) result.sessionPercent = parseInt(m[1])
    }
    if ((lower.includes('current week') && lower.includes('all model')) || lower.includes('本周（全部')) {
      const m = line.match(/(\d{1,3})\s*%/)
      if (m) result.weekAllPercent = parseInt(m[1])
    }
    if ((lower.includes('current week') && lower.includes('sonnet')) || lower.includes('本周（sonnet')) {
      const m = line.match(/(\d{1,3})\s*%/)
      if (m) result.weekSonnetPercent = parseInt(m[1])
    }
    if (lower.includes('extra usage') || lower.includes('额外')) {
      const m = line.match(/\$[\d.]+\s*\/\s*\$[\d.]+/)
      if (m) result.extraUsage = m[0]
    }
    // Match status bar format: ● XX% · date
    if (!result.sessionPercent) {
      const statusMatch = line.match(/[●⬤]\s*(\d{1,3})%\s*·\s*\d/)
      if (statusMatch) result.sessionPercent = parseInt(statusMatch[1])
    }
  }
  return result
}

function parsePercent(value: string | null): number | null {
  if (!value) return null
  const match = value.match(/(\d{1,3})\s*%/)
  if (!match) return null
  return Math.max(0, Math.min(100, Number(match[1])))
}

const CARD = 'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3'
const SOFT_CARD = 'rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]'
const SECTION_TITLE = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]'

function Pill({
  children,
  tone = 'default',
  style,
}: {
  children: string
  tone?: 'default' | 'success' | 'accent'
  style?: React.CSSProperties
}): JSX.Element {
  return (
    <span
      style={style}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        tone === 'success' && 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
        tone === 'accent' && 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
        tone === 'default' && 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]',
      )}
    >
      {children}
    </span>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: typeof Clock
  label: string
  value: string
  valueClassName?: string
}): JSX.Element {
  return (
    <div className={cn(SOFT_CARD, 'p-2')}>
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
        <Icon size={11} />
        <span>{label}</span>
      </div>
      <div className={cn('mt-1 text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-primary)]', valueClassName)}>
        {value}
      </div>
    </div>
  )
}

function DetailBlock({
  icon: Icon,
  label,
  value,
  valueClassName,
  children,
}: {
  icon: typeof Cpu
  label: string
  value?: string
  valueClassName?: string
  children?: React.ReactNode
}): JSX.Element {
  return (
    <div className={cn(SOFT_CARD, 'p-2.5')}>
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
        <Icon size={11} />
        <span>{label}</span>
      </div>
      {value && (
        <div className={cn('mt-1 text-[var(--ui-font-xs)] text-[var(--color-text-primary)]', valueClassName)}>
          {value}
        </div>
      )}
      {children}
    </div>
  )
}

function RateLimitBar({ label, percent }: { label: string; percent: number }): JSX.Element {
  const remaining = 100 - percent
  const color = percent >= 90 ? 'var(--color-error)' : percent >= 70 ? 'var(--color-warning)' : 'var(--color-success)'
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[var(--color-text-tertiary)]">{label}</span>
        <span className="text-[10px] font-mono font-semibold" style={{ color }}>
          {remaining}% 剩余
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-surface)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function RateLimitsCard({ rateLimits, sessionPtyId, sessionId }: {
  rateLimits: ReturnType<typeof extractRateLimits>
  sessionPtyId: string | null
  sessionId: string | null
}): JSX.Element {
  const [fetched, setFetched] = useState(false)
  const prevSessionRef = useRef(sessionId)

  // Auto-send /usage once when a Claude session becomes active and we have no data
  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      setFetched(false)
      prevSessionRef.current = sessionId
    }
    if (!fetched && sessionPtyId && rateLimits.sessionPercent === null) {
      setFetched(true)
      // Small delay to let the terminal settle
      const timer = setTimeout(() => {
        window.api.session.write(sessionPtyId, '/usage\r')
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [fetched, sessionPtyId, sessionId, rateLimits.sessionPercent])

  const hasData = rateLimits.sessionPercent !== null || rateLimits.weekAllPercent !== null

  return (
    <div className={CARD}>
      <span className={SECTION_TITLE}>Rate Limits</span>
      {hasData ? (
        <div className="mt-3 flex flex-col gap-2.5">
          {rateLimits.sessionPercent !== null && (
            <RateLimitBar label="5小时窗口" percent={rateLimits.sessionPercent} />
          )}
          {rateLimits.weekAllPercent !== null && (
            <RateLimitBar label="周窗口（全部模型）" percent={rateLimits.weekAllPercent} />
          )}
          {rateLimits.weekSonnetPercent !== null && (
            <RateLimitBar label="周窗口（Sonnet）" percent={rateLimits.weekSonnetPercent} />
          )}
          {rateLimits.extraUsage && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--color-text-tertiary)]">额外用量</span>
              <span className="font-mono text-[var(--color-warning)]">{rateLimits.extraUsage}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
          正在获取额度信息...
        </div>
      )}
    </div>
  )
}

export function AgentMonitor(): JSX.Element {
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const setPaneActiveSession = usePanesStore((s) => s.setPaneActiveSession)
  const setActivePaneId = usePanesStore((s) => s.setActivePaneId)
  const activeSessionId = usePanesStore((s) => s.paneActiveSession[activePaneId] ?? null)
  const activeSession = useSessionsStore((s) => s.sessions.find((x) => x.id === activeSessionId))
  const allSessions = useSessionsStore((s) => s.sessions)
  const projects = useProjectsStore((s) => s.projects)
  const worktrees = useWorktreesStore((s) => s.worktrees)

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const selectedProjectSessions = useMemo(() => {
    if (!activeSession) return []
    return [...allSessions]
      .filter((session) => session.projectId === activeSession.projectId)
      .sort((a, b) => {
        if (a.id === activeSessionId) return -1
        if (b.id === activeSessionId) return 1
        if (a.status === 'running' && b.status !== 'running') return -1
        if (b.status === 'running' && a.status !== 'running') return 1
        return b.updatedAt - a.updatedAt
      })
  }, [activeSession, activeSessionId, allSessions])

  const stats = getSessionRuntimeStats(activeSessionId)
  const recentTerminalText = activeSessionId ? getTerminalBufferText(activeSessionId, 120) : ''
  const recentLines = useMemo(() => getRecentLines(recentTerminalText), [recentTerminalText])

  const project = activeSession
    ? projects.find((item) => item.id === activeSession.projectId)
    : undefined
  const worktreeInfo = activeSession ? getWorktreeInfo(activeSession, worktrees) : null
  const cwd = activeSession ? getSessionPath(activeSession, project?.path, worktreeInfo?.path ?? null) : '—'
  const uptime = activeSession && activeSession.status !== 'stopped' && activeSession.createdAt
    ? formatDuration(now - activeSession.createdAt)
    : '—'
  // Subscribe to hook-based status updates
  const [, setStatusTick] = useState(0)
  useEffect(() => onStatusUpdate(() => setStatusTick((t) => t + 1)), [])

  const hookStatus = getAgentStatus(activeSessionId)
  // Prefer hook data, fallback to terminal text parsing
  const model = hookStatus?.model ?? extractModel(recentLines)
  const contextRemaining = hookStatus?.contextWindow
    ? `${hookStatus.contextWindow.percentage}% (${Math.round(hookStatus.contextWindow.used / 1000)}k/${Math.round(hookStatus.contextWindow.total / 1000)}k)`
    : extractContext(recentLines)
  const contextPercent = hookStatus?.contextWindow?.percentage ?? parsePercent(contextRemaining)
  const usage = hookStatus?.cost
    ? `Session: ${hookStatus.cost.session} · Total: ${hookStatus.cost.total}`
    : extractUsage(recentLines)
  const mode = activeSession ? getAgentMode(activeSession) : null
  const rateLimits = useMemo(() => extractRateLimits(recentLines), [recentLines])
  const runningCount = selectedProjectSessions.filter((session) => session.status === 'running').length
  const sameWorktreeCount = activeSession
    ? selectedProjectSessions.filter((session) => (session.worktreeId ?? null) === (activeSession.worktreeId ?? null)).length
    : 0

  if (!activeSession) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">无活跃会话</span>
      </div>
    )
  }

  const showAgentSpecific = activeSession.type !== 'terminal'
  const showClaudeSpecific = activeSession.type === 'claude-code' || activeSession.type === 'claude-code-yolo'

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className={CARD}>
        <div className="flex items-start gap-3">
          <Circle
            size={10}
            fill={activeSession.status === 'running' ? 'var(--color-success)' : 'var(--color-text-tertiary)'}
            className={cn(
              'mt-1 shrink-0',
              activeSession.status === 'running' ? 'text-[var(--color-success)] animate-pulse' : 'text-[var(--color-text-tertiary)]',
            )}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
                {activeSession.name}
              </span>
              {activeSession.color && (
                <div
                  className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: activeSession.color }}
                />
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone={activeSession.status === 'running' ? 'success' : 'default'}>
                {getStatusLabel(activeSession.status)}
              </Pill>
              <Pill>{getSessionTypeLabel(activeSession.type)}</Pill>
              {mode && <Pill>{mode}</Pill>}
              <Pill>{worktreeInfo?.branch ?? 'main'}</Pill>
              {model && <Pill tone="accent">{model}</Pill>}
              {activeSession.label && (
                <Pill
                  style={{
                    backgroundColor: `${activeSession.color ?? '#5e5e66'}20`,
                    color: activeSession.color ?? 'var(--color-text-secondary)',
                  }}
                >
                  {activeSession.label}
                </Pill>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <MetricTile icon={Clock} label="Uptime" value={uptime} />
          <MetricTile icon={Hash} label="Inputs" value={String(stats?.inputCount ?? 0)} />
          <MetricTile icon={BarChart3} label="Output" value={formatBytes(stats?.outputBytes ?? 0)} />
          <MetricTile icon={TimerReset} label="Last Output" value={formatRelativeTime(stats?.lastOutputAt, now)} />
        </div>

        <div className={cn(SOFT_CARD, 'mt-3 p-2.5')}>
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
            <Folder size={11} />
            <span>Path</span>
          </div>
          <div className="mt-1 break-all font-mono text-[11px] leading-5 text-[var(--color-text-primary)]">
            {cwd}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-tertiary)]">
            <span>最后输入 {formatRelativeTime(stats?.lastInputAt, now)}</span>
            <span>最后输出 {formatRelativeTime(stats?.lastOutputAt, now)}</span>
          </div>
        </div>
      </div>

      {showAgentSpecific && (
        <div className={CARD}>
          <div className="flex items-center justify-between gap-3">
            <span className={SECTION_TITLE}>Agent Runtime</span>
            <Pill>{activeSession.resumeUUID ? 'Resume' : 'Fresh'}</Pill>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {mode && <MetricTile icon={PlaySquare} label="Mode" value={mode} />}
            <MetricTile
              icon={Layers3}
              label="Resume ID"
              value={activeSession.resumeUUID ? `${activeSession.resumeUUID.slice(0, 8)}…` : 'fresh'}
            />
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <DetailBlock
              icon={Cpu}
              label="Model"
              value={model ?? 'Waiting for runtime metadata'}
              valueClassName="font-mono"
            />

            {showClaudeSpecific && (
              <DetailBlock
                icon={Waypoints}
                label="Context"
                value={contextRemaining ?? 'No context snapshot yet'}
                valueClassName="font-mono"
              >
                {contextPercent !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-surface)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
                      style={{ width: `${contextPercent}%` }}
                    />
                  </div>
                )}
              </DetailBlock>
            )}

            <DetailBlock
              icon={Wallet}
              label="Usage"
              value={usage ?? 'No usage data yet'}
              valueClassName="break-words font-mono leading-5"
            />
          </div>
        </div>
      )}

      {/* Rate Limits — auto-fetch on mount */}
      {showClaudeSpecific && (
        <RateLimitsCard
          rateLimits={rateLimits}
          sessionPtyId={activeSession?.ptyId ?? null}
          sessionId={activeSessionId}
        />
      )}

      <div className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className={SECTION_TITLE}>Project Overview</div>
            <div className="mt-1 truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
              {project?.name ?? '—'}
            </div>
          </div>
          <Pill>{worktreeInfo?.branch ?? 'main'}</Pill>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <MetricTile icon={PlaySquare} label="Running" value={String(runningCount)} />
          <MetricTile icon={Layers3} label="Sessions" value={String(selectedProjectSessions.length)} />
          <MetricTile icon={GitBranch} label="Same WT" value={String(sameWorktreeCount)} />
        </div>

        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
            Project Sessions
          </div>
          <div className="flex flex-col gap-1.5">
            {selectedProjectSessions.map((session) => {
              const sessionWorktree = getWorktreeInfo(session, worktrees)
              return (
                <button
                  key={session.id}
                  onClick={() => {
                    setActivePaneId(activePaneId)
                    setPaneActiveSession(activePaneId, session.id)
                  }}
                  className={cn(
                    'flex items-start gap-2 rounded-[var(--radius-sm)] border px-2 py-2 text-left transition-colors',
                    session.id === activeSessionId
                      ? 'border-[var(--color-accent)]/40 bg-[var(--color-bg-surface)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-surface)]',
                  )}
                >
                  <Circle
                    size={7}
                    fill={session.status === 'running' ? 'var(--color-success)' : 'var(--color-text-tertiary)'}
                    className={cn(
                      'mt-1 shrink-0',
                      session.status === 'running' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]',
                    )}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-[var(--ui-font-xs)]',
                          session.id === activeSessionId ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]',
                        )}
                      >
                        {session.name}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-[var(--color-text-tertiary)]">
                      <span>{getSessionTypeLabel(session.type)}</span>
                      <span>{sessionWorktree.branch}</span>
                      <span>{getStatusLabel(session.status)}</span>
                    </div>
                  </div>

                  {session.label && (
                    <span
                      className="shrink-0 rounded px-1 py-px text-[8px] font-medium leading-tight"
                      style={{
                        backgroundColor: `${session.color ?? '#5e5e66'}20`,
                        color: session.color ?? 'var(--color-text-tertiary)',
                      }}
                    >
                      {session.label}
                    </span>
                  )}

                  {!session.label && session.color && (
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: session.color }} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
