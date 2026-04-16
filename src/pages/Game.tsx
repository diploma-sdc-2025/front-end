import { Link, useNavigate, useParams } from 'react-router-dom'
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
  type BoardPieceDto,
  PAWN_RANK_ROWS_MAX,
  PAWN_RANK_ROWS_MIN,
  type BattleRoundResponse,
  type ShopPiece,
} from '../api/game.ts'
import { battleApi, type BattleEvaluateResponse } from '../api/battle.ts'
import { battlePositionAfterUciMoves, type BattleReplayPosition } from '../util/battlePvReplay.ts'
import { applyDisplayPreferencesToDocument, getSavedDisplayPreferences } from '../util/displayPreferences.ts'

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
const BATTLE_EVAL_RETRY_MS = 1200
/** Pause on the final battle position before returning to shop / placement. */
const BATTLE_END_PAUSE_MS = 2500
/** Half-moves (plies): 20 = White and Black each move 10 times. */
const PV_REPLAY_MAX_PLIES = 20
const SHOP_ORDER: ShopPiece[] = ['pawn', 'knight', 'bishop', 'rook', 'queen']
const TUTORIAL_BENCH: (ShopPiece | null)[] = Array.from({ length: 8 }, () => null)
const TUTORIAL_START_MONEY = 2
const TUTORIAL_ENEMY_KING = { x: 4, y: 0 }
const TUTORIAL_ENEMY_PIECES: BoardPieceDto[] = [{ x: 4, y: 1, piece: 'pawn' }]
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

