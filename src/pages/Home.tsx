import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'
import menuStyle from './MainMenu.module.css'
import { useEffect, useMemo, useState } from 'react'
import { useMatchmakingQueue } from '../hooks/useMatchmakingQueue.ts'
import { resolveDisplayName } from '../util/displayName.ts'
import { parseUserIdFromAccessToken } from '../util/jwtClaims.ts'
import { isAdminFromAccessToken } from '../util/adminAccess.ts'
import { analyticsApi, type PlayerStats } from '../api/analytics.ts'
import { fetchUsersByIds } from '../api/users.ts'
import { BattlePreviewBoard } from '../components/BattlePreviewBoard.tsx'
import lobbyBoardStyle from '../components/LobbyChessBoard.module.css'
import type { BoardPieceDto, KingSquareDto, ShopPiece } from '../api/game.ts'
import { Chess, type Square } from 'chess.js'
import {
  applyDisplayPreferencesToDocument,
  BOARD_THEME_OPTIONS,
  type BoardThemeId,
  demoReplayStepMs,
  DISPLAY_ANIMATION_SPEED_KEY,
  DISPLAY_BOARD_THEME_KEY,
  DISPLAY_COORDS_KEY,
  DISPLAY_THEME_KEY,
  type DisplayAnimationSpeed,
  readLocalToggle,
  readLocalValue,
  writeLocalToggle,
  writeLocalValue,
} from '../util/displayPreferences.ts'
import {
  AUDIO_CLICK_SOUND_KEY,
  AUDIO_GAME_SOUNDS_KEY,
  AUDIO_MATCH_SOUND_KEY,
  AUDIO_MUTE_ALL_KEY,
} from '../util/menuAudio.ts'

/** Stored before joining queue so the game client can branch when 1v3 is implemented. */
const QUEUE_MODE_STORAGE_KEY = 'diploma:queueMode'
const NOTIFY_BATTLE_REMINDER_KEY = 'menu_notify_battle_reminder'
const NOTIFY_BROWSER_KEY = 'menu_notify_browser'

const DEMO_LINE_UCI = [
  'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6',
  'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5',
  'a4b3', 'd7d6', 'c2c3', 'e8g8',
] as const

const PIECE_TO_SHOP: Record<string, ShopPiece | undefined> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
}

type DemoPosition = {
  whiteKing: KingSquareDto
  blackKing: KingSquareDto
  whitePieces: BoardPieceDto[]
  blackPieces: BoardPieceDto[]
}

type MiniFenPiece = {
  piece: ShopPiece | 'king'
  black: boolean
}

function pieceFromFenChar(ch: string): MiniFenPiece | null {
  const lower = ch.toLowerCase()
  const black = ch === lower
  if (lower === 'k') return { piece: 'king', black }
  if (lower === 'q') return { piece: 'queen', black }
  if (lower === 'r') return { piece: 'rook', black }
  if (lower === 'b') return { piece: 'bishop', black }
  if (lower === 'n') return { piece: 'knight', black }
  if (lower === 'p') return { piece: 'pawn', black }
  return null
}

function parseFenPiecesForMiniBoard(fen: string | null): Array<MiniFenPiece | null> | null {
  if (!fen) return null
  const placement = fen.trim().split(/\s+/)[0]
  if (!placement) return null
  const rows = placement.split('/')
  if (rows.length !== 8) return null

  const board: Array<MiniFenPiece | null> = []
  for (const row of rows) {
    for (const ch of row) {
      const n = Number(ch)
      if (Number.isInteger(n) && n >= 1 && n <= 8) {
        for (let i = 0; i < n; i += 1) board.push(null)
        continue
      }
      const parsed = pieceFromFenChar(ch)
      if (!parsed) return null
      board.push(parsed)
    }
  }
  return board.length === 64 ? board : null
}

function miniPieceSpriteName(piece: MiniFenPiece['piece']): string {
  if (piece === 'king') return 'king'
  return piece
}

function squareToCoords(square: string): { x: number; y: number } {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0)
  const rank = parseInt(square.slice(1), 10)
  if (!Number.isFinite(rank)) return { x: 0, y: 0 }
  return { x: file, y: 8 - rank }
}

function demoPositionFromChess(chess: Chess): DemoPosition {
  const whitePieces: BoardPieceDto[] = []
  const blackPieces: BoardPieceDto[] = []
  let whiteKing: KingSquareDto = { x: 4, y: 7 }
  let blackKing: KingSquareDto = { x: 4, y: 0 }

  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue
      const { x, y } = squareToCoords(cell.square)
      if (cell.type === 'k') {
        if (cell.color === 'w') whiteKing = { x, y }
        else blackKing = { x, y }
        continue
      }
      const piece = PIECE_TO_SHOP[cell.type]
      if (!piece) continue
      const dto: BoardPieceDto = { x, y, piece }
      if (cell.color === 'w') whitePieces.push(dto)
      else blackPieces.push(dto)
    }
  }
  return { whiteKing, blackKing, whitePieces, blackPieces }
}

function buildDemoPositions(): DemoPosition[] {
  const chess = new Chess()
  const out: DemoPosition[] = [demoPositionFromChess(chess)]
  for (const uci of DEMO_LINE_UCI) {
    const from = uci.slice(0, 2) as Square
    const to = uci.slice(2, 4) as Square
    const promotion = uci.length >= 5 ? uci.slice(4, 5) : undefined
    chess.move({
      from,
      to,
      promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined,
    })
    out.push(demoPositionFromChess(chess))
  }
  return out
}

