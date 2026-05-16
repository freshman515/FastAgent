import type { SessionType } from '@shared/types'
import claudeIcon from '@/assets/icons/Claude.png'
import codexDarkIcon from '@/assets/icons/codex_white.svg'
import codexLightIcon from '@/assets/icons/codex_black.svg'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIconDark from '@/assets/icons/terminal_white.png'
import terminalIconLight from '@/assets/icons/terminal.png'
import { geminiIcon } from '@/lib/geminiIcon'
import { browserIcon } from '@/lib/browserIcon'

const noteIcon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect x="5" y="4" width="14" height="16" rx="2" fill="#f0c35a"/><path d="M8 8h8M8 12h6M8 16h5" stroke="#3b2f14" stroke-width="1.7" stroke-linecap="round"/></svg>')}`

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
  note: noteIcon,
  'terminal-wsl': terminalIconDark,
}

export function getSessionIcon(type: SessionType, isDarkTheme: boolean): string {
  if (type === 'terminal' || type === 'terminal-wsl') return isDarkTheme ? terminalIconDark : terminalIconLight
  if (type === 'codex' || type === 'codex-yolo' || type === 'codex-wsl' || type === 'codex-yolo-wsl') return isDarkTheme ? codexDarkIcon : codexLightIcon
  return TYPE_ICONS[type] ?? claudeIcon
}
