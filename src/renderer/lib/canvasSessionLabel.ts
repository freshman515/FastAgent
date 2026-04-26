export function normalizeSessionRemark(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function formatSessionCardTitle(sessionName: string, remark: string | null | undefined): string {
  const normalized = normalizeSessionRemark(remark)
  return normalized ? `${sessionName}（${normalized}）` : sessionName
}
