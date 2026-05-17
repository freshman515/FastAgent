export function buildBracketedPastePayload(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.includes('\n') ? `\x1b[200~${normalized}\x1b[201~` : normalized
}

export async function sendNoteTextToPty(ptyId: string, text: string, autoSubmit: boolean): Promise<boolean> {
  if (autoSubmit) {
    return window.api.session.submit(ptyId, text, true)
  }
  window.api.session.write(ptyId, buildBracketedPastePayload(text))
  return true
}
