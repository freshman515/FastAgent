import { useEffect, useRef, useState } from 'react'
import type { ClaudeCodeContext } from '@shared/types'

/**
 * Poll the Claude Code session's JSONL transcript (stored under
 * `~/.claude/projects/{sanitized-cwd}/*.jsonl`) and derive the current
 * context-window usage for exactly this session.
 *
 * Cache is keyed by `sessionId` — each tab gets its own cache entry so
 * switching tabs instantly shows the new tab's cached data without blinking.
 * The main-process handler matches the transcript file using the tab's
 * `createdAt` timestamp, so two Claude Code tabs in the same project
 * directory still resolve to the correct transcript each.
 */
const DEFAULT_POLL_MS = 10_000

interface FetchArgs {
  cwd: string
  sessionStartedAt: number
}

interface CacheEntry {
  data: ClaudeCodeContext | null
  fetchedAt: number
  inflight: Promise<ClaudeCodeContext> | null
  subscribers: Set<() => void>
}

const cache = new Map<string, CacheEntry>()

function getEntry(sessionId: string): CacheEntry {
  let entry = cache.get(sessionId)
  if (!entry) {
    entry = { data: null, fetchedAt: 0, inflight: null, subscribers: new Set() }
    cache.set(sessionId, entry)
  }
  return entry
}

async function fetchNow(sessionId: string, args: FetchArgs): Promise<ClaudeCodeContext> {
  const entry = getEntry(sessionId)
  if (entry.inflight) return entry.inflight
  entry.inflight = window.api.claudeGui.fetchContext(args)
    .then((data) => {
      entry.data = data
      entry.fetchedAt = Date.now()
      for (const cb of entry.subscribers) cb()
      return data
    })
    .finally(() => {
      entry.inflight = null
    })
  return entry.inflight
}

export interface ClaudeCodeContextSnapshot {
  data: ClaudeCodeContext | null
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * @param sessionId  Unique id of the Claude Code tab. Passing null disables
 *                   polling entirely (e.g. active tab isn't Claude Code).
 * @param cwd        Project/worktree path the tab runs in.
 * @param startedAt  Tab's `createdAt` — used to pick the right transcript
 *                   when multiple jsonls exist in the same project folder.
 */
export function useClaudeCodeContext(sessionId: string | null, cwd: string | null, startedAt: number | null): ClaudeCodeContextSnapshot {
  const [, forceRender] = useState(0)
  const loadingRef = useRef(false)

  useEffect(() => {
    if (!sessionId) return
    const tick = (): void => forceRender((n) => n + 1)
    const entry = getEntry(sessionId)
    entry.subscribers.add(tick)
    return () => { entry.subscribers.delete(tick) }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || !cwd || !startedAt) return
    let cancelled = false

    const run = async (): Promise<void> => {
      loadingRef.current = true
      forceRender((n) => n + 1)
      try { await fetchNow(sessionId, { cwd, sessionStartedAt: startedAt }) }
      catch { /* surfaces via data.error */ }
      finally {
        if (!cancelled) {
          loadingRef.current = false
          forceRender((n) => n + 1)
        }
      }
    }

    void run()
    const timer = setInterval(() => { void run() }, DEFAULT_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, cwd, startedAt])

  const entry = sessionId ? cache.get(sessionId) : null
  return {
    data: entry?.data ?? null,
    loading: loadingRef.current,
    refresh: async () => {
      if (!sessionId || !cwd || !startedAt) return
      await fetchNow(sessionId, { cwd, sessionStartedAt: startedAt })
    },
  }
}
