import { Circle, Clock, Cpu, Hash, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

interface SessionStats {
  inputCount: number
  outputBytes: number
}

const sessionStats = new Map<string, SessionStats>()

export function trackSessionInput(sessionId: string): void {
  const stats = sessionStats.get(sessionId) ?? { inputCount: 0, outputBytes: 0 }
  stats.inputCount++
  sessionStats.set(sessionId, stats)
}

export function trackSessionOutput(sessionId: string, bytes: number): void {
  const stats = sessionStats.get(sessionId) ?? { inputCount: 0, outputBytes: 0 }
  stats.outputBytes += bytes
  sessionStats.set(sessionId, stats)
}

const ROW = 'flex items-center justify-between py-1.5'
const LABEL = 'flex items-center gap-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]'
const VALUE = 'text-[var(--ui-font-xs)] font-mono text-[var(--color-text-primary)]'

export function AgentMonitor(): JSX.Element {
  const activeSessionId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const activeSession = useSessionsStore((s) => s.sessions.find((x) => x.id === activeSessionId))
  const allSessions = useSessionsStore((s) => s.sessions)
  const selectedProjectSessions = useMemo(() => {
    if (!activeSession) return []
    return allSessions.filter((s) => s.projectId === activeSession.projectId)
  }, [allSessions, activeSession])

  const running = selectedProjectSessions.filter((s) => s.status === 'running')
  const stopped = selectedProjectSessions.filter((s) => s.status === 'stopped')

  // Live timer
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const uptime = activeSession?.status === 'running' && activeSession.createdAt
    ? formatDuration(now - activeSession.createdAt)
    : '—'

  const stats = activeSessionId ? sessionStats.get(activeSessionId) : undefined

  if (!activeSession) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">No active session</span>
      </div>
    )
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Current session */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
        <div className="flex items-center gap-2 mb-3">
          <Circle
            size={8}
            fill={activeSession.status === 'running' ? 'var(--color-success)' : 'var(--color-text-tertiary)'}
            className={cn(
              activeSession.status === 'running' ? 'text-[var(--color-success)] animate-pulse' : 'text-[var(--color-text-tertiary)]',
            )}
          />
          <span className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)] truncate">{activeSession.name}</span>
        </div>

        <div className="flex flex-col gap-0 divide-y divide-[var(--color-border)]">
          <div className={ROW}>
            <span className={LABEL}><Zap size={12} /> Status</span>
            <span className={cn(VALUE, activeSession.status === 'running' ? 'text-[var(--color-success)]' : '')}>
              {activeSession.status}
            </span>
          </div>
          <div className={ROW}>
            <span className={LABEL}><Clock size={12} /> Uptime</span>
            <span className={cn(VALUE, 'tabular-nums')}>{uptime}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}><Cpu size={12} /> Type</span>
            <span className={VALUE}>{activeSession.type}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}><Hash size={12} /> Inputs</span>
            <span className={VALUE}>{stats?.inputCount ?? 0}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}><Hash size={12} /> Output</span>
            <span className={VALUE}>{stats?.outputBytes ? `${(stats.outputBytes / 1024).toFixed(1)} KB` : '0 KB'}</span>
          </div>
        </div>
      </div>

      {/* Project overview */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
        <span className="text-[var(--ui-font-2xs)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Project Sessions
        </span>
        <div className="mt-2 flex flex-col gap-1">
          {selectedProjectSessions.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-0.5">
              <Circle
                size={6}
                fill={s.status === 'running' ? 'var(--color-success)' : 'var(--color-text-tertiary)'}
                className={s.status === 'running' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}
              />
              <span className={cn(
                'text-[var(--ui-font-xs)] truncate',
                s.id === activeSessionId ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-secondary)]',
              )}>
                {s.name}
              </span>
              {s.color && <div className="h-2 w-2 shrink-0 rounded-full ml-auto" style={{ backgroundColor: s.color }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
