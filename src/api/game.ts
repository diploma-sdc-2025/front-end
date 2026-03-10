import { getGameApi } from './config.ts'

export interface MatchResponse {
  matchId: number
  status: string
  currentRound: number
  playerIds: number[]
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
  const res = await fetch(getGameApi(path), init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as { message?: string }).message ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const gameApi = {
  getMatch(matchId: number, accessToken: string): Promise<MatchResponse> {
    return request<MatchResponse>(`/api/game/matches/${matchId}`, accessToken, { method: 'GET' })
  },

  startMatch(matchId: number, accessToken: string): Promise<void> {
    return request<void>(`/api/game/matches/${matchId}/start`, accessToken, { method: 'POST' })
  },

  getState(matchId: number, accessToken: string): Promise<{ phase?: string; round?: number }> {
    return request(`/api/game/matches/${matchId}/state`, accessToken, { method: 'GET' })
  },

  getBoard(matchId: number, accessToken: string): Promise<unknown> {
    return request(`/api/game/matches/${matchId}/board`, accessToken, { method: 'GET' })
  },
}
