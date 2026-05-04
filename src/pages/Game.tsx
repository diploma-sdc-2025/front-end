import { Link, useNavigate, useParams } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'
import gameStyle from './GamePage.module.css'
import lobbyBoardStyle from '../components/LobbyChessBoard.module.css'
import { BattlePreviewBoard } from '../components/BattlePreviewBoard.tsx'
import { EvaluationBar } from '../components/EvaluationBar.tsx'
import {
  assignSpriteDragPreviewCanvas,
  LobbyChessBoard,
  parsePieceDragPayload,
  setBenchDragData,
  type BoardPlacedPiece,
} from '../components/LobbyChessBoard.tsx'
import {
  gameApi,
  GAME_HP_MAX,
  type BoardPieceDto,
  PAWN_RANK_ROWS_MAX,
  PAWN_RANK_ROWS_MIN,
  type BattleRoundResponse,
  type ShopPiece,
  type ShopStateResponse,
} from '../api/game.ts'
import { fetchUsersByIds, formatPlayerLine } from '../api/users.ts'
import { resolveDisplayName } from '../util/displayName.ts'
import { battleApi, type BattleEvaluateResponse } from '../api/battle.ts'
import { battlePositionAfterUciMoves, type BattleReplayPosition } from '../util/battlePvReplay.ts'
import { applyDisplayPreferencesToDocument, getSavedDisplayPreferences } from '../util/displayPreferences.ts'
import {
  playBattleReplayMoveSound,
  playBattleStartSound,
  playPieceMoveSound,
} from '../util/menuAudio.ts'
import { parseIsGuestFromAccessToken, parseUserIdFromAccessToken } from '../util/jwtClaims.ts'

const PIECE_SPRITES = {
  pawn: '/pieces/pawn-white.png',
  knight: '/pieces/knight-white.png',
  bishop: '/pieces/bishop-white.png',
  rook: '/pieces/rook-white.png',
  queen: '/pieces/queen-white.png',
} as const

const ROUND_DURATION_SEC = 30
/** Short pause on the start position before PV stepping (must be > 0 so Strict Mode cannot cancel the arm before it fires). */
const PV_REPLAY_DELAY_MS = 50
/** Mirrors game-service replay pacing (same as {@code GameService.BATTLE_VIEW_STEP_MS}). */
const BATTLE_VIEW_STEP_MS = 1000
const BATTLE_EVAL_RETRY_MS = 1200
/** Pause on the final battle position before returning to shop / placement. */
const BATTLE_END_PAUSE_MS = 2500
/** Half-moves (plies): 20 = White and Black each move 10 times. */
const PV_REPLAY_MAX_PLIES = 20
/** Keep in sync with backend safety buffer for battle timeline restore. */
const BATTLE_VIEW_SAFETY_BUFFER_MS = 750
const SHOP_ORDER: ShopPiece[] = ['pawn', 'knight', 'bishop', 'rook', 'queen']
const TUTORIAL_BENCH: (ShopPiece | null)[] = Array.from({ length: 8 }, () => null)
const TUTORIAL_START_MONEY = 2
const TUTORIAL_ENEMY_KING = { x: 4, y: 0 }
const TUTORIAL_ENEMY_PIECES: BoardPieceDto[] = [{ x: 4, y: 1, piece: 'pawn' }]
/** After each tutorial battle (until the cap), black gains one extra pawn on an empty square. */
const TUTORIAL_MAX_ROUNDS = 8
const TUTORIAL_MIN_ROW = 4 // ranks 1-4 only (white POV)
const TUTORIAL_MAX_ROW = 7

type GamePhase = 'shop' | 'battle'
type GameMode = 'normal' | 'tutorial'

type GameProps = {
  mode?: GameMode
}

type TutorialBattleState = {
  fen: string
  eval: BattleEvaluateResponse
}

function formatRoundTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function opponentHpFromBattle(res: BattleRoundResponse): number {
  return res.currentUserIsWhite ? res.blackHp : res.whiteHp
}

/** Registered players see a static ±10 hint on the end screen; guests do not. */
function matchEndRatingOverlay(won: boolean, token: string | null): { won: boolean; ratingDelta?: number } {
  if (!token || parseIsGuestFromAccessToken(token)) return { won }
  return { won, ratingDelta: won ? 10 : -10 }
}

function addBlackPawnForTutorial(blackKing: { x: number; y: number }, pieces: BoardPieceDto[]): BoardPieceDto[] {
  const occupied = new Set<string>([`${blackKing.x},${blackKing.y}`])
  for (const p of pieces) occupied.add(`${p.x},${p.y}`)
  for (const y of [1, 2, 3, 0]) {
    for (let x = 0; x < 8; x++) {
      if (occupied.has(`${x},${y}`)) continue
      return [...pieces, { x, y, piece: 'pawn' as const }]
    }
  }
  return pieces
}

function boardToFenPlacement(
  whiteKing: { col: number; row: number },
  whitePieces: BoardPlacedPiece[],
  blackKing: { x: number; y: number },
  blackPieces: BoardPieceDto[],
): string {
  const board: string[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ''))
  const put = (x: number, y: number, symbol: string) => {
    if (x < 0 || x > 7 || y < 0 || y > 7) return
    board[y]![x] = symbol
  }
  put(whiteKing.col, whiteKing.row, 'K')
  for (const piece of whitePieces) {
    const symbol = piece.piece === 'knight' ? 'N' : piece.piece[0]!.toUpperCase()
    put(piece.col, piece.row, symbol)
  }
  put(blackKing.x, blackKing.y, 'k')
  for (const piece of blackPieces) {
    const symbol = piece.piece === 'knight' ? 'n' : piece.piece[0]!
    put(piece.x, piece.y, symbol)
  }

  return board
    .map((row) => {
      let out = ''
      let empty = 0
      for (const sq of row) {
        if (!sq) {
          empty += 1
        } else {
          if (empty > 0) out += String(empty)
          out += sq
          empty = 0
        }
      }
      if (empty > 0) out += String(empty)
      return out
    })
    .join('/')
}

function tutorialEnemyOccupiesSquare(col: number, row: number, enemyPieces: BoardPieceDto[]): boolean {
  if (col === TUTORIAL_ENEMY_KING.x && row === TUTORIAL_ENEMY_KING.y) return true
  return enemyPieces.some((p) => p.x === col && p.y === row)
}

/** Own king or a board piece on {@param col},{@param row}; optional {@param excludeFrom} when moving a piece off that square. */
function friendlyBlocksShopSquare(
  col: number,
  row: number,
  kingSquare: { col: number; row: number },
  boardPieces: BoardPlacedPiece[],
  excludeMovingFrom: { col: number; row: number } | null,
): boolean {
  if (kingSquare.col === col && kingSquare.row === row) return true
  return boardPieces.some((p) => {
    if (excludeMovingFrom && p.col === excludeMovingFrom.col && p.row === excludeMovingFrom.row) return false
    return p.col === col && p.row === row
  })
}

