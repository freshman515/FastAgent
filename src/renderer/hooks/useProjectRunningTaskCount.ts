import { useMemo } from 'react'
import type { SessionActivity } from '@shared/types'
import { useSessionsStore } from '@/stores/sessions'

const RUNNING_TASK_ACTIVITIES = new Set<SessionActivity>(['running', 'thinking'])

export function useProjectRunningTaskCount(projectId: string): number {
  const sessions = useSessionsStore((state) => state.sessions)
  const activityStates = useSessionsStore((state) => state.activityStates)

  return useMemo(
    () => sessions.filter((session) => {
      if (session.projectId !== projectId || session.status === 'stopped') return false
      const activity = activityStates[session.id]?.status
      return activity ? RUNNING_TASK_ACTIVITIES.has(activity) : false
    }).length,
    [activityStates, projectId, sessions],
  )
}
