import type { StructuredWorkerReport } from '@shared/types'

const FIELD_ALIASES: Record<string, keyof Omit<StructuredWorkerReport, 'raw' | 'updatedAt'>> = {
  状态: 'status',
  status: 'status',
  修改文件: 'filesChanged',
  fileschanged: 'filesChanged',
  files: 'filesChanged',
  验证: 'verification',
  verification: 'verification',
  tests: 'verification',
  风险: 'risks',
  risks: 'risks',
  阻塞: 'blockers',
  blockers: 'blockers',
  建议下一步: 'suggestedNextAction',
  下一步: 'suggestedNextAction',
  suggestednextaction: 'suggestedNextAction',
  next: 'suggestedNextAction',
}

function normalizeKey(raw: string): string {
  return raw.replace(/[\s_-]/g, '').replace(/[：:]+$/, '').toLowerCase()
}

function parseFieldLine(line: string): { key: keyof Omit<StructuredWorkerReport, 'raw' | 'updatedAt'>; value: string } | null {
  const trimmed = line.trim().replace(/^[-*]\s*/, '')
  const match = trimmed.match(/^([^:：]{1,40})[:：]\s*(.*)$/)
  if (!match) return null
  const [, rawKey, rawValue] = match
  const key = FIELD_ALIASES[normalizeKey(rawKey)]
  if (!key) return null
  return { key, value: rawValue.trim() }
}

function splitFiles(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

export function parseStructuredWorkerReport(output: string): StructuredWorkerReport | null {
  const marker = output.lastIndexOf('RESULT:')
  if (marker === -1) return null

  const raw = output.slice(marker).trim()
  const lines = raw.split(/\r?\n/).slice(1)
  const fields: Omit<StructuredWorkerReport, 'raw' | 'updatedAt'> = {
    status: '',
    filesChanged: [],
    verification: '',
    risks: '',
    blockers: '',
    suggestedNextAction: '',
  }

  let currentKey: keyof Omit<StructuredWorkerReport, 'raw' | 'updatedAt'> | null = null

  for (const line of lines) {
    const parsed = parseFieldLine(line)
    if (parsed) {
      currentKey = parsed.key
      if (parsed.key === 'filesChanged') {
        fields.filesChanged = splitFiles(parsed.value)
      } else {
        fields[parsed.key] = parsed.value
      }
      continue
    }

    if (!currentKey) continue
    const continuation = line.trim().replace(/^[-*]\s*/, '').trim()
    if (!continuation) continue
    if (currentKey === 'filesChanged') {
      fields.filesChanged.push(...splitFiles(continuation))
    } else {
      fields[currentKey] = fields[currentKey]
        ? `${fields[currentKey]}\n${continuation}`
        : continuation
    }
  }

  const hasContent = fields.status
    || fields.filesChanged.length > 0
    || fields.verification
    || fields.risks
    || fields.blockers
    || fields.suggestedNextAction
  if (!hasContent) return null

  return {
    ...fields,
    filesChanged: Array.from(new Set(fields.filesChanged)),
    raw,
    updatedAt: Date.now(),
  }
}
