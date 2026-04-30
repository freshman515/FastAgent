import { ipcMain } from 'electron'
import { IPC, type McpCloseSessionResponse, type McpCreateSessionResponse, type McpSessionInfo } from '@shared/types'
import { orchestratorService } from '../services/OrchestratorService'

/**
 * Bridge IPC handlers for the FastAgents MCP server (Meta-Agent).
 *
 * The orchestrator HTTP server lives in the main process but does not own
 * the renderer's session/pane stores. To answer "list sessions" and "create
 * session" tool calls it sends a request IPC to the renderer, then awaits
 * the response IPC handled here.
 */
export function registerMcpHandlers(): void {
  ipcMain.on(
    IPC.MCP_LIST_SESSIONS_RESPONSE,
    (_event, payload: { requestId: string; sessions: McpSessionInfo[] }) => {
      if (!payload || typeof payload.requestId !== 'string') return
      orchestratorService.resolveListSessions(
        payload.requestId,
        Array.isArray(payload.sessions) ? payload.sessions : [],
      )
    },
  )

  ipcMain.on(
    IPC.MCP_CREATE_SESSION_RESPONSE,
    (_event, payload: McpCreateSessionResponse) => {
      if (!payload || typeof payload.requestId !== 'string') return
      orchestratorService.resolveCreateSession(payload.requestId, payload)
    },
  )

  ipcMain.on(
    IPC.MCP_CLOSE_SESSION_RESPONSE,
    (_event, payload: McpCloseSessionResponse) => {
      if (!payload || typeof payload.requestId !== 'string') return
      orchestratorService.resolveCloseSession(payload.requestId, payload)
    },
  )
}
