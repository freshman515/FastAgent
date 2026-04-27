export function windowsPathToWslPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized) return normalized

  const wslShareMatch = normalized.match(/^\/\/wsl(?:\.localhost)?\/[^/]+(\/.*)$/i)
  if (wslShareMatch) return wslShareMatch[1] || '/'

  const driveMatch = normalized.match(/^([A-Za-z]):(?:\/(.*))?$/)
  if (!driveMatch) return normalized

  const drive = driveMatch[1].toLowerCase()
  const rest = driveMatch[2] ?? ''
  return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`
}

export function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}
