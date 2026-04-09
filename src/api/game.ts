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

export interface KingSquareDto {
  x: number
  y: number
}

export interface ShopStateResponse {
  money: number
  hp: number
  hpMax: number
  items: ShopItemState[]
  bench: BenchSlotDto[]
  board: BoardPieceDto[]
  king: KingSquareDto
  /** Server wall-clock deadline (epoch ms) when the shared shop window ends. */
  shopPhaseEndsAt: number
}

/** Combined position after shop phase; `centipawns` is from White’s perspective (Stockfish). */
export interface BattleRoundResponse {
  fen: string
  centipawns: number
  advantage: string
  whiteUserId: number
  blackUserId: number
  currentUserIsWhite: boolean
  whiteBoard: BoardPieceDto[]
  blackBoard: BoardPieceDto[]
  whiteKing: KingSquareDto
  blackKing: KingSquareDto
  /** Up to 20 UCI half-moves from Stockfish PV (~10 moves per side; White to move in `fen`). */
  principalVariation: string[]
  whiteHp: number
  blackHp: number
}

const SHOP_PIECES: ShopPiece[] = ['pawn', 'knight', 'bishop', 'rook', 'queen']

/** White POV: rank 8 at row 0. Pawns may use chess ranks 2–4 only → rows 4–6. */
export const PAWN_RANK_ROWS_MIN = 4
export const PAWN_RANK_ROWS_MAX = 6
/** King may use any file a–h → columns 0–7. */
export const KING_LANE_COL_MIN = 0
export const KING_LANE_COL_MAX = 7
/** White POV rows for ranks 1–4 only; ranks 5–8 (rows 0–3) are blocked. */
export const KING_RANK_ROWS_MIN = 4
export const KING_RANK_ROWS_MAX = 7

function normalizeKingSquare(raw: unknown): KingSquareDto | null {
  const r = raw as Record<string, unknown>
  if (!r || typeof r !== 'object') return null
  const x = Number(r.x ?? r.X)
  const y = Number(r.y ?? r.Y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.trunc(x), y: Math.trunc(y) }
}

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

export interface SellPieceResponse {
  piece: ShopPiece
  moneyBefore: number
  moneyAfter: number
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
    const data = await request<ShopStateResponse & { board?: unknown[]; king?: unknown }>(
      `/api/game/matches/${matchId}/shop`,
      accessToken,
      {
        method: 'GET',
      },
    )
    const raw = data as unknown as Record<string, unknown>
    const endsRaw = raw.shopPhaseEndsAt ?? raw.shop_phase_ends_at
    const shopPhaseEndsAtN = Number(endsRaw)
    let shopPhaseEndsAt: number
    if (!Number.isFinite(shopPhaseEndsAtN) || shopPhaseEndsAtN <= 0) {
      shopPhaseEndsAt = Date.now() + 30_000
    } else {
      let ms = Math.trunc(shopPhaseEndsAtN)
      // Heuristic: epoch seconds vs millis (avoids clients drifting apart if one field is mis-serialized).
      if (ms < 1_000_000_000_000) {
        ms *= 1000
      }
      shopPhaseEndsAt = ms
    }

    const boardRaw = Array.isArray(data.board) ? data.board : []
    const board: BoardPieceDto[] = []
    for (const row of boardRaw) {
      const b = normalizeBoardPiece(row as unknown as Record<string, unknown>)
      if (b) board.push(b)
    }
    const king =
      normalizeKingSquare(data.king) ??
      ({ x: 4, y: 7 } satisfies KingSquareDto)
    const hp = Number.isFinite(Number(data.hp)) ? Math.trunc(Number(data.hp)) : 100
    const hpMax = Number.isFinite(Number(data.hpMax)) ? Math.max(1, Math.trunc(Number(data.hpMax))) : 100
    return {
      ...data,
      hp,
      hpMax,
      bench: Array.isArray(data.bench) ? data.bench : [],
      board,
      king,
      shopPhaseEndsAt,
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

  moveKing(
    matchId: number,
    body: { toX: number; toY: number },
    accessToken: string,
  ): Promise<void> {
    return request<void>(`/api/game/matches/${matchId}/king/move`, accessToken, {
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

  async sellPiece(
    matchId: number,
    body: { benchSlot: number } | { fromX: number; fromY: number },
    accessToken: string,
  ): Promise<SellPieceResponse> {
    const raw = await request<Record<string, unknown>>(
      `/api/game/matches/${matchId}/inventory/sell`,
      accessToken,
      { method: 'POST', body },
    )
    const piece = String(raw.piece ?? '').toLowerCase().trim() as ShopPiece
    if (!SHOP_PIECES.includes(piece)) {
      throw new Error('Invalid sell response')
    }
    return {
      piece,
      moneyBefore: Number(raw.moneyBefore ?? raw.money_before ?? 0),
      moneyAfter: Number(raw.moneyAfter ?? raw.money_after ?? 0),
    }
  },

  async evaluateBattleRound(matchId: number, accessToken: string): Promise<BattleRoundResponse> {
    const raw = await request<Record<string, unknown>>(
      `/api/game/matches/${matchId}/battle/evaluate-round`,
      accessToken,
      { method: 'POST' },
    )
    const whiteBoardRaw = Array.isArray(raw.whiteBoard) ? raw.whiteBoard : []
    const blackBoardRaw = Array.isArray(raw.blackBoard) ? raw.blackBoard : []
    const whiteBoard: BoardPieceDto[] = []
    const blackBoard: BoardPieceDto[] = []
    for (const row of whiteBoardRaw) {
      const b = normalizeBoardPiece(row as Record<string, unknown>)
      if (b) whiteBoard.push(b)
    }
    for (const row of blackBoardRaw) {
      const b = normalizeBoardPiece(row as Record<string, unknown>)
      if (b) blackBoard.push(b)
    }
    const whiteKing = normalizeKingSquare(raw.whiteKing) ?? { x: 4, y: 7 }
    const blackKing = normalizeKingSquare(raw.blackKing) ?? { x: 4, y: 0 }
    const pvRaw = raw.principalVariation ?? raw.principal_variation
    const principalVariation = Array.isArray(pvRaw)
      ? pvRaw
          .map((x) => String(x).trim())
          .filter((s) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s))
          .slice(0, 20)
      : []
    const whiteHpRaw = raw.whiteHp ?? raw.white_hp
    const blackHpRaw = raw.blackHp ?? raw.black_hp
    return {
      fen: String(raw.fen ?? ''),
      centipawns: Number(raw.centipawns ?? 0),
      advantage: String(raw.advantage ?? ''),
      whiteUserId: Number(raw.whiteUserId ?? 0),
      blackUserId: Number(raw.blackUserId ?? 0),
      currentUserIsWhite: Boolean(raw.currentUserIsWhite),
      whiteBoard,
      blackBoard,
      whiteKing,
      blackKing,
      principalVariation,
      whiteHp: Number.isFinite(Number(whiteHpRaw)) ? Math.max(0, Math.trunc(Number(whiteHpRaw))) : 100,
      blackHp: Number.isFinite(Number(blackHpRaw)) ? Math.max(0, Math.trunc(Number(blackHpRaw))) : 100,
    }
  },
}
