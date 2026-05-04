import { joinApiUrl } from './client.ts'

/**
 * Read env URL; empty string = same origin (use Vite `server.proxy` in dev).
 * In dev, defaults to '' so `/api/...` hits the dev server and is proxied.
 */
function envUrl(name: keyof ImportMetaEnv, prodFallback: string): string {
  const raw = import.meta.env[name]
  if (raw === '' || raw === undefined) {
    return import.meta.env.DEV ? '' : prodFallback
  }
  return String(raw).replace(/\/$/, '')
}

/**
 * API base URLs. Override with .env (VITE_*).
 * Backend services can run on different ports or hosts.
 */
export const config = {
  authUrl: envUrl('VITE_AUTH_URL', 'http://localhost:8081'),
  matchmakingUrl: envUrl('VITE_MATCHMAKING_URL', 'http://localhost:8082'),
  gameUrl: envUrl('VITE_GAME_URL', 'http://localhost:8083'),
  battleUrl: envUrl('VITE_BATTLE_URL', 'http://localhost:8084'),
  /**
   * Default '' = same-origin `/api/analytics/...` (Vite proxy in dev; nginx/API gateway in prod).
   * Do not default to localhost here: the admin live stream uses EventSource from the browser;
   * a remote user would otherwise try to open SSE on their own machine and stay “Connecting…”.
   * Set `VITE_ANALYTICS_URL` only when the SPA is served from a host that cannot proxy `/api/analytics`.
   */
  analyticsUrl: envUrl('VITE_ANALYTICS_URL', ''),
} as const

export function getAuthApi(path: string): string {
  return joinApiUrl(config.authUrl, path)
}

export function getMatchmakingApi(path: string): string {
  return joinApiUrl(config.matchmakingUrl, path)
}

export function getGameApi(path: string): string {
  return joinApiUrl(config.gameUrl, path)
}

export function getBattleApi(path: string): string {
  return joinApiUrl(config.battleUrl, path)
}

export function getAnalyticsApi(path: string): string {
  return joinApiUrl(config.analyticsUrl, path)
}
