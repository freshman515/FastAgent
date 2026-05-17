import type { NoteImage, SessionDataEvent } from '@shared/types'
import { buildNoteContentParts, writeNoteImageToClipboard } from '@/lib/noteClipboardImage'

const NOTE_IMAGE_PASTE_DELAY_MS = 90
const NOTE_TEXT_AFTER_IMAGE_DELAY_MS = 35
const NOTE_TEXT_BEFORE_IMAGE_BASE_DELAY_MS = 45
const NOTE_TEXT_BEFORE_IMAGE_MAX_DELAY_MS = 180
const NOTE_TEXT_ECHO_TIMEOUT_MS = 1600
const NOTE_TEXT_MARKER_DELETE_DELAY_MS = 35
const NOTE_LEADING_NEWLINE_AFTER_IMAGE_DELAY_MS = 50
const NOTE_IMAGE_LINE_BREAK_SEPARATOR = ' '
const NOTE_IMAGE_ECHO_TIMEOUT_MS = 2400
const NOTE_ECHO_BUFFER_LIMIT = 12000
const CLEAR_INPUT_SETTLE_MS = 900
const CLEAR_INPUT_BACKSPACE_LIMIT = 8192
const CLEAR_FULL_INPUT = [
  '\x1b[1;5F',
  '\x1b[F',
  '\x05',
  '\x0b',
  '\x15',
  '\x7f'.repeat(CLEAR_INPUT_BACKSPACE_LIMIT),
].join('')

const ptyOperationQueues = new Map<string, Promise<void>>()

export function buildBracketedPastePayload(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.includes('\n') ? `\x1b[200~${normalized}\x1b[201~` : normalized
}

export async function sendNoteTextToPty(ptyId: string, text: string, autoSubmit: boolean): Promise<boolean> {
  return enqueuePtyOperation(ptyId, () => sendNoteTextToPtyNow(ptyId, text, autoSubmit))
}

async function sendNoteTextToPtyNow(ptyId: string, text: string, autoSubmit: boolean): Promise<boolean> {
  if (autoSubmit) {
    return window.api.session.submit(ptyId, text, true)
  }
  await writePty(ptyId, buildBracketedPastePayload(text))
  return true
}

export function clearPtyInput(ptyId: string): void {
  void enqueuePtyOperation(ptyId, async () => {
    await writePty(ptyId, CLEAR_FULL_INPUT)
    await delay(CLEAR_INPUT_SETTLE_MS)
  })
}

export function getClearPtyInputPayload(): string {
  return CLEAR_FULL_INPUT
}

export async function sendNoteContentToPty(
  ptyId: string,
  text: string,
  images: NoteImage[],
  autoSubmit: boolean,
  options: { includeUnreferencedImages?: boolean } = {},
): Promise<boolean> {
  return enqueuePtyOperation(ptyId, () =>
    sendNoteContentToPtyNow(ptyId, text, images, autoSubmit, options),
  )
}

async function sendNoteContentToPtyNow(
  ptyId: string,
  text: string,
  images: NoteImage[],
  autoSubmit: boolean,
  options: { includeUnreferencedImages?: boolean } = {},
): Promise<boolean> {
  const parts = buildNoteContentParts(text, images, options)
  const hasImages = parts.some((part) => part.kind === 'image')
  if (!hasImages) return sendNoteTextToPtyNow(ptyId, text, autoSubmit)

  let pastedImageCount = 0
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.kind === 'text') {
      if (part.text) {
        await writeTextPartToPty(ptyId, part.text, parts[index - 1]?.kind === 'image')
        if (parts[index + 1]?.kind === 'image') {
          await delay(getTextBeforeImageDelayMs(part.text))
        }
      }
      continue
    }

    const wroteClipboard = await writeNoteImageToClipboard(part.image)
    if (!wroteClipboard) return false
    pastedImageCount += 1
    await pasteImageToPty(ptyId, pastedImageCount)
    if (autoSubmit || parts[index + 1]) {
      await delay(NOTE_IMAGE_PASTE_DELAY_MS)
      if (parts[index + 1]) await delay(NOTE_TEXT_AFTER_IMAGE_DELAY_MS)
    }
  }

  if (autoSubmit) {
    await window.api.session.submit(ptyId, '', true)
  }

  return true
}

