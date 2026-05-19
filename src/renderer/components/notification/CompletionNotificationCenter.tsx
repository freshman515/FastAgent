import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent } from 'react'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { cn } from '@/lib/utils'
import { useUIStore, type CompletionNotification } from '@/stores/ui'

function formatNotificationAge(createdAt: number): string {
  const elapsed = Math.max(0, Date.now() - createdAt)
  const minute = 60 * 1000
  if (elapsed < minute) return '刚刚'
  const minutes = Math.floor(elapsed / minute)
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
}

export function CompletionNotificationCenter(): JSX.Element | null {
  const notifications = useUIStore((state) => state.completionNotifications)
  const enabled = useUIStore((state) => state.settings.completionNotificationEnabled)
  const runningEnabled = useUIStore((state) => state.settings.runningNotificationEnabled)
  const externalCompletionEnabled = useUIStore((state) => state.settings.externalCompletionNotificationEnabled)
  const externalRunningEnabled = useUIStore((state) => state.settings.externalRunningNotificationEnabled)
  const removeNotification = useUIStore((state) => state.removeCompletionNotification)
  const removeForSession = useUIStore((state) => state.removeCompletionNotificationsForSession)
  const clearNotifications = useUIStore((state) => state.clearCompletionNotifications)
  useEffect(() => {
    const hasAnyNotificationTarget = enabled || runningEnabled || externalCompletionEnabled || externalRunningEnabled
    if (!hasAnyNotificationTarget && notifications.length > 0) {
      clearNotifications()
    }
  }, [clearNotifications, enabled, externalCompletionEnabled, externalRunningEnabled, notifications.length, runningEnabled])

  useEffect(() => {
    const overlayNotifications = notifications.filter((notification) => (
      notification.status === 'running' ? externalRunningEnabled : externalCompletionEnabled
    ))
    if (overlayNotifications.length === 0) {
      window.api.overlay.sendTaskNotifications([])
      return
    }

    window.api.overlay.sendTaskNotifications(overlayNotifications)
  }, [externalCompletionEnabled, externalRunningEnabled, notifications])

  useEffect(() => {
    return () => {
      window.api.overlay.sendTaskNotifications([])
    }
  }, [])

  const handleJump = useCallback((notification: CompletionNotification): void => {
    focusSessionTarget(notification.sessionId)
    if (notification.status === 'completed') {
      removeForSession(notification.sessionId)
    }
  }, [removeForSession])

  const handleClose = useCallback((event: MouseEvent<HTMLButtonElement>, id: string): void => {
    event.stopPropagation()
    removeNotification(id)
  }, [removeNotification])

  const visibleNotifications = notifications.filter((notification) => (
    notification.status === 'running'
      ? runningEnabled
      : enabled
  ))

  if (visibleNotifications.length === 0) return null

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-12 z-[9998] flex w-[388px] max-w-[calc(100vw-32px)] flex-col gap-2">
      <AnimatePresence mode="popLayout">
        {visibleNotifications.map((notification) => {
          const Icon = notification.status === 'running'
            ? LoaderCircle
            : notification.type === 'warning'
              ? AlertTriangle
              : CheckCircle2
          const isWarning = notification.type === 'warning'
          const isRunning = notification.status === 'running'
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
                'group pointer-events-auto relative flex min-h-[64px] cursor-pointer items-center gap-3 overflow-hidden rounded-[12px] px-3.5 py-3',
                'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-[0_8px_18px_rgba(0,0,0,0.22)]',
                'transition-colors duration-200 hover:border-white/18 hover:bg-[var(--color-bg-surface)]',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25 focus-visible:ring-offset-0',
              )}
              aria-label="跳转到完成的会话"
            >
              <div
                className={cn(
                  'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                  isRunning
                    ? 'bg-[#2f80ed]/18 text-[#5aa7ff] transition-colors duration-200 group-hover:bg-[#2f80ed]/24'
                    : isWarning
                    ? 'bg-[var(--color-warning)]/16 text-[var(--color-warning)] transition-colors duration-200 group-hover:bg-[var(--color-warning)]/22'
                    : 'bg-[var(--color-success)]/16 text-[var(--color-success)] transition-colors duration-200 group-hover:bg-[var(--color-success)]/22',
                )}
              >
                <Icon size={20} className={cn('shrink-0', isRunning && 'animate-spin')} />
              </div>
              <div className="relative min-w-0 flex-1">
                <div className="min-w-0 truncate text-[15px] font-semibold leading-5 text-[var(--color-text-primary)]">
                  {notification.projectName}
                </div>
                <div className="mt-0.5 min-w-0 truncate text-[11px] font-normal leading-4 text-[var(--color-text-secondary)]">
                  {notification.sessionName} {isRunning ? '已启动' : '已完成'}
                </div>
              </div>
              <div className="relative flex shrink-0 items-center gap-3 self-center">
                <div className="text-[var(--ui-font-xs)] font-normal leading-5 text-[var(--color-text-tertiary)]">
                  {formatNotificationAge(notification.createdAt)}
                </div>
                <button
                  type="button"
                  onClick={(event) => handleClose(event, notification.id)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[var(--color-text-tertiary)] opacity-80 transition-colors hover:bg-white/8 hover:text-[var(--color-text-secondary)] hover:opacity-100"
                  aria-label="关闭完成通知"
                >
                  <X size={13} />
                </button>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
