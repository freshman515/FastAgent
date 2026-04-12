import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  IPC,
  type ClaudeDiffReviewOptions,
  type ClaudeGuiRequestOptions,
  type ClaudePromptOptimizeOptions,
} from '@shared/types'
import { claudeGuiService } from '../services/ClaudeGuiService'
import { listClaudeGuiSkills } from '../services/ClaudeSkillCatalogService'

export function registerClaudeGuiHandlers(): void {
  ipcMain.handle(IPC.CLAUDE_GUI_START, async (event, options: ClaudeGuiRequestOptions) => {
    await claudeGuiService.start(event.sender, options)
  })

  ipcMain.handle(IPC.CLAUDE_GUI_STOP, async () => {
    await claudeGuiService.stop()
  })

  ipcMain.handle(IPC.CLAUDE_GUI_LIST_SKILLS, async (_event, cwd: string) => {
    return await listClaudeGuiSkills(cwd)
  })

  ipcMain.handle(IPC.CLAUDE_PROMPT_OPTIMIZE, async (_event, options: ClaudePromptOptimizeOptions) => {
    return claudeGuiService.optimizePrompt(options)
  })

  ipcMain.handle(IPC.CLAUDE_DIFF_REVIEW, async (_event, options: ClaudeDiffReviewOptions) => {
    return claudeGuiService.reviewDiff(options)
  })

  ipcMain.handle(IPC.CLAUDE_GUI_EXPORT, async (event, options: {
    suggestedName: string
    extension: 'md' | 'json'
    content: string
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false

    const safeName = options.suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'claude-gui-export'
    const extension = options.extension === 'json' ? 'json' : 'md'
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${safeName}.${extension}`,
      filters: extension === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md'] }],
    })

    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, options.content, 'utf-8')
    return true
  })
}
