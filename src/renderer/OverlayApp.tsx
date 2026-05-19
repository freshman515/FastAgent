import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  CheckCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  X,
  Shield,
  Check,
  LoaderCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToastNotification } from '@shared/types'
import { useUIStore, type CompletionNotification } from '@/stores/ui'

// ─── Toast constants (same as ToastContainer) ───

const TYPE_ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
}

const TYPE_COLORS = {
  info: 'text-[var(--color-info)]',
  success: 'text-[var(--color-success)]',
  warning: 'text-[var(--color-warning)]',
  error: 'text-[var(--color-error)]',
}

// ─── Permission constants (same as PermissionDialog) ───

interface PermissionEntry {
  id: string
  sessionId: string | null
  conversationId?: string | null
  toolName: string
  detail: string
  suggestions: string[]
}

const TOOL_COLORS: Record<string, string> = {
  Bash: 'bg-orange-600',
  Edit: 'bg-blue-500',
  Write: 'bg-purple-500',
  Read: 'bg-green-600',
  Glob: 'bg-teal-500',
  Grep: 'bg-teal-500',
  Agent: 'bg-pink-500',
}

function formatNotificationAge(createdAt: number): string {
  const elapsed = Math.max(0, Date.now() - createdAt)
  const minute = 60 * 1000
  if (elapsed < minute) return '刚刚'
  const minutes = Math.floor(elapsed / minute)
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
}

// ─── OverlayApp ───

