import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'

export function Home() {
  const { accessToken, isReady, logout } = useAuth()

  if (!isReady) return null

  // Logged in: show main menu
  if (accessToken) {
    return (
      <div className={style.page}>
        <header className={style.header}>
          <h1>♟️ Auto-Chess</h1>
          <p>Chess-based auto-battler</p>
        </header>
        <nav className={style.menu}>
          <Link to="/lobby" className={style.menuItem}>
            <span className={style.menuIcon}>▶</span>
            Play
          </Link>
          <Link to="/game/1" className={style.menuItem}>
            <span className={style.menuIcon}>🎮</span>
            Game (placeholder)
          </Link>
          <button
            type="button"
            onClick={() => logout()}
            className={style.menuItemButton}
          >
            <span className={style.menuIcon}>⎋</span>
            Log out
          </button>
        </nav>
      </div>
    )
  }

  // Not logged in: landing with login / register
  return (
    <div className={style.page}>
      <header className={style.header}>
        <h1>♟️ Auto-Chess</h1>
        <p>Diploma project — chess-based auto-battler</p>
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

// Allow Home to render without redirect when logged in
function _noRedirect() {
  return <Navigate to="/" replace />
}
