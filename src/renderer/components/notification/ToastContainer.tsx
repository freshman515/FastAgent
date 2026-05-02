import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, CheckCircle, AlertTriangle, Info, XCircle, X } from 'lucide-react'
import { useCallback } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { ToastNotification } from '@shared/types'
import { cn } from '@/lib/utils'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { useUIStore } from '@/stores/ui'
import { useProjectsStore } from '@/stores/projects'

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

export function ToastContainer(): JSX.Element {
  const toasts = useUIStore((s) => s.toasts)
  const removeToast = useUIStore((s) => s.removeToast)
  const selectProject = useProjectsStore((s) => s.selectProject)

  const handleJump = useCallback(
    (toast: ToastNotification) => {
      if (toast.sessionId) {
        focusSessionTarget(toast.sessionId)
      } else if (toast.projectId) {
        selectProject(toast.projectId)
      }
      removeToast(toast.id)
    },
    [selectProject, removeToast],
  )

  const handleToastKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, toast: ToastNotification) => {
      if (!toast.sessionId && !toast.projectId) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      handleJump(toast)
    },
    [handleJump],
  )

  const handleCloseClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, toastId: string) => {
      event.stopPropagation()
      removeToast(toastId)
    },
    [removeToast],
  )

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const Icon = TYPE_ICONS[toast.type]
          const canJump = Boolean(toast.sessionId || toast.projectId)
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              role={canJump ? 'button' : undefined}
              tabIndex={canJump ? 0 : undefined}
              aria-label={canJump ? 'Jump to notification target' : undefined}
              onClick={canJump ? () => handleJump(toast) : undefined}
              onKeyDown={(event) => handleToastKeyDown(event, toast)}
              className={cn(
                'pointer-events-auto flex w-72 items-start gap-2.5 rounded-[var(--radius-lg)] p-3',
                'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
                'shadow-xl shadow-black/20',
                canJump && 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg-primary)]',
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
                  <span
                    className={cn(
                      'mt-1 flex items-center gap-1 self-start text-[var(--ui-font-xs)] font-medium',
                      'text-[var(--color-accent)]',
                      'transition-colors duration-100',
                    )}
                  >
                    Jump to session <ArrowRight size={10} />
                  </span>
                )}
              </div>

              <button
                onClick={(event) => handleCloseClick(event, toast.id)}
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
      </AnimatePresence>
    </div>
  )
}
