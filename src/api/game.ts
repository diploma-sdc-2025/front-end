import { getGameApi } from './config.ts'
import { coerceMatchId, readApiError } from './client.ts'

export interface MatchResponse {
  matchId: number
  status: string
  currentRound: number
  playerIds: number[]
}

export type ShopPiece = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen'

export interface ShopItemState {
  piece: ShopPiece
  cost: number
  affordable: boolean
  owned: number
}

export interface BenchSlotDto {
  slot: number
  piece: ShopPiece
}

export interface BoardPieceDto {
  x: number
  y: number
  piece: ShopPiece
}

export interface ShopStateResponse {
  money: number
  items: ShopItemState[]
  bench: BenchSlotDto[]
  board: BoardPieceDto[]
}

const SHOP_PIECES: ShopPiece[] = ['pawn', 'knight', 'bishop', 'rook', 'queen']

function normalizeBoardPiece(raw: Record<string, unknown>): BoardPieceDto | null {
  const x = Number(raw.x ?? raw.X)
  const y = Number(raw.y ?? raw.Y)
  const piece = raw.piece ?? raw.Piece
  if (!Number.isFinite(x) || !Number.isFinite(y) || typeof piece !== 'string') return null
  const p = piece.toLowerCase().trim() as ShopPiece
  if (!SHOP_PIECES.includes(p)) return null
  return { x: Math.trunc(x), y: Math.trunc(y), piece: p }
}

export interface BuyPieceResponse {
  piece: ShopPiece
  moneyBefore: number
  moneyAfter: number
  slot: number
}

function normalizeMatch(data: unknown): MatchResponse {
  const d = data as Record<string, unknown>
  const id = coerceMatchId(d.matchId ?? d.match_id)
  if (id === null) throw new Error('Invalid match: missing matchId')
  // game-service MatchResponse uses `players` (List<Long>)
  const playersRaw = d.players ?? d.playerIds ?? d.player_ids
  const playerIds = Array.isArray(playersRaw)
    ? playersRaw
        .map((p) => (typeof p === 'number' ? p : parseInt(String(p), 10)))
        .filter((n) => Number.isFinite(n))
    : []
  return {
    matchId: id,
    status: String(d.status ?? ''),
    currentRound: Number(d.currentRound ?? d.current_round ?? 0),
    playerIds,
  }
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
  const res = await fetch(getGameApi(path), init)
  if (!res.ok) {
    throw new Error(await readApiError(res))
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text.trim()) {
    throw new Error('Unexpected empty response from game service')
  }
  return JSON.parse(text) as T
}

export const gameApi = {
  async getMatch(matchId: number, accessToken: string): Promise<MatchResponse> {
    const raw = await request<unknown>(`/api/game/matches/${matchId}`, accessToken, { method: 'GET' })
    return normalizeMatch(raw)
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

  async getShop(matchId: number, accessToken: string): Promise<ShopStateResponse> {
    const data = await request<ShopStateResponse & { board?: unknown[] }>(
      `/api/game/matches/${matchId}/shop`,
      accessToken,
      {
        method: 'GET',
      },
    )
    const boardRaw = Array.isArray(data.board) ? data.board : []
    const board: BoardPieceDto[] = []
    for (const row of boardRaw) {
      const b = normalizeBoardPiece(row as unknown as Record<string, unknown>)
      if (b) board.push(b)
    }
    return {
      ...data,
      bench: Array.isArray(data.bench) ? data.bench : [],
      board,
    }
  },

  placePieceFromBench(
    matchId: number,
    body: { benchSlot: number; squareX: number; squareY: number },
    accessToken: string,
  ): Promise<void> {
    return request<void>(`/api/game/matches/${matchId}/inventory/place`, accessToken, {
      method: 'POST',
      body,
    })
  },

  moveBoardPiece(
    matchId: number,
    body: { fromX: number; fromY: number; toX: number; toY: number },
    accessToken: string,
  ): Promise<void> {
    return request<void>(`/api/game/matches/${matchId}/inventory/move`, accessToken, {
      method: 'POST',
      body,
    })
  },

  buyPiece(matchId: number, piece: ShopPiece, accessToken: string): Promise<BuyPieceResponse> {
    return request(`/api/game/matches/${matchId}/shop/buy`, accessToken, {
      method: 'POST',
      body: { piece },
    })
  },
}