export function Home() {
  const navigate = useNavigate()
  const { accessToken, isReady, logout, isGuest, playAsGuest, login, register } = useAuth()
  const queue = useMatchmakingQueue(accessToken, navigate)
  const [guestLandingLoading, setGuestLandingLoading] = useState(false)
  const [guestLandingError, setGuestLandingError] = useState('')
  const [landingLoginName, setLandingLoginName] = useState('')
  const [landingPassword, setLandingPassword] = useState('')
  const [landingLoginLoading, setLandingLoginLoading] = useState(false)
  const [landingRegisterUsername, setLandingRegisterUsername] = useState('')
  const [landingRegisterEmail, setLandingRegisterEmail] = useState('')
  const [landingRegisterPassword, setLandingRegisterPassword] = useState('')
  const [landingRegisterLoading, setLandingRegisterLoading] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const demoPositions = useMemo(() => buildDemoPositions(), [])
  const [demoPositionIdx, setDemoPositionIdx] = useState(0)

  type Tab = 'profile' | 'leaderboard' | 'settings' | 'statistics' | 'howToPlay'
  const [tab, setTab] = useState<Tab>('profile')
  const [settingsPanel, setSettingsPanel] = useState<
    'root' | 'account' | 'audio' | 'display' | 'notifications'
  >('root')
  const [audioMuteAll, setAudioMuteAll] = useState(() => readLocalToggle(AUDIO_MUTE_ALL_KEY, false))
  const [audioMatchFoundSound, setAudioMatchFoundSound] = useState(() =>
    readLocalToggle(AUDIO_MATCH_SOUND_KEY, true),
  )
  const [audioClickSound, setAudioClickSound] = useState(() => readLocalToggle(AUDIO_CLICK_SOUND_KEY, true))
  const [audioGameSounds, setAudioGameSounds] = useState(() => readLocalToggle(AUDIO_GAME_SOUNDS_KEY, true))
  const [notifyBattleReminder, setNotifyBattleReminder] = useState(() =>
    readLocalToggle(NOTIFY_BATTLE_REMINDER_KEY, true),
  )
  const [notifyBrowser, setNotifyBrowser] = useState(() => readLocalToggle(NOTIFY_BROWSER_KEY, false))
  const [displayTheme, setDisplayTheme] = useState<'dark' | 'light'>(() => {
    const raw = readLocalValue(DISPLAY_THEME_KEY, 'dark')
    return raw === 'light' ? 'light' : 'dark'
  })
  const [displayBoardTheme, setDisplayBoardTheme] = useState<BoardThemeId>(() => {
    const raw = readLocalValue(DISPLAY_BOARD_THEME_KEY, BOARD_THEME_OPTIONS[0].id)
    return BOARD_THEME_OPTIONS.some((v) => v.id === raw) ? (raw as BoardThemeId) : BOARD_THEME_OPTIONS[0].id
  })
  const [displayCoordinates, setDisplayCoordinates] = useState(() => readLocalToggle(DISPLAY_COORDS_KEY, true))
  const [displayAnimationSpeed, setDisplayAnimationSpeed] = useState<DisplayAnimationSpeed>(() => {
    const raw = readLocalValue(DISPLAY_ANIMATION_SPEED_KEY, 'normal')
    return raw === 'slow' || raw === 'fast' ? raw : 'normal'
  })
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0)
  const [leaderboardRows, setLeaderboardRows] = useState<
    Array<{
      rank: number
      userId: number
      username: string
      totalEvents: number
      matchesPlayed: number
      winRatePercent: number
      currentRating: number
    }>
  >([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)
  const [myStats, setMyStats] = useState<PlayerStats | null>(null)
  const [recentOpponentLabels, setRecentOpponentLabels] = useState<Map<number, string>>(() => new Map())
  const [statsLoading, setStatsLoading] = useState(false)
  const [playModePickerOpen, setPlayModePickerOpen] = useState(false)
  const [practiceVsBotNoticeOpen, setPracticeVsBotNoticeOpen] = useState(false)
  const [selectedQueueMode, setSelectedQueueMode] = useState<'1v1' | '1v3' | null>(null)
  const playerName = useMemo(() => resolveDisplayName(accessToken), [accessToken])
  const myUserId = useMemo(() => parseUserIdFromAccessToken(accessToken), [accessToken])
  const isAdmin = useMemo(() => isAdminFromAccessToken(accessToken), [accessToken])

  useEffect(() => {
    if (isGuest && (tab === 'leaderboard' || tab === 'statistics')) {
      setTab('profile')
    }
  }, [isGuest, tab])

  useEffect(() => {
    if (!accessToken || myUserId == null || isGuest) {
      setMyStats(null)
      return
    }
    let cancelled = false
    setStatsLoading(true)
    void (async () => {
      try {
        const s = await analyticsApi.fetchPlayerStats(myUserId)
        if (!cancelled) {
          setMyStats(s)
        }
      } catch {
        if (!cancelled) setMyStats(null)
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, myUserId, isGuest])

  useEffect(() => {
    if (!accessToken || !myStats?.recentMatches?.length) {
      setRecentOpponentLabels(new Map())
      return
    }
    const ids = [
      ...new Set(
        myStats.recentMatches
          .map((m) => m.opponentUserId)
          .filter((id): id is number => id != null && Number.isFinite(id) && id > 0),
      ),
    ]
    if (!ids.length) {
      setRecentOpponentLabels(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const map = await fetchUsersByIds(accessToken, ids)
        if (cancelled) return
        const next = new Map<number, string>()
        for (const id of ids) {
          const u = map.get(id)
          next.set(id, u?.username ?? `Player #${id}`)
        }
        setRecentOpponentLabels(next)
      } catch {
        if (!cancelled) setRecentOpponentLabels(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, myStats])

  useEffect(() => {
    if (!accessToken || tab !== 'leaderboard' || isGuest) return
    let cancelled = false
    setLeaderboardLoading(true)
    setLeaderboardError(null)
    void (async () => {
      try {
        const rows = await analyticsApi.fetchLeaderboard(100)
        const ids = [...new Set(rows.map((r) => r.userId))]
        const names = await fetchUsersByIds(accessToken, ids)
        if (cancelled) return
        setLeaderboardRows(
          rows.map((r) => ({
            rank: r.rank,
            userId: r.userId,
            username: names.get(r.userId)?.username ?? `Player #${r.userId}`,
            totalEvents: r.totalEvents,
            matchesPlayed: r.matchesPlayed,
            winRatePercent: r.winRatePercent,
            currentRating: r.currentRating,
          })),
        )
      } catch (e) {
        if (!cancelled) {
          setLeaderboardError(e instanceof Error ? e.message : 'Could not load leaderboard')
          setLeaderboardRows([])
        }
      } finally {
        if (!cancelled) setLeaderboardLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, tab, leaderboardRefresh, isGuest])

  useEffect(() => {
    if (queue.phase === 'finding') {
      setPlayModePickerOpen(false)
      setSelectedQueueMode(null)
    }
  }, [queue.phase])

  useEffect(() => {
    if (!practiceVsBotNoticeOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPracticeVsBotNoticeOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [practiceVsBotNoticeOpen])

  useEffect(() => {
    if (!accessToken) return
    if (!/(session expired|invalid token|unauthorized|401)/i.test(queue.error)) return
    void logout()
  }, [accessToken, queue.error, logout])

  useEffect(() => {
    if (tab !== 'settings') {
      setSettingsPanel('root')
    }
  }, [tab])

  useEffect(() => {
    applyDisplayPreferencesToDocument({
      theme: displayTheme,
      boardTheme: displayBoardTheme,
      showCoordinates: displayCoordinates,
      animationSpeed: displayAnimationSpeed,
    })
  }, [displayTheme, displayBoardTheme, displayCoordinates, displayAnimationSpeed])

  const settingsHeading =
    settingsPanel === 'root'
      ? 'SETTINGS'
      : settingsPanel === 'account'
        ? 'Account & Profile'
        : settingsPanel === 'audio'
          ? 'Audio'
          : settingsPanel === 'display'
            ? 'Display'
            : 'Notifications'
  const selectedBoardTheme =
    BOARD_THEME_OPTIONS.find((v) => v.id === displayBoardTheme) ?? BOARD_THEME_OPTIONS[0]

  useEffect(() => {
    if (accessToken) return
    const id = window.setInterval(() => {
      setDemoPositionIdx((n) => (n + 1) % demoPositions.length)
    }, demoReplayStepMs(displayAnimationSpeed))
    return () => window.clearInterval(id)
  }, [accessToken, demoPositions.length, displayAnimationSpeed])

  if (!isReady) return null

  if (accessToken) {
    const avatarInitials = playerName
      .split(/\s+/)
      .map((part) => part.trim().charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase()
    const matchesPlayed = myStats?.matchesPlayed ?? 0
    const wins = myStats?.wins ?? 0
    const losses = myStats?.losses ?? 0
    const winRateDisplay = myStats?.winRatePercent != null ? `${myStats.winRatePercent.toFixed(1)}%` : '-'
    const ratingDisplay = myStats?.currentRating != null ? myStats.currentRating.toLocaleString() : '-'
    const recentMatches = myStats?.recentMatches ?? []

    const startBoard = demoPositions[0]!

    return (
      <>
      <div className={menuStyle.menuFrame}>
        <div className={menuStyle.menuCard}>
          <header className={menuStyle.menuHeader}>
            <div className={menuStyle.headerIntro}>
              <div className={menuStyle.headerText}>
                <p className={menuStyle.subWelcome} />
              </div>
              <div className={menuStyle.headerWordmark} aria-hidden>
                AUTO-CHESS
              </div>
            </div>
          </header>

          <div className={menuStyle.menuBody}>
            <div className={menuStyle.menuBodyGrid}>
            <nav className={menuStyle.tabNav} aria-label="Main menu sections">
              <button
                type="button"
                className={`${menuStyle.tabButton} ${tab === 'profile' ? menuStyle.tabButtonActive : ''}`}
                onClick={() => setTab('profile')}
              >
                <div className={menuStyle.tabIconRow}>
                  <span className={menuStyle.tabIcon}>👤</span>
                  <span className={menuStyle.tabTitle}>Profile</span>
                </div>
              </button>

              {!isGuest && (
                <button
                  type="button"
                  className={`${menuStyle.tabButton} ${tab === 'leaderboard' ? menuStyle.tabButtonActive : ''}`}
                  onClick={() => setTab('leaderboard')}
                >
                  <div className={menuStyle.tabIconRow}>
                    <span className={menuStyle.tabIcon}>🏆</span>
                    <span className={menuStyle.tabTitle}>Leaderboard</span>
                  </div>
                </button>
              )}

              {isAdmin && (
                <button
                  type="button"
                  className={menuStyle.tabButton}
                  onClick={() => navigate('/admin/analytics')}
                >
                  <div className={menuStyle.tabIconRow}>
                    <span className={menuStyle.tabIcon}>🛡️</span>
                    <span className={menuStyle.tabTitle}>Admin Live</span>
                  </div>
                </button>
              )}

              <button
                type="button"
                className={`${menuStyle.tabButton} ${tab === 'settings' ? menuStyle.tabButtonActive : ''}`}
                onClick={() => setTab('settings')}
              >
                <div className={menuStyle.tabIconRow}>
                  <span className={menuStyle.tabIcon}>⚙️</span>
                  <span className={menuStyle.tabTitle}>Settings</span>
                </div>
              </button>

              <button
                type="button"
                className={`${menuStyle.tabButton} ${tab === 'howToPlay' ? menuStyle.tabButtonActive : ''}`}
                onClick={() => setTab('howToPlay')}
              >
                <div className={menuStyle.tabIconRow}>
                  <span className={menuStyle.tabIcon}>📘</span>
                  <span className={`${menuStyle.tabTitle} ${menuStyle.tabTitleHowToPlay}`}>How to play</span>
                </div>
              </button>

              <button
                type="button"
                className={menuStyle.tabButton}
                onClick={() => setPracticeVsBotNoticeOpen(true)}
              >
                <div className={menuStyle.tabIconRow}>
                  <span className={menuStyle.tabIcon}>🤖</span>
                  <span className={menuStyle.tabTitle}>Practice vs bot</span>
                </div>
              </button>

              {!isGuest && (
                <button
                  type="button"
                  className={`${menuStyle.tabButton} ${tab === 'statistics' ? menuStyle.tabButtonActive : ''}`}
                  onClick={() => setTab('statistics')}
                >
                  <div className={menuStyle.tabIconRow}>
                    <span className={menuStyle.tabIcon}>📈</span>
                    <span className={menuStyle.tabTitle}>Statistics</span>
                  </div>
                </button>
              )}
            </nav>

            <main className={menuStyle.menuMain}>
            <div
              className={`${menuStyle.tabContentWrap} ${tab === 'settings' || tab === 'howToPlay' ? menuStyle.tabContentWrapScrollable : ''}`}
            >
              {tab === 'profile' && (
                <>
                  <h2 className={menuStyle.sectionTitle}>PROFILE</h2>
                  {isGuest ? (
                    <div className={menuStyle.guestRegisterWrap}>
                      <p className={menuStyle.guestProfileIntro}>
                        Guest mode - create an account to track stats and rankings.
                      </p>
                      <Link
                        to="/register"
                        className={`${style.primaryButton} ${style.primaryButtonLightLabel} ${menuStyle.guestRegisterCta}`}
                      >
                        Create free account
                      </Link>
                    </div>
                  ) : (
                    <>
                      <div className={menuStyle.profileGrid}>
                        <section className={menuStyle.profileCard}>
                          <div className={menuStyle.profileIdentityRow}>
                            <div className={menuStyle.profileAvatar} aria-hidden>
                              {avatarInitials || 'P'}
                            </div>
                            <div>
                              <p className={menuStyle.profileLabel}>Player</p>
                              <p className={menuStyle.profileValue}>{playerName}</p>
                            </div>
                            <span className={menuStyle.profileTag}>Registered</span>
                          </div>
                          <div className={menuStyle.profileRatingBox}>
                            <span className={menuStyle.profileLabel}>Current rating</span>
                            <strong className={menuStyle.profileRatingValue}>
                              {statsLoading ? '…' : ratingDisplay}
                            </strong>
                          </div>
                        </section>

                        <section className={menuStyle.profileCard}>
                          <p className={menuStyle.profileLabel}>Performance</p>
                          <div className={menuStyle.profileStatsGrid}>
                            <div className={menuStyle.profileStatTile}>
                              <div className={menuStyle.profileStatValue}>
                                {statsLoading ? '…' : matchesPlayed.toLocaleString()}
                              </div>
                              <div className={menuStyle.profileStatLabel}>Matches played</div>
                            </div>
                            <div className={menuStyle.profileStatTile}>
                              <div className={menuStyle.profileStatValue}>
                                {statsLoading ? '…' : winRateDisplay}
                              </div>
                              <div className={menuStyle.profileStatLabel}>Win rate</div>
                            </div>
                            <div className={menuStyle.profileStatTile}>
                              <div className={menuStyle.profileStatValue}>
                                {statsLoading ? '…' : wins.toLocaleString()}
                              </div>
                              <div className={menuStyle.profileStatLabel}>Wins</div>
                            </div>
                            <div className={menuStyle.profileStatTile}>
                              <div className={menuStyle.profileStatValue}>
                                {statsLoading ? '…' : losses.toLocaleString()}
                              </div>
                              <div className={menuStyle.profileStatLabel}>Losses</div>
                            </div>
                          </div>
                        </section>
                      </div>

                      <section className={menuStyle.profileCard} style={{ marginTop: 12 }}>
                        <div className={menuStyle.profileRecentHeader}>
                          <p className={menuStyle.profileLabel}>Last 5 matches</p>
                        </div>
                        {statsLoading ? (
                          <p className={menuStyle.sectionSubtle}>Loading match history…</p>
                        ) : (
                          <div className={menuStyle.profileMiniBoardsGrid}>
                            {Array.from({ length: 5 }, (_, idx) => recentMatches[idx] ?? null).map((match, idx) => {
                              const pieces = parseFenPiecesForMiniBoard(match?.finalFen ?? null)
                              return (
                                <button
                                  key={match ? `${match.opponent}-${match.playedAt ?? idx}` : `empty-${idx}`}
                                  type="button"
                                  className={menuStyle.profileMiniBoardCard}
                                  title="Match details coming soon"
                                >
                                  <div className={menuStyle.profileMiniBoardTop}>
                                    <span className={menuStyle.profileRecentResult}>{match?.result ?? '-'}</span>
                                    <span className={menuStyle.profileMiniBoardOpponent}>
                                      {match == null
                                        ? 'No match yet'
                                        : match.opponentUserId != null
                                          ? recentOpponentLabels.get(match.opponentUserId) ??
                                            match.opponent ??
                                            `Player #${match.opponentUserId}`
                                          : match.opponent ?? 'Unknown opponent'}
                                    </span>
                                  </div>
                                  <div className={menuStyle.profileMiniBoardSurface}>
                                    {pieces ? (
                                      <div className={menuStyle.profileMiniBoardSquares}>
                                        {pieces.map((piece, squareIdx) => {
                                          const row = Math.floor(squareIdx / 8)
                                          const col = squareIdx % 8
                                          const light = (row + col) % 2 === 0
                                          return (
                                            <div
                                              key={squareIdx}
                                              className={`${menuStyle.profileMiniSquare} ${light ? menuStyle.profileMiniSquareLight : menuStyle.profileMiniSquareDark}`}
                                            >
                                              {piece ? (
                                                <img
                                                  src={`/pieces/${miniPieceSpriteName(piece.piece)}-white.png`}
                                                  alt=""
                                                  aria-hidden
                                                  className={`${menuStyle.profileMiniPiece} ${piece.black ? menuStyle.profileMiniPieceBlack : ''}`}
                                                />
                                              ) : null}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <div className={menuStyle.profileMiniBoardPlaceholder}>No board data</div>
                                    )}
                                  </div>
                                  <div className={menuStyle.profileMiniBoardMeta}>
                                    <span>{match?.playedAt ? new Date(match.playedAt).toLocaleDateString() : '-'}</span>
                                    <span>
                                      {match?.ratingDelta == null
                                        ? 'Δ -'
                                        : `Δ ${match.ratingDelta > 0 ? '+' : ''}${match.ratingDelta}`}
                                    </span>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </section>
                    </>
                  )}
                </>
              )}

              {tab === 'howToPlay' && (
                <>
                  <h2 className={`${menuStyle.sectionTitle} ${menuStyle.howToPlayPageTitle}`}>HOW TO PLAY</h2>

                  <div className={menuStyle.howToPlayGuides}>
                    <section className={menuStyle.profileCard}>
                      <h3 className={menuStyle.howToPlayModeTitle}>1 vs 1</h3>
                      <p className={menuStyle.howToPlayLead}>
                        1v1 Mode is a strategy-based game where you compete directly against another player. Success
                        depends on how well you position your pieces and manage your resources.
                      </p>

                      <h4 className={menuStyle.howToPlaySubTitle}>Starting the Game</h4>
                      <p className={menuStyle.howToPlayBody}>Each player begins with:</p>
                      <ul className={menuStyle.howToPlayList}>
                        <li>1 King</li>
                        <li>2 Currency Pawns</li>
                      </ul>
                      <p className={menuStyle.howToPlayBody}>Currency pawns are used to buy combat pieces.</p>

                      <h4 className={menuStyle.howToPlaySubTitle}>Shop Phase</h4>
                      <ul className={menuStyle.howToPlayList}>
                        <li>Use your currency to purchase and place pieces anywhere on the board.</li>
                        <li>You can sell pieces at full price if you want to change your strategy.</li>
                        <li>
                          Positioning is key - especially your King, which should be kept safe.
                        </li>
                      </ul>

                      <h4 className={menuStyle.howToPlaySubTitle}>Battle Phase</h4>
                      <ul className={menuStyle.howToPlayList}>
                        <li>When the timer reaches 0, the battle begins automatically.</li>
                        <li>Your setup is evaluated against your opponent’s.</li>
                        <li>
                          An evaluation bar shows how much damage you deal or receive based on positioning and piece
                          choices.
                        </li>
                      </ul>

                      <h4 className={menuStyle.howToPlaySubTitle}>Health &amp; Damage</h4>
                      <ul className={menuStyle.howToPlayList}>
                        <li>Each player starts with 50 HP.</li>
                        <li>The maximum damage per round is 10 HP.</li>
                      </ul>

                      <h4 className={menuStyle.howToPlaySubTitle}>Round Cycle</h4>
                      <p className={menuStyle.howToPlayBody}>After each battle:</p>
                      <ul className={menuStyle.howToPlayList}>
                        <li>A new shop phase begins.</li>
                        <li>Both players receive 2 new currency pawns.</li>
                        <li>The cycle repeats until one player’s HP reaches 0.</li>
                      </ul>

                      <h4 className={menuStyle.howToPlaySubTitle}>Winning the Game</h4>
                      <p className={menuStyle.howToPlayBody}>The last player with remaining HP wins.</p>
                    </section>

                    <section className={menuStyle.profileCard}>
                      <h3 className={menuStyle.howToPlayModeTitle}>1 vs 3</h3>
                      <p className={menuStyle.howToPlayLead}>
                        This mode follows the same core rules as 1v1, but with four players in a free-for-all,
                        last-man-standing match - each player is on their own, not a premade team.
                      </p>

                      <h4 className={menuStyle.howToPlaySubTitle}>Objective</h4>
                      <ul className={menuStyle.howToPlayList}>
                        <li>Defeat all opponents.</li>
                        <li>The last player with remaining HP wins.</li>
                      </ul>

                      <h4 className={menuStyle.howToPlaySubTitle}>Core rules</h4>
                      <p className={menuStyle.howToPlayBody}>All standard mechanics from 1v1 apply:</p>
                      <ul className={menuStyle.howToPlayList}>
                        <li>Shop phase → battle phase loop</li>
                        <li>Piece placement and positioning</li>
                        <li>50 HP per player</li>
                        <li>Maximum 10 damage per round</li>
                      </ul>

                      <h4 className={menuStyle.howToPlaySubTitle}>Economy &amp; pricing</h4>
                      <p className={menuStyle.howToPlayBody}>
                        <strong>Piece costs increased:</strong> all pieces except pawns cost +1 compared to{' '}
                        <strong>1v1</strong> shop prices (e.g. knights and bishops cost 4 instead of 3).
                      </p>

                      <h4 className={menuStyle.howToPlaySubTitle}>Income &amp; streaks</h4>
                      <p className={menuStyle.howToPlayBody}>
                        <strong>Base income:</strong> players receive 2 currency pawns each round.
                      </p>
                      <p className={menuStyle.howToPlayBody}>
                        <strong>Losing streak bonus:</strong> after each loss, you gain +1 extra pawn per round. This
                        bonus does not stack - as long as you keep losing, your income stays at 3 pawns per round (2 base +
                        1 bonus). It resets when you win a round.
                      </p>
                      <p className={menuStyle.howToPlayBody}>
                        <strong>Win streak bonus:</strong> after 2 consecutive wins, you gain +1 extra pawn per round.
                        This bonus does not stack - while the streak continues, your income stays at 3 pawns per round (2 base
                        + 1 bonus). It resets when your streak breaks (you lose a round).
                      </p>

                    </section>
                  </div>

                  <div className={menuStyle.howToPlayTutorialRow}>
                    <button
                      type="button"
                      className={`${style.primaryButton} ${style.primaryButtonLightLabel} ${menuStyle.howToPlayTutorialButton}`}
                      onClick={() => navigate('/game/tutorial', { state: { matchAssignedAt: Date.now() } })}
                    >
                      Start the tutorial
                    </button>
                  </div>
                </>
              )}

              {tab === 'leaderboard' && (
                <>
                  <h2 className={menuStyle.sectionTitle}>LEADERBOARD</h2>
                  <p className={menuStyle.sectionSubtle}>Top 100 players.</p>
                  {leaderboardError && (
                    <p className={style.error} style={{ marginTop: 8 }}>
                      {leaderboardError}
                    </p>
                  )}
                  {leaderboardLoading && <p className={menuStyle.sectionSubtle}>Loading…</p>}
                  {!leaderboardLoading && !leaderboardError && leaderboardRows.length === 0 && (
                    <p className={menuStyle.sectionSubtle}>No data yet - queue for a match to appear here.</p>
                  )}
                  <div className={menuStyle.leaderboardScroll}>
                    <div className={menuStyle.list}>
                      {leaderboardRows.map((row) => (
                        <div className={menuStyle.listRow} key={row.userId}>
                          <span className={menuStyle.badgeDot}>{row.rank}</span>
                          <div className={menuStyle.rowMain}>
                            <div className={menuStyle.rowTitle}>
                              {row.username}
                              {myUserId != null && row.userId === myUserId ? ' (you)' : ''}
                            </div>
                            <div className={menuStyle.rowSub}>
                              Games {row.matchesPlayed} · Win rate {row.winRatePercent.toFixed(1)}%
                            </div>
                          </div>
                          <div className={menuStyle.rowValue}>{row.currentRating}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className={style.secondaryButton}
                      disabled={leaderboardLoading}
                      onClick={() => setLeaderboardRefresh((n) => n + 1)}
                    >
                      Refresh
                    </button>
                  </div>
                </>
              )}

              {tab === 'settings' && (
                <>
                  <h2 className={`${menuStyle.sectionTitle} ${menuStyle.settingsTitle}`}>{settingsHeading}</h2>
                  {settingsPanel === 'root' ? (
                    <div className={menuStyle.settingsGridWrap}>
                      <div className={menuStyle.settingsGrid}>
                        <button
                          type="button"
                          className={menuStyle.settingsNavButton}
                          onClick={() => setSettingsPanel('account')}
                        >
                          Account &amp; Profile
                        </button>
                        <button
                          type="button"
                          className={menuStyle.settingsNavButton}
                          onClick={() => setSettingsPanel('audio')}
                        >
                          Audio
                        </button>
                        <button
                          type="button"
                          className={menuStyle.settingsNavButton}
                          onClick={() => setSettingsPanel('display')}
                        >
                          Display
                        </button>
                        <button
                          type="button"
                          className={menuStyle.settingsNavButton}
                          onClick={() => setSettingsPanel('notifications')}
                        >
                          Notifications
                        </button>
                      </div>
                    </div>
                  ) : settingsPanel === 'account' ? (
                    <div className={menuStyle.settingsPanelWrap}>
                      <div key="settings-account" className={menuStyle.settingsPanel}>
                        <button
                          type="button"
                          className={menuStyle.settingsBackButton}
                          onClick={() => setSettingsPanel('root')}
                        >
                          ← Back
                        </button>
                        <div className={menuStyle.settingsActionList}>
                          <button
                            type="button"
                            className={menuStyle.settingsActionButton}
                            onClick={() => window.alert('Profile picture editing is coming soon.')}
                          >
                            Edit profile pic
                          </button>
                          <button
                            type="button"
                            className={menuStyle.settingsActionButton}
                            onClick={() => window.alert('Password change is coming soon.')}
                          >
                            Change password
                          </button>
                          <button type="button" className={menuStyle.settingsActionButton} onClick={() => logout()}>
                            Log out
                          </button>
                          <button
                            type="button"
                            className={`${menuStyle.settingsActionButton} ${menuStyle.settingsActionDanger}`}
                            onClick={() =>
                              window.alert('Account deletion is not available yet. Please contact support for now.')
                            }
                          >
                            Delete account
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : settingsPanel === 'audio' ? (
                    <div className={menuStyle.settingsPanelWrap}>
                      <div key="settings-audio" className={menuStyle.settingsPanel}>
                        <button
                          type="button"
                          className={menuStyle.settingsBackButton}
                          onClick={() => setSettingsPanel('root')}
                        >
                          ← Back
                        </button>
                        <div className={menuStyle.toggleRow}>
                          <div className={menuStyle.toggleLine}>
                            <div className={menuStyle.toggleLabel}>
                              <div className={menuStyle.toggleName}>Mute all</div>
                            </div>
                            <button
                              type="button"
                              className={`${menuStyle.toggleSwitch} ${audioMuteAll ? menuStyle.toggleSwitchOn : ''}`}
                              aria-pressed={audioMuteAll}
                              onClick={() => {
                                const next = !audioMuteAll
                                writeLocalToggle(AUDIO_MUTE_ALL_KEY, next)
                                setAudioMuteAll(next)
                                if (next) {
                                  setAudioMatchFoundSound(true)
                                  writeLocalToggle(AUDIO_MATCH_SOUND_KEY, true)
                                  setAudioGameSounds(true)
                                  writeLocalToggle(AUDIO_GAME_SOUNDS_KEY, true)
                                  setAudioClickSound(true)
                                  writeLocalToggle(AUDIO_CLICK_SOUND_KEY, true)
                                } else {
                                  setAudioMatchFoundSound(false)
                                  writeLocalToggle(AUDIO_MATCH_SOUND_KEY, false)
                                  setAudioGameSounds(false)
                                  writeLocalToggle(AUDIO_GAME_SOUNDS_KEY, false)
                                  setAudioClickSound(false)
                                  writeLocalToggle(AUDIO_CLICK_SOUND_KEY, false)
                                }
                              }}
                            >
                              <span className={menuStyle.toggleKnob} />
                            </button>
                          </div>

                          <div className={menuStyle.toggleLine}>
                            <div className={menuStyle.toggleLabel}>
                              <div className={menuStyle.toggleName}>Play sound on match found</div>
                            </div>
                            <button
                              type="button"
                              disabled={audioMuteAll}
                              className={`${menuStyle.toggleSwitch} ${audioMatchFoundSound ? menuStyle.toggleSwitchOn : ''}`}
                              aria-pressed={audioMatchFoundSound}
                              aria-disabled={audioMuteAll}
                              title={audioMuteAll ? 'Turn off Mute all to adjust individual sounds' : undefined}
                              onClick={() =>
                                setAudioMatchFoundSound((on) => {
                                  const next = !on
                                  writeLocalToggle(AUDIO_MATCH_SOUND_KEY, next)
                                  return next
                                })
                              }
                            >
                              <span className={menuStyle.toggleKnob} />
                            </button>
                          </div>

                          <div className={menuStyle.toggleLine}>
                            <div className={menuStyle.toggleLabel}>
                              <div className={menuStyle.toggleName}>Battle &amp; piece sounds</div>
                            </div>
                            <button
                              type="button"
                              disabled={audioMuteAll}
                              className={`${menuStyle.toggleSwitch} ${audioGameSounds ? menuStyle.toggleSwitchOn : ''}`}
                              aria-pressed={audioGameSounds}
                              aria-disabled={audioMuteAll}
                              title={audioMuteAll ? 'Turn off Mute all to adjust individual sounds' : undefined}
                              onClick={() =>
                                setAudioGameSounds((on) => {
                                  const next = !on
                                  writeLocalToggle(AUDIO_GAME_SOUNDS_KEY, next)
                                  return next
                                })
                              }
                            >
                              <span className={menuStyle.toggleKnob} />
                            </button>
                          </div>

                          <div className={menuStyle.toggleLine}>
                            <div className={menuStyle.toggleLabel}>
                              <div className={menuStyle.toggleName}>Button click sounds</div>
                            </div>
                            <button
                              type="button"
                              disabled={audioMuteAll}
                              className={`${menuStyle.toggleSwitch} ${audioClickSound ? menuStyle.toggleSwitchOn : ''}`}
                              aria-pressed={audioClickSound}
                              aria-disabled={audioMuteAll}
                              title={audioMuteAll ? 'Turn off Mute all to adjust individual sounds' : undefined}
                              onClick={() =>
                                setAudioClickSound((on) => {
                                  const next = !on
                                  writeLocalToggle(AUDIO_CLICK_SOUND_KEY, next)
                                  return next
                                })
                              }
                            >
                              <span className={menuStyle.toggleKnob} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : settingsPanel === 'display' ? (
                    <div className={menuStyle.settingsPanelWrap}>
                      <div key="settings-display" className={menuStyle.settingsPanel}>
                        <button
                          type="button"
                          className={menuStyle.settingsBackButton}
                          onClick={() => setSettingsPanel('root')}
                        >
                          ← Back
                        </button>

                        <div className={menuStyle.settingsBlock}>
                          <div className={menuStyle.settingsBlockTitle}>Theme</div>
                          <div className={menuStyle.settingsChoiceRow}>
                            <button
                              type="button"
                              className={`${menuStyle.settingsChoiceButton} ${displayTheme === 'dark' ? menuStyle.settingsChoiceButtonActive : ''}`}
                              onClick={() => {
                                setDisplayTheme('dark')
                                writeLocalValue(DISPLAY_THEME_KEY, 'dark')
                              }}
                            >
                              Dark
                            </button>
                            <button
                              type="button"
                              className={`${menuStyle.settingsChoiceButton} ${displayTheme === 'light' ? menuStyle.settingsChoiceButtonActive : ''}`}
                              onClick={() => {
                                setDisplayTheme('light')
                                writeLocalValue(DISPLAY_THEME_KEY, 'light')
                              }}
                            >
                              Light
                            </button>
                          </div>
                        </div>

                        <div className={menuStyle.settingsBlock}>
                          <div className={menuStyle.settingsBlockTitle}>Move animation speed</div>
                          <div className={menuStyle.settingsChoiceRow}>
                            {(['slow', 'normal', 'fast'] as const).map((speed) => (
                              <button
                                key={speed}
                                type="button"
                                className={`${menuStyle.settingsChoiceButton} ${displayAnimationSpeed === speed ? menuStyle.settingsChoiceButtonActive : ''}`}
                                onClick={() => {
                                  setDisplayAnimationSpeed(speed)
                                  writeLocalValue(DISPLAY_ANIMATION_SPEED_KEY, speed)
                                }}
                              >
                                {speed[0].toUpperCase() + speed.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className={menuStyle.settingsBlock}>
                          <div className={menuStyle.settingsBlockTitle}>Board theme</div>
                          <div className={menuStyle.boardThemeLayout}>
                            <div className={menuStyle.boardThemeGrid}>
                              {BOARD_THEME_OPTIONS.map((theme) => (
                                <button
                                  key={theme.id}
                                  type="button"
                                  className={`${menuStyle.boardThemeTile} ${displayBoardTheme === theme.id ? menuStyle.boardThemeTileActive : ''}`}
                                  onClick={() => {
                                    setDisplayBoardTheme(theme.id)
                                    writeLocalValue(DISPLAY_BOARD_THEME_KEY, theme.id)
                                  }}
                                >
                                  <span className={menuStyle.boardThemeSwatch} style={{ background: theme.light }} />
                                  <span className={menuStyle.boardThemeSwatch} style={{ background: theme.dark }} />
                                  <span className={menuStyle.boardThemeLabel}>{theme.label}</span>
                                </button>
                              ))}
                            </div>

                            <div className={menuStyle.boardThemePreview}>
                              <div className={menuStyle.boardThemePreviewGrid}>
                                {Array.from({ length: 9 }, (_, idx) => {
                                  const row = Math.floor(idx / 3)
                                  const col = idx % 3
                                  const light = (row + col) % 2 === 0
                                  const pieceByIndex: Record<number, MiniFenPiece | undefined> = {
                                    0: { piece: 'bishop', black: true },
                                    1: { piece: 'queen', black: true },
                                    2: { piece: 'pawn', black: true },
                                    6: { piece: 'knight', black: false },
                                    7: { piece: 'king', black: false },
                                    8: { piece: 'rook', black: false },
                                  }
                                  const piece = pieceByIndex[idx]
                                  return (
                                    <div
                                      key={idx}
                                      className={menuStyle.boardThemePreviewSquare}
                                      style={{ background: light ? selectedBoardTheme.light : selectedBoardTheme.dark }}
                                    >
                                      {displayCoordinates && idx === 0 ? (
                                        <span className={menuStyle.boardThemeCoord}>8</span>
                                      ) : null}
                                      {displayCoordinates && idx === 3 ? (
                                        <span className={menuStyle.boardThemeCoord}>7</span>
                                      ) : null}
                                      {displayCoordinates && idx === 6 ? (
                                        <span className={menuStyle.boardThemeCoord}>6</span>
                                      ) : null}
                                      {piece ? (
                                        <img
                                          src={`/pieces/${miniPieceSpriteName(piece.piece)}-white.png`}
                                          alt=""
                                          aria-hidden
                                          className={`${menuStyle.boardThemePiece} ${piece.black ? menuStyle.boardThemePieceBlack : ''}`}
                                        />
                                      ) : null}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className={menuStyle.settingsBlock}>
                          <div className={menuStyle.toggleRow}>
                            <div className={menuStyle.toggleLine}>
                              <div className={menuStyle.toggleLabel}>
                                <div className={menuStyle.toggleName}>Show coordinates</div>
                              </div>
                              <button
                                type="button"
                                className={`${menuStyle.toggleSwitch} ${displayCoordinates ? menuStyle.toggleSwitchOn : ''}`}
                                aria-pressed={displayCoordinates}
                                onClick={() =>
                                  setDisplayCoordinates((on) => {
                                    const next = !on
                                    writeLocalToggle(DISPLAY_COORDS_KEY, next)
                                    return next
                                  })
                                }
                              >
                                <span className={menuStyle.toggleKnob} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : settingsPanel === 'notifications' ? (
                    <div className={menuStyle.settingsPanelWrap}>
                      <div key="settings-notifications" className={menuStyle.settingsPanel}>
                        <button
                          type="button"
                          className={menuStyle.settingsBackButton}
                          onClick={() => setSettingsPanel('root')}
                        >
                          ← Back
                        </button>
                        <div className={menuStyle.toggleRow}>
                          <div className={menuStyle.toggleLine}>
                            <div className={menuStyle.toggleLabel}>
                              <div className={menuStyle.toggleName}>Battle start reminder</div>
                            </div>
                            <button
                              type="button"
                              className={`${menuStyle.toggleSwitch} ${notifyBattleReminder ? menuStyle.toggleSwitchOn : ''}`}
                              aria-pressed={notifyBattleReminder}
                              onClick={() =>
                                setNotifyBattleReminder((on) => {
                                  const next = !on
                                  writeLocalToggle(NOTIFY_BATTLE_REMINDER_KEY, next)
                                  return next
                                })
                              }
                            >
                              <span className={menuStyle.toggleKnob} />
                            </button>
                          </div>

                          <div className={menuStyle.toggleLine}>
                            <div className={menuStyle.toggleLabel}>
                              <div className={menuStyle.toggleName}>Browser notifications</div>
                            </div>
                            <button
                              type="button"
                              className={`${menuStyle.toggleSwitch} ${notifyBrowser ? menuStyle.toggleSwitchOn : ''}`}
                              aria-pressed={notifyBrowser}
                              onClick={() =>
                                void (async () => {
                                  if (notifyBrowser) {
                                    writeLocalToggle(NOTIFY_BROWSER_KEY, false)
                                    setNotifyBrowser(false)
                                    return
                                  }
                                  // Keep as a user preference even if permission is denied.
                                  writeLocalToggle(NOTIFY_BROWSER_KEY, true)
                                  setNotifyBrowser(true)
                                  if ('Notification' in globalThis) {
                                    try {
                                      await globalThis.Notification.requestPermission()
                                    } catch {
                                      // ignore; preference remains enabled
                                    }
                                  }
                                })()
                              }
                            >
                              <span className={menuStyle.toggleKnob} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={menuStyle.settingsPanelWrap}>
                      <div key="settings-other" className={menuStyle.settingsPanel}>
                        <button
                          type="button"
                          className={menuStyle.settingsBackButton}
                          onClick={() => setSettingsPanel('root')}
                        >
                          ← Back
                        </button>
                        <p className={menuStyle.sectionSubtle} style={{ margin: 0 }}>
                          This section is coming soon.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === 'statistics' && (
                <>
                  <h2 className={menuStyle.sectionTitle}>STATISTICS</h2>

                  <div className={menuStyle.statsLayout}>
                    <div className={menuStyle.statsPrimaryCard}>
                      <div className={menuStyle.statsPrimaryLabel}>Matches played</div>
                      <div className={menuStyle.statsPrimaryValue}>
                        {statsLoading ? '…' : myStats != null ? myStats.matchesPlayed.toLocaleString() : '-'}
                      </div>
                      <div className={menuStyle.statsPrimarySub}>Total completed matches</div>
                    </div>

                    <div className={menuStyle.statsTriple}>
                      <div className={menuStyle.statsMiniCard}>
                        <div className={menuStyle.statsMiniValue}>
                          {statsLoading ? '…' : myStats != null ? myStats.wins.toLocaleString() : '-'}
                        </div>
                        <div className={menuStyle.statsMiniLabel}>Wins</div>
                      </div>
                      <div className={menuStyle.statsMiniCard}>
                        <div className={menuStyle.statsMiniValue}>
                          {statsLoading ? '…' : myStats != null ? myStats.losses.toLocaleString() : '-'}
                        </div>
                        <div className={menuStyle.statsMiniLabel}>Losses</div>
                      </div>
                      <div className={menuStyle.statsMiniCard}>
                        <div className={menuStyle.statsMiniValue}>
                          {statsLoading
                            ? '…'
                            : myStats?.winRatePercent != null
                              ? `${myStats.winRatePercent.toFixed(1)}%`
                              : '-'}
                        </div>
                        <div className={menuStyle.statsMiniLabel}>Win rate</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            </main>
            </div>

            <footer className={menuStyle.menuFooter}>
              {queue.error && (
              <p className={style.error} style={{ margin: 0 }}>
                {queue.error}
              </p>
            )}
              {queue.phase === 'finding' && (
                <p className={menuStyle.sectionSubtle} style={{ margin: 0, textAlign: 'center' }}>
                  Finding match... Queue: {queue.queueSize} · Position: {queue.position ?? '-'}
                </p>
              )}

              <div className={menuStyle.bottomActions}>
                <button
                  type="button"
                  className={`${style.primaryButton} ${menuStyle.playButton}`}
                  onClick={() => {
                    if (queue.phase !== 'idle' || queue.isJoining) return
                    setSelectedQueueMode('1v1')
                    setPlayModePickerOpen(true)
                  }}
                  disabled={queue.phase !== 'idle' || queue.isJoining}
                >
                  {queue.phase === 'idle' ? (queue.isJoining ? 'Joining…' : 'Play') : 'Searching…'}
                </button>
                {queue.phase === 'finding' && (
                  <button type="button" className={style.secondaryButton} onClick={() => queue.cancelFinding()}>
                    Cancel search
                  </button>
                )}
              </div>

              <div className={menuStyle.footerRow}>
                <button type="button" onClick={() => logout()} className={menuStyle.smallLinkLikeButton}>
                  Log out
                </button>
              </div>
            </footer>
          </div>
        </div>
      </div>

      {playModePickerOpen ? (
        <div
          className={menuStyle.playModePickerOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="play-mode-picker-title"
        >
          <div className={menuStyle.playModePickerPanel}>
            <h2 id="play-mode-picker-title" className={menuStyle.playModePickerTitle}>
              Choose a mode
            </h2>
            <p className={menuStyle.playModePickerSub}>Select a board, then Play.</p>
            <div className={menuStyle.playModePickerBoards}>
              <button
                type="button"
                className={`${menuStyle.playModeBoardChoice} ${selectedQueueMode === '1v1' ? menuStyle.playModeBoardChoiceSelected : ''}`}
                onClick={() => setSelectedQueueMode('1v1')}
              >
                <span className={menuStyle.playModeBoardLabel}>1 vs 1</span>
                <BattlePreviewBoard
                  className={`${lobbyBoardStyle.boardCompact} ${menuStyle.playModePickerBoard}`}
                  whiteKing={startBoard.whiteKing}
                  blackKing={startBoard.blackKing}
                  whitePieces={startBoard.whitePieces}
                  blackPieces={startBoard.blackPieces}
                  viewAsBlack={false}
                />
              </button>
              <button
                type="button"
                disabled
                aria-disabled="true"
                aria-label="1 vs 3, coming out soon"
                className={`${menuStyle.playModeBoardChoice} ${menuStyle.playModeBoardChoiceDisabled}`}
              >
                <span className={menuStyle.playModeBoardLabel}>1 vs 3</span>
                <div className={menuStyle.playModeBoardLockedWrap}>
                  <BattlePreviewBoard
                    className={`${lobbyBoardStyle.boardCompact} ${menuStyle.playModePickerBoard}`}
                    whiteKing={startBoard.whiteKing}
                    blackKing={startBoard.blackKing}
                    whitePieces={startBoard.whitePieces}
                    blackPieces={startBoard.blackPieces}
                    viewAsBlack={false}
                  />
                  <span className={menuStyle.playModeBoardLockedBadge} aria-hidden>
                    Coming out soon
                  </span>
                </div>
              </button>
            </div>
            <div className={menuStyle.playModePickerActions}>
              <button
                type="button"
                className={style.secondaryButton}
                onClick={() => {
                  setPlayModePickerOpen(false)
                  setSelectedQueueMode(null)
                }}
              >
                Back
              </button>
              <button
                type="button"
                className={`${style.primaryButton} ${menuStyle.playModePickerPlay}`}
                disabled={selectedQueueMode == null || queue.phase !== 'idle' || queue.isJoining}
                onClick={() => {
                  if (selectedQueueMode == null) return
                  try {
                    sessionStorage.setItem(QUEUE_MODE_STORAGE_KEY, selectedQueueMode)
                  } catch {
                    /* ignore quota / private mode */
                  }
                  setPlayModePickerOpen(false)
                  void queue.startFinding()
                }}
              >
                Play
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {practiceVsBotNoticeOpen ? (
        <div
          className={menuStyle.noticeModalOverlay}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPracticeVsBotNoticeOpen(false)
          }}
        >
          <div
            className={menuStyle.noticeModalPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-vs-bot-notice-title"
          >
            <h2 id="practice-vs-bot-notice-title" className={menuStyle.noticeModalTitle}>
              Practice vs bot
            </h2>
            <p className={menuStyle.noticeModalBody}>
              This mode is still in development. A dedicated practice flow against an AI opponent will be added in a
              future update. Use <strong>How to play</strong> for the interactive tutorial in the meantime.
            </p>
            <div className={menuStyle.noticeModalActions}>
              <button
                type="button"
                className={menuStyle.noticeModalButton}
                onClick={() => setPracticeVsBotNoticeOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </>
    )
  }

  const demo = demoPositions[demoPositionIdx] ?? demoPositions[0]
  return (
    <div className={style.authLanding}>
      <div className={style.authLandingScene}>
        <section className={style.authLandingBoardPane} aria-label="Opening demo board">
          <BattlePreviewBoard
            className={style.authLandingBoard}
            whiteKing={demo.whiteKing}
            blackKing={demo.blackKing}
            whitePieces={demo.whitePieces}
            blackPieces={demo.blackPieces}
            viewAsBlack={false}
          />
          <p className={style.authLandingBoardCaption}>
            Ruy Lopez opening
          </p>
        </section>
        <div className={style.authLandingCard}>
          <h1>Auto-Chess</h1>
          <form
            className={style.authLandingForm}
            onSubmit={(e) => {
              e.preventDefault()
              setGuestLandingError('')
              if (authMode === 'register') {
                setLandingRegisterLoading(true)
                void (async () => {
                  try {
                    await register(
                      landingRegisterUsername.trim(),
                      landingRegisterEmail.trim(),
                      landingRegisterPassword,
                    )
                  } catch (err) {
                    setGuestLandingError(err instanceof Error ? err.message : 'Registration failed')
                  } finally {
                    setLandingRegisterLoading(false)
                  }
                })()
                return
              }
              setLandingLoginLoading(true)
              void (async () => {
                try {
                  await login(landingLoginName.trim(), landingPassword)
                } catch (err) {
                  setGuestLandingError(err instanceof Error ? err.message : 'Login failed')
                } finally {
                  setLandingLoginLoading(false)
                }
              })()
            }}
          >
            {authMode === 'register' ? (
              <>
                <input
                  type="text"
                  className={style.input}
                  placeholder="Username"
                  autoComplete="username"
                  value={landingRegisterUsername}
                  onChange={(e) => setLandingRegisterUsername(e.target.value)}
                  minLength={3}
                  maxLength={50}
                  required
                />
                <input
                  type="email"
                  className={style.input}
                  placeholder="Email"
                  autoComplete="email"
                  value={landingRegisterEmail}
                  onChange={(e) => setLandingRegisterEmail(e.target.value)}
                  required
                />
                <input
                  type="password"
                  className={style.input}
                  placeholder="Password"
                  autoComplete="new-password"
                  value={landingRegisterPassword}
                  onChange={(e) => setLandingRegisterPassword(e.target.value)}
                  minLength={8}
                  maxLength={72}
                  required
                />
                <button
                  type="submit"
                  className={`${style.primaryButton} ${style.authLandingSubmit}`}
                  disabled={landingRegisterLoading}
                >
                  {landingRegisterLoading ? 'Creating account…' : 'Register'}
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  className={style.input}
                  placeholder="Name or email"
                  autoComplete="username"
                  value={landingLoginName}
                  onChange={(e) => setLandingLoginName(e.target.value)}
                  required
                />
                <input
                  type="password"
                  className={style.input}
                  placeholder="Password"
                  autoComplete="current-password"
                  value={landingPassword}
                  onChange={(e) => setLandingPassword(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  className={`${style.primaryButton} ${style.authLandingSubmit}`}
                  disabled={landingLoginLoading}
                >
                  {landingLoginLoading ? 'Signing in…' : 'Log in'}
                </button>
              </>
            )}
          </form>
          {guestLandingError && <p className={style.error}>{guestLandingError}</p>}
          <div className={style.authLandingRegisterRow}>
            {authMode === 'register' ? (
              <>
                <span>Already have an account?</span>{' '}
                <button
                  type="button"
                  className={style.authLandingRegister}
                  onClick={() => {
                    setGuestLandingError('')
                    setAuthMode('login')
                  }}
                >
                  Log in
                </button>
              </>
            ) : (
              <>
                <span>No account?</span>{' '}
                <button
                  type="button"
                  className={style.authLandingRegister}
                  onClick={() => {
                    setGuestLandingError('')
                    setAuthMode('register')
                  }}
                >
                  Register
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            className={style.authGuestLink}
            disabled={guestLandingLoading}
            onClick={() => {
              setGuestLandingError('')
              setGuestLandingLoading(true)
              void (async () => {
                try {
                  await playAsGuest()
                } catch (e) {
                  setGuestLandingError(e instanceof Error ? e.message : 'Could not start guest session')
                } finally {
                  setGuestLandingLoading(false)
                }
              })()
            }}
          >
            {guestLandingLoading ? 'Starting…' : 'Continue as guest'}
          </button>
        </div>
      </div>
    </div>
  )
}
