import type { NoteImage } from '@shared/types'
import type { ClipboardEvent } from 'react'

const NOTE_IMAGE_PLACEHOLDER_RE = /\[\[图片:([A-Za-z0-9_-]+)\]\]|\[Image #([1-9]\d*)\]/g

export type NoteContentPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; image: NoteImage }

export function pasteEventHasImage(event: ClipboardEvent<HTMLTextAreaElement>): boolean {
  return Array.from(event.clipboardData?.items ?? []).some((item) => item.type.startsWith('image/'))
}

export async function readNoteImagesFromPasteEvent(event: ClipboardEvent<HTMLTextAreaElement>): Promise<NoteImage[]> {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))

  const now = Date.now()
  const images = await Promise.all(files.map(async (file, index) => ({
    id: createNoteImageId(),
    name: file.name || `pasted-image-${index + 1}`,
    mediaType: file.type || 'image/png',
    dataUrl: await readBlobAsDataUrl(file),
    createdAt: now + index,
  })))

  return images.filter((image) => image.dataUrl.startsWith('data:image/'))
}

export async function readNoteImagesFromClipboardItems(items: ClipboardItem[]): Promise<NoteImage[]> {
  const imageTypes = items.flatMap((item) =>
    item.types
      .filter((type) => type.startsWith('image/'))
      .map((type) => ({ item, type })),
  )
  const now = Date.now()
  const images = await Promise.all(imageTypes.map(async ({ item, type }, index) => {
    const blob = await item.getType(type)
    return {
      id: createNoteImageId(),
      name: `clipboard-image-${index + 1}`,
      mediaType: blob.type || type || 'image/png',
      dataUrl: await readBlobAsDataUrl(blob),
      createdAt: now + index,
    }
  }))

  return images.filter((image) => image.dataUrl.startsWith('data:image/'))
}

function createNoteImageId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') return `note-image-${randomUUID.call(globalThis.crypto)}`
  return `note-image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function getNoteImageToken(image: NoteImage): string {
  return image.id.replace(/^note-image-/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || image.id.slice(0, 8)
}

export function getNoteImageDisplayIndex(image: NoteImage, fallbackIndex?: number): number {
  if (typeof image.displayIndex === 'number' && Number.isInteger(image.displayIndex) && image.displayIndex > 0) {
    return image.displayIndex
  }
  return typeof fallbackIndex === 'number' ? fallbackIndex + 1 : 1
}

export function assignNoteImageDisplayIndices(images: NoteImage[], existingImages: NoteImage[]): NoteImage[] {
  const nextIndex = existingImages.reduce((max, image, index) => Math.max(max, getNoteImageDisplayIndex(image, index)), 0) + 1
  return images.map((image, index) => ({
    ...image,
    displayIndex: nextIndex + index,
  }))
}

export function createNoteImagePlaceholder(image: NoteImage, fallbackIndex?: number): string {
  return `[Image #${getNoteImageDisplayIndex(image, fallbackIndex)}]`
}

export function createNoteImagePlaceholderText(images: NoteImage[]): string {
  return images.map((image, index) => createNoteImagePlaceholder(image, index)).join(' ')
}

export function createInlinePlaceholderInsertion(_before: string, placeholderText: string, _after: string): string {
  return placeholderText
}

export function removeNoteImagePlaceholders(text: string, image: NoteImage): string {
  return text
    .replace(NOTE_IMAGE_PLACEHOLDER_RE, (match, matchedToken: string | undefined, matchedIndex: string | undefined) => (
      placeholderMatchesImage(image, matchedToken, matchedIndex) ? '' : match
    ))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

export function hasNoteImagePlaceholder(text: string, image: NoteImage, fallbackIndex?: number): boolean {
  for (const match of text.matchAll(NOTE_IMAGE_PLACEHOLDER_RE)) {
    if (placeholderMatchesImage(image, match[1], match[2], fallbackIndex)) return true
  }
  return false
}

export function syncNoteImagesWithBodyChange(
  previousText: string,
  nextText: string,
  images: NoteImage[],
): NoteImage[] {
  let removed = false
  const nextImages = images.filter((image, index) => {
    const wasReferenced = hasNoteImagePlaceholder(previousText, image, index)
    if (!wasReferenced) return true
    const stillReferenced = hasNoteImagePlaceholder(nextText, image, index)
    if (!stillReferenced) removed = true
    return stillReferenced
  })
  return removed ? nextImages : images
}

export function buildNoteContentParts(
  text: string,
  images: NoteImage[],
  options: { includeUnreferencedImages?: boolean } = {},
): NoteContentPart[] {
  const parts: NoteContentPart[] = []
  const referencedIds = new Set<string>()
  let lastIndex = 0

  for (const match of text.matchAll(NOTE_IMAGE_PLACEHOLDER_RE)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push({ kind: 'text', text: text.slice(lastIndex, index) })
    const image = findNoteImageByPlaceholder(images, match[1], match[2])
    if (image) {
      parts.push({ kind: 'image', image })
      referencedIds.add(image.id)
    } else {
      parts.push({ kind: 'text', text: match[0] })
    }
    lastIndex = index + match[0].length
  }

  if (lastIndex < text.length) parts.push({ kind: 'text', text: text.slice(lastIndex) })

  if (options.includeUnreferencedImages) {
    for (const image of images) {
      if (!referencedIds.has(image.id)) parts.push({ kind: 'image', image })
    }
  }

  return mergeAdjacentTextParts(parts)
}

export async function writeNoteImageToClipboard(image: NoteImage): Promise<boolean> {
  const wroteViaMain = await window.api.clipboard.writeImageDataUrl(image.dataUrl).catch(() => false)
  if (wroteViaMain) return true

  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
  const blob = await dataUrlToBlob(image.dataUrl)
  if (!blob.type.startsWith('image/')) return false
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  return true
}

function findNoteImageByPlaceholder(
  images: NoteImage[],
  token: string | undefined,
  displayIndexText: string | undefined,
): NoteImage | null {
  if (token) return images.find((image) => image.id === token || getNoteImageToken(image) === token) ?? null
  const displayIndex = displayIndexText ? Number(displayIndexText) : Number.NaN
  if (!Number.isFinite(displayIndex)) return null
  return images.find((image, index) => getNoteImageDisplayIndex(image, index) === displayIndex) ?? null
}

function placeholderMatchesImage(
  image: NoteImage,
  token: string | undefined,
  displayIndexText: string | undefined,
  fallbackIndex?: number,
): boolean {
  if (token) return token === image.id || token === getNoteImageToken(image)
  const displayIndex = displayIndexText ? Number(displayIndexText) : Number.NaN
  return Number.isFinite(displayIndex) && displayIndex === getNoteImageDisplayIndex(image, fallbackIndex)
}

function mergeAdjacentTextParts(parts: NoteContentPart[]): NoteContentPart[] {
  const merged: NoteContentPart[] = []
  for (const part of parts) {
    if (part.kind === 'text' && part.text.length === 0) continue
    const previous = merged[merged.length - 1]
    if (part.kind === 'text' && previous?.kind === 'text') {
      previous.text += part.text
    } else {
      merged.push(part)
    }
  }
  return merged
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

function readBlobAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}
