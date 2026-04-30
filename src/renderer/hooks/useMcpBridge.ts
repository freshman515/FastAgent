import { useEffect } from 'react'
import {
  type McpCloseSessionRequest,
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
 *   - close a session tab from renderer-owned pane/session state
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

    const offClose = window.api.mcp.onCloseSessionRequest((req) => {
      handleCloseSession(req)
    })

    return () => {
      offList()
      offCreate()
      offClose()
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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase()
}

function findProjectIdByCwd(cwd?: string): string | null {
  if (!cwd) return null
  const target = normalizePath(cwd)
  const projects = useProjectsStore.getState().projects
  let best: { id: string; length: number } | null = null
  for (const project of projects) {
    const root = normalizePath(project.path)
    if (!root) continue
    if (target === root) return project.id
    if (target.startsWith(`${root}/`) && (!best || root.length > best.length)) {
      best = { id: project.id, length: root.length }
    }
  }
  return best?.id ?? null
}

function sessionsShareMcpScope(source: { projectId: string; worktreeId?: string; cwd?: string }, target: { projectId: string; worktreeId?: string; cwd?: string }): boolean {
  if (source.projectId && target.projectId && source.projectId === target.projectId) return true

  const sourceCwd = source.cwd ? normalizePath(source.cwd) : ''
  const targetCwd = target.cwd ? normalizePath(target.cwd) : ''
  return Boolean(sourceCwd && targetCwd && (sourceCwd === targetCwd || targetCwd.startsWith(`${sourceCwd}/`) || sourceCwd.startsWith(`${targetCwd}/`)))
}

function handleCloseSession(req: McpCloseSessionRequest): void {
  try {
    const sessionStore = useSessionsStore.getState()
    const paneStore = usePanesStore.getState()
    const target = sessionStore.sessions.find((session) => session.id === req.targetSessionId)
    if (!target) {
      throw new Error(`Session not found: ${req.targetSessionId}`)
    }
    if (target.pinned) {
      throw new Error('Pinned sessions cannot be closed.')
    }
    if (req.sourceSessionId && req.sourceSessionId === req.targetSessionId) {
      throw new Error('Refusing to close the calling session itself.')
    }
    if (req.sourceSessionId) {
      const source = sessionStore.sessions.find((session) => session.id === req.sourceSessionId)
      if (!source) {
        throw new Error('Calling session is no longer available.')
      }
      if (!sessionsShareMcpScope(source, target)) {
        throw new Error('Target session is outside the current workspace scope.')
      }
    }

    for (const [paneId, sessionIds] of Object.entries(paneStore.paneSessions)) {
      if (sessionIds.includes(req.targetSessionId)) {
        paneStore.removeSessionFromPane(paneId, req.targetSessionId)
      }
    }
    sessionStore.removeSession(req.targetSessionId)

    window.api.mcp.respondCloseSession({
      requestId: req.requestId,
      ok: true,
      closed: true,
    })
  } catch (err) {
    window.api.mcp.respondCloseSession({
      requestId: req.requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function handleCreateSession(req: McpCreateSessionRequest): Promise<void> {
  try {
    const sessionStore = useSessionsStore.getState()
    const paneStore = usePanesStore.getState()

    // Resolve projectId: explicit > source session's project > cwd match > selected project.
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

    if (!projectId) projectId = findProjectIdByCwd(req.cwd)
    if (!projectId) projectId = useProjectsStore.getState().selectedProjectId
    if (!projectId) {
      throw new Error('No project is selected. Select a project or pass projectId before creating a session.')
    }

    const project = useProjectsStore.getState().projects.find((item) => item.id === projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    if (req.isolateWorktree) {
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
