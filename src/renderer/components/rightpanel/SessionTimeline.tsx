import { Circle, Play, Square, Terminal, MessageSquare, AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'

export interface TimelineEvent {
  id: string
  sessionId: string
  type: 'start' | 'stop' | 'input' | 'output' | 'error'
  message: string
  timestamp: number
}

// Global timeline store
const timelineEvents: TimelineEvent[] = []
let listeners: Array<() => void> = []

function notify(): void {
  for (const fn of listeners) fn()
}

export function addTimelineEvent(sessionId: string, type: TimelineEvent['type'], message: string): void {
  timelineEvents.push({
    id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    type,
    message,
    timestamp: Date.now(),
  })
  // Keep max 200 events
  if (timelineEvents.length > 200) timelineEvents.splice(0, timelineEvents.length - 200)
  notify()
}

function useTimeline(): TimelineEvent[] {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = (): void => setTick((t) => t + 1)
    listeners.push(fn)
    return () => { listeners = listeners.filter((l) => l !== fn) }
  }, [])
  return timelineEvents
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

const ICON_MAP = {
  start: { icon: Play, color: 'text-[var(--color-success)]' },
  stop: { icon: Square, color: 'text-[var(--color-text-tertiary)]' },
  input: { icon: Terminal, color: 'text-[var(--color-accent)]' },
  output: { icon: MessageSquare, color: 'text-[var(--color-info)]' },
  error: { icon: AlertTriangle, color: 'text-[var(--color-error)]' },
}

export function SessionTimeline(): JSX.Element {
  const events = useTimeline()
  const sessions = useSessionsStore((s) => s.sessions)
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)

  const [filterSession, setFilterSession] = useState<string | 'all'>('all')

  const projectSessions = useMemo(
    () => sessions.filter((session) => session.projectId === selectedProjectId),
    [selectedProjectId, sessions],
  )

  const projectSessionIds = useMemo(
    () => new Set(projectSessions.map((session) => session.id)),
    [projectSessions],
  )

  useEffect(() => {
    if (filterSession !== 'all' && !projectSessionIds.has(filterSession)) {
      setFilterSession('all')
    }
  }, [filterSession, projectSessionIds])

  const filtered = useMemo(() => {
    const projectEvents = events.filter((event) => projectSessionIds.has(event.sessionId))
    const sessionsWithEvents = new Set(projectEvents.map((event) => event.sessionId))
    const snapshotEvents: TimelineEvent[] = projectSessions
      .filter((session) => !sessionsWithEvents.has(session.id))
      .map((session) => ({
        id: `snapshot-${session.id}`,
        sessionId: session.id,
        type: session.status === 'stopped' ? 'stop' : 'start',
        message: session.status === 'stopped'
          ? `Session stopped (${session.type})`
          : `Session running (${session.type})`,
        timestamp: session.updatedAt || session.createdAt,
      }))
    const allProjectEvents = [...projectEvents, ...snapshotEvents]
    const list = filterSession === 'all'
      ? allProjectEvents
      : allProjectEvents.filter((event) => event.sessionId === filterSession)
    return [...list].reverse()
  }, [events, filterSession, projectSessionIds, projectSessions])

  const sessionNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const session of projectSessions) map.set(session.id, session.name)
    return map
  }, [projectSessions])

  return (
    <div className="flex flex-col h-full">
      {/* Filter */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]">
        <select
          value={filterSession}
          onChange={(e) => setFilterSession(e.target.value)}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none"
        >
          <option value="all">当前项目全部会话</option>
          {projectSessions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
            当前项目暂无时间线事件
          </div>
        ) : (
          <div className="flex flex-col gap-0">
            {filtered.map((event) => {
              const { icon: Icon, color } = ICON_MAP[event.type]
              return (
                <div key={event.id} className="flex gap-2 py-1.5 border-b border-[var(--color-border)]/30">
                  <div className="flex flex-col items-center pt-0.5">
                    <Icon size={12} className={color} />
                    <div className="flex-1 w-px bg-[var(--color-border)]/50 mt-1" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] tabular-nums text-[var(--color-text-tertiary)]">{formatTime(event.timestamp)}</span>
                      {filterSession === 'all' && (
                        <span className="text-[10px] text-[var(--color-text-tertiary)] truncate max-w-[80px]">
                          {sessionNames.get(event.sessionId) ?? '?'}
                        </span>
                      )}
                    </div>
                    <p className="text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] break-words mt-0.5">{event.message}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
