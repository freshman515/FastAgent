import type { HistoricalSession, Session, SessionType } from '@shared/types'
import { isClaudeCodeType } from '@shared/types'
import { ensureAnonymousProject } from '@/lib/anonymous-project'
import { switchProjectContext } from '@/lib/project-context'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useUIStore } from '@/stores/ui'

// Normalize paths for comparison: forward slashes, lowercased, trailing slash
// stripped. Mirrors the logic in @shared/claudeSession so matches here line up
// with what PtyManager will consider a valid cwd for `claude --resume`.
function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function findMatchingProjectId(cwd: string): string | null {
  if (!cwd) return null
  const target = normalizePath(cwd)
  const projects = useProjectsStore.getState().projects
  // Prefer an exact project match; fall back to the longest-prefix match so a
  // session run inside a subfolder still resolves to the enclosing project.
  let exact: string | null = null
  let prefixMatch: { id: string; length: number } | null = null
  for (const project of projects) {
    const projectPath = normalizePath(project.path)
    if (projectPath === target) {
      exact = project.id
      break
    }
    if (target.startsWith(`${projectPath}/`) && projectPath.length > 0) {
      if (!prefixMatch || projectPath.length > prefixMatch.length) {
        prefixMatch = { id: project.id, length: projectPath.length }
      }
    }
  }
  return exact ?? prefixMatch?.id ?? null
}

function buildSessionName(entry: HistoricalSession): string {
  const label = entry.source === 'codex' ? 'Codex' : 'Claude Code'
  const preview = entry.firstUserPrompt ?? '无内容'
  const trimmed = preview.slice(0, 40)
  return `${label} · ${trimmed}${preview.length > 40 ? '…' : ''}`
}

function sessionTypeFor(entry: HistoricalSession): SessionType {
  if (entry.source === 'codex') {
    return useUIStore.getState().settings.defaultSessionType === 'codex-yolo' ? 'codex-yolo' : 'codex'
  }
  return useUIStore.getState().settings.defaultSessionType === 'claude-code-yolo' ? 'claude-code-yolo' : 'claude-code'
}

export interface ResumeResult {
  sessionId: string
  matchedProjectId: string | null
  anonymous: boolean
  /** True when we focused an already-open tab instead of creating a new one. */
  reused: boolean
}

function findExistingSession(entry: HistoricalSession, sessions: Session[]): Session | null {
  // Claude and Codex live in different fields because their UUID schemes and
  // resume semantics diverge — see shared/claudeSession.ts.
  if (entry.source === 'claude-code') {
    for (const s of sessions) {
      if (!isClaudeCodeType(s.type)) continue
      if (s.resumeUUID === entry.id) return s
    }
  } else {
    for (const s of sessions) {
      if (s.type !== 'codex' && s.type !== 'codex-yolo') continue
      if (s.codexResumeId === entry.id) return s
    }
  }
  return null
}

function focusExistingSession(session: Session): void {
  // Re-enter the session's project context so the pane strip shows its tab,
  // then surface + activate it. Mirrors the flow in createAnonymousTerminal.
  switchProjectContext(session.projectId, session.id, session.worktreeId ?? null)
  const paneStore = usePanesStore.getState()
  const existingPane = paneStore.findPaneForSession(session.id)
  const targetPaneId = existingPane ?? paneStore.activePaneId
  if (!existingPane) {
    paneStore.addSessionToPane(targetPaneId, session.id)
  }
  paneStore.setPaneActiveSession(targetPaneId, session.id)
  paneStore.setActivePaneId(targetPaneId)
  useSessionsStore.getState().setActive(session.id)
}

export async function resumeHistoricalSession(entry: HistoricalSession): Promise<ResumeResult> {
  const sessionStore = useSessionsStore.getState()

  // If a tab for this exact transcript is already open, just focus it instead
  // of forking a second conversation from the same starting point.
  const existing = findExistingSession(entry, sessionStore.sessions)
  if (existing) {
    focusExistingSession(existing)
    return {
      sessionId: existing.id,
      matchedProjectId: existing.projectId,
      anonymous: false,
      reused: true,
    }
  }

  const matchedProjectId = findMatchingProjectId(entry.cwd)
  let projectId = matchedProjectId
  let anonymous = false
  if (!projectId) {
    const anon = await ensureAnonymousProject()
    projectId = anon.id
    anonymous = true
  }

  const sessionType = sessionTypeFor(entry)
  const name = buildSessionName(entry)
  const sessionId = sessionStore.addSession(projectId, sessionType, undefined, name)

  // Wire the resume handshake — this is what makes PtyManager launch with
  // `--resume` / `resume <id>` instead of opening a plain conversation. We
  // always override cwd to the original transcript's directory even when we
  // found a matching project — prefix-matched projects can point at an
  // ancestor, and Claude's resume cwd validator rejects that mismatch.
  const updates: Parameters<typeof sessionStore.updateSession>[1] = {}
  if (entry.cwd) updates.cwd = entry.cwd
  if (entry.source === 'claude-code') {
    updates.initialized = true
    updates.resumeUUID = entry.id
  } else {
    updates.codexResumeId = entry.id
  }
  sessionStore.updateSession(sessionId, updates)

  // Activate — switch to the right project context so the new tab is visible
  // in the current pane, then mount it and focus.
  switchProjectContext(projectId, sessionId, null)
  const paneStore = usePanesStore.getState()
  if (!paneStore.findPaneForSession(sessionId)) {
    paneStore.addSessionToPane(paneStore.activePaneId, sessionId)
  }
  paneStore.setPaneActiveSession(paneStore.activePaneId, sessionId)
  useSessionsStore.getState().setActive(sessionId)

  return { sessionId, matchedProjectId, anonymous, reused: false }
}
