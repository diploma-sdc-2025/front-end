import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'

export function Login() {
  const navigate = useNavigate()
  const { login, accessToken, isGuest, playAsGuest } = useAuth()
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [guestLoading, setGuestLoading] = useState(false)

  if (accessToken && !isGuest) {
    navigate('/', { replace: true })
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(emailOrUsername.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={style.authShell}>
      <header className={style.header}>
        <h1>Log in</h1>
        <p className={style.mutedSmall} style={{ marginTop: 8 }}>
          Use your email or username and password.
        </p>
      </header>
      <form onSubmit={handleSubmit} className={style.form}>
        {error && <p className={style.error}>{error}</p>}
        <input
          type="text"
          placeholder="Email or username"
          value={emailOrUsername}
          onChange={(e) => setEmailOrUsername(e.target.value)}
          className={style.input}
          autoComplete="username"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={style.input}
          autoComplete="current-password"
          required
        />
        <button type="submit" className={style.primaryButton} disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <button
        type="button"
        className={style.authGuestLink}
        disabled={guestLoading}
        onClick={() => {
          setError('')
          setGuestLoading(true)
          void (async () => {
            try {
              await playAsGuest()
              navigate('/', { replace: true })
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Guest session failed')
            } finally {
              setGuestLoading(false)
            }
          })()
        }}
      >
        {guestLoading ? 'Starting…' : 'Play as guest (no stats)'}
      </button>
      <p className={style.footer}>
        No account? <Link to="/register">Create one</Link>
      </p>
      <p className={style.authBack}>
        <Link to="/">← Back to home</Link>
      </p>
    </div>
  )
}
