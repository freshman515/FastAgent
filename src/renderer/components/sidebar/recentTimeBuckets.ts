import type { Session } from '@shared/types'

export type TimeBucketKey = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older'

export interface TimeBucket {
  key: TimeBucketKey
  label: string
  sessions: readonly Session[]
}

const DAY_MS = 24 * 60 * 60 * 1000

const BUCKET_LABELS: Record<TimeBucketKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  older: 'Older',
}

const BUCKET_ORDER: readonly TimeBucketKey[] = [
  'today',
  'yesterday',
  'thisWeek',
  'thisMonth',
  'older',
]

function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function bucketOf(ts: number, startOfToday: number): TimeBucketKey {
  if (ts >= startOfToday) return 'today'
  if (ts >= startOfToday - DAY_MS) return 'yesterday'
  if (ts >= startOfToday - 7 * DAY_MS) return 'thisWeek'
  if (ts >= startOfToday - 30 * DAY_MS) return 'thisMonth'
  return 'older'
}

/**
 * Split sessions into time buckets based on local-day boundaries.
 * Preserves input order within each bucket, so callers should pre-sort by updatedAt desc.
 * Empty buckets are dropped from the result.
 */
export function bucketRecentSessions(
  sessions: readonly Session[],
  now: number = Date.now(),
): TimeBucket[] {
  const startOfToday = startOfLocalDay(now)
  const groups: Record<TimeBucketKey, Session[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    thisMonth: [],
    older: [],
  }
  for (const s of sessions) {
    groups[bucketOf(s.updatedAt, startOfToday)].push(s)
  }
  return BUCKET_ORDER
    .filter((key) => groups[key].length > 0)
    .map((key) => ({ key, label: BUCKET_LABELS[key], sessions: groups[key] }))
}
