/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_URL?: string
  readonly VITE_MATCHMAKING_URL?: string
  readonly VITE_GAME_URL?: string
  readonly VITE_BATTLE_URL?: string
  readonly VITE_ANALYTICS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