export function OverlayApp(): JSX.Element {
  const [toasts, setToasts] = useState<ToastNotification[]>([])
  const [permissions, setPermissions] = useState<PermissionEntry[]>([])
  const [taskNotifications, setTaskNotifications] = useState<CompletionNotification[]>([])
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const init = async (): Promise<void> => {
      const data = await window.api.config.read()
      useUIStore.getState()._loadSettings(
        data.ui,
        (data as Record<string, unknown>).customThemes as Record<string, unknown> | undefined,
      )
      document.documentElement.style.backgroundColor = 'transparent'
      document.body.style.backgroundColor = 'transparent'
      const root = document.getElementById('root')
      if (root) root.style.backgroundColor = 'transparent'
    }
    void init()
  }, [])

  // Listen for toast events from main process (forwarded from main window)
  useEffect(() => {
    const offToast = window.api.overlay.onToast((raw) => {
      const toast = raw as ToastNotification
      setToasts((prev) => {
        if (prev.some((t) => t.id === toast.id)) return prev
        return [...prev, toast]
      })
      // Auto-remove after duration
      const duration = toast.duration ?? (toast.type === 'error' ? 10000 : 5000)
      if (duration > 0) {
        setTimeout(() => {
          setToasts((p) => p.filter((t) => t.id !== toast.id))
        }, duration)
      }
    })

    const offRemove = window.api.overlay.onToastRemove((id) => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    })

    const offTaskNotifications = window.api.overlay.onTaskNotifications((raw) => {
      setTaskNotifications(Array.isArray(raw) ? raw as CompletionNotification[] : [])
    })

    // Permission IPC events are broadcast to all windows by the main process
    const offPermReq = window.api.session.onPermissionRequest((event) => {
      if (event.conversationId) return
      setPermissions((q) => {
        if (q.some((e) => e.id === event.id)) return q
        return [...q, event]
      })
    })

    const offPermDismiss = window.api.session.onPermissionDismiss((event) => {
      setPermissions((q) => q.filter((e) => e.id !== event.id))
    })

    return () => {
      offToast()
      offRemove()
      offTaskNotifications()
      offPermReq()
      offPermDismiss()
    }
  }, [])

  const hasContent = toasts.length > 0 || permissions.length > 0 || taskNotifications.length > 0

  // Toggle mouse passthrough: allow clicks only when content is visible
  useEffect(() => {
    window.api.overlay.setIgnoreMouse(!hasContent)
  }, [hasContent])

  useEffect(() => {
    if (!hasContent) {
      window.api.overlay.setContentSize({ height: 0 })
      return
    }

    const element = contentRef.current
    if (!element) return

    const updateSize = (): void => {
      const rect = element.getBoundingClientRect()
      window.api.overlay.setContentSize({
        width: 420,
        height: Math.ceil(rect.height + 24),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasContent, permissions.length, taskNotifications.length, toasts.length])

  // ─── Toast handlers ───

  const removeToast = useCallback((id: string) => {
    setToasts((p) => p.filter((t) => t.id !== id))
  }, [])

  const handleJump = useCallback(
    (toast: ToastNotification) => {
      window.api.overlay.sendAction({
        type: 'jump',
        sessionId: toast.sessionId,
        projectId: toast.projectId,
      })
      removeToast(toast.id)
    },
    [removeToast],
  )

  // ─── Permission handlers ───

  const dismissPermission = useCallback((id: string) => {
    setPermissions((q) => q.filter((e) => e.id !== id))
  }, [])

  const handleAllow = useCallback(
    (entry: PermissionEntry) => {
      window.api.session.respondPermission(entry.id, 'allow')
      dismissPermission(entry.id)
    },
    [dismissPermission],
  )

  const handleDeny = useCallback(
    (entry: PermissionEntry) => {
      window.api.session.respondPermission(entry.id, 'deny')
      dismissPermission(entry.id)
    },
    [dismissPermission],
  )

  const handleSuggestion = useCallback(
    (entry: PermissionEntry, index: number) => {
      window.api.session.respondPermission(entry.id, 'allow', index)
      dismissPermission(entry.id)
    },
    [dismissPermission],
  )

  const handlePermissionJump = useCallback((entry: PermissionEntry) => {
    if (!entry.sessionId) return
    window.api.overlay.sendAction({
      type: 'jump',
      sessionId: entry.sessionId,
    })
  }, [])

  const handleTaskJump = useCallback((notification: CompletionNotification) => {
    window.api.overlay.sendAction({
      type: 'jump-notification',
      sessionId: notification.sessionId,
      projectId: notification.projectId,
      notificationId: notification.id,
      status: notification.status,
    })
  }, [])

  const handleTaskDismiss = useCallback((id: string) => {
    window.api.overlay.sendAction({
      type: 'dismiss-notification',
      notificationId: id,
    })
  }, [])

  return (
    <div
      className="pointer-events-none flex w-screen items-start justify-end p-3"
      style={{ background: 'transparent' }}
    >
      <div ref={contentRef} className="flex w-[396px] max-w-[calc(100vw-24px)] flex-col gap-2">
      <AnimatePresence mode="popLayout">
        {/* ─── Task notification cards ─── */}
        {taskNotifications.map((notification) => {
          const isRunning = notification.status === 'running'
          const isWarning = notification.type === 'warning'
          const Icon = isRunning ? LoaderCircle : isWarning ? AlertTriangle : CheckCircle2
          return (
            <motion.div
              key={`task-${notification.id}`}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              role="button"
              tabIndex={0}
              onClick={() => handleTaskJump(notification)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                handleTaskJump(notification)
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
                  onClick={(event) => {
                    event.stopPropagation()
                    handleTaskDismiss(notification.id)
                  }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[var(--color-text-tertiary)] opacity-80 transition-colors hover:bg-white/8 hover:text-[var(--color-text-secondary)] hover:opacity-100"
                  aria-label="关闭完成通知"
                >
                  <X size={13} />
                </button>
              </div>
            </motion.div>
          )
        })}

        {/* ─── Toast cards ─── */}
        {toasts.map((toast) => {
          const Icon = TYPE_ICONS[toast.type]
          return (
            <motion.div
              key={`toast-${toast.id}`}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              className={cn(
                'pointer-events-auto flex w-72 items-start gap-2.5 rounded-[var(--radius-lg)] p-3',
                'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
                'shadow-xl shadow-black/20',
              )}
            >
              <Icon size={16} className={cn('mt-0.5 shrink-0', TYPE_COLORS[toast.type])} />

              <div className="flex flex-1 flex-col gap-1">
                <p className="text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">
                  {toast.title}
                </p>
                {toast.body && (
                  <p className="whitespace-pre-line text-[var(--ui-font-xs)] leading-relaxed text-[var(--color-text-secondary)]">
                    {toast.body}
                  </p>
                )}
                {toast.sessionId && (
                  <button
                    onClick={() => handleJump(toast)}
                    className={cn(
                      'mt-1 flex items-center gap-1 self-start text-[var(--ui-font-xs)] font-medium',
                      'text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]',
                      'transition-colors duration-100',
                    )}
                  >
                    Jump to session <ArrowRight size={10} />
                  </button>
                )}
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm',
                  'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                  'transition-colors duration-75',
                )}
              >
                <X size={12} />
              </button>
            </motion.div>
          )
        })}

        {/* ─── Permission cards ─── */}
        {permissions.map((entry) => {
          const pillColor = TOOL_COLORS[entry.toolName] ?? 'bg-zinc-600'
          return (
            <motion.div
              key={`perm-${entry.id}`}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              className={cn(
                'pointer-events-auto w-80 rounded-2xl',
                'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
                'shadow-xl shadow-black/30 overflow-hidden',
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-orange-400" />
                  <span className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
                    Permission Request
                  </span>
                </div>
                <span
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white',
                    pillColor,
                  )}
                >
                  {entry.toolName}
                </span>
              </div>

              {/* Detail */}
              {entry.detail && (
                <div
                  className={cn(
                    'mx-4 mb-2 rounded-lg px-3 py-2',
                    'bg-[var(--color-bg-primary)] border border-[var(--color-border)]',
                    'font-mono text-[11px] text-[var(--color-text-secondary)]',
                    'max-h-[60px] overflow-y-auto break-all leading-relaxed',
                  )}
                >
                  {entry.detail}
                </div>
              )}

              {/* Allow / Deny */}
              <div className="flex gap-2 px-4 pb-2">
                <button
                  onClick={() => handleAllow(entry)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2',
                    'bg-orange-600 text-white text-[var(--ui-font-sm)] font-semibold',
                    'hover:bg-orange-700 active:scale-[0.97] transition-all duration-100',
                  )}
                >
                  <Check size={14} />
                  Allow
                </button>
                <button
                  onClick={() => handleDeny(entry)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2',
                    'border border-[var(--color-border)] text-[var(--color-text-secondary)]',
                    'text-[var(--ui-font-sm)] font-semibold',
                    'hover:bg-[var(--color-bg-surface)] active:scale-[0.97] transition-all duration-100',
                  )}
                >
                  <X size={14} />
                  Deny
                </button>
              </div>

              {/* Suggestions */}
              {entry.suggestions.length > 0 && (
                <div className="flex flex-col gap-1 px-4 pb-3 border-t border-[var(--color-border)] pt-2">
                  {entry.suggestions.map((label, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestion(entry, i)}
                      className={cn(
                        'w-full rounded-lg px-3 py-1.5 text-left',
                        'text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]',
                        'border border-[var(--color-border)]',
                        'hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                        'active:scale-[0.98] transition-all duration-100',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Jump to session */}
              {entry.sessionId && (
                <button
                  onClick={() => handlePermissionJump(entry)}
                  className={cn(
                    'flex w-full items-center justify-center gap-1 border-t border-[var(--color-border)] px-4 py-1.5',
                    'text-[var(--ui-font-2xs)] text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]',
                    'hover:bg-[var(--color-bg-surface)] transition-colors',
                  )}
                >
                  Jump to session <ArrowRight size={10} />
                </button>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
      </div>
    </div>
  )
}
