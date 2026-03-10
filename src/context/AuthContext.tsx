import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authApi } from '../api/auth.ts'

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
      const res = await authApi.login({ identifier: emailOrUsername, password })
      setTokens(res.accessToken, res.refreshToken)
    },
    [setTokens]
  )

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const res = await authApi.register({ username, email, password })
      setTokens(res.accessToken, res.refreshToken)
    },
    [setTokens]
  )

  const logout = useCallback(async () => {
    const refresh = localStorage.getItem(REFRESH_KEY)
    if (refresh) {
      try {
        await authApi.logout({ refreshToken: refresh })
      } catch {
        // ignore
      }
    }
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
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
    [state, login, register, logout, setTokens, getAccessToken]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
