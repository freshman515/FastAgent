const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

const WORD_DOCUMENT_EXTENSIONS = new Set([
  'doc',
  'docx',
  'docm',
  'dot',
  'dotx',
  'dotm',
  'odt',
  'rtf',
])

const SPREADSHEET_DOCUMENT_EXTENSIONS = new Set([
  'ods',
  'xls',
  'xlsb',
  'xlsm',
  'xlsx',
  'xlt',
  'xltm',
  'xltx',
])

export type DocumentFileKind = 'pdf' | 'word' | 'spreadsheet'

export function getFileExtension(fileName: string): string {
  const baseName = fileName.split(/[/\\]/).pop() ?? fileName
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === baseName.length - 1) return ''
  return baseName.slice(dotIndex + 1).toLowerCase()
}

export function getImageMimeType(fileName: string): string | null {
  return IMAGE_MIME_BY_EXTENSION[getFileExtension(fileName)] ?? null
}

export function isImageFileName(fileName: string): boolean {
  return getImageMimeType(fileName) !== null
}

export function getDocumentFileKind(fileName: string): DocumentFileKind | null {
  const extension = getFileExtension(fileName)
  if (extension === 'pdf') return 'pdf'
  if (WORD_DOCUMENT_EXTENSIONS.has(extension)) return 'word'
  if (SPREADSHEET_DOCUMENT_EXTENSIONS.has(extension)) return 'spreadsheet'
  return null
}

export function isPdfFileName(fileName: string): boolean {
  return getDocumentFileKind(fileName) === 'pdf'
}

export function isExternalDocumentFileName(fileName: string): boolean {
  const kind = getDocumentFileKind(fileName)
  return kind === 'word' || kind === 'spreadsheet'
}
