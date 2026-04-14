import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClaudeUtilization } from '@shared/types'

/**
 * Polls the Anthropic `/api/oauth/usage` endpoint (via the main-process IPC)
 * and exposes the current Claude subscription usage.
 *
 * Enabled only when `active === true` so tabs that have no Claude session
 * don't waste quota on pointless polls. Refresh interval defaults to 5
 * minutes — the API updates roughly at that cadence anyway.
 */
export interface ClaudeUsageSnapshot {
  data: ClaudeUtilization | null
  loading: boolean
  fetchedAt: number | null
  refresh: () => Promise<void>
}

const DEFAULT_POLL_MS = 5 * 60 * 1000 // 5 minutes

// Module-level cache shared across all hook consumers. Avoids duplicate
// network calls when multiple components (status bar + usage panel) both
// want the data.
let cached: ClaudeUtilization | null = null
let cachedAt: number | null = null
let inflight: Promise<ClaudeUtilization> | null = null
const subscribers = new Set<() => void>()

function notify(): void {
  for (const cb of subscribers) cb()
}

async function fetchNow(): Promise<ClaudeUtilization> {
  if (inflight) return inflight
  inflight = window.api.claudeGui.fetchUsage()
    .then((data) => {
      cached = data
      cachedAt = Date.now()
      notify()
      return data
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** External trigger — call after events that likely changed usage (request
 * completion, etc.) so the status bar updates without waiting for the next
 * poll tick. Safe to call from anywhere; dedups via the inflight guard. */
export function refreshClaudeUsage(): Promise<ClaudeUtilization> {
  return fetchNow()
}

export function useClaudeUsage(options: { active: boolean; pollMs?: number } = { active: true }): ClaudeUsageSnapshot {
  const { active, pollMs = DEFAULT_POLL_MS } = options
  const [, forceRender] = useState(0)
  const loadingRef = useRef(false)

  // Subscribe to cache updates
  useEffect(() => {
    const tick = (): void => forceRender((n) => n + 1)
    subscribers.add(tick)
    return () => { subscribers.delete(tick) }
  }, [])

  // Active polling
  useEffect(() => {
    if (!active) return
    let cancelled = false

    const run = async (): Promise<void> => {
      loadingRef.current = true
      forceRender((n) => n + 1)
      try {
        await fetchNow()
      } catch {
        // Errors surface via the `data.error` field in ClaudeUtilization
      } finally {
        if (!cancelled) {
          loadingRef.current = false
          forceRender((n) => n + 1)
        }
      }
    }

    // Fetch on activation if the cache is stale (older than half the poll interval)
    const staleThreshold = Date.now() - pollMs / 2
    if (!cachedAt || cachedAt < staleThreshold) {
      void run()
    }

    const timer = setInterval(() => { void run() }, pollMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, pollMs])

  const refresh = useCallback(async (): Promise<void> => {
    loadingRef.current = true
    forceRender((n) => n + 1)
    try {
      await fetchNow()
    } finally {
      loadingRef.current = false
      forceRender((n) => n + 1)
    }
  }, [])

  return {
    data: cached,
    loading: loadingRef.current,
    fetchedAt: cachedAt,
    refresh,
  }
}
