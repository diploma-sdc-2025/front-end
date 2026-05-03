/** Must match keys used in AuthContext.tsx */
export const AUTH_ACCESS_STORAGE_KEY = 'autochess_access_token'
export const AUTH_REFRESH_STORAGE_KEY = 'autochess_refresh_token'

/** Dispatched when game API refreshes tokens so React state stays in sync with sessionStorage. */
export const AUTOCHESS_TOKENS_UPDATED_EVENT = 'autochess-tokens-updated'
