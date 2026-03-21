import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'
import { gameApi, type MatchResponse } from '../api/game.ts'

export function Game() {
  const { matchId } = useParams<{ matchId: string }>()
  const { accessToken } = useAuth()
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [phaseState, setPhaseState] = useState<{ phase?: string; round?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!accessToken || !matchId) {
      setLoading(false)
      return
    }
    const id = parseInt(matchId, 10)
    if (!Number.isFinite(id)) {
      setError('Invalid match id')
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')

    ;(async () => {
      try {
        const m = await gameApi.getMatch(id, accessToken)
        if (cancelled) return
        setMatch(m)
        try {
          const st = await gameApi.getState(id, accessToken)
          if (!cancelled) setPhaseState(st ?? null)
        } catch {
          if (!cancelled) setPhaseState(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load match')
          setMatch(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [matchId, accessToken])

  if (!accessToken) {
    return (
      <div className={style.page}>
        <p>Please log in.</p>
        <Link to="/login">Log in</Link>
      </div>
    )
  }

  return (
    <div className={style.page}>
      <header className={style.header}>
        <h1>Match #{matchId ?? '—'}</h1>
        <p>Loaded from game-service when the backend is running.</p>
      </header>

      {loading && <p className={style.hint}>Loading match…</p>}
      {error && <p className={style.error}>{error}</p>}

      {match && !error && (
        <div className={style.card}>
          <p>
            <strong>Status:</strong> {match.status}
          </p>
          <p>
            <strong>Round:</strong> {match.currentRound}
          </p>
          <p>
            <strong>Players:</strong> {match.playerIds.join(', ') || '—'}
          </p>
          {phaseState && (
            <p>
              <strong>State:</strong>{' '}
              {[phaseState.phase, phaseState.round !== undefined ? `round ${phaseState.round}` : null]
                .filter(Boolean)
                .join(' · ') || '—'}
            </p>
          )}
        </div>
      )}

      <nav className={style.nav}>
        <Link to="/" className={style.secondaryButton}>
          Main menu
        </Link>
        <Link to="/lobby" className={style.secondaryButton}>
          Lobby
        </Link>
      </nav>
    </div>
  )
}
