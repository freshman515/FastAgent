import { app, ipcMain } from 'electron'
import { IPC, type AppInfo, type WebUiInfo } from '@shared/types'
import { webUiService } from '../services/WebUiService'

const REPOSITORY_OWNER = 'freshman515'
const REPOSITORY_REPO = 'FastAgent'
const REPOSITORY_URL = `https://github.com/${REPOSITORY_OWNER}/${REPOSITORY_REPO}`

export function registerAppInfoHandlers(): void {
  ipcMain.handle(IPC.APP_INFO, (): AppInfo => ({
    name: app.getName(),
    productName: 'FastAgents',
    version: app.getVersion(),
    appId: 'com.fastagents.app',
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    repository: {
      provider: 'github',
      owner: REPOSITORY_OWNER,
      repo: REPOSITORY_REPO,
      url: REPOSITORY_URL,
    },
    updateFeed: `${REPOSITORY_URL}/releases`,
  }))

  ipcMain.handle(IPC.WEB_UI_GET_INFO, (): WebUiInfo => ({
    url: webUiService.getLocalClaimUrl(),
    lanUrls: webUiService.getLanClaimUrls(),
    port: webUiService.getPort(),
    host: webUiService.getHost(),
  }))
}
