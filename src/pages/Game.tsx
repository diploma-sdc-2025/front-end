import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'

export function Game() {
  const { matchId } = useParams<{ matchId: string }>()
  const { accessToken } = useAuth()

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
        <p>Game screen placeholder. Connect to game-service and battle-service to show board, shop, and rounds.</p>
      </header>
      <div className={style.card}>
        <p>Backend endpoints to use:</p>
        <ul>
          <li>GET /api/game/matches/{matchId} — match info</li>
          <li>POST /api/game/matches/{matchId}/start — start match</li>
          <li>GET /api/game/matches/{matchId}/state — phase, round</li>
          <li>GET /api/game/matches/{matchId}/board — board state</li>
          <li>POST /api/battle/simulate — run battle (FEN, attacker, defender)</li>
        </ul>
      </div>
      <Link to="/lobby" className={style.secondaryButton}>
        Back to Lobby
      </Link>
    </div>
  )
}
