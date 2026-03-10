/**
 * API base URLs. Override with .env (VITE_*).
 * Backend services can run on different ports or hosts.
 */
export const config = {
  authUrl: import.meta.env.VITE_AUTH_URL ?? 'http://localhost:8080',
  matchmakingUrl: import.meta.env.VITE_MATCHMAKING_URL ?? 'http://localhost:8082',
  gameUrl: import.meta.env.VITE_GAME_URL ?? 'http://localhost:8080',
  battleUrl: import.meta.env.VITE_BATTLE_URL ?? 'http://localhost:8083',
  analyticsUrl: import.meta.env.VITE_ANALYTICS_URL ?? 'http://localhost:8084',
} as const

export function getAuthApi(path: string): string {
  return `${config.authUrl}${path.startsWith('/') ? path : '/' + path}`
}

export function getMatchmakingApi(path: string): string {
  return `${config.matchmakingUrl}${path.startsWith('/') ? path : '/' + path}`
}

export function getGameApi(path: string): string {
  return `${config.gameUrl}${path.startsWith('/') ? path : '/' + path}`
}

export function getBattleApi(path: string): string {
  return `${config.battleUrl}${path.startsWith('/') ? path : '/' + path}`
}
