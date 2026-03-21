import { getMatchmakingApi } from './config.ts'
import { coerceMatchId, readApiError } from './client.ts'

export interface QueueJoinResponse {
  status: string
  userId: number
  queueSize: number
  joinedAt?: string
  /** Present if the backend assigns a match immediately */
  matchId?: number
  match_id?: number
}

export interface QueueStatusResponse {
  inQueue: boolean
  position: number | null
  queueSize: number
  /** When a match is ready, the backend may expose the id here */
  matchId?: number
  match_id?: number
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

async function request<T>(
  path: string,
  accessToken: string,
  options: RequestOptions = {},
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
    throw new Error(await readApiError(res))
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text.trim()) {
    throw new Error('Unexpected empty response from matchmaking service')
  }
  return JSON.parse(text) as T
}

/** Match id from join or status payloads (camelCase or snake_case). */
export function matchIdFromJoinOrStatus(
  payload: QueueJoinResponse | QueueStatusResponse | Record<string, unknown>,
): number | null {
  const p = payload as Record<string, unknown>
  return coerceMatchId(p.matchId ?? p.match_id)
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
