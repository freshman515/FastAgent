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
import { geminiIcon } from '@/lib/geminiIcon'

export interface SessionOption {
  type: SessionType
  label: string
  icon: string
}

export const SESSION_OPTIONS: SessionOption[] = [
  { type: 'terminal', label: '终端', icon: terminalIcon },
  { type: 'claude-code', label: 'Claude Code', icon: claudeIcon },
  { type: 'claude-code-yolo', label: 'Claude Code YOLO', icon: claudeIcon },
  { type: 'claude-gui', label: 'Claude GUI', icon: claudeIcon },
  { type: 'codex', label: 'Codex', icon: codexIcon },
  { type: 'codex-yolo', label: 'Codex YOLO', icon: codexIcon },
  { type: 'gemini', label: 'Gemini', icon: geminiIcon },
  { type: 'gemini-yolo', label: 'Gemini YOLO', icon: geminiIcon },
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
        'fixed z-[10000] w-52 overflow-hidden rounded-[var(--radius-lg)] border border-white/[0.08]',
        'bg-[var(--color-bg-secondary)]/90 backdrop-blur-2xl p-1',
        'shadow-[0_12px_40px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.05)]',
        'animate-in fade-in zoom-in-95 duration-150',
      )}
    >
      <div className="px-3 py-1.5 mb-1 border-b border-white/[0.05]">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] opacity-60">新建会话</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {SESSION_OPTIONS.map((opt) => (
          <button
            key={opt.type}
            onClick={() => handleSelect(opt.type)}
            className={cn(
              'group/item relative flex h-9 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-left transition-all duration-200',
              'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white',
            )}
          >
            {/* Left accent bar on hover */}
            <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/item:scale-y-100 group-hover/item:opacity-100 group-hover/item:shadow-[0_0_8px_var(--color-accent)]" />

            <div className="flex h-5 w-5 shrink-0 items-center justify-center transition-transform duration-200 group-hover/item:scale-110">
              <img src={opt.icon} alt="" className="h-4.5 w-4.5 shrink-0" />
            </div>
            <span className="flex-1 text-[13px] font-medium">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
