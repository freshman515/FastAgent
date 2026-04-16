import { useEffect } from 'react'
import {
  ANONYMOUS_PROJECT_ID,
  type McpCreateSessionRequest,
  type McpSessionInfo,
} from '@shared/types'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { createAgentWorktree } from '@/lib/agent-worktrees'

/**
 * Bridges the FastAgents MCP HTTP server (main process) to the renderer's
 * session / pane stores. The orchestrator can ask the renderer to:
 *
 *   - list all sessions (id / name / type / cwd / pane / hasPty)
 *   - create a new session and attach it to the current active pane
 *
 * Direct PTY operations (read output / write input / wait_for_idle) are
 * served by main-process code without crossing this bridge.
 */
export function useMcpBridge(): void {
  useEffect(() => {
    const offList = window.api.mcp.onListSessionsRequest(({ requestId }) => {
      const infos = collectSessionInfos()
      window.api.mcp.respondListSessions({ requestId, sessions: infos })
    })

    const offCreate = window.api.mcp.onCreateSessionRequest((req) => {
      void handleCreateSession(req)
    })

    return () => {
      offList()
      offCreate()
    }
  }, [])
}

function collectSessionInfos(): McpSessionInfo[] {
  const sessions = useSessionsStore.getState().sessions
  const paneSessions = usePanesStore.getState().paneSessions
  const projects = useProjectsStore.getState().projects
  const worktrees = useWorktreesStore.getState().worktrees

  const sessionToPane = new Map<string, string>()
  for (const [paneId, ids] of Object.entries(paneSessions)) {
    for (const id of ids) sessionToPane.set(id, paneId)
  }

  return sessions.map((s) => {
    const project = projects.find((p) => p.id === s.projectId)
    const worktree = s.worktreeId
      ? worktrees.find((w) => w.id === s.worktreeId)
      : worktrees.find((w) => w.projectId === s.projectId && w.isMain)
    const cwd = s.cwd ?? worktree?.path ?? project?.path ?? null

    return {
      id: s.id,
      name: s.name,
      type: s.type,
      status: s.status,
      cwd,
      projectId: s.projectId,
      worktreeId: s.worktreeId ?? null,
      paneId: sessionToPane.get(s.id) ?? null,
      // Overridden by the orchestrator using the X-FastAgents-Session-Id header.
      isSelf: false,
      hasPty: s.ptyId !== null,
    }
  })
}

async function handleCreateSession(req: McpCreateSessionRequest): Promise<void> {
  try {
    const sessionStore = useSessionsStore.getState()
    const paneStore = usePanesStore.getState()

    // Resolve projectId: explicit > source session's project > anonymous.
    let projectId = req.projectId ?? null
    let worktreeId = req.worktreeId ?? undefined
    let worktreeFallback = false
    let worktreeError: string | undefined

    if (!projectId && req.sourceSessionId) {
      const source = sessionStore.sessions.find((s) => s.id === req.sourceSessionId)
      if (source) {
        projectId = source.projectId
        if (!worktreeId) worktreeId = source.worktreeId
      }
    }

    if (!projectId) projectId = ANONYMOUS_PROJECT_ID

    if (req.isolateWorktree && projectId !== ANONYMOUS_PROJECT_ID) {
      const project = useProjectsStore.getState().projects.find((item) => item.id === projectId)
      if (project) {
        const created = await createAgentWorktree({
          projectId,
          projectPath: project.path,
          label: req.name ?? req.type,
          branchName: req.branchName,
        })
        if (created.worktreeId) {
          worktreeId = created.worktreeId
        }
        worktreeFallback = created.fallback
        worktreeError = created.error
      }
    }

    const sessionId = sessionStore.addSession(projectId, req.type, worktreeId)

    const updates: Parameters<typeof sessionStore.updateSession>[1] = {}
    if (req.name) updates.name = req.name
    // If caller supplied a cwd hint without any project mapping, persist it
    // on the session so useXterm's cwd resolver can fall back to it.
    if (req.cwd && !req.projectId && !req.worktreeId) updates.cwd = req.cwd
    if (Object.keys(updates).length > 0) {
      sessionStore.updateSession(sessionId, updates)
    }

    paneStore.addSessionToPane(paneStore.activePaneId, sessionId)
    if (req.activate !== false) {
      paneStore.setPaneActiveSession(paneStore.activePaneId, sessionId)
    }

    await waitForPty(sessionId, 8000)

    if (req.initialInput) {
      const session = useSessionsStore.getState().sessions.find((s) => s.id === sessionId)
      if (session?.ptyId) {
        await window.api.session.submit(session.ptyId, req.initialInput, true)
      }
    }

    window.api.mcp.respondCreateSession({
      requestId: req.requestId,
      ok: true,
      sessionId,
      worktreeFallback,
      worktreeError,
    })
  } catch (err) {
    window.api.mcp.respondCreateSession({
      requestId: req.requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function waitForPty(sessionId: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const isReady = (): boolean => {
      const s = useSessionsStore.getState().sessions.find((x) => x.id === sessionId)
      return Boolean(s && s.ptyId && s.status === 'running')
    }

    if (isReady()) {
      resolve()
      return
    }

    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`PTY did not start within ${timeoutMs}ms`))
    }, timeoutMs)

    const unsubscribe = useSessionsStore.subscribe(() => {
      if (isReady()) {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    })
  })
}
