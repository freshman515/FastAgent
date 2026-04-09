import { useCallback } from 'react'
import type { SessionType } from '@shared/types'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/icon-opencode.png'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIcon from '@/assets/icons/terminal_white.png'

interface SessionOption {
  type: SessionType
  label: string
  icon: string
}

const SESSION_OPTIONS: SessionOption[] = [
  { type: 'claude-code', label: 'Claude Code', icon: claudeIcon },
  { type: 'codex', label: 'Codex', icon: codexIcon },
  { type: 'opencode', label: 'OpenCode', icon: opencodeIcon },
  { type: 'terminal', label: 'Terminal', icon: terminalIcon },
]

interface NewSessionMenuProps {
  projectId: string
  paneId?: string
  onClose: () => void
  position: { top: number; left: number }
}

export function NewSessionMenu({ projectId, paneId, onClose, position }: NewSessionMenuProps): JSX.Element {
  const addSession = useSessionsStore((s) => s.addSession)
  const addSessionToPane = usePanesStore((s) => s.addSessionToPane)

  const handleSelect = useCallback(
    (type: SessionType) => {
      const id = addSession(projectId, type)
      const targetPane = paneId ?? usePanesStore.getState().activePaneId
      addSessionToPane(targetPane, id)
      onClose()
    },
    [projectId, paneId, addSession, addSessionToPane, onClose],
  )

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={{ top: position.top, left: position.left }}
        className={cn(
          'fixed z-50 w-52 rounded-[var(--radius-md)] py-1',
          'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
          'shadow-lg shadow-black/30 animate-[fade-in_0.1s_ease-out]',
        )}
      >
        <div className="px-3 py-1.5">
          <p className="text-[var(--ui-font-2xs)] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
            New Session
          </p>
        </div>
        {SESSION_OPTIONS.map((opt) => (
          <button
            key={opt.type}
            onClick={() => handleSelect(opt.type)}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-2',
              'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
              'transition-colors duration-75',
            )}
          >
            <img src={opt.icon} alt="" className="h-4 w-4 shrink-0" />
            <span className="text-[var(--ui-font-sm)] font-medium">{opt.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}
