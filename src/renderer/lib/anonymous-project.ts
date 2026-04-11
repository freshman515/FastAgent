import type { Project } from '@shared/types'
import {
  ANONYMOUS_PROJECT_ID,
  ANONYMOUS_PROJECT_NAME,
  UNGROUPED_PROJECT_GROUP_ID,
  isAnonymousProjectId,
} from '@shared/types'
import { switchProjectContext } from '@/lib/project-context'
import { useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'

let ensureAnonymousProjectPromise: Promise<Project> | null = null

export function isAnonymousProject(project: Pick<Project, 'id'> | string): boolean {
  return isAnonymousProjectId(typeof project === 'string' ? project : project.id)
}

export async function ensureAnonymousProject(): Promise<Project> {
  if (ensureAnonymousProjectPromise) return ensureAnonymousProjectPromise

  ensureAnonymousProjectPromise = (async () => {
    const projectPath = await window.api.config.getAnonymousWorkspace()
    const project: Project = {
      id: ANONYMOUS_PROJECT_ID,
      name: ANONYMOUS_PROJECT_NAME,
      path: projectPath,
      groupId: UNGROUPED_PROJECT_GROUP_ID,
    }

    useProjectsStore.getState().upsertProject(project)
    return project
  })()

  try {
    return await ensureAnonymousProjectPromise
  } finally {
    ensureAnonymousProjectPromise = null
  }
}

export async function createAnonymousTerminal(): Promise<string> {
  const project = await ensureAnonymousProject()
  const sessionId = useSessionsStore.getState().addSession(project.id, 'terminal')

  switchProjectContext(project.id, sessionId, null)

  const paneStore = usePanesStore.getState()
  paneStore.addSessionToPane(paneStore.activePaneId, sessionId)
  paneStore.setPaneActiveSession(paneStore.activePaneId, sessionId)
  useSessionsStore.getState().setActive(sessionId)

  return sessionId
}

export async function removeAnonymousProject(): Promise<void> {
  const projectStore = useProjectsStore.getState()
  const paneStore = usePanesStore.getState()
  const sessionStore = useSessionsStore.getState()
  const editorStore = useEditorsStore.getState()

  const sessions = sessionStore.sessions.filter((session) => session.projectId === ANONYMOUS_PROJECT_ID)
  for (const session of sessions) {
    if (session.ptyId) {
      try {
        await window.api.session.kill(session.ptyId)
      } catch {
        // ignore
      }
    }
    if (session.pinned) {
      sessionStore.updateSession(session.id, { pinned: false })
    }
    const paneId = paneStore.findPaneForSession(session.id)
    if (paneId) paneStore.removeSessionFromPane(paneId, session.id)
    sessionStore.removeSession(session.id)
  }

  const editorIds = editorStore.tabs
    .filter((tab) => tab.projectId === ANONYMOUS_PROJECT_ID)
    .map((tab) => tab.id)
  for (const editorId of editorIds) {
    const paneId = paneStore.findPaneForSession(editorId)
    if (paneId) paneStore.removeSessionFromPane(paneId, editorId)
    editorStore.closeTab(editorId)
  }

  projectStore.removeProject(ANONYMOUS_PROJECT_ID)
}
