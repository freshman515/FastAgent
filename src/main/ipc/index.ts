import { registerWindowHandlers } from './window'
import { registerDialogHandlers } from './dialog'
import { registerNotificationHandlers } from './notification'
import { registerSessionHandlers } from './session'
import { registerConfigHandlers } from './config'

export function registerAllHandlers(): void {
  registerWindowHandlers()
  registerDialogHandlers()
  registerNotificationHandlers()
  registerSessionHandlers()
  registerConfigHandlers()
}
