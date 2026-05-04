import {
  AUTH_ACCESS_STORAGE_KEY,
  AUTH_REFRESH_STORAGE_KEY,
  AUTOCHESS_TOKENS_UPDATED_EVENT,
} from '../constants/authStorageKeys.ts'
import { getGameApi } from './config.ts'
import { authApi } from './auth.ts'
import { coerceMatchId, readApiErrorFromText } from './client.ts'
import { getAccessTokenExp } from '../util/jwtClaims.ts'

export interface MatchResponse {
  matchId: number
  status: string
  currentRound: number
  playerIds: number[]
  /** Present when {@link status} is `FINISHED`. */
  winnerUserId: number | null
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
  /** Opponent HP when the game service includes it on `/shop` (optional). */
  opponentHp?: number
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
  /** Shared server epoch ms when battle presentation should end and both clients return to shop. */
  battleViewEndsAt: number
  whiteHp: number
  blackHp: number
  /** True when the match ended this round (elimination or already resolved). */
  matchFinished: boolean
  winnerUserId: number | null
}

const SHOP_PIECES: ShopPiece[] = ['pawn', 'knight', 'bishop', 'rook', 'queen']

/** White POV: rank 8 at row 0. Pawns may use chess ranks 2–4 only → rows 4–6. */
export const PAWN_RANK_ROWS_MIN = 4
/** Must stay in sync with `PlayerResources.DEFAULT_HP` in game-service (starting / max HP). */
export const GAME_HP_MAX = 30

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
  const winnerRaw = d.winnerUserId ?? d.winner_user_id
  const winnerN = winnerRaw != null && winnerRaw !== '' ? Number(winnerRaw) : NaN
  return {
    matchId: id,
    status: String(d.status ?? ''),
    currentRound: Number(d.currentRound ?? d.current_round ?? 0),
    playerIds,
    winnerUserId: Number.isFinite(winnerN) ? Math.trunc(winnerN) : null,
  }
}

/**
 * game-service often refreshes the JWT inside GET /shop before React re-renders. Mutations must not send the
 * stale access token still held in component state - sessionStorage is updated synchronously on refresh.
 */
function resolveAccessTokenForGameRequest(passed: string): string {
  const stored = sessionStorage.getItem(AUTH_ACCESS_STORAGE_KEY)?.trim()
  if (stored) return stored
  return passed.trim()
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

/** Single-flight refresh when game-service returns 401/403 (often expired JWT). */
let refreshInFlight: Promise<string | null> | null = null

async function refreshAccessTokenForGame(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight
  const storedRefresh = sessionStorage.getItem(AUTH_REFRESH_STORAGE_KEY)
  if (!storedRefresh?.trim()) return null

  refreshInFlight = (async () => {
    try {
      const res = await authApi.refresh({ refreshToken: storedRefresh })
      sessionStorage.setItem(AUTH_ACCESS_STORAGE_KEY, res.accessToken)
      sessionStorage.setItem(AUTH_REFRESH_STORAGE_KEY, res.refreshToken ?? storedRefresh)
      window.dispatchEvent(
        new CustomEvent(AUTOCHESS_TOKENS_UPDATED_EVENT, {
          detail: { accessToken: res.accessToken },
        }),
      )
      return res.accessToken
    } catch {
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

/**
 * Only refresh proactively when the token is essentially out of life. Aggressive proactive refresh can mask
 * deeper issues (e.g. mismatched JWT secrets between services); the on-403 retry path still handles real
 * expirations.
 */
const GAME_TOKEN_REFRESH_WITHIN_SEC = 30

async function resolveTokenForGameFetch(passed: string, retried: boolean): Promise<string> {
  let token = resolveAccessTokenForGameRequest(passed)
  if (retried || !token) return token
  const exp = getAccessTokenExp(token)
  const now = Math.floor(Date.now() / 1000)
  if (exp != null && exp - now <= GAME_TOKEN_REFRESH_WITHIN_SEC) {
    const next = await refreshAccessTokenForGame()
    if (next?.trim()) return next.trim()
  }
  return token
}

async function request<T>(
  path: string,
  accessToken: string,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  const token = await resolveTokenForGameFetch(accessToken, retried)
  if (!token.trim()) {
    throw new Error('Not signed in or session expired. Please log in again.')
  }
  const { body, ...rest } = options
  const headers = new Headers()
  if (options.headers) {
    new Headers(options.headers as HeadersInit).forEach((value, key) => {
      const k = key.toLowerCase()
      if (k !== 'authorization' && k !== 'content-type') {
        headers.set(key, value)
      }
    })
  }
  headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${token.trim()}`)
  const init: RequestInit = {
    ...rest,
    cache: 'no-store',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  const res = await fetch(getGameApi(path), init)
  if (!res.ok) {
    if (!retried && (res.status === 401 || res.status === 403)) {
      const nextToken = await refreshAccessTokenForGame()
      if (nextToken) {
        return request(path, nextToken, options, true)
      }
    }
    // Buffer the response body once so we can both log it (for diagnostics) and surface it to the UI.
    const rawBody = await res.text().catch(() => '')
    const tokPreview = `${token.slice(0, 12)}…${token.slice(-8)} len=${token.length}`
    const bodyPreview = rawBody.length > 200 ? `${rawBody.slice(0, 200)}…` : rawBody
    console.warn(
      `[gameApi] ${options.method ?? 'GET'} ${path} -> HTTP ${res.status} ${res.statusText}; token=${tokPreview}; retried=${retried}; body=${bodyPreview || '<empty>'}`,
    )
    throw new Error(await readApiErrorFromText(res, rawBody))
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
    const hpMax = Number.isFinite(Number(data.hpMax)) ? Math.max(1, Math.trunc(Number(data.hpMax))) : GAME_HP_MAX
    const hpRaw = Number.isFinite(Number(data.hp)) ? Math.trunc(Number(data.hp)) : hpMax
    const hp = Math.min(Math.max(0, hpRaw), hpMax)

    const oppHpRaw = raw.opponentHp ?? raw.opponent_hp
    let opponentHp: number | undefined
    if (Number.isFinite(Number(oppHpRaw))) {
      opponentHp = Math.min(Math.max(0, Math.trunc(Number(oppHpRaw))), GAME_HP_MAX)
    }

    return {
      ...data,
      hp,
      hpMax,
      opponentHp,
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
    const battleViewEndsAtRaw = raw.battleViewEndsAt ?? raw.battle_view_ends_at
    const battleViewEndsAtN = Number(battleViewEndsAtRaw)
    const matchFinishedRaw = raw.matchFinished ?? raw.match_finished
    const winnerRaw = raw.winnerUserId ?? raw.winner_user_id
    const winnerN = winnerRaw != null && winnerRaw !== '' ? Number(winnerRaw) : NaN
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
      battleViewEndsAt: Number.isFinite(battleViewEndsAtN) ? Math.trunc(battleViewEndsAtN) : Date.now() + 25_000,
      whiteHp: Number.isFinite(Number(whiteHpRaw)) ? Math.max(0, Math.trunc(Number(whiteHpRaw))) : 100,
      blackHp: Number.isFinite(Number(blackHpRaw)) ? Math.max(0, Math.trunc(Number(blackHpRaw))) : 100,
      matchFinished: Boolean(matchFinishedRaw),
      winnerUserId: Number.isFinite(winnerN) ? Math.trunc(winnerN) : null,
    }
  },

  resignMatch(matchId: number, accessToken: string): Promise<void> {
    return request<void>(`/api/game/matches/${matchId}/resign`, accessToken, {
      method: 'POST',
    })
  },
}
