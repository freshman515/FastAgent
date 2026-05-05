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