export function Game({ mode = 'normal' }: GameProps) {
  const navigate = useNavigate()
  const { matchId } = useParams<{ matchId: string }>()
  const { accessToken } = useAuth()
  const [pawnMoney, setPawnMoney] = useState(2)
  /** Visual bar capacity: at least 2, expands if the server reports higher gold. */
  const [pawnMoneyCap, setPawnMoneyCap] = useState(2)
  const [playerHp, setPlayerHp] = useState(GAME_HP_MAX)
  const [playerHpMax, setPlayerHpMax] = useState(GAME_HP_MAX)
  const [opponentHp, setOpponentHp] = useState(GAME_HP_MAX)
  /** From auth users API; shown in shop/battle headers. */
  const [selfUsername, setSelfUsername] = useState('')
  const [opponentUsername, setOpponentUsername] = useState('')
  const [roundTimeLeft, setRoundTimeLeft] = useState(ROUND_DURATION_SEC)
  /** Server-authoritative shop deadline (epoch ms); keeps multi-tab countdowns aligned. */
  const [shopPhaseEndsAtMs, setShopPhaseEndsAtMs] = useState<number | null>(null)
  /** Once the shared deadline passes, lock into "battle pending" until evaluate succeeds/retries. */
  const [battlePending, setBattlePending] = useState(false)
  const [shopCosts, setShopCosts] = useState<Record<ShopPiece, number>>({
    pawn: 1,
    knight: 3,
    bishop: 3,
    rook: 5,
    queen: 8,
  })
  const [shopAffordable, setShopAffordable] = useState<Record<ShopPiece, boolean>>({
    pawn: false,
    knight: false,
    bishop: false,
    rook: false,
    queen: false,
  })
  const [buyingPiece, setBuyingPiece] = useState<ShopPiece | null>(null)
  const [shopError, setShopError] = useState('')
  const [benchSlots, setBenchSlots] = useState<(ShopPiece | null)[]>(() =>
    Array.from({ length: 8 }, () => null),
  )
  const [boardPieces, setBoardPieces] = useState<BoardPlacedPiece[]>([])
  /** Synced with shop `king`; defaults to server initial (e1). */
  const [kingSquare, setKingSquare] = useState<{ col: number; row: number }>({ col: 4, row: 7 })
  const [placingPiece, setPlacingPiece] = useState(false)
  const [phase, setPhase] = useState<GamePhase>('shop')
  const [battleResult, setBattleResult] = useState<BattleRoundResponse | null>(null)
  const [battleError, setBattleError] = useState('')
  const [battleEvalRetryTick, setBattleEvalRetryTick] = useState(0)
  const [battleRestoreDone, setBattleRestoreDone] = useState(false)
  /** Set after battle replay when the server reports the match ended (elimination). */
  const [matchEndOverlay, setMatchEndOverlay] = useState<{ won: boolean; ratingDelta?: number } | null>(null)
  /** One-shot popup when an online battle round begins (White vs Black). */
  const [battleColorSplashOpen, setBattleColorSplashOpen] = useState(false)
  const battleRequestRef = useRef(false)
  const shopRefreshTimerRef = useRef<number | null>(null)
  const shopSyncRequestIdRef = useRef(0)
  const phaseRef = useRef<GamePhase>(phase)
  phaseRef.current = phase
  const [pvMovesApplied, setPvMovesApplied] = useState(0)
  const battleReplayPlySoundRef = useRef(-1)
  const tutorialReplayPlySoundRef = useRef(-1)
  const [sellBinVisible, setSellBinVisible] = useState(false)
  const [sellBinOver, setSellBinOver] = useState(false)

  type TapSelection =
    | { source: 'bench'; benchSlot: number }
    | { source: 'board'; col: number; row: number }
    | { source: 'king' }
    | null
  const [tapSelection, setTapSelection] = useState<TapSelection>(null)

  const isTutorialMode = mode === 'tutorial'
  const battleSessionKey = useMemo(
    () => (matchId ? `autochess:battle:${matchId}` : 'autochess:battle:unknown'),
    [matchId],
  )
  const [tutorialBenchSlots, setTutorialBenchSlots] = useState<(ShopPiece | null)[]>(() => [...TUTORIAL_BENCH])
  const [tutorialBoardPieces, setTutorialBoardPieces] = useState<BoardPlacedPiece[]>([])
  const [tutorialKingSquare, setTutorialKingSquare] = useState<{ col: number; row: number }>({ col: 4, row: 7 })
  const [tutorialPawnMoney, setTutorialPawnMoney] = useState(TUTORIAL_START_MONEY)
  const [tutorialPawnMoneyCap, setTutorialPawnMoneyCap] = useState(TUTORIAL_START_MONEY)
  const [tutorialRoundTimeLeft, setTutorialRoundTimeLeft] = useState(ROUND_DURATION_SEC)
  const [tutorialTimerSeed, setTutorialTimerSeed] = useState(0)
  const [tutorialInBattle, setTutorialInBattle] = useState(false)
  const [tutorialBattleState, setTutorialBattleState] = useState<TutorialBattleState | null>(null)
  const [tutorialBattleError, setTutorialBattleError] = useState('')
  const [tutorialPvMovesApplied, setTutorialPvMovesApplied] = useState(0)
  const [showTutorialWelcome, setShowTutorialWelcome] = useState(() => mode === 'tutorial')
  const [showTutorialShopHint, setShowTutorialShopHint] = useState(false)
  const [showTutorialBenchHint, setShowTutorialBenchHint] = useState(false)
  const [showTutorialCurrencyHint, setShowTutorialCurrencyHint] = useState(false)
  const [tutorialBoughtFirstPiece, setTutorialBoughtFirstPiece] = useState(false)
  const [showTutorialDragHint, setShowTutorialDragHint] = useState(false)
  const [tutorialDragHintShown, setTutorialDragHintShown] = useState(false)
  const [showTutorialEvalHint, setShowTutorialEvalHint] = useState(false)
  const [tutorialEvalHintAcknowledged, setTutorialEvalHintAcknowledged] = useState(false)
  const [tutorialCurrencyHintShown, setTutorialCurrencyHintShown] = useState(false)
  const [tutorialBattlesCompleted, setTutorialBattlesCompleted] = useState(0)
  const [tutorialRemoveHintAcknowledged, setTutorialRemoveHintAcknowledged] = useState(false)
  const [showTutorialTimerBattleHint, setShowTutorialTimerBattleHint] = useState(false)
  const [tutorialTimerBattleHintAcknowledged, setTutorialTimerBattleHintAcknowledged] = useState(false)
  const [showTutorialKnightBishopHint, setShowTutorialKnightBishopHint] = useState(false)
  const [tutorialKnightBishopHintAcknowledged, setTutorialKnightBishopHintAcknowledged] = useState(false)
  const [tutorialEnemyPieces, setTutorialEnemyPieces] = useState<BoardPieceDto[]>(() => [...TUTORIAL_ENEMY_PIECES])
  const [showTutorialComplete, setShowTutorialComplete] = useState(false)
  const previousTutorialMoneyRef = useRef(tutorialPawnMoney)
  /** Only reset shop countdown when `tutorialTimerSeed` bumps (new shop round), not when tutorial popups open/close. */
  const tutorialShopTimerLastSeedRef = useRef<number | null>(null)
  const tutorialBattlesCompletedPrevRef = useRef(0)
  const showTutorialRemoveHint =
    isTutorialMode &&
    !tutorialInBattle &&
    tutorialBattlesCompleted >= 1 &&
    !tutorialRemoveHintAcknowledged
  const hasBlockingTutorialHint =
    showTutorialShopHint ||
    showTutorialBenchHint ||
    showTutorialCurrencyHint ||
    showTutorialDragHint ||
    showTutorialEvalHint ||
    showTutorialRemoveHint ||
    showTutorialTimerBattleHint ||
    showTutorialKnightBishopHint

  /** Shop timer can show 0 while battle evaluation runs; block buys/placement until phase flips. */
  const shopInteractionsLocked = useMemo(
    () => !isTutorialMode && Boolean(battlePending || matchEndOverlay),
    [isTutorialMode, battlePending, matchEndOverlay],
  )

  useEffect(() => {
    return () => {
      if (shopRefreshTimerRef.current != null) {
        window.clearTimeout(shopRefreshTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    applyDisplayPreferencesToDocument(getSavedDisplayPreferences())
  }, [])

  const applyBenchFromApi = useCallback((bench: { slot: number; piece: ShopPiece }[]) => {
    const next: (ShopPiece | null)[] = Array.from({ length: 8 }, () => null)
    for (const b of bench) {
      if (b.slot >= 0 && b.slot < 8 && SHOP_ORDER.includes(b.piece)) {
        next[b.slot] = b.piece
      }
    }
    setBenchSlots(next)
  }, [])

  const applyBoardFromApi = useCallback((board: { x: number; y: number; piece: ShopPiece }[]) => {
    const next: BoardPlacedPiece[] = []
    for (const p of board) {
      if (!SHOP_ORDER.includes(p.piece)) continue
      if (p.x < 0 || p.x > 7 || p.y < 0 || p.y > 7) continue
      next.push({ col: p.x, row: p.y, piece: p.piece })
    }
    setBoardPieces(next)
  }, [])

  useEffect(() => {
    battleRequestRef.current = false
    shopSyncRequestIdRef.current = 0
    setPhase('shop')
    setShopPhaseEndsAtMs(null)
    setBattlePending(false)
    setMatchEndOverlay(null)
    // Avoid showing a fake local 30s countdown before first authoritative /shop sync.
    setRoundTimeLeft(0)
    setBattleResult(null)
    setBattleError('')
    setBattleEvalRetryTick(0)
    setPlayerHp(GAME_HP_MAX)
    setPlayerHpMax(GAME_HP_MAX)
    setOpponentHp(GAME_HP_MAX)
    setSelfUsername('')
    setOpponentUsername('')
    setBattleRestoreDone(false)
  }, [matchId])

  useEffect(() => {
    if (isTutorialMode) return
    if (!accessToken || !matchId) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    let cancelled = false
    void (async () => {
      try {
        const m = await gameApi.getMatch(id, accessToken)
        const selfId = parseUserIdFromAccessToken(accessToken)
        const names = await fetchUsersByIds(accessToken, m.playerIds)
        if (cancelled) return
        const selfGuest = parseIsGuestFromAccessToken(accessToken)
        if (selfId != null) {
          const sp = names.get(selfId)
          setSelfUsername(formatPlayerLine(sp, resolveDisplayName(accessToken), selfGuest))
        } else {
          setSelfUsername(formatPlayerLine(undefined, resolveDisplayName(accessToken), selfGuest))
        }
        const oppId = m.playerIds.find((p) => p !== selfId)
        if (oppId != null) {
          const op = names.get(oppId)
          setOpponentUsername(formatPlayerLine(op, `Player ${oppId}`, op?.guest ?? false))
        } else {
          setOpponentUsername('Opponent')
        }
      } catch {
        if (!cancelled) {
          setSelfUsername(resolveDisplayName(accessToken))
          setOpponentUsername('Opponent')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [matchId, accessToken, isTutorialMode])

  useEffect(() => {
    if (isTutorialMode) {
      setBattleRestoreDone(true)
      return
    }
    if (!accessToken || !matchId || battleRestoreDone) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) {
      setBattleRestoreDone(true)
      return
    }
    const raw = sessionStorage.getItem(battleSessionKey)
    if (!raw) {
      setBattleRestoreDone(true)
      return
    }
    const endsAt = Number(raw)
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) {
      sessionStorage.removeItem(battleSessionKey)
      setBattleRestoreDone(true)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const res = await gameApi.evaluateBattleRound(id, accessToken)
        if (cancelled) return
        if (res.battleViewEndsAt > Date.now()) {
          setBattlePending(false)
          setShopPhaseEndsAtMs(null)
          setRoundTimeLeft(0)
          setBattleResult(res)
          setBattleError('')
          setPlayerHp(res.currentUserIsWhite ? res.whiteHp : res.blackHp)
          setPlayerHpMax((prev) =>
            Math.max(prev, res.currentUserIsWhite ? res.whiteHp : res.blackHp, GAME_HP_MAX),
          )
          setOpponentHp(opponentHpFromBattle(res))
          setPhase('battle')
          sessionStorage.setItem(battleSessionKey, String(res.battleViewEndsAt))
        } else {
          sessionStorage.removeItem(battleSessionKey)
        }
      } catch {
        sessionStorage.removeItem(battleSessionKey)
      } finally {
        if (!cancelled) setBattleRestoreDone(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, matchId, battleRestoreDone, battleSessionKey, isTutorialMode])

  /** Client extends the replay window when the evaluate response arrives late so PV does not skip ahead. */
  const matchBattleTimeline = useMemo(() => {
    if (isTutorialMode || !battleResult) return null
    const pv = Array.isArray(battleResult.principalVariation) ? battleResult.principalVariation : []
    const cap = Math.min(PV_REPLAY_MAX_PLIES, pv.length)
    const fullWindowMs =
      PV_REPLAY_DELAY_MS + cap * BATTLE_VIEW_STEP_MS + BATTLE_END_PAUSE_MS + BATTLE_VIEW_SAFETY_BUFFER_MS
    const effectiveEndsAt = Math.max(battleResult.battleViewEndsAt, Date.now() + fullWindowMs)
    const replayStartMs = effectiveEndsAt - fullWindowMs
    return { cap, fullWindowMs, effectiveEndsAt, replayStartMs }
  }, [battleResult, isTutorialMode])

  /** Drive replay; timeline matches backend but never runs ahead of when the UI received the battle payload. */
  useEffect(() => {
    if (phase !== 'battle' || !matchBattleTimeline) return
    const { cap, replayStartMs } = matchBattleTimeline
    if (cap === 0) {
      setPvMovesApplied(0)
      return
    }
    const computePlies = () => {
      const elapsedMs = Date.now() - replayStartMs - PV_REPLAY_DELAY_MS
      const plies = Math.max(0, Math.min(cap, Math.floor(elapsedMs / BATTLE_VIEW_STEP_MS)))
      setPvMovesApplied(plies)
    }
    computePlies()
    const id = window.setInterval(computePlies, 250)
    return () => window.clearInterval(id)
  }, [phase, matchBattleTimeline])

  useEffect(() => {
    if (isTutorialMode || phase !== 'battle' || !battleResult) return
    setBattleColorSplashOpen(true)
    const id = window.setTimeout(() => setBattleColorSplashOpen(false), 4200)
    return () => {
      window.clearTimeout(id)
    }
  }, [phase, battleResult?.battleViewEndsAt, isTutorialMode])

  useEffect(() => {
    if (!battleColorSplashOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBattleColorSplashOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [battleColorSplashOpen])

  useEffect(() => {
    if (phase !== 'battle') setBattleColorSplashOpen(false)
  }, [phase])

  useEffect(() => {
    if (phase !== 'battle') {
      battleReplayPlySoundRef.current = -1
      return
    }
    const prev = battleReplayPlySoundRef.current
    battleReplayPlySoundRef.current = pvMovesApplied
    if (prev >= 0 && pvMovesApplied > prev) {
      playBattleReplayMoveSound()
    }
  }, [phase, pvMovesApplied])

  useEffect(() => {
    if (!isTutorialMode || !tutorialInBattle) {
      tutorialReplayPlySoundRef.current = -1
      return
    }
    const prev = tutorialReplayPlySoundRef.current
    tutorialReplayPlySoundRef.current = tutorialPvMovesApplied
    if (prev >= 0 && tutorialPvMovesApplied > prev) {
      playBattleReplayMoveSound()
    }
  }, [isTutorialMode, tutorialInBattle, tutorialPvMovesApplied])

  const battleBoardDisplay = useMemo(() => {
    if (!battleResult) return null
    const pv = Array.isArray(battleResult.principalVariation) ? battleResult.principalVariation : []
    const fen = battleResult.fen
    if (pvMovesApplied > 0 && fen.length > 0 && pv.length > 0) {
      const derived = battlePositionAfterUciMoves(fen, pv, pvMovesApplied)
      if (derived) return derived
    }
    return {
      whiteKing: battleResult.whiteKing,
      blackKing: battleResult.blackKing,
      whiteBoard: battleResult.whiteBoard,
      blackBoard: battleResult.blackBoard,
    }
  }, [battleResult, pvMovesApplied])

  const tutorialFen = useMemo(() => {
    const placement = boardToFenPlacement(
      tutorialKingSquare,
      tutorialBoardPieces,
      TUTORIAL_ENEMY_KING,
      tutorialEnemyPieces,
    )
    return `${placement} w - - 0 1`
  }, [tutorialKingSquare, tutorialBoardPieces, tutorialEnemyPieces])

  const tutorialBattleDisplay: BattleReplayPosition | null = useMemo(() => {
    if (!tutorialInBattle) return null
    const fen = tutorialBattleState?.fen ?? tutorialFen
    const pv = tutorialBattleState?.eval.principalVariation ?? []
    return battlePositionAfterUciMoves(fen, pv, tutorialPvMovesApplied)
  }, [tutorialInBattle, tutorialBattleState, tutorialFen, tutorialPvMovesApplied])

  useEffect(() => {
    if (phase !== 'shop' || shopPhaseEndsAtMs == null) return
    const tick = () => {
      setRoundTimeLeft(Math.max(0, Math.ceil((shopPhaseEndsAtMs - Date.now()) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [phase, shopPhaseEndsAtMs])

  useEffect(() => {
    if (phase !== 'shop' || shopPhaseEndsAtMs == null || battlePending) return
    const markPendingIfExpired = () => {
      if (Date.now() >= shopPhaseEndsAtMs) {
        setBattlePending(true)
        setRoundTimeLeft(0)
      }
    }
    markPendingIfExpired()
    const id = window.setInterval(markPendingIfExpired, 250)
    return () => window.clearInterval(id)
  }, [phase, shopPhaseEndsAtMs, battlePending])

  /**
   * Run battle evaluate when the shop deadline has passed (`battlePending`). Omits `shopPhaseEndsAtMs` from deps so
   * /shop polling cannot cancel an in-flight request when the shared deadline jumps after the opponent applies the round.
   * No `battleRequestRef` mutex: React Strict Mode remount can leave the mutex true while the second effect bails and
   * never starts a request, leaving the player stuck in shop with a fake timer.
   */
  useEffect(() => {
    if (phase !== 'shop' || !battlePending || shopPhaseEndsAtMs == null) return
    if (!accessToken || !matchId) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return

    let cancelled = false
    void (async () => {
      try {
        const res = await gameApi.evaluateBattleRound(id, accessToken)
        if (!cancelled) {
          setBattlePending(false)
          setShopPhaseEndsAtMs(null)
          setRoundTimeLeft(0)
          setBattleResult(res)
          setBattleError('')
          setPlayerHp(res.currentUserIsWhite ? res.whiteHp : res.blackHp)
          setPlayerHpMax((prev) =>
            Math.max(prev, res.currentUserIsWhite ? res.whiteHp : res.blackHp, GAME_HP_MAX),
          )
          setOpponentHp(opponentHpFromBattle(res))
          playBattleStartSound()
          setPhase('battle')
          sessionStorage.setItem(battleSessionKey, String(res.battleViewEndsAt))
        }
      } catch (e) {
        if (!cancelled) {
          setBattleError(e instanceof Error ? e.message : 'Could not run battle evaluation')
          window.setTimeout(() => {
            setBattleEvalRetryTick((n) => n + 1)
          }, BATTLE_EVAL_RETRY_MS)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- omit shopPhaseEndsAtMs so poll/timer server updates cannot abort this fetch
  }, [phase, battlePending, accessToken, matchId, battleEvalRetryTick, battleSessionKey])

  const syncShopFromServer = useCallback(
    async (id: number, token: string, opts?: { applyShopTimer?: boolean }) => {
      const requestId = ++shopSyncRequestIdRef.current
      const shop = await gameApi.getShop(id, token)
      if (requestId !== shopSyncRequestIdRef.current) return
      // While waiting for evaluate/battle, never pull a new deadline from /shop — it can jump when the other
      // client finalizes the round (replay end + 30s) and would both mislead the countdown and retrigger effects.
      const applyTimer =
        !battlePending &&
        (opts?.applyShopTimer === true || phaseRef.current === 'shop')
      if (applyTimer) {
        setShopPhaseEndsAtMs(shop.shopPhaseEndsAt)
        setRoundTimeLeft(Math.max(0, Math.ceil((shop.shopPhaseEndsAt - Date.now()) / 1000)))
      }
      setPawnMoney(shop.money)
      setPawnMoneyCap((prev) => Math.max(prev, shop.money))
      setPlayerHp(shop.hp)
      setPlayerHpMax((prev) => Math.max(prev, shop.hpMax, 1))
      if (shop.opponentHp != null) {
        setOpponentHp(shop.opponentHp)
      }
      const nextCosts: Record<ShopPiece, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 8 }
      const nextAffordable: Record<ShopPiece, boolean> = {
        pawn: false,
        knight: false,
        bishop: false,
        rook: false,
        queen: false,
      }
      for (const item of shop.items) {
        nextCosts[item.piece] = item.cost
        nextAffordable[item.piece] = item.affordable
      }
      setShopCosts(nextCosts)
      setShopAffordable(nextAffordable)
      applyBenchFromApi(shop.bench)
      applyBoardFromApi(shop.board)
      setKingSquare({ col: shop.king.x, row: shop.king.y })
      try {
        const meta = await gameApi.getMatch(id, token)
        if (requestId !== shopSyncRequestIdRef.current) return
        if (meta.status === 'FINISHED') {
          const uid = parseUserIdFromAccessToken(token)
          const wid = meta.winnerUserId
          const won = uid != null && wid != null && uid === wid
          setMatchEndOverlay(matchEndRatingOverlay(won, token))
        }
      } catch {
        /* match row may be briefly inconsistent during transitions */
      }
      setShopError('')
    },
    [applyBenchFromApi, applyBoardFromApi, battlePending],
  )

  /** When mutation fails because DB says FINISHED, show overlay instead of a flickering banner. */
  const applyFinishedMatchFromServerError = useCallback(
    async (id: number, token: string, err: unknown): Promise<boolean> => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/match has ended/i.test(msg)) return false
      try {
        const m = await gameApi.getMatch(id, token)
        if (m.status === 'FINISHED') {
          const uid = parseUserIdFromAccessToken(token)
          const wid = m.winnerUserId
          const won = uid != null && wid != null && uid === wid
          setMatchEndOverlay(matchEndRatingOverlay(won, token))
          return true
        }
      } catch {
        /* ignore */
      }
      return false
    },
    [],
  )

  const returnToShopAfterBattle = useCallback(
    (id: number, token: string) => {
      battleRequestRef.current = false
      setBattleResult(null)
      setBattleError('')
      setPhase('shop')
      setBattlePending(false)
      setShopPhaseEndsAtMs(null)
      sessionStorage.removeItem(battleSessionKey)
      void syncShopFromServer(id, token, { applyShopTimer: true }).catch(() => {
        /* shop polling will retry */
      })
    },
    [syncShopFromServer, battleSessionKey],
  )

  const resignMatch = useCallback(async () => {
    if (!accessToken || !matchId) return
    const accepted = window.confirm('Are you sure you want to resign this match?')
    if (!accepted) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    try {
      await gameApi.resignMatch(id, token)
      battleRequestRef.current = false
      sessionStorage.removeItem(battleSessionKey)
      setBattleResult(null)
      setBattleError('')
      setPhase('shop')
      setBattlePending(false)
      setShopPhaseEndsAtMs(null)
      setRoundTimeLeft(0)
      setMatchEndOverlay(matchEndRatingOverlay(false, token))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not resign'
      if (phaseRef.current === 'battle') setBattleError(msg)
      else setShopError(msg)
    }
  }, [accessToken, matchId, battleSessionKey])

  useEffect(() => {
    if (phase !== 'battle' || !battleResult || !matchBattleTimeline || !accessToken || !matchId) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    const maxWaitMs = Math.max(0, matchBattleTimeline.effectiveEndsAt - Date.now())
    const t = window.setTimeout(() => {
      if (phaseRef.current !== 'battle') return
      if (battleResult.matchFinished) {
        battleRequestRef.current = false
        sessionStorage.removeItem(battleSessionKey)
        const uid = parseUserIdFromAccessToken(token)
        const wid = battleResult.winnerUserId
        const won =
          uid != null && wid != null ? uid === wid : false
        setMatchEndOverlay(matchEndRatingOverlay(won, token))
      } else {
        returnToShopAfterBattle(id, token)
      }
    }, maxWaitMs)
    return () => window.clearTimeout(t)
  }, [
    phase,
    battleResult,
    matchBattleTimeline,
    accessToken,
    matchId,
    returnToShopAfterBattle,
    battleSessionKey,
  ])

  const endSellableDrag = useCallback(() => {
    setSellBinVisible(false)
    setSellBinOver(false)
  }, [])

  const handleTutorialPlaceFromBench = useCallback(
    (col: number, row: number, benchSlot: number) => {
      if (row < TUTORIAL_MIN_ROW || row > TUTORIAL_MAX_ROW) {
        setShopError('Pieces may only be placed on ranks 1-4.')
        return
      }
      if (friendlyBlocksShopSquare(col, row, tutorialKingSquare, tutorialBoardPieces, null)) {
        setShopError('That square is already occupied.')
        return
      }
      if (tutorialEnemyOccupiesSquare(col, row, tutorialEnemyPieces)) {
        setShopError('You cannot place on an enemy square.')
        return
      }
      setTutorialBenchSlots((prev) => {
        if (benchSlot < 0 || benchSlot >= prev.length || prev[benchSlot] == null) return prev
        const piece = prev[benchSlot]
        if (piece === 'pawn' && (row < PAWN_RANK_ROWS_MIN || row > PAWN_RANK_ROWS_MAX)) {
          setShopError('Pawns may only be placed on ranks 2-4.')
          return prev
        }
        const nextBench = [...prev]
        nextBench[benchSlot] = null
        playPieceMoveSound()
        setTutorialBoardPieces((prevBoard) => [...prevBoard, { col, row, piece }])
        setShopError('')
        return nextBench
      })
    },
    [tutorialKingSquare, tutorialBoardPieces, tutorialEnemyPieces],
  )

  const handleTutorialMoveBoardPiece = useCallback(
    (fromCol: number, fromRow: number, toCol: number, toRow: number) => {
      if (toRow < TUTORIAL_MIN_ROW || toRow > TUTORIAL_MAX_ROW) {
        setShopError('Pieces may only be moved within ranks 1-4.')
        return
      }
      setTutorialBoardPieces((prev) => {
        const moving = prev.find((p) => p.col === fromCol && p.row === fromRow)
        if (!moving) return prev
        if (moving.piece === 'pawn' && (toRow < PAWN_RANK_ROWS_MIN || toRow > PAWN_RANK_ROWS_MAX)) {
          setShopError('Pawns may only be moved within ranks 2-4.')
          return prev
        }
        if (tutorialEnemyOccupiesSquare(toCol, toRow, tutorialEnemyPieces)) {
          setShopError('You cannot move onto an enemy square.')
          return prev
        }
        if (
          friendlyBlocksShopSquare(toCol, toRow, tutorialKingSquare, prev, {
            col: fromCol,
            row: fromRow,
          })
        ) {
          setShopError('That square is already occupied.')
          return prev
        }
        const kept = prev.filter((p) => !(p.col === fromCol && p.row === fromRow))
        playPieceMoveSound()
        setShopError('')
        return [...kept, { col: toCol, row: toRow, piece: moving.piece }]
      })
    },
    [tutorialKingSquare, tutorialEnemyPieces],
  )

  const handleTutorialMoveKing = useCallback(
    (toCol: number, toRow: number) => {
      setTutorialKingSquare((prev) => {
        if (prev.col === toCol && prev.row === toRow) return prev
        if (tutorialEnemyOccupiesSquare(toCol, toRow, tutorialEnemyPieces)) {
          setShopError('You cannot move onto an enemy square.')
          return prev
        }
        if (tutorialBoardPieces.some((p) => p.col === toCol && p.row === toRow)) {
          setShopError('That square is already occupied.')
          return prev
        }
        playPieceMoveSound()
        setShopError('')
        return { col: toCol, row: toRow }
      })
    },
    [tutorialBoardPieces, tutorialEnemyPieces],
  )

  const handleTutorialSellDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setSellBinOver(false)
    const payload = parsePieceDragPayload(e.dataTransfer)
    if (!payload || payload.source === 'king') return
    let refund = 0
    if (payload.source === 'bench') {
      if (payload.benchSlot < 0 || payload.benchSlot >= tutorialBenchSlots.length) return
      const piece = tutorialBenchSlots[payload.benchSlot]
      if (!piece) return
      refund = shopCosts[piece]
      setTutorialBenchSlots((prev) => {
        const next = [...prev]
        next[payload.benchSlot] = null
        return next
      })
    } else {
      const placed = tutorialBoardPieces.find((p) => p.col === payload.fromCol && p.row === payload.fromRow)
      if (!placed) return
      refund = shopCosts[placed.piece]
      setTutorialBoardPieces((prev) =>
        prev.filter((p) => !(p.col === payload.fromCol && p.row === payload.fromRow)),
      )
    }
    if (refund > 0) {
      setTutorialPawnMoney((n) => {
        const next = n + refund
        setTutorialPawnMoneyCap((cap) => Math.max(cap, next))
        return next
      })
      setShopError('')
      if (!tutorialKnightBishopHintAcknowledged) {
        setShowTutorialKnightBishopHint(true)
      }
    }
  }, [shopCosts, tutorialBenchSlots, tutorialBoardPieces, tutorialKnightBishopHintAcknowledged])

  const handleTutorialBuy = useCallback(
    (piece: ShopPiece) => {
      const cost = shopCosts[piece]
      if (tutorialPawnMoney < cost) {
        setShopError('Not enough pawns for this piece.')
        return
      }
      const slot = tutorialBenchSlots.findIndex((v) => v == null)
      if (slot === -1) {
        setShopError('Bench is full.')
        return
      }
      setTutorialBenchSlots((prev) => {
        const next = [...prev]
        next[slot] = piece
        return next
      })
      setTutorialPawnMoney((n) => Math.max(0, n - cost))
      if (!tutorialBoughtFirstPiece) {
        setTutorialBoughtFirstPiece(true)
        setShowTutorialBenchHint(true)
      }
      setShopError('')
    },
    [shopCosts, tutorialBenchSlots, tutorialPawnMoney, tutorialBoughtFirstPiece],
  )

  useEffect(() => {
    if (!isTutorialMode) return
    if (showTutorialComplete) return
    if (
      showTutorialWelcome ||
      showTutorialShopHint ||
      showTutorialBenchHint ||
      showTutorialCurrencyHint ||
      showTutorialDragHint ||
      showTutorialEvalHint ||
      showTutorialRemoveHint ||
      showTutorialTimerBattleHint ||
      showTutorialKnightBishopHint
    ) return
    if (tutorialShopTimerLastSeedRef.current !== tutorialTimerSeed) {
      setTutorialRoundTimeLeft(ROUND_DURATION_SEC)
      tutorialShopTimerLastSeedRef.current = tutorialTimerSeed
    }
    const id = window.setInterval(() => {
      setTutorialRoundTimeLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(id)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [
    isTutorialMode,
    tutorialTimerSeed,
    showTutorialWelcome,
    showTutorialShopHint,
    showTutorialBenchHint,
    showTutorialCurrencyHint,
    showTutorialDragHint,
    showTutorialEvalHint,
    showTutorialRemoveHint,
    showTutorialTimerBattleHint,
    showTutorialKnightBishopHint,
    showTutorialComplete,
  ])

  useEffect(() => {
    if (!isTutorialMode) return
    const prev = tutorialBattlesCompletedPrevRef.current
    if (tutorialBattlesCompleted === prev) return
    if (tutorialBattlesCompleted < prev) {
      tutorialBattlesCompletedPrevRef.current = tutorialBattlesCompleted
      return
    }
    tutorialBattlesCompletedPrevRef.current = tutorialBattlesCompleted
    if (tutorialBattlesCompleted >= TUTORIAL_MAX_ROUNDS) {
      setShowTutorialComplete(true)
      return
    }
    setTutorialEnemyPieces((pieces) => addBlackPawnForTutorial(TUTORIAL_ENEMY_KING, pieces))
  }, [isTutorialMode, tutorialBattlesCompleted])

  useEffect(() => {
    if (!isTutorialMode || tutorialInBattle) return
    if (tutorialBattlesCompleted !== 0) return
    if (tutorialTimerBattleHintAcknowledged) return
    if (tutorialRoundTimeLeft !== 20) return
    setShowTutorialTimerBattleHint(true)
  }, [
    isTutorialMode,
    tutorialInBattle,
    tutorialBattlesCompleted,
    tutorialTimerBattleHintAcknowledged,
    tutorialRoundTimeLeft,
  ])

  useEffect(() => {
    if (!isTutorialMode || tutorialInBattle) {
      previousTutorialMoneyRef.current = tutorialPawnMoney
      return
    }
    const prev = previousTutorialMoneyRef.current
    if (prev > 0 && tutorialPawnMoney === 0) {
      if (!tutorialCurrencyHintShown) {
        setShowTutorialCurrencyHint(true)
        setTutorialCurrencyHintShown(true)
      }
    }
    previousTutorialMoneyRef.current = tutorialPawnMoney
  }, [isTutorialMode, tutorialInBattle, tutorialPawnMoney, tutorialCurrencyHintShown])

  useEffect(() => {
    if (!isTutorialMode || !tutorialInBattle || tutorialEvalHintAcknowledged) return
    setShowTutorialEvalHint(true)
  }, [isTutorialMode, tutorialInBattle, tutorialEvalHintAcknowledged])

  useEffect(() => {
    if (!isTutorialMode) return
    if (showTutorialComplete) return
    if (tutorialRoundTimeLeft === 0) {
      playBattleStartSound()
      setTutorialInBattle(true)
    }
  }, [isTutorialMode, tutorialRoundTimeLeft, showTutorialComplete])

  useEffect(() => {
    if (!isTutorialMode || !tutorialInBattle) return
    if (!tutorialEvalHintAcknowledged) return
    let cancelled = false
    setTutorialBattleError('')
    setTutorialBattleState(null)
    setTutorialPvMovesApplied(0)
    void (async () => {
      try {
        const evalRes = await battleApi.evaluatePosition(tutorialFen)
        if (cancelled) return
        setTutorialBattleState({ fen: tutorialFen, eval: evalRes })
      } catch (e) {
        if (cancelled) return
        setTutorialBattleError(e instanceof Error ? e.message : 'Could not evaluate tutorial battle')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isTutorialMode, tutorialInBattle, tutorialFen, tutorialEvalHintAcknowledged])

  useEffect(() => {
    if (!isTutorialMode || !tutorialInBattle || !tutorialBattleState) return
    if (!tutorialEvalHintAcknowledged) return
    const pv = tutorialBattleState.eval.principalVariation
    if (!Array.isArray(pv) || pv.length === 0) return
    setTutorialPvMovesApplied(0)
    const cap = Math.min(PV_REPLAY_MAX_PLIES, pv.length)
    let step = 0
    const id = window.setInterval(() => {
      step += 1
      setTutorialPvMovesApplied(step)
      if (step >= cap) {
        window.clearInterval(id)
      }
    }, 700)
    return () => window.clearInterval(id)
  }, [isTutorialMode, tutorialInBattle, tutorialBattleState, tutorialEvalHintAcknowledged])

  useEffect(() => {
    if (!isTutorialMode || !tutorialInBattle) return
    if (!tutorialEvalHintAcknowledged) return
    const pvLen = tutorialBattleState?.eval.principalVariation?.length ?? 0
    const replayMs = Math.max(2500, Math.min(PV_REPLAY_MAX_PLIES, pvLen) * 700)
    const totalBattleMs = replayMs + BATTLE_END_PAUSE_MS
    const id = window.setTimeout(() => {
      setTutorialInBattle(false)
      setTutorialBattleState(null)
      setTutorialBattleError('')
      setTutorialPvMovesApplied(0)
      setTutorialPawnMoney((n) => {
        const next = n + TUTORIAL_START_MONEY
        setTutorialPawnMoneyCap((cap) => Math.max(cap, next))
        return next
      })
      setTutorialRoundTimeLeft(ROUND_DURATION_SEC)
      setTutorialTimerSeed((n) => n + 1)
      setTutorialBattlesCompleted((n) => n + 1)
    }, totalBattleMs)
    return () => window.clearTimeout(id)
  }, [isTutorialMode, tutorialInBattle, tutorialBattleState, tutorialEvalHintAcknowledged])

  useEffect(() => {
    if (!accessToken || !matchId || phase !== 'shop' || !battleRestoreDone) return
    if (matchEndOverlay) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) {
      setShopError('Invalid match id')
      return
    }
    let cancelled = false
    const loadShop = async (force = false) => {
      try {
        if (!force && document.visibilityState !== 'visible') return
        if (cancelled) return
        await syncShopFromServer(id, accessToken, { applyShopTimer: true })
      } catch (e) {
        if (!cancelled) setShopError(e instanceof Error ? e.message : 'Could not load shop')
      }
    }
    void loadShop(true)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadShop(true)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    const pollId = window.setInterval(() => {
      void loadShop()
    }, 10000)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(pollId)
    }
  }, [accessToken, matchId, phase, syncShopFromServer, battleRestoreDone, matchEndOverlay])

  const handleBuy = async (piece: ShopPiece) => {
    if (!accessToken || !matchId || buyingPiece || shopInteractionsLocked) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    setBuyingPiece(piece)
    setShopError('')
    try {
      const res = await gameApi.buyPiece(id, piece, accessToken)
      shopSyncRequestIdRef.current += 1
      setPawnMoney(res.moneyAfter)
      setPawnMoneyCap((prev) => Math.max(prev, res.moneyAfter, res.moneyBefore))
      setShopAffordable((prev) => {
        const next = { ...prev }
        for (const p of SHOP_ORDER) next[p] = res.moneyAfter >= shopCosts[p]
        return next
      })
      setBenchSlots((prev) => {
        const next = [...prev]
        if (res.slot >= 0 && res.slot < 8) next[res.slot] = res.piece
        return next
      })
    } catch (e) {
      if (await applyFinishedMatchFromServerError(id, accessToken, e)) return
      setShopError(e instanceof Error ? e.message : 'Could not buy piece')
    } finally {
      setBuyingPiece(null)
    }
  }

  const applyShopLayoutFromResponse = useCallback(
    (shop: ShopStateResponse) => {
      if (phaseRef.current === 'shop' && !battlePending) {
        setShopPhaseEndsAtMs(shop.shopPhaseEndsAt)
        setRoundTimeLeft(Math.max(0, Math.ceil((shop.shopPhaseEndsAt - Date.now()) / 1000)))
      }
      setPawnMoney(shop.money)
      setPawnMoneyCap((prev) => Math.max(prev, shop.money))
      setPlayerHp(shop.hp)
      setPlayerHpMax((prev) => Math.max(prev, shop.hpMax, 1))
      if (shop.opponentHp != null) {
        setOpponentHp(shop.opponentHp)
      }
      const nextCosts: Record<ShopPiece, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 8 }
      const nextAffordable: Record<ShopPiece, boolean> = {
        pawn: false,
        knight: false,
        bishop: false,
        rook: false,
        queen: false,
      }
      for (const item of shop.items) {
        nextCosts[item.piece] = item.cost
        nextAffordable[item.piece] = item.affordable
      }
      setShopCosts(nextCosts)
      setShopAffordable(nextAffordable)
      applyBenchFromApi(shop.bench)
      applyBoardFromApi(shop.board)
      setKingSquare({ col: shop.king.x, row: shop.king.y })
    },
    [applyBenchFromApi, applyBoardFromApi, battlePending],
  )

  const refreshShopLayout = useCallback(async (id: number, token: string) => {
    const requestId = ++shopSyncRequestIdRef.current
    const shop = await gameApi.getShop(id, token)
    if (requestId !== shopSyncRequestIdRef.current) return
    applyShopLayoutFromResponse(shop)
  }, [applyShopLayoutFromResponse])

  /** Reconcile after a failed shop mutation without dropping on request-id races (see refreshShopLayout). */
  const recoverShopAfterFailedMutation = useCallback(
    async (id: number, token: string) => {
      const shop = await gameApi.getShop(id, token)
      applyShopLayoutFromResponse(shop)
      shopSyncRequestIdRef.current += 1
      try {
        const meta = await gameApi.getMatch(id, token)
        if (meta.status === 'FINISHED') {
          const uid = parseUserIdFromAccessToken(token)
          const wid = meta.winnerUserId
          const won = uid != null && wid != null && uid === wid
          setMatchEndOverlay(matchEndRatingOverlay(won, token))
        }
      } catch {
        /* match row may be briefly inconsistent during transitions */
      }
    },
    [applyShopLayoutFromResponse],
  )

  const scheduleShopLayoutRefresh = useCallback(
    (id: number, token: string, delayMs = 650) => {
      if (shopRefreshTimerRef.current != null) {
        window.clearTimeout(shopRefreshTimerRef.current)
      }
      shopRefreshTimerRef.current = window.setTimeout(() => {
        shopRefreshTimerRef.current = null
        void refreshShopLayout(id, token)
      }, delayMs)
    },
    [refreshShopLayout],
  )

  const handlePlaceFromBench = async (col: number, row: number, benchSlot: number) => {
    if (!accessToken || !matchId || placingPiece || shopInteractionsLocked) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    const benchPiece = benchSlots[benchSlot]
    if (!benchPiece) return
    if (friendlyBlocksShopSquare(col, row, kingSquare, boardPieces, null)) return
    if (
      benchPiece === 'pawn' &&
      (row < PAWN_RANK_ROWS_MIN || row > PAWN_RANK_ROWS_MAX)
    ) {
      setShopError('Pawns may only be on ranks 2–4.')
      return
    }
    setPlacingPiece(true)
    setShopError('')
    try {
      setBenchSlots((prev) => {
        const next = [...prev]
        next[benchSlot] = null
        return next
      })
      setBoardPieces((prev) => [...prev, { col, row, piece: benchPiece }])
      shopSyncRequestIdRef.current += 1
      await gameApi.placePieceFromBench(id, { benchSlot, squareX: col, squareY: row }, token)
      playPieceMoveSound()
      shopSyncRequestIdRef.current += 1
      scheduleShopLayoutRefresh(id, token, 0)
    } catch (e) {
      if (await applyFinishedMatchFromServerError(id, token, e)) {
        setPlacingPiece(false)
        return
      }
      await recoverShopAfterFailedMutation(id, token)
      setShopError(e instanceof Error ? e.message : 'Could not place piece')
    } finally {
      setPlacingPiece(false)
    }
  }

  const handleMoveBoardPiece = async (
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
  ) => {
    if (!accessToken || !matchId || placingPiece || shopInteractionsLocked) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    const moved = boardPieces.find((p) => p.col === fromCol && p.row === fromRow)
    if (!moved) return
    if (
      moved.piece === 'pawn' &&
      (toRow < PAWN_RANK_ROWS_MIN || toRow > PAWN_RANK_ROWS_MAX)
    ) {
      setShopError('Pawns may only be on ranks 2–4.')
      return
    }
    if (
      friendlyBlocksShopSquare(toCol, toRow, kingSquare, boardPieces, {
        col: fromCol,
        row: fromRow,
      })
    )
      return
    setPlacingPiece(true)
    setShopError('')
    try {
      setBoardPieces((prev) => {
        const moving = prev.find((p) => p.col === fromCol && p.row === fromRow)
        if (!moving) return prev
        const trimmed = prev.filter(
          (p) =>
            !(p.col === fromCol && p.row === fromRow) &&
            !(p.col === toCol && p.row === toRow),
        )
        return [...trimmed, { ...moving, col: toCol, row: toRow }]
      })
      shopSyncRequestIdRef.current += 1
      await gameApi.moveBoardPiece(
        id,
        { fromX: fromCol, fromY: fromRow, toX: toCol, toY: toRow },
        token,
      )
      playPieceMoveSound()
      shopSyncRequestIdRef.current += 1
      scheduleShopLayoutRefresh(id, token, 0)
    } catch (e) {
      if (await applyFinishedMatchFromServerError(id, token, e)) {
        setPlacingPiece(false)
        return
      }
      await recoverShopAfterFailedMutation(id, token)
      setShopError(e instanceof Error ? e.message : 'Could not move piece')
    } finally {
      setPlacingPiece(false)
    }
  }

  const handleMoveKing = async (toCol: number, toRow: number) => {
    if (!accessToken || !matchId || placingPiece || shopInteractionsLocked) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    if (boardPieces.some((p) => p.col === toCol && p.row === toRow)) return
    setPlacingPiece(true)
    setShopError('')
    try {
      setKingSquare({ col: toCol, row: toRow })
      shopSyncRequestIdRef.current += 1
      await gameApi.moveKing(id, { toX: toCol, toY: toRow }, token)
      playPieceMoveSound()
      shopSyncRequestIdRef.current += 1
      scheduleShopLayoutRefresh(id, token, 0)
    } catch (e) {
      if (await applyFinishedMatchFromServerError(id, token, e)) {
        setPlacingPiece(false)
        return
      }
      await recoverShopAfterFailedMutation(id, token)
      setShopError(e instanceof Error ? e.message : 'Could not move king')
    } finally {
      setPlacingPiece(false)
    }
  }

  const startSellableDrag = useCallback(() => {
    setSellBinVisible(true)
  }, [])

  const handleSellDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setSellBinOver(false)
    if (!accessToken || !matchId || placingPiece || shopInteractionsLocked) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const payload = parsePieceDragPayload(e.dataTransfer)
    if (!payload || payload.source === 'king') return

    setPlacingPiece(true)
    setShopError('')
    try {
      if (payload.source === 'bench') {
        setBenchSlots((prev) => {
          const next = [...prev]
          next[payload.benchSlot] = null
          return next
        })
      } else {
        setBoardPieces((prev) =>
          prev.filter((p) => !(p.col === payload.fromCol && p.row === payload.fromRow)),
        )
      }
      shopSyncRequestIdRef.current += 1
      let sellRes: Awaited<ReturnType<typeof gameApi.sellPiece>>
      if (payload.source === 'bench') {
        sellRes = await gameApi.sellPiece(id, { benchSlot: payload.benchSlot }, accessToken)
      } else {
        sellRes = await gameApi.sellPiece(
          id,
          { fromX: payload.fromCol, fromY: payload.fromRow },
          accessToken,
        )
      }
      setPawnMoney(sellRes.moneyAfter)
      setPawnMoneyCap((prev) => Math.max(prev, sellRes.moneyAfter, sellRes.moneyBefore))
      setShopAffordable((prev) => {
        const next = { ...prev }
        for (const p of SHOP_ORDER) next[p] = sellRes.moneyAfter >= shopCosts[p]
        return next
      })
      shopSyncRequestIdRef.current += 1
      scheduleShopLayoutRefresh(id, accessToken, 0)
    } catch (err) {
      if (await applyFinishedMatchFromServerError(id, accessToken, err)) {
        setPlacingPiece(false)
        return
      }
      await recoverShopAfterFailedMutation(id, accessToken)
      setShopError(err instanceof Error ? err.message : 'Could not sell piece')
    } finally {
      setPlacingPiece(false)
    }
  }

  if (!accessToken) {
    return (
      <div className={style.page}>
        <p>Please log in.</p>
        <Link to="/login">Log in</Link>
      </div>
    )
  }

  if (isTutorialMode) {
    return (
      <div className={gameStyle.page}>
        {hasBlockingTutorialHint ? <div className={gameStyle.tutorialHintBackdrop} aria-hidden /> : null}
        {showTutorialComplete ? (
          <div
            className={gameStyle.tutorialCompleteBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="Tutorial complete"
          >
            <div className={gameStyle.tutorialWelcomeCard}>
              <h2 className={gameStyle.tutorialWelcomeTitle}>You have completed the tutorial.</h2>
              <button
                type="button"
                className={gameStyle.tutorialWelcomeButton}
                onClick={() => navigate('/', { replace: true })}
              >
                OK
              </button>
            </div>
          </div>
        ) : null}
        {showTutorialWelcome ? (
          <div className={gameStyle.tutorialWelcomeBackdrop} role="dialog" aria-modal="true" aria-label="How to play welcome">
            <div className={gameStyle.tutorialWelcomeCard}>
              <h2 className={gameStyle.tutorialWelcomeTitle}>Welcome to how to play Auto Chess</h2>
              <button
                type="button"
                className={gameStyle.tutorialWelcomeButton}
                onClick={() => {
                  setShowTutorialWelcome(false)
                  setShowTutorialShopHint(true)
                  setShowTutorialBenchHint(false)
                  setShowTutorialCurrencyHint(false)
                }}
              >
                OK
              </button>
            </div>
          </div>
        ) : null}
        <div className={gameStyle.boardArea}>
          <div className={gameStyle.boardWithHp}>
            <div className={gameStyle.boardColumn}>
              <p className={gameStyle.matchPlayersBanner} aria-label="Tutorial match">
                <span className={gameStyle.matchPlayerSelf}>
                  <span className={gameStyle.matchNameGroup}>
                    <span className={gameStyle.matchPlayerName}>You</span>
                  </span>
                  <span className={gameStyle.matchHpPill} aria-label={`Your HP ${GAME_HP_MAX}`}>
                    {GAME_HP_MAX}
                  </span>
                </span>
                <span className={gameStyle.matchPlayersVs}>vs</span>
                <span className={gameStyle.matchPlayerOpponentSlot}>
                  <span className={gameStyle.matchNameGroup}>
                    <span className={gameStyle.matchPlayerName}>Trainer</span>
                  </span>
                  <span
                    className={`${gameStyle.matchHpPill} ${gameStyle.matchHpPillOpponent}`}
                    aria-label={`Opponent HP ${GAME_HP_MAX}`}
                  >
                    {GAME_HP_MAX}
                  </span>
                </span>
              </p>
              {!tutorialInBattle && shopError ? (
                <p className={gameStyle.shopFeedback} role="alert" aria-live="polite">
                  {shopError}
                </p>
              ) : null}
              <div className={gameStyle.boardShell}>
                {!tutorialInBattle ? (
                  <div className={gameStyle.leftBars}>
                    <aside className={gameStyle.hpPanel} aria-label="Player HP">
                      <div className={gameStyle.hpValue}>{GAME_HP_MAX}</div>
                      <div className={gameStyle.hpTrack}>
                        <div className={gameStyle.hpFill} style={{ '--hp-pct': '100%' } as CSSProperties} />
                      </div>
                    </aside>
                    <div className={gameStyle.tutorialCurrencyAnchor}>
                      {showTutorialCurrencyHint ? (
                        <div className={gameStyle.tutorialCurrencyHint} role="dialog" aria-modal="true" aria-label="Tutorial currency hint">
                          <p className={gameStyle.tutorialCurrencyHintText}>
                            this is your currency, you start with 2 and get +2 each round
                          </p>
                          <button
                            type="button"
                            className={gameStyle.tutorialCurrencyHintButton}
                            onClick={() => setShowTutorialCurrencyHint(false)}
                          >
                            OK
                          </button>
                        </div>
                      ) : null}
                      <aside className={gameStyle.moneyPanel} aria-label="Pawn money">
                        <div className={gameStyle.moneyValue}>
                          {tutorialPawnMoney}/{tutorialPawnMoneyCap}
                        </div>
                        <div className={gameStyle.moneyTrack}>
                          <div className={gameStyle.moneyFill}>
                            {Array.from({ length: tutorialPawnMoneyCap }, (_, i) => (
                              <img
                                key={i}
                                src={PIECE_SPRITES.pawn}
                                alt=""
                                aria-hidden
                                className={`${gameStyle.moneyPawnImage} ${i < tutorialPawnMoney ? gameStyle.moneyPawnImageFilled : gameStyle.moneyPawnImageEmpty}`}
                              />
                            ))}
                          </div>
                        </div>
                      </aside>
                    </div>
                  </div>
                ) : (
                  <div className={gameStyle.leftBarsBattle}>
                    <div className={gameStyle.hpBattleCluster}>
                      <div className={gameStyle.hpBattleValue}>{GAME_HP_MAX}</div>
                      <div className={gameStyle.hpAndEvalRow}>
                        {showTutorialEvalHint ? (
                          <div className={gameStyle.tutorialEvalHint} role="dialog" aria-modal="true" aria-label="Tutorial eval hint">
                            <p className={gameStyle.tutorialEvalHintText}>
                              This eval bar here shows how good/bad your position is, and the hp it will take or deal to you or the enemy
                            </p>
                            <button
                              type="button"
                              className={gameStyle.tutorialEvalHintButton}
                              onClick={() => {
                                setShowTutorialEvalHint(false)
                                setTutorialEvalHintAcknowledged(true)
                              }}
                            >
                              OK
                            </button>
                          </div>
                        ) : null}
                        <aside className={gameStyle.hpPanelBattle} aria-label="Player HP">
                          <div className={gameStyle.hpTrack}>
                            <div className={gameStyle.hpFill} style={{ '--hp-pct': '100%' } as CSSProperties} />
                          </div>
                        </aside>
                        <EvaluationBar centipawns={tutorialBattleState?.eval.centipawns ?? 0} invert />
                      </div>
                    </div>
                  </div>
                )}
                <div className={gameStyle.boardMiddleColumn}>
                  <div className={gameStyle.boardSlot}>
                    {!tutorialInBattle ? (
                      <LobbyChessBoard
                        playerColor="white"
                        className={lobbyBoardStyle.boardCompact}
                        kingSquare={tutorialKingSquare}
                        placedPieces={tutorialBoardPieces}
                        shadeOpponentRanks
                        onDropBenchOnSquare={handleTutorialPlaceFromBench}
                        onMoveBoardPiece={handleTutorialMoveBoardPiece}
                        onMoveKing={handleTutorialMoveKing}
                        onSellablePieceDragStart={startSellableDrag}
                        onSellablePieceDragEnd={endSellableDrag}
                        highlightSquare={
                          tapSelection?.source === 'board' ? { col: tapSelection.col, row: tapSelection.row }
                          : tapSelection?.source === 'king' ? tutorialKingSquare
                          : null
                        }
                        onTapSquare={(col, row) => {
                          if (!tapSelection) return
                          if (tapSelection.source === 'bench') {
                            handleTutorialPlaceFromBench(col, row, tapSelection.benchSlot)
                          } else if (tapSelection.source === 'board') {
                            handleTutorialMoveBoardPiece(tapSelection.col, tapSelection.row, col, row)
                          } else if (tapSelection.source === 'king') {
                            handleTutorialMoveKing(col, row)
                          }
                          setTapSelection(null)
                        }}
                        onTapBoardPiece={(col, row) => {
                          if (tapSelection?.source === 'board' && tapSelection.col === col && tapSelection.row === row) {
                            setTapSelection(null)
                          } else {
                            setTapSelection({ source: 'board', col, row })
                          }
                        }}
                        onTapKing={() => {
                          if (tapSelection?.source === 'king') {
                            setTapSelection(null)
                          } else {
                            setTapSelection({ source: 'king' })
                          }
                        }}
                      />
                    ) : (
                      tutorialBattleDisplay ? (
                        <BattlePreviewBoard
                          className={lobbyBoardStyle.boardCompact}
                          whiteKing={tutorialBattleDisplay.whiteKing}
                          blackKing={tutorialBattleDisplay.blackKing}
                          whitePieces={tutorialBattleDisplay.whiteBoard}
                          blackPieces={tutorialBattleDisplay.blackBoard}
                          viewAsBlack={false}
                        />
                      ) : (
                        <p className={style.error}>{tutorialBattleError || 'Evaluating tutorial battle…'}</p>
                      )
                    )}
                  </div>
                  {tutorialInBattle && tutorialBattleState && tutorialBattleState.eval.principalVariation.length > 0 ? (
                    <div className={gameStyle.battlePvPanel} aria-label="Tutorial engine move line">
                      <ul className={gameStyle.battlePvList}>
                        {tutorialBattleState.eval.principalVariation.slice(0, PV_REPLAY_MAX_PLIES).map((uci, i) => {
                          const n = i + 1
                          const played = tutorialPvMovesApplied >= n
                          const active = played && tutorialPvMovesApplied === n
                          return (
                            <li
                              key={`${i}-${uci}`}
                              className={`${gameStyle.battlePvItem} ${played ? gameStyle.battlePvItemPlayed : ''} ${active ? gameStyle.battlePvItemActive : ''}`}
                            >
                              <span className={gameStyle.battlePvIndex}>{n}.</span>
                              <span className={gameStyle.battlePvUci}>{uci}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <aside className={gameStyle.rightActions} aria-label="Tutorial actions">
                  <div className={gameStyle.tutorialRoundTimerAnchor}>
                    {showTutorialTimerBattleHint ? (
                      <div className={gameStyle.tutorialTimerBattleHint} role="dialog" aria-modal="true" aria-label="Round timer hint">
                        <p className={gameStyle.tutorialTimerBattleHintText}>When the time runs out, the battle begins.</p>
                        <button
                          type="button"
                          className={gameStyle.tutorialTimerBattleHintButton}
                          onClick={() => {
                            setShowTutorialTimerBattleHint(false)
                            setTutorialTimerBattleHintAcknowledged(true)
                          }}
                        >
                          OK
                        </button>
                      </div>
                    ) : null}
                    <div className={gameStyle.roundTimer} aria-label="Round timer">
                      <span className={gameStyle.roundTimerLabel}>{tutorialInBattle ? 'Battle' : 'Round timer'}</span>
                      <span className={gameStyle.roundTimerValue}>
                        {tutorialInBattle ? 'Battle' : formatRoundTime(tutorialRoundTimeLeft)}
                      </span>
                    </div>
                  </div>
                  <div className={gameStyle.matchButtons}>
                    <button
                      type="button"
                      className={gameStyle.resignButton}
                      onClick={() => {
                        setTutorialBenchSlots([...TUTORIAL_BENCH])
                        setTutorialBoardPieces([])
                        setTutorialKingSquare({ col: 4, row: 7 })
                        setTutorialPawnMoney(TUTORIAL_START_MONEY)
                        setTutorialPawnMoneyCap(TUTORIAL_START_MONEY)
                        setTutorialRoundTimeLeft(ROUND_DURATION_SEC)
                        setTutorialTimerSeed((n) => n + 1)
                        setTutorialInBattle(false)
                        setTutorialBattleState(null)
                        setTutorialBattleError('')
                        setTutorialPvMovesApplied(0)
                        setShopError('')
                        setTutorialBattlesCompleted(0)
                        setTutorialRemoveHintAcknowledged(false)
                        setShowTutorialTimerBattleHint(false)
                        setTutorialTimerBattleHintAcknowledged(false)
                        setShowTutorialKnightBishopHint(false)
                        setTutorialKnightBishopHintAcknowledged(false)
                        setTutorialEnemyPieces([...TUTORIAL_ENEMY_PIECES])
                        setShowTutorialComplete(false)
                      }}
                    >
                      Reset setup
                    </button>
                    <button
                      type="button"
                      className={gameStyle.drawButton}
                      onClick={() => navigate('/', { replace: true })}
                    >
                      Back to menu
                    </button>
                    <div className={gameStyle.tutorialRemoveAnchor}>
                      {showTutorialRemoveHint ? (
                        <div className={gameStyle.tutorialRemoveHint} role="dialog" aria-modal="true" aria-label="Tutorial remove hint">
                          <p className={gameStyle.tutorialRemoveHintText}>
                            This is Remove. Drag a piece from your bench or board here to remove it and get its cost back in pawns.
                          </p>
                          <button
                            type="button"
                            className={gameStyle.tutorialRemoveHintButton}
                            onClick={() => setTutorialRemoveHintAcknowledged(true)}
                          >
                            OK
                          </button>
                        </div>
                      ) : null}
                      <div
                        className={`${gameStyle.sellBin} ${sellBinVisible || showTutorialRemoveHint ? gameStyle.sellBinVisible : ''} ${sellBinOver ? gameStyle.sellBinOver : ''}`}
                        onDragEnter={(ev) => {
                          ev.preventDefault()
                          setSellBinOver(true)
                        }}
                        onDragOver={(ev) => {
                          ev.preventDefault()
                          ev.dataTransfer.dropEffect = 'move'
                          setSellBinOver(true)
                        }}
                        onDragLeave={() => setSellBinOver(false)}
                        onDrop={(ev) => handleTutorialSellDrop(ev)}
                        role="region"
                        aria-label="Drop here to remove piece"
                      >
                        <svg
                          className={gameStyle.sellBinIcon}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M6 6l1 14h10l1-14" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                        <span className={gameStyle.sellBinLabel}>Remove</span>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>

              {!tutorialInBattle ? (
                <div className={gameStyle.tutorialShopGuideArea}>
                  <div className={gameStyle.tutorialBenchAnchor}>
                    {showTutorialBenchHint ? (
                      <div className={gameStyle.tutorialBenchHint} role="dialog" aria-modal="true" aria-label="Tutorial bench hint">
                        <p className={gameStyle.tutorialBenchHintText}>This is your bench where the pieces are saved.</p>
                        <button
                          type="button"
                          className={gameStyle.tutorialBenchHintButton}
                          onClick={() => setShowTutorialBenchHint(false)}
                        >
                          OK
                        </button>
                      </div>
                    ) : null}
                    {showTutorialDragHint ? (
                      <div className={gameStyle.tutorialBenchHint} role="dialog" aria-modal="true" aria-label="Tutorial drag hint">
                        <p className={gameStyle.tutorialBenchHintText}>Tap a piece to select it, then tap a board square to place it. On desktop you can also drag.</p>
                        <button
                          type="button"
                          className={gameStyle.tutorialBenchHintButton}
                          onClick={() => setShowTutorialDragHint(false)}
                        >
                          OK
                        </button>
                      </div>
                    ) : null}
                    <div className={gameStyle.bench} aria-label="Tutorial bench">
                      {tutorialBenchSlots.map((piece, i) => (
                        <div key={i} className={gameStyle.benchSlot} aria-label={piece ? `Bench slot ${i + 1}, ${piece}` : `Bench slot ${i + 1}`}>
                          {piece ? (
                            <img
                              src={PIECE_SPRITES[piece]}
                              alt=""
                              aria-hidden
                              className={`${gameStyle.benchPiece} ${gameStyle.benchPieceDraggable} ${tapSelection?.source === 'bench' && tapSelection.benchSlot === i ? gameStyle.benchPieceSelected : ''}`}
                              draggable
                              onDragStart={(e) => {
                                assignSpriteDragPreviewCanvas(e.nativeEvent, e.currentTarget)
                                setBenchDragData(e.dataTransfer, i)
                                startSellableDrag()
                              }}
                              onDragEnd={() => endSellableDrag()}
                              onClick={() => {
                                if (!tutorialDragHintShown) {
                                  setTutorialDragHintShown(true)
                                  setShowTutorialDragHint(true)
                                }
                                if (tapSelection?.source === 'bench' && tapSelection.benchSlot === i) {
                                  setTapSelection(null)
                                } else {
                                  setTapSelection({ source: 'bench', benchSlot: i })
                                }
                              }}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={gameStyle.tutorialShopAnchor}>
                    {showTutorialShopHint ? (
                      <div className={gameStyle.tutorialShopHint} role="dialog" aria-modal="true" aria-label="Tutorial shop hint">
                        <p className={gameStyle.tutorialShopHintText}>You can buy pieces here.</p>
                        <button
                          type="button"
                          className={gameStyle.tutorialShopHintButton}
                          onClick={() => {
                            setShowTutorialShopHint(false)
                          }}
                        >
                          OK
                        </button>
                      </div>
                    ) : null}
                    {showTutorialKnightBishopHint ? (
                      <div
                        className={gameStyle.tutorialKnightBishopHint}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Knight and bishop shop hint"
                      >
                        <p className={gameStyle.tutorialKnightBishopHintText}>
                          Here are the knight and bishop. Each costs 3 pawns - you can buy them when you have enough.
                        </p>
                        <button
                          type="button"
                          className={gameStyle.tutorialKnightBishopHintButton}
                          onClick={() => {
                            setShowTutorialKnightBishopHint(false)
                            setTutorialKnightBishopHintAcknowledged(true)
                          }}
                        >
                          OK
                        </button>
                      </div>
                    ) : null}
                    <div className={gameStyle.hudInner}>
                      <div className={gameStyle.shopSellRow}>
                        <div className={gameStyle.shop} aria-label="Piece shop">
                          <button
                            type="button"
                            className={gameStyle.shopItem}
                            aria-label={SHOP_ORDER[0]}
                            onClick={() => handleTutorialBuy(SHOP_ORDER[0]!)}
                            disabled={
                              tutorialPawnMoney < shopCosts[SHOP_ORDER[0]!] ||
                              !tutorialBenchSlots.some((v) => v == null)
                            }
                            title={`Cost: ${shopCosts[SHOP_ORDER[0]!]}`}
                          >
                            <img
                              src={PIECE_SPRITES[SHOP_ORDER[0]!]}
                              alt=""
                              aria-hidden
                              className={gameStyle.shopPieceImage}
                            />
                          </button>
                          <div className={gameStyle.tutorialKnightBishopPair}>
                            {(['knight', 'bishop'] as const).map((piece) => (
                              <button
                                key={piece}
                                type="button"
                                className={gameStyle.shopItem}
                                aria-label={piece}
                                onClick={() => handleTutorialBuy(piece)}
                                disabled={
                                  tutorialPawnMoney < shopCosts[piece] || !tutorialBenchSlots.some((v) => v == null)
                                }
                                title={`Cost: ${shopCosts[piece]}`}
                              >
                                <img src={PIECE_SPRITES[piece]} alt="" aria-hidden className={gameStyle.shopPieceImage} />
                              </button>
                            ))}
                          </div>
                          {SHOP_ORDER.slice(3).map((piece) => (
                            <button
                              key={piece}
                              type="button"
                              className={gameStyle.shopItem}
                              aria-label={piece}
                              onClick={() => handleTutorialBuy(piece)}
                              disabled={
                                tutorialPawnMoney < shopCosts[piece] || !tutorialBenchSlots.some((v) => v == null)
                              }
                              title={`Cost: ${shopCosts[piece]}`}
                            >
                              <img src={PIECE_SPRITES[piece]} alt="" aria-hidden className={gameStyle.shopPieceImage} />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={gameStyle.page}>
      {matchEndOverlay ? (
        <div
          className={gameStyle.matchEndOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="match-end-title"
        >
          <div className={gameStyle.matchEndCard}>
            <h2 id="match-end-title" className={gameStyle.matchEndTitle}>
              {matchEndOverlay.won ? 'You won' : 'You lost'}
            </h2>
            {!matchEndOverlay.won ? (
              <p className={gameStyle.matchEndHint}>Your opponent won this match.</p>
            ) : null}
            {matchEndOverlay.ratingDelta != null ? (
              <p className={gameStyle.matchEndHint}>
                Rating {matchEndOverlay.ratingDelta > 0 ? '+' : ''}
                {matchEndOverlay.ratingDelta}
              </p>
            ) : null}
            <p className={gameStyle.matchEndHint}>The match is finished.</p>
            <button
              type="button"
              className={gameStyle.matchEndButton}
              onClick={() => navigate('/', { replace: true })}
            >
              Back to menu
            </button>
          </div>
        </div>
      ) : null}
      {!isTutorialMode && battleColorSplashOpen && battleResult ? (
        <div
          className={gameStyle.battleColorSplashBackdrop}
          onClick={() => setBattleColorSplashOpen(false)}
          role="presentation"
        >
          <div
            className={gameStyle.battleColorSplashCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby="battle-splash-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="battle-splash-title" className={gameStyle.battleColorSplashTitle}>
              Battle begins
            </h2>
            <div className={gameStyle.battleColorSplashRow}>
              <div className={gameStyle.battleColorSplashPanelWhite}>
                <span className={gameStyle.battleColorSplashLabel}>White</span>
                <span className={gameStyle.battleColorSplashName}>
                  {battleResult.currentUserIsWhite
                    ? selfUsername || resolveDisplayName(accessToken)
                    : opponentUsername || 'Opponent'}
                  {battleResult.currentUserIsWhite ? (
                    <span className={gameStyle.battleColorSplashYou}> (you)</span>
                  ) : null}
                </span>
              </div>
              <span className={gameStyle.battleColorSplashVs} aria-hidden>
                vs
              </span>
              <div className={gameStyle.battleColorSplashPanelBlack}>
                <span className={gameStyle.battleColorSplashLabel}>Black</span>
                <span className={gameStyle.battleColorSplashName}>
                  {battleResult.currentUserIsWhite
                    ? opponentUsername || 'Opponent'
                    : selfUsername || resolveDisplayName(accessToken)}
                  {!battleResult.currentUserIsWhite ? (
                    <span className={gameStyle.battleColorSplashYou}> (you)</span>
                  ) : null}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={gameStyle.battleColorSplashContinue}
              onClick={() => setBattleColorSplashOpen(false)}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}
      <div className={gameStyle.boardArea}>
        <div className={gameStyle.boardWithHp}>
            <div className={gameStyle.boardColumn}>
            {(phase === 'shop' || (phase === 'battle' && battleResult && battleBoardDisplay)) ? (
              <p className={gameStyle.matchPlayersBanner} aria-label="Match players">
                <span className={gameStyle.matchPlayerSelf}>
                  <span className={gameStyle.matchNameGroup}>
                    <span
                      className={gameStyle.matchPlayerName}
                      title={selfUsername || resolveDisplayName(accessToken)}
                    >
                      {selfUsername || resolveDisplayName(accessToken)}
                    </span>
                    <span className={gameStyle.matchYouSuffix}> (you)</span>
                  </span>
                  <span className={gameStyle.matchHpPill} aria-label={`Your HP ${playerHp}`}>
                    {playerHp}
                  </span>
                </span>
                <span className={gameStyle.matchPlayersVs}>vs</span>
                <span className={gameStyle.matchPlayerOpponentSlot}>
                  <span className={gameStyle.matchNameGroup}>
                    <span className={gameStyle.matchPlayerName} title={opponentUsername || 'Opponent'}>
                      {opponentUsername || '…'}
                    </span>
                  </span>
                  <span
                    className={`${gameStyle.matchHpPill} ${gameStyle.matchHpPillOpponent}`}
                    aria-label={`Opponent HP ${opponentHp}`}
                  >
                    {opponentHp}
                  </span>
                </span>
              </p>
            ) : null}
            <div className={gameStyle.boardShell}>
              {phase === 'shop' ? (
                <div className={gameStyle.leftBars}>
                  <aside className={gameStyle.hpPanel} aria-label="Player HP">
                    <div className={gameStyle.hpValue}>{playerHp}</div>
                    <div className={gameStyle.hpTrack}>
                      <div
                        className={gameStyle.hpFill}
                        style={{
                          '--hp-pct': `${playerHpMax <= 0 ? 0 : Math.min(100, (playerHp / playerHpMax) * 100)}%`,
                        } as CSSProperties}
                      />
                    </div>
                  </aside>
                  <aside className={gameStyle.moneyPanel} aria-label="Pawn money">
                    <div className={gameStyle.moneyValue}>
                      {pawnMoney}/{pawnMoneyCap}
                    </div>
                    <div className={gameStyle.moneyTrack}>
                      <div className={gameStyle.moneyFill}>
                        {Array.from({ length: pawnMoneyCap }, (_, i) => {
                          const filled = i < pawnMoney
                          return (
                            <img
                              key={i}
                              src={PIECE_SPRITES.pawn}
                              alt=""
                              aria-hidden
                              className={`${gameStyle.moneyPawnImage} ${filled ? gameStyle.moneyPawnImageFilled : gameStyle.moneyPawnImageEmpty}`}
                            />
                          )
                        })}
                      </div>
                    </div>
                  </aside>
                </div>
              ) : battleResult ? (
                <div className={gameStyle.leftBarsBattle}>
                  <div className={gameStyle.hpBattleCluster}>
                    <div className={gameStyle.hpBattleValue}>{playerHp}</div>
                    <div className={gameStyle.hpAndEvalRow}>
                      <aside className={gameStyle.hpPanelBattle} aria-label="Player HP">
                        <div className={gameStyle.hpTrack}>
                          <div
                            className={gameStyle.hpFill}
                            style={{
                              '--hp-pct': `${playerHpMax <= 0 ? 0 : Math.min(100, (playerHp / playerHpMax) * 100)}%`,
                            } as CSSProperties}
                          />
                        </div>
                      </aside>
                      <EvaluationBar centipawns={battleResult.centipawns} invert={battleResult.currentUserIsWhite} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className={gameStyle.leftBarsPlaceholder} aria-hidden />
              )}

              <div className={gameStyle.boardMiddleColumn}>
                <div className={gameStyle.boardSlot}>
                  {phase === 'shop' ? (
                    <LobbyChessBoard
                      playerColor="white"
                      className={lobbyBoardStyle.boardCompact}
                      kingSquare={kingSquare}
                      placedPieces={boardPieces}
                      shadeOpponentRanks
                      onDropBenchOnSquare={handlePlaceFromBench}
                      onMoveBoardPiece={handleMoveBoardPiece}
                      onMoveKing={handleMoveKing}
                      placementDisabled={placingPiece || shopInteractionsLocked}
                      onSellablePieceDragStart={startSellableDrag}
                      onSellablePieceDragEnd={endSellableDrag}
                      highlightSquare={
                        tapSelection?.source === 'board' ? { col: tapSelection.col, row: tapSelection.row }
                        : tapSelection?.source === 'king' ? kingSquare
                        : null
                      }
                      onTapSquare={(col, row) => {
                        if (placingPiece || shopInteractionsLocked || !tapSelection) return
                        if (tapSelection.source === 'bench') {
                          handlePlaceFromBench(col, row, tapSelection.benchSlot)
                        } else if (tapSelection.source === 'board') {
                          handleMoveBoardPiece(tapSelection.col, tapSelection.row, col, row)
                        } else if (tapSelection.source === 'king') {
                          handleMoveKing(col, row)
                        }
                        setTapSelection(null)
                      }}
                      onTapBoardPiece={(col, row) => {
                        if (placingPiece || shopInteractionsLocked) return
                        if (tapSelection?.source === 'board' && tapSelection.col === col && tapSelection.row === row) {
                          setTapSelection(null)
                        } else {
                          setTapSelection({ source: 'board', col, row })
                        }
                      }}
                      onTapKing={() => {
                        if (placingPiece || shopInteractionsLocked) return
                        if (tapSelection?.source === 'king') {
                          setTapSelection(null)
                        } else {
                          setTapSelection({ source: 'king' })
                        }
                      }}
                    />
                  ) : battleResult && battleBoardDisplay ? (
                    <BattlePreviewBoard
                      className={lobbyBoardStyle.boardCompact}
                      whiteKing={battleBoardDisplay.whiteKing}
                      blackKing={battleBoardDisplay.blackKing}
                      whitePieces={battleBoardDisplay.whiteBoard}
                      blackPieces={battleBoardDisplay.blackBoard}
                      viewAsBlack={!battleResult.currentUserIsWhite}
                    />
                  ) : (
                    <p className={style.error}>{battleError || 'Loading battle…'}</p>
                  )}
                </div>
                {phase === 'battle' && battleResult && battleResult.principalVariation.length > 0 ? (
                  <div className={gameStyle.battlePvPanel} aria-label="Engine move line">
                    <ul className={gameStyle.battlePvList}>
                      {battleResult.principalVariation.slice(0, PV_REPLAY_MAX_PLIES).map((uci, i) => {
                        const n = i + 1
                        const played = pvMovesApplied >= n
                        const active = played && pvMovesApplied === n
                        return (
                          <li
                            key={`${i}-${uci}`}
                            className={`${gameStyle.battlePvItem} ${played ? gameStyle.battlePvItemPlayed : ''} ${active ? gameStyle.battlePvItemActive : ''}`}
                          >
                            <span className={gameStyle.battlePvIndex}>{n}.</span>
                            <span className={gameStyle.battlePvUci}>{uci}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>

              <aside className={gameStyle.rightActions} aria-label="Match actions">
                <div className={gameStyle.roundTimer} aria-label="Round timer">
                  <span className={gameStyle.roundTimerLabel}>
                    {phase === 'shop' ? 'Round timer' : 'Phase'}
                  </span>
                  <span className={gameStyle.roundTimerValue}>
                    {phase === 'shop' ? formatRoundTime(roundTimeLeft) : '-'}
                  </span>
                </div>
                {phase === 'shop' ? (
                  <div className={gameStyle.matchButtons}>
                    <button type="button" className={gameStyle.resignButton} onClick={() => void resignMatch()}>
                      Resign
                    </button>
                    <button
                      type="button"
                      className={gameStyle.drawButton}
                      onClick={() => {
                        window.alert('Draw offer feature is coming soon.')
                      }}
                    >
                      Draw
                    </button>
                    <div
                      className={`${gameStyle.sellBin} ${sellBinVisible ? gameStyle.sellBinVisible : ''} ${sellBinOver ? gameStyle.sellBinOver : ''}`}
                      onDragEnter={(ev) => {
                        ev.preventDefault()
                        setSellBinOver(true)
                      }}
                      onDragOver={(ev) => {
                        ev.preventDefault()
                        ev.dataTransfer.dropEffect = 'move'
                        setSellBinOver(true)
                      }}
                      onDragLeave={() => setSellBinOver(false)}
                      onDrop={(ev) => void handleSellDrop(ev)}
                      role="region"
                      aria-label="Drop here to sell piece for pawns"
                    >
                      <svg
                        className={gameStyle.sellBinIcon}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M6 6l1 14h10l1-14" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                      <span className={gameStyle.sellBinLabel}>Sell</span>
                    </div>
                  </div>
                ) : phase === 'battle' ? (
                  <div className={gameStyle.matchButtons}>
                    <button type="button" className={gameStyle.resignButton} onClick={() => void resignMatch()}>
                      Resign
                    </button>
                  </div>
                ) : null}
              </aside>
            </div>
            {phase === 'shop' ? (
              <>
                <div className={gameStyle.bench} aria-label="Piece bench">
                  {benchSlots.map((piece, i) => (
                    <div
                      key={i}
                      className={gameStyle.benchSlot}
                      aria-label={piece ? `Bench slot ${i + 1}, ${piece}` : `Bench slot ${i + 1}`}
                    >
                      {piece ? (
                        <img
                          src={PIECE_SPRITES[piece]}
                          alt=""
                          aria-hidden
                          className={`${gameStyle.benchPiece} ${!placingPiece && !shopInteractionsLocked ? gameStyle.benchPieceDraggable : ''} ${tapSelection?.source === 'bench' && tapSelection.benchSlot === i ? gameStyle.benchPieceSelected : ''}`}
                          draggable={!placingPiece && !shopInteractionsLocked}
                          onDragStart={
                            !placingPiece && !shopInteractionsLocked
                              ? (e) => {
                                  assignSpriteDragPreviewCanvas(e.nativeEvent, e.currentTarget)
                                  setBenchDragData(e.dataTransfer, i)
                                  startSellableDrag()
                                }
                              : undefined
                          }
                          onDragEnd={!placingPiece && !shopInteractionsLocked ? () => endSellableDrag() : undefined}
                          onClick={
                            !placingPiece && !shopInteractionsLocked
                              ? () => {
                                  if (tapSelection?.source === 'bench' && tapSelection.benchSlot === i) {
                                    setTapSelection(null)
                                  } else {
                                    setTapSelection({ source: 'bench', benchSlot: i })
                                  }
                                }
                              : undefined
                          }
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className={gameStyle.hudInner}>
                  <div className={gameStyle.shopSellRow}>
                    <div className={gameStyle.shop} aria-label="Piece shop">
                      {SHOP_ORDER.map((piece) => (
                        <button
                          key={piece}
                          type="button"
                          className={gameStyle.shopItem}
                          aria-label={piece}
                          onClick={() => void handleBuy(piece)}
                          disabled={
                            !shopAffordable[piece] || buyingPiece !== null || shopInteractionsLocked
                          }
                          title={`Cost: ${shopCosts[piece]}`}
                        >
                          <img src={PIECE_SPRITES[piece]} alt="" aria-hidden className={gameStyle.shopPieceImage} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
