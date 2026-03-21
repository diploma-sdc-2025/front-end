/**
 * Shared helpers for calling microservices (or a single gateway).
 */

export function joinApiUrl(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const b = base.trim()
  if (!b) return p
  return `${b.replace(/\/$/, '')}${p}`
}

export async function readApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  if (!text.trim()) return res.statusText || `HTTP ${res.status}`
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const msg = j.message ?? j.error ?? j.detail
    if (typeof msg === 'string' && msg.trim()) return msg
    if (Array.isArray(j.errors) && j.errors.length > 0) {
      const first = j.errors[0] as Record<string, unknown> | string
      if (typeof first === 'string') return first
      if (first && typeof first === 'object' && typeof first.defaultMessage === 'string') {
        return first.defaultMessage
      }
    }
  } catch {
    /* not JSON */
  }
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/** Accepts snake_case or camelCase from Spring / other backends */
export function extractAuthTokens(data: Record<string, unknown>): {
  accessToken: string
  refreshToken: string | null
} {
  const access = (data.accessToken ?? data.access_token ?? data.token) as string | undefined
  const refresh = (data.refreshToken ?? data.refresh_token) as string | undefined
  if (!access?.trim()) {
    throw new Error('Server did not return an access token')
  }
  return {
    accessToken: access.trim(),
    refreshToken: refresh?.trim() ? refresh.trim() : null,
  }
}

export function coerceMatchId(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const n = typeof value === 'number' ? value : parseInt(String(value), 10)
  return Number.isFinite(n) ? n : null
}
