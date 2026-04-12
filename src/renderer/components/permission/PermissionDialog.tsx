import { AnimatePresence, motion } from 'framer-motion'
import { Shield, Check, X, ArrowRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { switchProjectContext } from '@/lib/project-context'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'

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

export function PermissionDialog(): JSX.Element {
  const [queue, setQueue] = useState<PermissionEntry[]>([])

  useEffect(() => {
    const offRequest = window.api.session.onPermissionRequest((event) => {
      if (event.conversationId) return
      setQueue((q) => {
        if (q.some((e) => e.id === event.id)) return q
        return [...q, event]
      })
    })
    const offDismiss = window.api.session.onPermissionDismiss((event) => {
      setQueue((q) => q.filter((e) => e.id !== event.id))
    })
    return () => { offRequest(); offDismiss() }
  }, [])

  const dismiss = useCallback((id: string) => {
    setQueue((q) => q.filter((e) => e.id !== id))
  }, [])

  const handleAllow = useCallback((entry: PermissionEntry) => {
    window.api.session.respondPermission(entry.id, 'allow')
    dismiss(entry.id)
  }, [dismiss])

  const handleDeny = useCallback((entry: PermissionEntry) => {
    window.api.session.respondPermission(entry.id, 'deny')
    dismiss(entry.id)
  }, [dismiss])

  const handleSuggestion = useCallback((entry: PermissionEntry, index: number) => {
    window.api.session.respondPermission(entry.id, 'allow', index)
    dismiss(entry.id)
  }, [dismiss])

  const handleJump = useCallback((entry: PermissionEntry) => {
    if (!entry.sessionId) return
    const session = useSessionsStore.getState().sessions.find((s) => s.id === entry.sessionId)
    if (!session) return
    const projectsStore = useProjectsStore.getState()
    const paneStore = usePanesStore.getState()
    if (projectsStore.selectedProjectId !== session.projectId) {
      switchProjectContext(session.projectId, entry.sessionId, session.worktreeId ?? null)
    }
    const paneId = paneStore.findPaneForSession(entry.sessionId)
    if (paneId) {
      paneStore.setActivePaneId(paneId)
      paneStore.setPaneActiveSession(paneId, entry.sessionId)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9998] flex flex-col-reverse gap-2">
      <AnimatePresence mode="popLayout">
        {queue.map((entry) => {
          const pillColor = TOOL_COLORS[entry.toolName] ?? 'bg-zinc-600'
          return (
            <motion.div
              key={entry.id}
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
                <span className={cn(
                  'rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white',
                  pillColor,
                )}>
                  {entry.toolName}
                </span>
              </div>

              {/* Detail */}
              {entry.detail && (
                <div className={cn(
                  'mx-4 mb-2 rounded-lg px-3 py-2',
                  'bg-[var(--color-bg-primary)] border border-[var(--color-border)]',
                  'font-mono text-[11px] text-[var(--color-text-secondary)]',
                  'max-h-[60px] overflow-y-auto break-all leading-relaxed',
                )}>
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

              {/* Suggestions (e.g., "Always allow Bash in Desktop/") */}
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
                  onClick={() => handleJump(entry)}
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
  )
}
