export function buildBracketedPastePayload(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.includes('\n') ? `\x1b[200~${normalized}\x1b[201~` : normalized
}

export function buildNoteSendPayload(text: string, autoSubmit: boolean): string {
  return `${buildBracketedPastePayload(text)}${autoSubmit ? '\r' : ''}`
}
