import type { SessionType } from '@shared/types'
import claudeIcon from '@/assets/icons/Claude.png'
import codexDarkIcon from '@/assets/icons/codex_white.svg'
import codexLightIcon from '@/assets/icons/codex_black.svg'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIconDark from '@/assets/icons/terminal_white.png'
import terminalIconLight from '@/assets/icons/terminal.png'
import { geminiIcon } from '@/lib/geminiIcon'
import { browserIcon } from '@/lib/browserIcon'

const TYPE_ICONS: Record<string, string> = {
  browser: browserIcon,
  'claude-code': claudeIcon,
  'claude-code-yolo': claudeIcon,
  'claude-code-wsl': claudeIcon,
  'claude-code-yolo-wsl': claudeIcon,
  'claude-gui': claudeIcon,
  gemini: geminiIcon,
  'gemini-yolo': geminiIcon,
  opencode: opencodeIcon,
  'terminal-wsl': terminalIconDark,
}

export function getSessionIcon(type: SessionType, isDarkTheme: boolean): string {
  if (type === 'terminal' || type === 'terminal-wsl') return isDarkTheme ? terminalIconDark : terminalIconLight
  if (type === 'codex' || type === 'codex-yolo' || type === 'codex-wsl' || type === 'codex-yolo-wsl') return isDarkTheme ? codexDarkIcon : codexLightIcon
  return TYPE_ICONS[type] ?? claudeIcon
}
