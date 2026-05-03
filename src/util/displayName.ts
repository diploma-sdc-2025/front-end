const STORAGE_KEY = 'autochess_display_name'

/** JWT payload `username` claim from auth-service (see JwtService.CLAIM_USERNAME). */
export function parseUsernameFromAccessToken(accessToken: string | null): string | null {
  if (!accessToken?.includes('.')) return null
  const part = accessToken.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = base64.length % 4
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64
    const json = atob(padded)
    const payload = JSON.parse(json) as Record<string, unknown>
    const u = payload.username
    if (typeof u === 'string' && u.trim()) return u.trim()
    return null
  } catch {
    return null
  }
}

export function setStoredDisplayName(name: string) {
  const t = name.trim()
  if (t) sessionStorage.setItem(STORAGE_KEY, t)
}

export function clearStoredDisplayName() {
  sessionStorage.removeItem(STORAGE_KEY)
}

export function getStoredDisplayName(): string | null {
  const s = sessionStorage.getItem(STORAGE_KEY)
  return s?.trim() ? s.trim() : null
}

/** Prefer JWT `username`, then last login/register identifier we stored. */
export function resolveDisplayName(accessToken: string | null): string {
  return (
    parseUsernameFromAccessToken(accessToken) ??
    getStoredDisplayName() ??
    'Player'
  )
}
