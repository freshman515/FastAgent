import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent } from 'react'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { cn } from '@/lib/utils'
import { isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore, type CompletionNotification } from '@/stores/ui'

function isNotificationTargetVisible(notification: CompletionNotification): boolean {
  const session = useSessionsStore.getState().sessions.find((item) => item.id === notification.sessionId)
  if (!session) return true

  const selectedProjectId = useProjectsStore.getState().selectedProjectId
  const sessions = useSessionsStore.getState()
  const panes = usePanesStore.getState()
  if (
    sessions.activeSessionId === notification.sessionId
    && (panes.workspaceMode === 'sessions' || selectedProjectId === notification.projectId)
  ) {
    return true
  }

  const activePaneSessionIds = new Set(Object.values(panes.paneActiveSession).filter(Boolean))
  if (
    activePaneSessionIds.has(notification.sessionId)
    && (panes.workspaceMode === 'sessions' || selectedProjectId === notification.projectId)
  ) {
    return true
  }

  if (useUIStore.getState().settings.workspaceLayout === 'canvas') {
    const canvas = useCanvasStore.getState()
    const visibleCard = canvas.getCards().some((card) =>
      card.refId === notification.sessionId && !isCanvasCardHidden(card)
    )
    if (visibleCard) return true
  }

  return false
}

export function CompletionNotificationCenter(): JSX.Element | null {
  const notifications = useUIStore((state) => state.completionNotifications)
  const enabled = useUIStore((state) => state.settings.completionNotificationEnabled)
  const removeNotification = useUIStore((state) => state.removeCompletionNotification)
  const removeForSession = useUIStore((state) => state.removeCompletionNotificationsForSession)
  const clearNotifications = useUIStore((state) => state.clearCompletionNotifications)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const activeSessionId = useSessionsStore((state) => state.activeSessionId)
  const paneActiveSessionKey = usePanesStore((state) => Object.values(state.paneActiveSession).join('|'))
  const workspaceMode = usePanesStore((state) => state.workspaceMode)
  const workspaceLayout = useUIStore((state) => state.settings.workspaceLayout)
  const canvasActiveLayoutKey = useCanvasStore((state) => state.activeLayoutKey)
  const canvasLayouts = useCanvasStore((state) => state.layouts)

  useEffect(() => {
    if (!enabled && notifications.length > 0) {
      clearNotifications()
    }
  }, [clearNotifications, enabled, notifications.length])

  useEffect(() => {
    if (!enabled) return
    for (const notification of notifications) {
      if (isNotificationTargetVisible(notification)) {
        removeForSession(notification.sessionId)
      }
    }
  }, [
    activeSessionId,
    canvasActiveLayoutKey,
    canvasLayouts,
    enabled,
    notifications,
    paneActiveSessionKey,
    removeForSession,
    selectedProjectId,
    workspaceLayout,
    workspaceMode,
  ])

  const handleJump = useCallback((notification: CompletionNotification): void => {
    focusSessionTarget(notification.sessionId)
    removeForSession(notification.sessionId)
  }, [removeForSession])

  const handleClose = useCallback((event: MouseEvent<HTMLButtonElement>, id: string): void => {
    event.stopPropagation()
    removeNotification(id)
  }, [removeNotification])

  if (!enabled || notifications.length === 0) return null

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-12 z-[9998] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2">
      <AnimatePresence mode="popLayout">
        {notifications.map((notification) => {
          const Icon = notification.type === 'warning' ? AlertTriangle : CheckCircle2
          return (
            <motion.div
              key={notification.id}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              role="button"
              tabIndex={0}
              onClick={() => handleJump(notification)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                handleJump(notification)
              }}
              className={cn(
                'pointer-events-auto flex h-10 cursor-pointer items-center gap-2.5 rounded-[var(--radius-lg)] px-3',
                'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]/96',
                'shadow-xl shadow-black/25 backdrop-blur-md',
                'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg-primary)]',
              )}
              aria-label="跳转到完成的会话"
            >
              <Icon
                size={17}
                className={cn(
                  'shrink-0',
                  notification.type === 'warning' ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]',
                )}
              />
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
                  {notification.projectName}
                </span>
                <span className="shrink-0 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">·</span>
                <span className="min-w-0 truncate text-[var(--ui-font-xs)] font-medium text-[var(--color-text-secondary)]">
                  {notification.sessionName}
                </span>
              </div>
              <span className="shrink-0 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                完成
              </span>
              <button
                type="button"
                onClick={(event) => handleClose(event, notification.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
                aria-label="关闭完成通知"
              >
                <X size={12} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
