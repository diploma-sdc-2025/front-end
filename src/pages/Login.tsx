import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'

export function Login() {
  const navigate = useNavigate()
  const { login, accessToken } = useAuth()
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (accessToken) {
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
    <div className={style.page}>
      <header className={style.header}>
        <h1>Log in</h1>
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
      <p className={style.footer}>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  )
}
