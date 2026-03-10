import { getAuthApi } from './config.ts'

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
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as { message?: string }).message ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const authApi = {
  login(data: LoginRequest): Promise<AuthResponse> {
    return request<AuthResponse>('/api/auth/login', { method: 'POST', body: data })
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const res = await fetch(getAuthApi('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message ?? res.statusText)
    }
    // Backend returns 200 with no body; log in to get tokens (use email as identifier)
    return authApi.login({ identifier: data.email, password: data.password })
  },

  refresh(data: RefreshRequest): Promise<AuthResponse> {
    return request<AuthResponse>('/api/auth/refresh', { method: 'POST', body: data })
  },

  logout(data: RefreshRequest): Promise<void> {
    return request<void>('/api/auth/logout', { method: 'POST', body: data })
  },
}
