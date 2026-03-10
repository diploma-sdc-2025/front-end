import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import style from './Pages.module.css'

export function Register() {
  const navigate = useNavigate()
  const { register, accessToken } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (accessToken) {
    navigate('/lobby', { replace: true })
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(username.trim(), email.trim(), password)
      navigate('/lobby', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={style.page}>
      <header className={style.header}>
        <h1>Register</h1>
      </header>
      <form onSubmit={handleSubmit} className={style.form}>
        {error && <p className={style.error}>{error}</p>}
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={style.input}
          autoComplete="username"
          required
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={style.input}
          autoComplete="email"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={style.input}
          autoComplete="new-password"
          required
        />
        <button type="submit" className={style.primaryButton} disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className={style.footer}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  )
}
