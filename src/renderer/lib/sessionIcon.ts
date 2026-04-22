import type { SessionType } from '@shared/types'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/codex.png'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIconDark from '@/assets/icons/terminal_white.png'
import terminalIconLight from '@/assets/icons/terminal.png'

const TYPE_ICONS: Record<string, string> = {
  'claude-code': claudeIcon,
  'claude-code-yolo': claudeIcon,
  'claude-gui': claudeIcon,
  codex: codexIcon,
  'codex-yolo': codexIcon,
  opencode: opencodeIcon,
}

export function getSessionIcon(type: SessionType, isDarkTheme: boolean): string {
  if (type === 'terminal') return isDarkTheme ? terminalIconDark : terminalIconLight
  return TYPE_ICONS[type] ?? claudeIcon
}
