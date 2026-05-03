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
  return readApiErrorFromText(res, text)
}

/**
 * Same logic as {@link readApiError} but operates on an already-buffered body so callers
 * can read the body once for both logging and user-facing error messages (a Response body
 * stream can only be consumed once).
 */
export async function readApiErrorFromText(res: Response, text: string): Promise<string> {
  const trimmed = text.trim()
  const stamp = `(HTTP ${res.status} ${res.url ?? ''})`.trim()
  if (!trimmed) {
    if (res.status === 401) {
      return `Not signed in or session expired. Please log in again. ${stamp}`
    }
    if (res.status === 403) {
      return `Access denied. Sign in again, or open this match from the lobby with the same account that joined it. ${stamp}`
    }
    if (res.status === 409) {
      return `This match has already ended. ${stamp}`
    }
    return res.statusText ? `${res.statusText} ${stamp}` : stamp
  }
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>
    const msg = j.message ?? j.error ?? j.detail
    if (typeof msg === 'string' && msg.trim()) {
      const m = msg.trim()
      if (res.status === 403 && (m === 'Forbidden' || m === 'Access Denied')) {
        return `Access denied. Sign in again, or open this match from the lobby with the same account that joined it. ${stamp}`
      }
      return `${m} ${stamp}`
    }
    if (Array.isArray(j.errors) && j.errors.length > 0) {
      const first = j.errors[0] as Record<string, unknown> | string
      if (typeof first === 'string') return `${first} ${stamp}`
      if (first && typeof first === 'object' && typeof first.defaultMessage === 'string') {
        return `${first.defaultMessage} ${stamp}`
      }
    }
  } catch {
    /* not JSON */
  }
  if (res.status === 403 && trimmed === 'Forbidden') {
    return `Access denied. Sign in again, or open this match from the lobby with the same account that joined it. ${stamp}`
  }
  const body = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed
  return `${body} ${stamp}`
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
