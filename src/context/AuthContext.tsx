import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { authApi } from '../api/auth.ts'
import {
  clearStoredDisplayName,
  parseUsernameFromAccessToken,
  setStoredDisplayName,
} from '../util/displayName.ts'
import {
  AUTH_ACCESS_STORAGE_KEY,
  AUTH_REFRESH_STORAGE_KEY,
  AUTOCHESS_TOKENS_UPDATED_EVENT,
} from '../constants/authStorageKeys.ts'
import { getAccessTokenExp, isAccessTokenExpired, parseIsGuestFromAccessToken } from '../util/jwtClaims.ts'

const ACCESS_KEY = AUTH_ACCESS_STORAGE_KEY
const REFRESH_KEY = AUTH_REFRESH_STORAGE_KEY

/**
 * Tokens live in sessionStorage only so each tab can be a different user (e.g. local multiplayer tests).
 * Do not mirror to localStorage - that key space is shared across tabs and would merge sessions.
 */
interface AuthState {
  accessToken: string | null
  isReady: boolean
}

interface AuthContextValue extends AuthState {
  isGuest: boolean
  login: (emailOrUsername: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  playAsGuest: () => Promise<void>
  logout: () => Promise<void>
  setTokens: (access: string, refresh: string) => void
  getAccessToken: () => string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const storedAccessToken = sessionStorage.getItem(ACCESS_KEY)
  const initialAccessToken = isAccessTokenExpired(storedAccessToken) ? null : storedAccessToken
  const [state, setState] = useState<AuthState>({
    accessToken: initialAccessToken,
    isReady: true,
  })
  const refreshInFlightRef = useRef(false)

  /** One-time: drop legacy mirrored tokens so tabs cannot inherit another tab’s login from localStorage. */
  useEffect(() => {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }, [])

  useEffect(() => {
    if (!storedAccessToken || initialAccessToken) return
    sessionStorage.removeItem(ACCESS_KEY)
    sessionStorage.removeItem(REFRESH_KEY)
    clearStoredDisplayName()
  }, [storedAccessToken, initialAccessToken])

  const setTokens = useCallback((access: string, refresh: string) => {
    sessionStorage.setItem(ACCESS_KEY, access)
    sessionStorage.setItem(REFRESH_KEY, refresh)
    setState((s) => ({ ...s, accessToken: access }))
  }, [])

  const getAccessToken = useCallback(() => sessionStorage.getItem(ACCESS_KEY), [])

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(ACCESS_KEY)
    sessionStorage.removeItem(REFRESH_KEY)
    clearStoredDisplayName()
    setState((s) => ({ ...s, accessToken: null }))
  }, [])

  const login = useCallback(
    async (emailOrUsername: string, password: string) => {
      const id = emailOrUsername.trim()
      if (!id) throw new Error('Enter email or username')
      if (!password.trim()) throw new Error('Enter password')

      const res = await authApi.login({ identifier: id, password })
      setTokens(res.accessToken, res.refreshToken ?? '')
      const fromJwt = parseUsernameFromAccessToken(res.accessToken)
      setStoredDisplayName(fromJwt ?? id)
    },
    [setTokens],
  )

  const playAsGuest = useCallback(async () => {
    const res = await authApi.guest()
    setTokens(res.accessToken, res.refreshToken ?? '')
    const fromJwt = parseUsernameFromAccessToken(res.accessToken)
    setStoredDisplayName(fromJwt ?? 'Guest')
  }, [setTokens])

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const u = username.trim()
      const e = email.trim()
      if (!u) throw new Error('Enter username')
      if (!e) throw new Error('Enter email')
      if (!password.trim()) throw new Error('Enter password')

      const res = await authApi.register({ username: u, email: e, password })
      setTokens(res.accessToken, res.refreshToken ?? '')
      const fromJwt = parseUsernameFromAccessToken(res.accessToken)
      setStoredDisplayName(fromJwt ?? u)
    },
    [setTokens],
  )

  const logout = useCallback(async () => {
    const refresh = sessionStorage.getItem(REFRESH_KEY)
    try {
      if (refresh?.trim()) {
        await authApi.logout({ refreshToken: refresh })
      }
    } catch {
      /* still clear local session */
    }
    clearSession()
  }, [clearSession])

  useEffect(() => {
    const onTokensUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ accessToken?: string }>).detail
      const access = detail?.accessToken ?? sessionStorage.getItem(ACCESS_KEY)
      if (access && !isAccessTokenExpired(access)) {
        setState((s) => ({ ...s, accessToken: access }))
      }
    }
    window.addEventListener(AUTOCHESS_TOKENS_UPDATED_EVENT, onTokensUpdated)
    return () => window.removeEventListener(AUTOCHESS_TOKENS_UPDATED_EVENT, onTokensUpdated)
  }, [])

  useEffect(() => {
    if (!state.accessToken) return

    const maybeRefresh = async () => {
      if (refreshInFlightRef.current) return
      const access = sessionStorage.getItem(ACCESS_KEY)
      const refresh = sessionStorage.getItem(REFRESH_KEY)
      if (!access || !refresh?.trim()) return

      const exp = getAccessTokenExp(access)
      if (!exp) return
      const now = Math.floor(Date.now() / 1000)
      const secondsLeft = exp - now

      // Refresh shortly before expiration to avoid mid-game unauthorized errors.
      if (secondsLeft > 60) return

      refreshInFlightRef.current = true
      try {
        const res = await authApi.refresh({ refreshToken: refresh })
        setTokens(res.accessToken, res.refreshToken ?? refresh)
      } catch {
        clearSession()
      } finally {
        refreshInFlightRef.current = false
      }
    }

    void maybeRefresh()
    const id = window.setInterval(() => {
      void maybeRefresh()
    }, 15_000)
    return () => window.clearInterval(id)
  }, [state.accessToken, setTokens, clearSession])

  const isGuest = useMemo(() => parseIsGuestFromAccessToken(state.accessToken), [state.accessToken])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isGuest,
      login,
      register,
      playAsGuest,
      logout,
      setTokens,
      getAccessToken,
    }),
    [state, isGuest, login, register, playAsGuest, logout, setTokens, getAccessToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
