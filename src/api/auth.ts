import { getAuthApi } from './config.ts'
import { extractAuthTokens, readApiError } from './client.ts'

/** Backend expects "identifier" (email or username) + password */
export interface LoginRequest {
  identifier: string
  password: string
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  expiresIn?: number
  tokenType?: string
}

export interface RefreshRequest {
  refreshToken: string
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, ...rest } = options
  const init: RequestInit = {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as HeadersInit),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  const res = await fetch(getAuthApi(path), init)
  if (!res.ok) {
    throw new Error(await readApiError(res))
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

function jsonToAuthResponse(data: unknown): AuthResponse {
  const tokens = extractAuthTokens(data as Record<string, unknown>)
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? '',
  }
}

export const authApi = {
  /** No body; creates a throwaway account and returns tokens (see auth-service POST /api/auth/guest). */
  async guest(): Promise<AuthResponse> {
    const json = await request<unknown>('/api/auth/guest', { method: 'POST' })
    return jsonToAuthResponse(json)
  },

  async login(data: LoginRequest): Promise<AuthResponse> {
    const json = await request<unknown>('/api/auth/login', { method: 'POST', body: data })
    return jsonToAuthResponse(json)
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const res = await fetch(getAuthApi('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      throw new Error(await readApiError(res))
    }
    // Backend may return 200 with no body; then obtain tokens via login
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return authApi.login({ identifier: data.email, password: data.password })
    }
    const text = await res.text()
    if (!text.trim()) {
      return authApi.login({ identifier: data.email, password: data.password })
    }
    try {
      const json = JSON.parse(text) as unknown
      try {
        return jsonToAuthResponse(json)
      } catch {
        return authApi.login({ identifier: data.email, password: data.password })
      }
    } catch {
      return authApi.login({ identifier: data.email, password: data.password })
    }
  },

  async refresh(data: RefreshRequest): Promise<AuthResponse> {
    const json = await request<unknown>('/api/auth/refresh', { method: 'POST', body: data })
    return jsonToAuthResponse(json)
  },

  async logout(data: RefreshRequest): Promise<void> {
    await request<void>('/api/auth/logout', { method: 'POST', body: data })
  },
}