export function Game({ mode = 'normal' }: GameProps) {
  const navigate = useNavigate()
  const { matchId } = useParams<{ matchId: string }>()
  const { accessToken } = useAuth()
  const [pawnMoney, setPawnMoney] = useState(0)
  /** Visual bar capacity: at least 2, expands if the server reports higher gold. */
  const [pawnMoneyCap, setPawnMoneyCap] = useState(2)
  const [playerHp, setPlayerHp] = useState(100)
  const [playerHpMax, setPlayerHpMax] = useState(100)
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
  const battleRequestRef = useRef(false)
  const phaseRef = useRef<GamePhase>(phase)
  phaseRef.current = phase
  const [pvMovesApplied, setPvMovesApplied] = useState(0)
  const [pvReplayArmed, setPvReplayArmed] = useState(false)
  const [sellBinVisible, setSellBinVisible] = useState(false)
  const [sellBinOver, setSellBinOver] = useState(false)
  const isTutorialMode = mode === 'tutorial'
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
    setPhase('shop')
    setShopPhaseEndsAtMs(null)
    setBattlePending(false)
    setRoundTimeLeft(ROUND_DURATION_SEC)
    setBattleResult(null)
    setBattleError('')
    setBattleEvalRetryTick(0)
    setPlayerHp(100)
    setPlayerHpMax(100)
  }, [matchId])

  /** Reset replay state when a new battle payload arrives; arm PV stepping from the same effect so Strict Mode cannot clear the arm timeout before it runs. */
  useEffect(() => {
    if (!battleResult) return
    setPvMovesApplied(0)
    setPvReplayArmed(false)
    if (phase !== 'battle') return
    const pv = Array.isArray(battleResult.principalVariation) ? battleResult.principalVariation : []
    if (pv.length === 0) return undefined
    const t = window.setTimeout(() => setPvReplayArmed(true), PV_REPLAY_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [battleResult, phase])

  useEffect(() => {
    if (!pvReplayArmed || !battleResult) return
    const pv = Array.isArray(battleResult.principalVariation) ? battleResult.principalVariation : []
    const cap = Math.min(PV_REPLAY_MAX_PLIES, pv.length)
    if (cap === 0) return undefined

    const replayEndsAtMs = Math.max(Date.now(), battleResult.battleViewEndsAt - BATTLE_END_PAUSE_MS)
    const remainingMs = Math.max(1, replayEndsAtMs - Date.now())
    const syncedStepMs = Math.max(120, Math.floor(remainingMs / cap))
    let current = 0
    const id = window.setInterval(() => {
      current += 1
      setPvMovesApplied(current)
      if (current >= cap) window.clearInterval(id)
    }, syncedStepMs)
    return () => window.clearInterval(id)
  }, [pvReplayArmed, battleResult])

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
      TUTORIAL_ENEMY_PIECES,
    )
    return `${placement} w - - 0 1`
  }, [tutorialKingSquare, tutorialBoardPieces])

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

  useEffect(() => {
    if (phase !== 'shop' || !battlePending || shopPhaseEndsAtMs == null) return
    if (!accessToken || !matchId) return
    if (battleRequestRef.current) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return

    battleRequestRef.current = true
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
          setPlayerHpMax((prev) => Math.max(prev, res.currentUserIsWhite ? res.whiteHp : res.blackHp, 100))
          setPhase('battle')
        }
      } catch (e) {
        if (!cancelled) {
          setBattleError(e instanceof Error ? e.message : 'Could not run battle evaluation')
          battleRequestRef.current = false
          window.setTimeout(() => {
            setBattleEvalRetryTick((n) => n + 1)
          }, BATTLE_EVAL_RETRY_MS)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, roundTimeLeft, shopPhaseEndsAtMs, accessToken, matchId, battleEvalRetryTick])

  const syncShopFromServer = useCallback(
    async (id: number, token: string, opts?: { applyShopTimer?: boolean }) => {
      const shop = await gameApi.getShop(id, token)
      const applyTimer =
        opts?.applyShopTimer === true || (phaseRef.current === 'shop' && !battlePending)
      if (applyTimer) {
        setShopPhaseEndsAtMs(shop.shopPhaseEndsAt)
        setRoundTimeLeft(Math.max(0, Math.ceil((shop.shopPhaseEndsAt - Date.now()) / 1000)))
      }
      setPawnMoney(shop.money)
      setPawnMoneyCap((prev) => Math.max(prev, shop.money))
      setPlayerHp(shop.hp)
      setPlayerHpMax((prev) => Math.max(prev, shop.hpMax, 1))
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
      setShopError('')
    },
    [applyBenchFromApi, applyBoardFromApi, battlePending],
  )

  const returnToShopAfterBattle = useCallback(
    (id: number, token: string) => {
      battleRequestRef.current = false
      setBattleResult(null)
      setBattleError('')
      setPhase('shop')
      setBattlePending(false)
      setShopPhaseEndsAtMs(null)
      void syncShopFromServer(id, token, { applyShopTimer: true }).catch(() => {
        /* shop polling will retry */
      })
    },
    [syncShopFromServer],
  )

  useEffect(() => {
    if (phase !== 'battle' || !battleResult || !accessToken || !matchId) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    const maxWaitMs = Math.max(0, battleResult.battleViewEndsAt - Date.now())
    const t = window.setTimeout(() => {
      if (phaseRef.current !== 'battle') return
      returnToShopAfterBattle(id, token)
    }, maxWaitMs)
    return () => window.clearTimeout(t)
  }, [phase, battleResult, accessToken, matchId, returnToShopAfterBattle])

  const endSellableDrag = useCallback(() => {
    setSellBinVisible(false)
    setSellBinOver(false)
  }, [])

  const handleTutorialPlaceFromBench = useCallback((col: number, row: number, benchSlot: number) => {
    if (row < TUTORIAL_MIN_ROW || row > TUTORIAL_MAX_ROW) {
      setShopError('Pieces may only be placed on ranks 1-4.')
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
      setTutorialBoardPieces((prevBoard) => {
        const withoutTarget = prevBoard.filter((p) => !(p.col === col && p.row === row))
        return [...withoutTarget, { col, row, piece }]
      })
      return nextBench
    })
  }, [])

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
        const kept = prev.filter(
          (p) =>
            !(p.col === fromCol && p.row === fromRow) &&
            !(p.col === toCol && p.row === toRow),
        )
        setShopError('')
        return [...kept, { col: toCol, row: toRow, piece: moving.piece }]
      })
    },
    [],
  )

  const handleTutorialMoveKing = useCallback((toCol: number, toRow: number) => {
    setTutorialKingSquare({ col: toCol, row: toRow })
  }, [])

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
    }
  }, [shopCosts, tutorialBenchSlots, tutorialBoardPieces])

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
      setShopError('')
    },
    [shopCosts, tutorialBenchSlots, tutorialPawnMoney],
  )

  useEffect(() => {
    if (!isTutorialMode) return
    if (showTutorialWelcome || showTutorialShopHint) return
    setTutorialRoundTimeLeft(ROUND_DURATION_SEC)
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
  }, [isTutorialMode, tutorialTimerSeed, showTutorialWelcome, showTutorialShopHint])

  useEffect(() => {
    if (!isTutorialMode) return
    if (tutorialRoundTimeLeft === 0) {
      setTutorialInBattle(true)
    }
  }, [isTutorialMode, tutorialRoundTimeLeft])

  useEffect(() => {
    if (!isTutorialMode || !tutorialInBattle) return
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
  }, [isTutorialMode, tutorialInBattle, tutorialFen])

  useEffect(() => {
    if (!isTutorialMode || !tutorialInBattle || !tutorialBattleState) return
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
  }, [isTutorialMode, tutorialInBattle, tutorialBattleState])

  useEffect(() => {
    if (!isTutorialMode || !tutorialInBattle) return
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
    }, totalBattleMs)
    return () => window.clearTimeout(id)
  }, [isTutorialMode, tutorialInBattle, tutorialBattleState])

  useEffect(() => {
    if (!accessToken || !matchId || phase !== 'shop') return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) {
      setShopError('Invalid match id')
      return
    }
    let cancelled = false
    const loadShop = async () => {
      try {
        if (cancelled) return
        await syncShopFromServer(id, accessToken)
      } catch (e) {
        if (!cancelled) setShopError(e instanceof Error ? e.message : 'Could not load shop')
      }
    }
    void loadShop()
    const pollId = window.setInterval(() => {
      void loadShop()
    }, 4000)
    return () => {
      cancelled = true
      window.clearInterval(pollId)
    }
  }, [accessToken, matchId, phase, syncShopFromServer])

  const handleBuy = async (piece: ShopPiece) => {
    if (!accessToken || !matchId || buyingPiece) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    setBuyingPiece(piece)
    setShopError('')
    try {
      const res = await gameApi.buyPiece(id, piece, accessToken)
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
      setShopError(e instanceof Error ? e.message : 'Could not buy piece')
    } finally {
      setBuyingPiece(null)
    }
  }

  const refreshShopLayout = async (id: number, token: string) => {
    const shop = await gameApi.getShop(id, token)
    if (phaseRef.current === 'shop' && !battlePending) {
      setShopPhaseEndsAtMs(shop.shopPhaseEndsAt)
      setRoundTimeLeft(Math.max(0, Math.ceil((shop.shopPhaseEndsAt - Date.now()) / 1000)))
    }
    applyBenchFromApi(shop.bench)
    applyBoardFromApi(shop.board)
    setKingSquare({ col: shop.king.x, row: shop.king.y })
  }

  const handlePlaceFromBench = async (col: number, row: number, benchSlot: number) => {
    if (!accessToken || !matchId || placingPiece) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    const benchPiece = benchSlots[benchSlot]
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
      await gameApi.placePieceFromBench(id, { benchSlot, squareX: col, squareY: row }, token)
      await refreshShopLayout(id, token)
    } catch (e) {
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
    if (!accessToken || !matchId || placingPiece) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    const moved = boardPieces.find((p) => p.col === fromCol && p.row === fromRow)
    if (
      moved?.piece === 'pawn' &&
      (toRow < PAWN_RANK_ROWS_MIN || toRow > PAWN_RANK_ROWS_MAX)
    ) {
      setShopError('Pawns may only be on ranks 2–4.')
      return
    }
    setPlacingPiece(true)
    setShopError('')
    try {
      await gameApi.moveBoardPiece(
        id,
        { fromX: fromCol, fromY: fromRow, toX: toCol, toY: toRow },
        token,
      )
      await refreshShopLayout(id, token)
    } catch (e) {
      setShopError(e instanceof Error ? e.message : 'Could not move piece')
    } finally {
      setPlacingPiece(false)
    }
  }

  const handleMoveKing = async (toCol: number, toRow: number) => {
    if (!accessToken || !matchId || placingPiece) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    setPlacingPiece(true)
    setShopError('')
    try {
      await gameApi.moveKing(id, { toX: toCol, toY: toRow }, token)
      await refreshShopLayout(id, token)
    } catch (e) {
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
    if (!accessToken || !matchId || placingPiece) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const payload = parsePieceDragPayload(e.dataTransfer)
    if (!payload || payload.source === 'king') return

    setPlacingPiece(true)
    setShopError('')
    try {
      if (payload.source === 'bench') {
        await gameApi.sellPiece(id, { benchSlot: payload.benchSlot }, accessToken)
      } else {
        await gameApi.sellPiece(
          id,
          { fromX: payload.fromCol, fromY: payload.fromRow },
          accessToken,
        )
      }
      await syncShopFromServer(id, accessToken)
    } catch (err) {
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
              <div className={gameStyle.boardShell}>
                {!tutorialInBattle ? (
                  <div className={gameStyle.leftBars}>
                    <aside className={gameStyle.hpPanel} aria-label="Player HP">
                      <div className={gameStyle.hpValue}>100</div>
                      <div className={gameStyle.hpTrack}>
                        <div className={gameStyle.hpFill} style={{ height: '100%' }} />
                      </div>
                    </aside>
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
                ) : (
                  <div className={gameStyle.leftBarsBattle}>
                    <div className={gameStyle.hpBattleCluster}>
                      <div className={gameStyle.hpBattleValue}>100</div>
                      <div className={gameStyle.hpAndEvalRow}>
                        <aside className={gameStyle.hpPanelBattle} aria-label="Player HP">
                          <div className={gameStyle.hpTrack}>
                            <div className={gameStyle.hpFill} style={{ height: '100%' }} />
                          </div>
                        </aside>
                        <EvaluationBar centipawns={tutorialBattleState?.eval.centipawns ?? 0} />
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
                        onDropBenchOnSquare={handleTutorialPlaceFromBench}
                        onMoveBoardPiece={handleTutorialMoveBoardPiece}
                        onMoveKing={handleTutorialMoveKing}
                        onSellablePieceDragStart={startSellableDrag}
                        onSellablePieceDragEnd={endSellableDrag}
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
                  <div className={gameStyle.roundTimer} aria-label="Round timer">
                    <span className={gameStyle.roundTimerLabel}>{tutorialInBattle ? 'Battle' : 'Round timer'}</span>
                    <span className={gameStyle.roundTimerValue}>
                      {tutorialInBattle ? 'Battle' : formatRoundTime(tutorialRoundTimeLeft)}
                    </span>
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
                </aside>
              </div>

              {!tutorialInBattle ? (
                <div className={gameStyle.tutorialShopGuideArea}>
                  {showTutorialShopHint ? (
                    <div className={gameStyle.tutorialShopHint} role="dialog" aria-modal="true" aria-label="Tutorial shop hint">
                      <p className={gameStyle.tutorialShopHintText}>You can buy pieces here.</p>
                      <button
                        type="button"
                        className={gameStyle.tutorialShopHintButton}
                        onClick={() => setShowTutorialShopHint(false)}
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
                            className={`${gameStyle.benchPiece} ${gameStyle.benchPieceDraggable}`}
                            draggable
                            onDragStart={(e) => {
                              assignSpriteDragPreviewCanvas(e.nativeEvent, e.currentTarget)
                              setBenchDragData(e.dataTransfer, i)
                              startSellableDrag()
                            }}
                            onDragEnd={() => endSellableDrag()}
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
                            onClick={() => handleTutorialBuy(piece)}
                            disabled={tutorialPawnMoney < shopCosts[piece] || !tutorialBenchSlots.some((v) => v == null)}
                            title={`Cost: ${shopCosts[piece]}`}
                          >
                            <img src={PIECE_SPRITES[piece]} alt="" aria-hidden className={gameStyle.shopPieceImage} />
                          </button>
                        ))}
                      </div>
                    </div>
                    {shopError && <p className={style.error}>{shopError}</p>}
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
      <div className={gameStyle.boardArea}>
        <div className={gameStyle.boardWithHp}>
          <div className={gameStyle.boardColumn}>
            {phase === 'battle' && battleResult && battleBoardDisplay ? (
              <p className={gameStyle.battleSceneHeader}>
                Battle — you are{' '}
                <strong>{battleResult.currentUserIsWhite ? 'White' : 'Black'}</strong>
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
                          height: `${playerHpMax <= 0 ? 0 : Math.min(100, (playerHp / playerHpMax) * 100)}%`,
                        }}
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
                              height: `${playerHpMax <= 0 ? 0 : Math.min(100, (playerHp / playerHpMax) * 100)}%`,
                            }}
                          />
                        </div>
                      </aside>
                      <EvaluationBar centipawns={battleResult.centipawns} />
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
                      onDropBenchOnSquare={handlePlaceFromBench}
                      onMoveBoardPiece={handleMoveBoardPiece}
                      onMoveKing={handleMoveKing}
                      placementDisabled={placingPiece}
                      onSellablePieceDragStart={startSellableDrag}
                      onSellablePieceDragEnd={endSellableDrag}
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
                    {phase === 'shop' ? formatRoundTime(roundTimeLeft) : '—'}
                  </span>
                </div>
                {phase === 'shop' ? (
                  <div className={gameStyle.matchButtons}>
                    <button
                      type="button"
                      className={gameStyle.resignButton}
                      onClick={() => {
                        const accepted = window.confirm('Are you sure you want to resign this match?')
                        if (accepted) navigate('/', { replace: true })
                      }}
                    >
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
                          className={`${gameStyle.benchPiece} ${!placingPiece ? gameStyle.benchPieceDraggable : ''}`}
                          draggable={!placingPiece}
                          onDragStart={
                            !placingPiece
                              ? (e) => {
                                  assignSpriteDragPreviewCanvas(e.nativeEvent, e.currentTarget)
                                  setBenchDragData(e.dataTransfer, i)
                                  startSellableDrag()
                                }
                              : undefined
                          }
                          onDragEnd={!placingPiece ? () => endSellableDrag() : undefined}
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
                          disabled={!shopAffordable[piece] || buyingPiece !== null}
                          title={`Cost: ${shopCosts[piece]}`}
                        >
                          <img src={PIECE_SPRITES[piece]} alt="" aria-hidden className={gameStyle.shopPieceImage} />
                        </button>
                      ))}
                    </div>
                  </div>
                  {shopError && <p className={style.error}>{shopError}</p>}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
