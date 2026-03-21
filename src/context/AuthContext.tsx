import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authApi } from '../api/auth.ts'
import {
  clearStoredDisplayName,
  parseUsernameFromAccessToken,
  setStoredDisplayName,
} from '../util/displayName.ts'

const ACCESS_KEY = 'autochess_access_token'
const REFRESH_KEY = 'autochess_refresh_token'

interface AuthState {
  accessToken: string | null
  isReady: boolean
}

interface AuthContextValue extends AuthState {
  login: (emailOrUsername: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setTokens: (access: string, refresh: string) => void
  getAccessToken: () => string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: localStorage.getItem(ACCESS_KEY),
    isReady: true,
  })

  const setTokens = useCallback((access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
    setState((s) => ({ ...s, accessToken: access }))
  }, [])

  const getAccessToken = useCallback(() => localStorage.getItem(ACCESS_KEY), [])

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
    const refresh = localStorage.getItem(REFRESH_KEY)
    try {
      if (refresh?.trim()) {
        await authApi.logout({ refreshToken: refresh })
      }
    } catch {
      /* still clear local session */
    }
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    clearStoredDisplayName()
    setState((s) => ({ ...s, accessToken: null }))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      register,
      logout,
      setTokens,
      getAccessToken,
    }),
    [state, login, register, logout, setTokens, getAccessToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
