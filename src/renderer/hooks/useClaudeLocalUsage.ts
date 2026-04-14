import { useEffect, useRef, useState } from 'react'
import type { ClaudeCodeLocalUsage } from '@shared/types'

/**
 * Local-only Claude usage aggregated from `~/.claude/projects/**` JSONL
 * transcripts. Unlike the OAuth `/usage` endpoint, this doesn't touch
 * refresh tokens — immune to the token-rotation conflicts that kept
 * logging the user out. Refreshes every 60 seconds by default.
 */
const DEFAULT_POLL_MS = 60_000

let cached: ClaudeCodeLocalUsage | null = null
let cachedAt: number | null = null
let inflight: Promise<ClaudeCodeLocalUsage> | null = null
const subscribers = new Set<() => void>()

function notify(): void { for (const cb of subscribers) cb() }

async function fetchNow(): Promise<ClaudeCodeLocalUsage> {
  if (inflight) return inflight
  inflight = window.api.claudeGui.fetchLocalUsage()
    .then((data) => { cached = data; cachedAt = Date.now(); notify(); return data })
    .finally(() => { inflight = null })
  return inflight
}

export interface ClaudeLocalUsageSnapshot {
  data: ClaudeCodeLocalUsage | null
  loading: boolean
  fetchedAt: number | null
  refresh: () => Promise<void>
}

export function useClaudeLocalUsage(options: { active: boolean; pollMs?: number } = { active: true }): ClaudeLocalUsageSnapshot {
  const { active, pollMs = DEFAULT_POLL_MS } = options
  const [, forceRender] = useState(0)
  const loadingRef = useRef(false)

  useEffect(() => {
    const tick = (): void => forceRender((n) => n + 1)
    subscribers.add(tick)
    return () => { subscribers.delete(tick) }
  }, [])

  useEffect(() => {
    if (!active) return
    let cancelled = false

    const run = async (): Promise<void> => {
      loadingRef.current = true
      forceRender((n) => n + 1)
      try { await fetchNow() }
      catch { /* soft fail */ }
      finally {
        if (!cancelled) {
          loadingRef.current = false
          forceRender((n) => n + 1)
        }
      }
    }

    if (!cachedAt || cachedAt < Date.now() - pollMs / 2) void run()

    const timer = setInterval(() => { void run() }, pollMs)
    return () => { cancelled = true; clearInterval(timer) }
  }, [active, pollMs])

  return {
    data: cached,
    loading: loadingRef.current,
    fetchedAt: cachedAt,
    refresh: async () => { await fetchNow() },
  }
}
