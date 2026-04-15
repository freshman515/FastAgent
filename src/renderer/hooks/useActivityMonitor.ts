import { useEffect, useRef } from 'react'
import { switchProjectContext } from '@/lib/project-context'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'

const POLL_INTERVAL = 2000
const IDLE_THRESHOLD = 2

export function useActivityMonitor(): void {
  const idleCountsRef = useRef<Record<string, number>>({})

  // Single polling effect - uses getState() to avoid re-render loops
  useEffect(() => {
    const interval = setInterval(async () => {
      const { sessions, outputStates, activeSessionId, updateStatus, setOutputState } =
        useSessionsStore.getState()
      const runningSessions = sessions.filter((s) => s.status === 'running' && s.ptyId)

      for (const session of runningSessions) {
        if (!session.ptyId) continue

        try {
          const active = await window.api.session.getActivity(session.ptyId)

          if (active) {
            idleCountsRef.current[session.id] = 0
          } else {
            const count = (idleCountsRef.current[session.id] ?? 0) + 1
            idleCountsRef.current[session.id] = count

            if (count >= IDLE_THRESHOLD && outputStates[session.id] === 'outputting') {
              const isViewing = activeSessionId === session.id
              setOutputState(session.id, isViewing ? 'idle' : 'unread')
              updateStatus(session.id, 'idle')

              if (!isViewing && useUIStore.getState().settings.notificationToastEnabled) {
                const project = useProjectsStore
                  .getState()
                  .projects.find((p) => p.id === session.projectId)
                useUIStore.getState().addToast({
                  title: `${session.name} completed`,
                  body: project ? `Project: ${project.name}` : undefined,
                  type: 'info',
                  sessionId: session.id,
                  projectId: session.projectId,
                })

                window.api.notification.show({
                  title: `${session.name} completed`,
                  body: project ? `Project: ${project.name}` : '',
                  sessionId: session.id,
                  projectId: session.projectId,
                })
              }
            }
          }
        } catch {
          // Session may have been destroyed
        }
      }
    }, POLL_INTERVAL)

    return () => clearInterval(interval)
  }, [])

  // Listen for system notification clicks
  useEffect(() => {
    return window.api.notification.onClick((data) => {
      if (data.sessionId) {
        const session = useSessionsStore.getState().sessions.find((s) => s.id === data.sessionId)
        if (session) {
          switchProjectContext(session.projectId, session.id, session.worktreeId ?? null)
        } else if (data.projectId) {
          useProjectsStore.getState().selectProject(data.projectId)
        }
        useSessionsStore.getState().setActive(data.sessionId)
        useSessionsStore.getState().markAsRead(data.sessionId)
      } else if (data.projectId) {
        useProjectsStore.getState().selectProject(data.projectId)
      }
    })
  }, [])

  // Listen for session exit events
  useEffect(() => {
    return window.api.session.onExit((event) => {
      const { sessions, activeSessionId } = useSessionsStore.getState()
      const session = sessions.find((s) => s.ptyId === event.ptyId)
      if (!session) return

      const isViewing = activeSessionId === session.id
      if (!isViewing && useUIStore.getState().settings.notificationToastEnabled) {
        const project = useProjectsStore
          .getState()
          .projects.find((p) => p.id === session.projectId)
        useUIStore.getState().addToast({
          title: `${session.name} exited`,
          body: `Exit code: ${event.exitCode}${project ? ` | ${project.name}` : ''}`,
          type: event.exitCode === 0 ? 'success' : 'warning',
          sessionId: session.id,
          projectId: session.projectId,
        })
      }
    })
  }, [])
}
