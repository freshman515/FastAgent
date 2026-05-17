import { clipboard, ipcMain, nativeImage } from 'electron'
import { IPC } from '@shared/types'

export function registerClipboardHandlers(): void {
  ipcMain.handle(IPC.CLIPBOARD_WRITE_IMAGE, (_event, dataUrl: string) => {
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) return false

    try {
      const image = nativeImage.createFromDataURL(dataUrl)
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      return true
    } catch {
      return false
    }
  })
}
