import { parseUsernameFromAccessToken } from './displayName.ts'

const DEFAULT_ADMINS = ['kon']

export function isAdminFromAccessToken(accessToken: string | null): boolean {
  const username = parseUsernameFromAccessToken(accessToken)
  if (!username) return false
  const raw = import.meta.env.VITE_ADMIN_USERS
  const admins =
    typeof raw === 'string' && raw.trim().length > 0
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_ADMINS
  return admins.includes(username)
}

