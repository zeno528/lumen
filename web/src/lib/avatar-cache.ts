import type { AvatarSettings } from '@/api/settings'

export function readAvatarCache(): AvatarSettings | undefined {
  try {
    const cached = localStorage.getItem('avatar')
    return cached ? (JSON.parse(cached) as AvatarSettings) : undefined
  } catch {
    return undefined
  }
}

export function saveAvatarCache(avatar: AvatarSettings) {
  try {
    localStorage.setItem('avatar', JSON.stringify(avatar))
  } catch {
    /* quota 等不影响功能 */
  }
}
