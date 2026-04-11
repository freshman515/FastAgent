import { ipcMain } from 'electron'
import { opencodeService, type OpencodeRequest, type OpencodeSubscriptionRequest } from '../services/OpencodeService'

export function registerOpencodeHandlers(): void {
  ipcMain.handle('opencode:request', async (_event, payload: OpencodeRequest) => {
    return await opencodeService.request(payload)
  })

  ipcMain.handle('opencode:list-models', async (_event, directory: string) => {
    return await opencodeService.listModels(directory)
  })

  ipcMain.handle('opencode:subscribe', async (event, payload: OpencodeSubscriptionRequest) => {
    return await opencodeService.subscribe(event.sender, payload)
  })

  ipcMain.handle('opencode:unsubscribe', (_event, subscriptionId: string) => {
    opencodeService.unsubscribe(subscriptionId)
  })
}
