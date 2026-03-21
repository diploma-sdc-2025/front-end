import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'
import { useEffect } from 'react'
import { useMatchmakingQueue } from '../hooks/useMatchmakingQueue.ts'

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
    <div className={style.page}>
      <header className={style.header}>
        <h1>Lobby</h1>
        <p>Matchmaking via game backend · Join queue, then open a match when assigned.</p>
      </header>

      {queue.error && <p className={style.error}>{queue.error}</p>}

      <div className={style.card}>
        {queue.phase === 'finding' ? (
          <>
            <p>
              In queue · Size: {queue.queueSize} · Position: {queue.position ?? '—'}
            </p>
            <p className={style.hint}>Elapsed {formatElapsed(queue.elapsedSec)} — waiting for match…</p>
            <button
              type="button"
              onClick={() => queue.cancelFinding()}
              className={style.secondaryButton}
              disabled={queue.isJoining}
            >
              Leave queue
            </button>
          </>
        ) : (
          <>
            <p>Join the matchmaking queue. When the server assigns a match id, you’ll be redirected.</p>
            <button
              type="button"
              onClick={() => queue.startFinding()}
              className={style.primaryButton}
              disabled={queue.isJoining}
            >
              {queue.isJoining ? 'Joining…' : 'Find match'}
            </button>
          </>
        )}
      </div>

      <nav className={style.nav}>
        <Link to="/" className={style.secondaryButton}>
          Main menu
        </Link>
        <button type="button" onClick={() => logout()} className={style.secondaryButton}>
          Log out
        </button>
      </nav>
    </div>
  )
}
