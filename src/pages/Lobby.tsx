import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'
import lobbyStyle from './LobbyPage.module.css'
import { useEffect } from 'react'
import { useMatchmakingQueue } from '../hooks/useMatchmakingQueue.ts'
import { LobbyChessBoard } from '../components/LobbyChessBoard.tsx'

function formatElapsed(totalSec: number) {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function Lobby() {
  const navigate = useNavigate()
  const { accessToken, logout } = useAuth()
  const queue = useMatchmakingQueue(accessToken, navigate)

  useEffect(() => {
    if (!accessToken) {
      navigate('/login', { replace: true })
    }
  }, [accessToken, navigate])

  if (!accessToken) return null

  return (
    <div className={lobbyStyle.page}>
      <div className={lobbyStyle.boardSlot}>
        <LobbyChessBoard playerColor="white" />
      </div>

      <div className={lobbyStyle.hud}>
        <div className={lobbyStyle.hudInner}>
          <h1 className={lobbyStyle.hudTitle}>Lobby</h1>
          <p className={lobbyStyle.hudSub}>
            Your king is on e1. When you find a match, you’ll jump into the game automatically.
          </p>

          {queue.error && <p className={style.error}>{queue.error}</p>}

          {queue.phase === 'finding' ? (
            <>
              <div className={lobbyStyle.findingRow}>
                <div>
                  <strong>Searching for opponent…</strong>
                  <p className={style.mutedSmall} style={{ marginTop: 6, textAlign: 'left' }}>
                    Queue {queue.queueSize} · You are #{queue.position ?? '-'}
                  </p>
                </div>
                <span className={lobbyStyle.timer}>{formatElapsed(queue.elapsedSec)}</span>
              </div>
              <div className={lobbyStyle.hudActions}>
                <button
                  type="button"
                  onClick={() => queue.cancelFinding()}
                  className={style.secondaryButton}
                  disabled={queue.isJoining}
                >
                  Leave queue
                </button>
              </div>
            </>
          ) : (
            <div className={lobbyStyle.hudActions}>
              <button
                type="button"
                onClick={() => queue.startFinding()}
                className={style.primaryButton}
                disabled={queue.isJoining}
              >
                {queue.isJoining ? 'Joining…' : 'Find match'}
              </button>
            </div>
          )}

          <div className={lobbyStyle.hudNav}>
            <Link to="/" className={style.secondaryButton}>
              Main menu
            </Link>
            <button type="button" onClick={() => logout()} className={style.secondaryButton}>
              Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
