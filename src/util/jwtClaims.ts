/** JWT `sub` from auth-service is the numeric user id (see JwtService.createAccessToken). */
export function parseUserIdFromAccessToken(accessToken: string | null): number | null {
  if (!accessToken?.includes('.')) return null
  const part = accessToken.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = base64.length % 4
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64
    const json = atob(padded)
    const payload = JSON.parse(json) as Record<string, unknown>
    const sub = payload.sub
    if (typeof sub === 'string' && sub.trim()) {
      const n = parseInt(sub.trim(), 10)
      return Number.isFinite(n) ? n : null
    }
    if (typeof sub === 'number' && Number.isFinite(sub)) return sub
    return null
  } catch {
    return null
  }
}
