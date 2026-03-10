import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import { matchmakingApi } from '../api/matchmaking.ts'
import style from './Pages.module.css'

export function Lobby() {
  const navigate = useNavigate()
  const { accessToken, logout } = useAuth()
  const [inQueue, setInQueue] = useState(false)
  const [position, setPosition] = useState<number | null>(null)
  const [queueSize, setQueueSize] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!accessToken) {
      navigate('/login', { replace: true })
      return
    }
    matchmakingApi.status(accessToken).then((s) => {
      setInQueue(s.inQueue)
      setPosition(s.position)
      setQueueSize(s.queueSize)
    }).catch(() => {})
  }, [accessToken, navigate])

  async function handleJoin() {
    if (!accessToken) return
    setError('')
    setLoading(true)
    try {
      const res = await matchmakingApi.join(accessToken)
      setInQueue(true)
      setPosition(res.queueSize)
      setQueueSize(res.queueSize)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join queue')
    } finally {
      setLoading(false)
    }
  }

  async function handleLeave() {
    if (!accessToken) return
    setError('')
    setLoading(true)
    try {
      await matchmakingApi.leave(accessToken)
      setInQueue(false)
      setPosition(null)
      setQueueSize((s) => Math.max(0, s - 1))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave queue')
    } finally {
      setLoading(false)
    }
  }

  if (!accessToken) return null

  return (
    <div className={style.page}>
      <header className={style.header}>
        <h1>Lobby</h1>
        <p>Find a match — when two players are in queue, a game is created.</p>
      </header>

      {error && <p className={style.error}>{error}</p>}

      <div className={style.card}>
        {inQueue ? (
          <>
            <p>You are in queue. Position: {position ?? '—'}, Queue size: {queueSize}</p>
            <p className={style.hint}>Wait for another player. When a match is created, you can be redirected to the game (to be wired).</p>
            <button
              type="button"
              onClick={handleLeave}
              className={style.secondaryButton}
              disabled={loading}
            >
              Leave queue
            </button>
          </>
        ) : (
          <>
            <p>Click to join the matchmaking queue.</p>
            <button
              type="button"
              onClick={handleJoin}
              className={style.primaryButton}
              disabled={loading}
            >
              {loading ? 'Joining…' : 'Find match'}
            </button>
          </>
        )}
      </div>

      <nav className={style.nav}>
        <button type="button" onClick={() => logout()} className={style.secondaryButton}>
          Log out
        </button>
        <Link to="/game/1" className={style.secondaryButton}>
          Game (placeholder)
        </Link>
      </nav>
    </div>
  )
}
