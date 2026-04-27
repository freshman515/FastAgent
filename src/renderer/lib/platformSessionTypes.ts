import { isWslSessionType, type SessionType } from '@shared/types'

export function isSessionTypeAvailableOnCurrentPlatform(type: SessionType): boolean {
  if (isWslSessionType(type)) return window.api.platform === 'win32'
  return true
}

export function normalizeSessionTypeForCurrentPlatform(type: SessionType): SessionType {
  return isSessionTypeAvailableOnCurrentPlatform(type) ? type : 'terminal'
}

export function filterSessionTypesForCurrentPlatform<T extends { type?: SessionType; id?: string; value?: SessionType }>(items: T[]): T[] {
  return items.filter((item) => {
    const type = item.type ?? item.value ?? item.id
    return typeof type === 'string'
      ? isSessionTypeAvailableOnCurrentPlatform(type as SessionType)
      : true
  })
}
