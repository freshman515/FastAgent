import { useCallback } from 'react'
import type { SessionType } from '@shared/types'
import { cn } from '@/lib/utils'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { createSessionWithPrompt } from '@/lib/createSession'
import { usePanesStore } from '@/stores/panes'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/codex_white.svg'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIcon from '@/assets/icons/terminal_white.png'

interface SessionOption {
  type: SessionType
  label: string
  icon: string
}

const SESSION_OPTIONS: SessionOption[] = [
  { type: 'terminal', label: '终端', icon: terminalIcon },
  { type: 'claude-code', label: 'Claude Code', icon: claudeIcon },
  { type: 'claude-code-yolo', label: 'Claude Code YOLO', icon: claudeIcon },
  { type: 'claude-gui', label: 'Claude GUI', icon: claudeIcon },
  { type: 'codex', label: 'Codex', icon: codexIcon },
  { type: 'codex-yolo', label: 'Codex YOLO', icon: codexIcon },
  { type: 'opencode', label: 'OpenCode', icon: opencodeIcon },
]

interface NewSessionMenuProps {
  projectId: string
  paneId?: string
  onClose: () => void
  position: { top: number; left: number }
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function NewSessionMenu({
  projectId,
  paneId,
  onClose,
  position,
  onMouseEnter,
  onMouseLeave,
}: NewSessionMenuProps): JSX.Element {
  const addSessionToPane = usePanesStore((s) => s.addSessionToPane)

  const handleSelect = useCallback(
    (type: SessionType) => {
      const worktreeId = getDefaultWorktreeIdForProject(projectId)
      const targetPane = paneId ?? usePanesStore.getState().activePaneId
      createSessionWithPrompt({ projectId, type, worktreeId }, (id) => {
        addSessionToPane(targetPane, id)
      })
      onClose()
    },
    [projectId, paneId, addSessionToPane, onClose],
  )

  return (
    <div
      style={{ top: position.top, left: position.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'fixed z-50 w-48 rounded-[var(--radius-md)] py-1',
        'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
        'shadow-lg shadow-black/30 animate-[fade-in_0.1s_ease-out]',
      )}
    >
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
  )
}
