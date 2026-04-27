import { useCallback } from 'react'
import type { SessionType } from '@shared/types'
import { cn } from '@/lib/utils'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { createSessionWithPrompt } from '@/lib/createSession'
import { usePanesStore } from '@/stores/panes'
import { useUIStore, type CustomSessionDefinition } from '@/stores/ui'
import { SessionIconView } from './SessionIconView'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/codex_white.svg'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIcon from '@/assets/icons/terminal_white.png'
import { geminiIcon } from '@/lib/geminiIcon'
import { browserIcon } from '@/lib/browserIcon'

export interface SessionOption {
  type: SessionType
  label: string
  icon: string
}

export interface NewSessionOption {
  id: string
  label: string
  icon: string
  type?: SessionType
  customSessionDefinitionId?: string
}

export const SESSION_OPTIONS: SessionOption[] = [
  { type: 'terminal', label: 'Terminal', icon: terminalIcon },
  { type: 'terminal-wsl', label: 'Terminal(WSL)', icon: terminalIcon },
  { type: 'browser', label: 'Browser', icon: browserIcon },
  { type: 'claude-code', label: 'Claude Code', icon: claudeIcon },
  { type: 'claude-code-yolo', label: 'Claude Code YOLO', icon: claudeIcon },
  { type: 'claude-code-wsl', label: 'Claude Code(WSL)', icon: claudeIcon },
  { type: 'claude-code-yolo-wsl', label: 'Claude Code YOLO(WSL)', icon: claudeIcon },
  { type: 'claude-gui', label: 'Claude GUI', icon: claudeIcon },
  { type: 'codex', label: 'Codex', icon: codexIcon },
  { type: 'codex-yolo', label: 'Codex YOLO', icon: codexIcon },
  { type: 'codex-wsl', label: 'Codex(WSL)', icon: codexIcon },
  { type: 'codex-yolo-wsl', label: 'Codex YOLO(WSL)', icon: codexIcon },
  { type: 'gemini', label: 'Gemini', icon: geminiIcon },
  { type: 'gemini-yolo', label: 'Gemini YOLO', icon: geminiIcon },
  { type: 'opencode', label: 'OpenCode', icon: opencodeIcon },
]

export function buildNewSessionOptions(customDefinitions: CustomSessionDefinition[]): NewSessionOption[] {
  return [
    ...SESSION_OPTIONS.map((option) => ({
      id: option.type,
      label: option.label,
      icon: option.icon,
      type: option.type,
    })),
    ...customDefinitions.map((definition) => ({
      id: `custom:${definition.id}`,
      label: definition.name,
      icon: definition.icon,
      customSessionDefinitionId: definition.id,
    })),
  ]
}

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
  const customSessionDefinitions = useUIStore((s) => s.settings.customSessionDefinitions)
  const options = buildNewSessionOptions(customSessionDefinitions)

  const handleSelect = useCallback(
    (option: NewSessionOption) => {
      const worktreeId = getDefaultWorktreeIdForProject(projectId)
      const targetPane = paneId ?? usePanesStore.getState().activePaneId
      createSessionWithPrompt({
        projectId,
        type: option.type,
        customSessionDefinitionId: option.customSessionDefinitionId,
        worktreeId,
      }, (id) => {
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
      <div className="flex flex-col gap-0.5">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleSelect(opt)}
            className={cn(
              'group/item relative flex h-9 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-left transition-all duration-200',
              'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white',
            )}
          >
            {/* Left accent bar on hover */}
            <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/item:scale-y-100 group-hover/item:opacity-100 group-hover/item:shadow-[0_0_8px_var(--color-accent)]" />

            <SessionIconView icon={opt.customSessionDefinitionId ? opt.icon : undefined} fallbackSrc={opt.customSessionDefinitionId ? undefined : opt.icon} className="transition-transform duration-200 group-hover/item:scale-110" />
            <span className="flex-1 text-[13px] font-medium">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
