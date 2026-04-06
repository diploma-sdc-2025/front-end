import { Link, useNavigate, useParams } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'
import gameStyle from './GamePage.module.css'
import { LobbyChessBoard, setBenchDragData, type BoardPlacedPiece } from '../components/LobbyChessBoard.tsx'
import { gameApi, type ShopPiece } from '../api/game.ts'

const PIECE_SPRITES = {
  pawn: '/pieces/pawn-white.png',
  knight: '/pieces/knight-white.png',
  bishop: '/pieces/bishop-white.png',
  rook: '/pieces/rook-white.png',
  queen: '/pieces/queen-white.png',
} as const

const ROUND_DURATION_SEC = 30
const SHOP_ORDER: ShopPiece[] = ['pawn', 'knight', 'bishop', 'rook', 'queen']

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
  const [roundTimeLeft, setRoundTimeLeft] = useState(ROUND_DURATION_SEC)
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
  const [placingPiece, setPlacingPiece] = useState(false)

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
    const id = window.setInterval(() => {
      setRoundTimeLeft((prev) => (prev <= 1 ? ROUND_DURATION_SEC : prev - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!accessToken || !matchId) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) {
      setShopError('Invalid match id')
      return
    }
    let cancelled = false
    const loadShop = async () => {
      try {
        const shop = await gameApi.getShop(id, accessToken)
        if (cancelled) return
        setPawnMoney(shop.money)
        setPawnMoneyCap((prev) => Math.max(prev, shop.money))
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
        setShopError('')
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
  }, [accessToken, matchId, applyBenchFromApi, applyBoardFromApi])

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
    applyBenchFromApi(shop.bench)
    applyBoardFromApi(shop.board)
  }

  const handlePlaceFromBench = async (col: number, row: number, benchSlot: number) => {
    if (!accessToken || !matchId || placingPiece) return
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) return
    const token = accessToken
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
            <div className={gameStyle.boardShell}>
              <div className={gameStyle.leftBars}>
                <aside className={gameStyle.hpPanel} aria-label="Player HP">
                  <div className={gameStyle.hpValue}>100</div>
                  <div className={gameStyle.hpTrack}>
                    <div className={gameStyle.hpFill} />
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

              <div className={gameStyle.boardSlot}>
                <LobbyChessBoard
                  playerColor="white"
                  className={gameStyle.boardCompact}
                  placedPieces={boardPieces}
                  onDropBenchOnSquare={handlePlaceFromBench}
                  onMoveBoardPiece={handleMoveBoardPiece}
                  placementDisabled={placingPiece}
                />
              </div>

              <aside className={gameStyle.rightActions} aria-label="Match actions">
                <div className={gameStyle.roundTimer} aria-label="Round timer">
                  <span className={gameStyle.roundTimerLabel}>Round timer</span>
                  <span className={gameStyle.roundTimerValue}>{formatRoundTime(roundTimeLeft)}</span>
                </div>
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
              </aside>
            </div>
            <div className={gameStyle.bench} aria-label="Piece bench">
              {benchSlots.map((piece, i) => (
                <div
                  key={i}
                  className={gameStyle.benchSlot}
                  aria-label={piece ? `Bench slot ${i + 1}, ${piece}` : `Bench slot ${i + 1}`}
                  draggable={Boolean(piece) && !placingPiece}
                  onDragStart={
                    piece
                      ? (e) => setBenchDragData(e.dataTransfer, i)
                      : undefined
                  }
                >
                  {piece ? (
                    <img
                      src={PIECE_SPRITES[piece]}
                      alt=""
                      aria-hidden
                      className={gameStyle.benchPiece}
                      draggable={false}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div className={gameStyle.hudInner}>
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
              {shopError && <p className={style.error}>{shopError}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
