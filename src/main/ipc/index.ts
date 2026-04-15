import { registerWindowHandlers } from './window'
import { registerDialogHandlers } from './dialog'
import { registerNotificationHandlers } from './notification'
import { registerSessionHandlers } from './session'
import { registerConfigHandlers } from './config'
import { registerMediaHandlers } from './media'
import { registerGitHandlers } from './git'
import { registerAiHandlers } from './ai'
import { registerClaudeGuiHandlers } from './claudeGui'
import { registerOpencodeHandlers } from './opencode'
import { registerSearchHandlers } from './search'
import { registerUpdaterHandlers } from './updater'

export function registerAllHandlers(): void {
  registerWindowHandlers()
  registerDialogHandlers()
  registerNotificationHandlers()
  registerSessionHandlers()
  registerConfigHandlers()
  registerMediaHandlers()
  registerGitHandlers()
  registerAiHandlers()
  registerClaudeGuiHandlers()
  registerOpencodeHandlers()
  registerSearchHandlers()
  registerUpdaterHandlers()
}
