import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, CheckCircle, AlertTriangle, Info, XCircle, X } from 'lucide-react'
import { useCallback } from 'react'
import type { ToastNotification } from '@shared/types'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { useSessionsStore } from '@/stores/sessions'
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
  const setActive = useSessionsStore((s) => s.setActive)
  const selectProject = useProjectsStore((s) => s.selectProject)

  const handleJump = useCallback(
    (toast: ToastNotification) => {
      if (toast.projectId) selectProject(toast.projectId)
      if (toast.sessionId) setActive(toast.sessionId)
      removeToast(toast.id)
    },
    [selectProject, setActive, removeToast],
  )

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const Icon = TYPE_ICONS[toast.type]
          return (
            <motion.div
              key={toast.id}
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
                  <p className="text-[var(--ui-font-xs)] leading-relaxed text-[var(--color-text-secondary)]">
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
      </AnimatePresence>
    </div>
  )
}
