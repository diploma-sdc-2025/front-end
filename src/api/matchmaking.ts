import { getMatchmakingApi } from './config.ts'

export interface QueueJoinResponse {
  status: string
  userId: number
  queueSize: number
  joinedAt?: string
}

export interface QueueStatusResponse {
  inQueue: boolean
  position: number | null
  queueSize: number
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

async function request<T>(
  path: string,
  accessToken: string,
  options: RequestOptions = {}
): Promise<T> {
  const { body, ...rest } = options
  const init: RequestInit = {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(accessToken),
      ...(options.headers as HeadersInit),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  const res = await fetch(getMatchmakingApi(path), init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as { message?: string }).message ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const matchmakingApi = {
  join(accessToken: string): Promise<QueueJoinResponse> {
    return request<QueueJoinResponse>('/api/matchmaking/join', accessToken, { method: 'POST' })
  },

  leave(accessToken: string): Promise<void> {
    return request<void>('/api/matchmaking/leave', accessToken, { method: 'POST' })
  },

  status(accessToken: string): Promise<QueueStatusResponse> {
    return request<QueueStatusResponse>('/api/matchmaking/status', accessToken, { method: 'GET' })
  },
}
