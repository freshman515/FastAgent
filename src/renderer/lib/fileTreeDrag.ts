export interface FileTreeDragPayload {
  path: string
  isDir: boolean
}

export const FILE_TREE_DRAG_MIME = 'application/x-pragma-desk-file-tree-node'

export function readFileTreeDragPayload(dataTransfer: DataTransfer): FileTreeDragPayload | null {
  const raw = dataTransfer.getData(FILE_TREE_DRAG_MIME)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<FileTreeDragPayload>
    if (typeof parsed.path !== 'string' || typeof parsed.isDir !== 'boolean') return null
    return { path: parsed.path, isDir: parsed.isDir }
  } catch {
    return null
  }
}

export function hasFileTreeDragPayload(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(FILE_TREE_DRAG_MIME)
}

export function formatTerminalPath(path: string): string {
  return /\s/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path
}

export function formatTerminalPaths(paths: string[]): string {
  return paths.map(formatTerminalPath).join(' ')
}
