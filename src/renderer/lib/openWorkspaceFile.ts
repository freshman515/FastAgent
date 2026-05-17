import { isExternalDocumentFileName } from '@shared/fileTypes'
import { type EditorNavigationTarget, useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { useUIStore } from '@/stores/ui'

interface OpenWorkspaceFileOptions {
  context?: {
    projectId?: string | null
    worktreeId?: string | null
  }
  location?: EditorNavigationTarget | null
  paneId?: string
}

function openInSystem(filePath: string): void {
  void window.api.shell.openPath(filePath).then((message: unknown) => {
    if (typeof message !== 'string' || !message.trim()) return
    useUIStore.getState().addToast({
      type: 'error',
      title: '打开文件失败',
      body: message,
    })
  }).catch((error: unknown) => {
    useUIStore.getState().addToast({
      type: 'error',
      title: '打开文件失败',
      body: error instanceof Error ? error.message : String(error),
    })
  })
}

export function openWorkspaceFile(filePath: string, options: OpenWorkspaceFileOptions = {}): string | null {
  if (isExternalDocumentFileName(filePath)) {
    openInSystem(filePath)
    return null
  }

  const editors = useEditorsStore.getState()
  const tabId = options.location
    ? editors.openFileAtLocation(filePath, options.location, options.context)
    : editors.openFile(filePath, options.context)

  const panes = usePanesStore.getState()
  const paneId = options.paneId ?? panes.activePaneId
  panes.addSessionToPane(paneId, tabId)
  panes.setPaneActiveSession(paneId, tabId)
  return tabId
}

export function openWorkspaceFileInSystem(filePath: string): void {
  openInSystem(filePath)
}
