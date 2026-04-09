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
  PAWN_RANK_ROWS_MAX,
  PAWN_RANK_ROWS_MIN,
  type BattleRoundResponse,
  type ShopPiece,
} from '../api/game.ts'
import { battlePositionAfterUciMoves } from '../util/battlePvReplay.ts'

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
const PV_REPLAY_STEP_MS = 1000
/** Pause on the final battle position before returning to shop / placement. */
const BATTLE_END_PAUSE_MS = 2500
/** Half-moves (plies): 20 = White and Black each move 10 times. */
const PV_REPLAY_MAX_PLIES = 20
const SHOP_ORDER: ShopPiece[] = ['pawn', 'knight', 'bishop', 'rook', 'queen']

type GamePhase = 'shop' | 'battle'

function formatRoundTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function Game() {
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
  const battleRequestRef = useRef(false)
  const phaseRef = useRef<GamePhase>(phase)
  phaseRef.current = phase
  const [pvMovesApplied, setPvMovesApplied] = useState(0)
  const [pvReplayArmed, setPvReplayArmed] = useState(false)
  const [sellBinVisible, setSellBinVisible] = useState(false)
  const [sellBinOver, setSellBinOver] = useState(false)

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
    setRoundTimeLeft(ROUND_DURATION_SEC)
    setBattleResult(null)
    setBattleError('')
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

    let current = 0
    const id = window.setInterval(() => {
      current += 1
      setPvMovesApplied(current)
      if (current >= cap) window.clearInterval(id)
    }, PV_REPLAY_STEP_MS)
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

  const battlePvCap = useMemo(() => {
    if (!battleResult) return 0
    const pv = Array.isArray(battleResult.principalVariation) ? battleResult.principalVariation : []
    return Math.min(PV_REPLAY_MAX_PLIES, pv.length)
  }, [battleResult])

  /** No PV to replay → "done" immediately; otherwise done after replay interval has applied all plies. */
  const battleReplayDone = useMemo(() => {
    if (phase !== 'battle' || !battleResult) return false
    if (battlePvCap === 0) return true
    return pvReplayArmed && pvMovesApplied >= battlePvCap
  }, [phase, battleResult, battlePvCap, pvReplayArmed, pvMovesApplied])

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
    if (phase !== 'shop' || roundTimeLeft !== 0 || shopPhaseEndsAtMs == null) return
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
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, roundTimeLeft, shopPhaseEndsAtMs, accessToken, matchId])

  const syncShopFromServer = useCallback(
    async (id: number, token: string, opts?: { applyShopTimer?: boolean }) => {
      const shop = await gameApi.getShop(id, token)
      const applyTimer = opts?.applyShopTimer === true || phaseRef.current === 'shop'
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
    [applyBenchFromApi, applyBoardFromApi],
  )

  const returnToShopAfterBattle = useCallback(
    (id: number, token: string) => {
      battleRequestRef.current = false
      setBattleResult(null)
      setBattleError('')
      setPhase('shop')
      setShopPhaseEndsAtMs(null)
      void syncShopFromServer(id, token, { applyShopTimer: true }).catch(() => {
        /* shop polling will retry */
      })
    },
    [syncShopFromServer],
  )

  useEffect(() => {
    if (!battleReplayDone || !accessToken || !matchId) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    const t = window.setTimeout(() => returnToShopAfterBattle(id, token), BATTLE_END_PAUSE_MS)
    return () => window.clearTimeout(t)
  }, [battleReplayDone, accessToken, matchId, returnToShopAfterBattle])

  /** If PV replay / "done" detection never completes, still leave battle so the match cannot soft-lock. */
  useEffect(() => {
    if (phase !== 'battle' || !battleResult || !accessToken || !matchId) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
    const pv = Array.isArray(battleResult.principalVariation) ? battleResult.principalVariation : []
    const cap = Math.min(PV_REPLAY_MAX_PLIES, pv.length)
    const replayMs = cap === 0 ? 0 : PV_REPLAY_DELAY_MS + cap * PV_REPLAY_STEP_MS
    const maxWaitMs = replayMs + BATTLE_END_PAUSE_MS + 8000
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
    if (phaseRef.current === 'shop') {
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