function enqueuePtyOperation<T>(ptyId: string, operation: () => Promise<T>): Promise<T> {
  const previous = ptyOperationQueues.get(ptyId) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(operation)
  const cleanup = run
    .then(() => undefined, () => undefined)
    .finally(() => {
      if (ptyOperationQueues.get(ptyId) === cleanup) {
        ptyOperationQueues.delete(ptyId)
      }
    })
  ptyOperationQueues.set(ptyId, cleanup)
  return run
}

async function writePty(ptyId: string, data: string): Promise<void> {
  await window.api.session.write(ptyId, data)
}

async function writeTextPartToPty(ptyId: string, text: string, splitLeadingNewlines = false): Promise<void> {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (splitLeadingNewlines) {
    const leadingNewlines = normalized.match(/^\n+/)?.[0] ?? ''
    if (leadingNewlines) {
      const lineBreaks = `${NOTE_IMAGE_LINE_BREAK_SEPARATOR}\n${'\n'.repeat(leadingNewlines.length - 1)}`
      await writePty(ptyId, buildBracketedPastePayload(lineBreaks))
      await delay(NOTE_LEADING_NEWLINE_AFTER_IMAGE_DELAY_MS * leadingNewlines.length)
      const rest = normalized.slice(leadingNewlines.length)
      if (!rest) return
      return writeTextPartToPty(ptyId, rest)
    }
  }

  if (!normalizeComparableText(normalized)) {
    await writePty(ptyId, buildBracketedPastePayload(normalized))
    return
  }

  const marker = createTextSyncMarker()
  await waitForPtyEcho(
    ptyId,
    () => writePty(ptyId, buildBracketedPastePayload(`${normalized}${marker}`)),
    (echo) => normalizeComparableText(echo).includes(marker),
    NOTE_TEXT_ECHO_TIMEOUT_MS,
  )
  await writePty(ptyId, '\x7f'.repeat(marker.length))
  await delay(NOTE_TEXT_MARKER_DELETE_DELAY_MS)
}

async function pasteImageToPty(ptyId: string, expectedMinimumImageIndex: number): Promise<void> {
  await waitForPtyEcho(
    ptyId,
    () => writePty(ptyId, '\x1bv'),
    (echo) => getHighestImagePlaceholderIndex(echo) >= expectedMinimumImageIndex,
    NOTE_IMAGE_ECHO_TIMEOUT_MS,
  )
}

async function waitForPtyEcho(
  ptyId: string,
  action: () => Promise<void>,
  matches: (echo: string) => boolean,
  timeoutMs: number,
): Promise<void> {
  let buffer = ''
  let complete = false
  let unsubscribe: (() => void) | null = null
  let actionError: unknown = null

  await new Promise<void>((resolve) => {
    const finish = () => {
      if (complete) return
      complete = true
      unsubscribe?.()
      window.clearTimeout(timeout)
      resolve()
    }

    const timeout = window.setTimeout(finish, timeoutMs)
    unsubscribe = window.api.session.onData((event: SessionDataEvent) => {
      if (event.ptyId !== ptyId) return
      buffer = (buffer + normalizePtyEcho(event.data)).slice(-NOTE_ECHO_BUFFER_LIMIT)
      if (matches(buffer)) finish()
    })

    void action().catch((error) => {
      actionError = error
      finish()
    })
  })

  if (actionError) throw actionError
}

function createTextSyncMarker(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `__PD${Date.now().toString(36)}${random}__`
}

function normalizeComparableText(text: string): string {
  return text
    .replace(/\[Image #\d+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getHighestImagePlaceholderIndex(text: string): number {
  let highest = 0
  for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
    const index = Number(match[1])
    if (Number.isFinite(index)) highest = Math.max(highest, index)
  }
  return highest
}

function normalizePtyEcho(data: string): string {
  return data
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-B]/g, '')
    .replace(/\x1b[>=<][^\x1b]*/g, '')
    .replace(/\x1b./g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
}

function getTextBeforeImageDelayMs(text: string): number {
  const length = [...text].length
  return Math.min(
    NOTE_TEXT_BEFORE_IMAGE_MAX_DELAY_MS,
    NOTE_TEXT_BEFORE_IMAGE_BASE_DELAY_MS + Math.floor(length / 8) * 20,
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
