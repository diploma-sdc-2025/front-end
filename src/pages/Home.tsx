import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'
import menuStyle from './MainMenu.module.css'
import { useEffect, useMemo, useState } from 'react'
import { useMatchmakingQueue } from '../hooks/useMatchmakingQueue.ts'
import { resolveDisplayName } from '../util/displayName.ts'
import { parseUserIdFromAccessToken } from '../util/jwtClaims.ts'
import { analyticsApi } from '../api/analytics.ts'
import { fetchUsersByIds } from '../api/users.ts'

function formatElapsed(totalSec: number) {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function Home() {
  const navigate = useNavigate()
  const { accessToken, isReady, logout } = useAuth()
  const queue = useMatchmakingQueue(accessToken, navigate)

  type Tab = 'profile' | 'leaderboard' | 'settings' | 'statistics'
  const [tab, setTab] = useState<Tab>('profile')
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0)
  const [leaderboardRows, setLeaderboardRows] = useState<
    Array<{
      rank: number
      userId: number
      username: string
      totalEvents: number
      queueJoins: number
      queueLeaves: number
    }>
  >([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)
  const [myStats, setMyStats] = useState<{
    totalEvents: number
    queueJoins: number
    queueLeaves: number
  } | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const playerName = useMemo(() => resolveDisplayName(accessToken), [accessToken])
  const myUserId = useMemo(() => parseUserIdFromAccessToken(accessToken), [accessToken])

  useEffect(() => {
    if (!accessToken || myUserId == null) {
      setMyStats(null)
      return
    }
    let cancelled = false
    setStatsLoading(true)
    void (async () => {
      try {
        const s = await analyticsApi.fetchPlayerStats(myUserId)
        if (!cancelled) {
          setMyStats({
            totalEvents: s.totalEvents,
            queueJoins: s.queueJoins,
            queueLeaves: s.queueLeaves,
          })
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
  }, [accessToken, myUserId])

  useEffect(() => {
    if (!accessToken || tab !== 'leaderboard') return
    let cancelled = false
    setLeaderboardLoading(true)
    setLeaderboardError(null)
    void (async () => {
      try {
        const rows = await analyticsApi.fetchLeaderboard(50)
        const ids = [...new Set(rows.map((r) => r.userId))]
        const names = await fetchUsersByIds(accessToken, ids)
        if (cancelled) return
        setLeaderboardRows(
          rows.map((r) => ({
            rank: r.rank,
            userId: r.userId,
            username: names.get(r.userId) ?? `Player #${r.userId}`,
            totalEvents: r.totalEvents,
            queueJoins: r.queueJoins,
            queueLeaves: r.queueLeaves,
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
  }, [accessToken, tab, leaderboardRefresh])

  if (!isReady) return null

  if (accessToken) {
    return (
      <div className={menuStyle.menuFrame}>
        <div className={menuStyle.menuCard}>
          <header className={menuStyle.menuHeader}>
            <div className={menuStyle.headerIntro}>
              <div className={menuStyle.headerText}>
                <span className={menuStyle.brandMark}>Auto-Chess</span>
                <p className={menuStyle.welcome}>Welcome back, {playerName}!</p>
                <p className={menuStyle.subWelcome}>Your next battle is one click away.</p>
              </div>
              <div className={menuStyle.topStatsRow}>
                <div className={menuStyle.statTile}>
                  <div className={menuStyle.statValue}>
                    {statsLoading ? '…' : myStats != null ? myStats.totalEvents.toLocaleString() : '—'}
                  </div>
                  <div className={menuStyle.statLabel}>ACTIVITY</div>
                </div>
                <div className={menuStyle.statTile}>
                  <div className={menuStyle.statValue}>
                    {statsLoading ? '…' : myStats != null ? myStats.queueJoins.toLocaleString() : '—'}
                  </div>
                  <div className={menuStyle.statLabel}>QUEUE JOINS</div>
                </div>
                <div className={menuStyle.statTile}>
                  <div className={menuStyle.statValue}>
                    {statsLoading ? '…' : myStats != null ? myStats.queueLeaves.toLocaleString() : '—'}
                  </div>
                  <div className={menuStyle.statLabel}>QUEUE LEAVES</div>
                </div>
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
                className={`${menuStyle.tabButton} ${tab === 'statistics' ? menuStyle.tabButtonActive : ''}`}
                onClick={() => setTab('statistics')}
              >
                <div className={menuStyle.tabIconRow}>
                  <span className={menuStyle.tabIcon}>📈</span>
                  <span className={menuStyle.tabTitle}>Statistics</span>
                </div>
              </button>
            </nav>

            <main className={menuStyle.menuMain}>
            <div className={menuStyle.tabContentWrap}>
              {tab === 'profile' && (
                <>
                  <h2 className={menuStyle.sectionTitle}>PROFILE</h2>
                  <p className={menuStyle.sectionSubtle}>Your account and matchmaking summary.</p>
                  <div className={menuStyle.list}>
                    <div className={menuStyle.listRow}>
                      <span className={menuStyle.badgeDot}>♞</span>
                      <div className={menuStyle.rowMain}>
                        <div className={menuStyle.rowTitle}>{playerName}</div>
                        <div className={menuStyle.rowSub}>
                          User ID: {myUserId != null ? String(myUserId) : '—'}
                        </div>
                      </div>
                      <div className={menuStyle.rowValue}>{myUserId != null ? `#${myUserId}` : '—'}</div>
                    </div>
                    <div className={menuStyle.listRow}>
                      <span className={menuStyle.badgeDot}>♗</span>
                      <div className={menuStyle.rowMain}>
                        <div className={menuStyle.rowTitle}>Matchmaking</div>
                        <div className={menuStyle.rowSub}>Queue joins and leaves</div>
                      </div>
                      <div className={menuStyle.rowValue}>
                        {statsLoading
                          ? '…'
                          : myStats != null
                            ? `${myStats.queueJoins} joins · ${myStats.queueLeaves} leaves`
                            : '—'}
                      </div>
                    </div>
                    <div className={menuStyle.listRow}>
                      <span className={menuStyle.badgeDot}>📊</span>
                      <div className={menuStyle.rowMain}>
                        <div className={menuStyle.rowTitle}>Total activity</div>
                        <div className={menuStyle.rowSub}>Actions on your account</div>
                      </div>
                      <div className={menuStyle.rowValue}>
                        {statsLoading ? '…' : myStats != null ? myStats.totalEvents.toLocaleString() : '—'}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {tab === 'leaderboard' && (
                <>
                  <h2 className={menuStyle.sectionTitle}>LEADERBOARD</h2>
                  <p className={menuStyle.sectionSubtle}>Most active players in matchmaking.</p>
                  {leaderboardError && (
                    <p className={style.error} style={{ marginTop: 8 }}>
                      {leaderboardError}
                    </p>
                  )}
                  {leaderboardLoading && <p className={menuStyle.sectionSubtle}>Loading…</p>}
                  {!leaderboardLoading && !leaderboardError && leaderboardRows.length === 0 && (
                    <p className={menuStyle.sectionSubtle}>No data yet — queue for a match to appear here.</p>
                  )}
                  <div className={`${menuStyle.list} ${menuStyle.twoColDesktop}`}>
                    {leaderboardRows.map((row) => (
                      <div className={menuStyle.listRow} key={row.userId}>
                        <span className={menuStyle.badgeDot}>{row.rank}</span>
                        <div className={menuStyle.rowMain}>
                          <div className={menuStyle.rowTitle}>
                            {row.username}
                            {myUserId != null && row.userId === myUserId ? ' (you)' : ''}
                          </div>
                          <div className={menuStyle.rowSub}>
                            Joins {row.queueJoins} · Leaves {row.queueLeaves}
                          </div>
                        </div>
                        <div className={menuStyle.rowValue}>{row.totalEvents}</div>
                      </div>
                    ))}
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
                  <h2 className={menuStyle.sectionTitle}>SETTINGS</h2>
                  <p className={menuStyle.sectionSubtle}>
                    App preferences are not synced to a server API yet. Use Log out to end your session.
                  </p>
                  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <button type="button" className={style.secondaryButton} style={{ width: '100%' }} onClick={() => logout()}>
                      Log out
                    </button>
                  </div>
                </>
              )}

              {tab === 'statistics' && (
                <>
                  <h2 className={menuStyle.sectionTitle}>STATISTICS</h2>

                  <div className={menuStyle.list} style={{ marginTop: 12 }}>
                    <div className={menuStyle.listRow}>
                      <span className={menuStyle.badgeDot}>◎</span>
                      <div className={menuStyle.rowMain}>
                        <div className={menuStyle.rowTitle}>Joined the queue</div>
                        <div className={menuStyle.rowSub}>Times you looked for a match</div>
                      </div>
                      <div className={menuStyle.rowValue}>
                        {statsLoading ? '…' : myStats != null ? myStats.queueJoins.toLocaleString() : '—'}
                      </div>
                    </div>
                    <div className={menuStyle.listRow}>
                      <span className={menuStyle.badgeDot}>→</span>
                      <div className={menuStyle.rowMain}>
                        <div className={menuStyle.rowTitle}>Left the queue</div>
                        <div className={menuStyle.rowSub}>Times you cancelled search</div>
                      </div>
                      <div className={menuStyle.rowValue}>
                        {statsLoading ? '…' : myStats != null ? myStats.queueLeaves.toLocaleString() : '—'}
                      </div>
                    </div>
                    <div className={menuStyle.listRow}>
                      <span className={menuStyle.badgeDot}>∑</span>
                      <div className={menuStyle.rowMain}>
                        <div className={menuStyle.rowTitle}>Total actions</div>
                        <div className={menuStyle.rowSub}>Matchmaking activity on your account</div>
                      </div>
                      <div className={menuStyle.rowValue}>
                        {statsLoading ? '…' : myStats != null ? myStats.totalEvents.toLocaleString() : '—'}
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
                <div className={menuStyle.findingOverlay}>
                  <div>
                    <div className={menuStyle.findingTitle}>Finding match…</div>
                    <div className={menuStyle.sectionSubtle}>
                      Queue: {queue.queueSize} · Position: {queue.position ?? '—'}
                    </div>
                  </div>
                  <div className={menuStyle.findingTimer}>{formatElapsed(queue.elapsedSec)}</div>
                  <button type="button" className={menuStyle.smallLinkLikeButton} onClick={() => queue.cancelFinding()}>
                    Cancel
                  </button>
                </div>
              )}

              <div className={menuStyle.bottomActions}>
                <button
                  type="button"
                  className={`${style.primaryButton} ${menuStyle.playButton}`}
                  onClick={() => queue.startFinding()}
                  disabled={queue.phase !== 'idle' || queue.isJoining}
                >
                  {queue.phase === 'idle' ? (queue.isJoining ? 'Joining…' : 'Play') : 'Searching…'}
                </button>
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
    )
  }

  return (
    <div className={style.page}>
      <header className={style.header}>
        <h1>Auto-Chess</h1>
        <p>Chess-based auto-battler</p>
      </header>
      <nav className={style.nav}>
        <Link to="/login" className={style.primaryButton}>
          Log in
        </Link>
        <Link to="/register" className={style.secondaryButton}>
          Register
        </Link>
      </nav>
    </div>
  )
}
