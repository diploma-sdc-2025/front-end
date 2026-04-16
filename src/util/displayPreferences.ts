export const DISPLAY_THEME_KEY = 'menu_display_theme'
export const DISPLAY_BOARD_THEME_KEY = 'menu_display_board_theme'
export const DISPLAY_COORDS_KEY = 'menu_display_coordinates'
export const DISPLAY_ANIMATION_SPEED_KEY = 'menu_display_animation_speed'

export type DisplayTheme = 'dark' | 'light'
export type DisplayAnimationSpeed = 'slow' | 'normal' | 'fast'

export const BOARD_THEME_OPTIONS = [
  { id: 'classic-green', label: 'Classic', light: '#f2ecdc', dark: '#5a7d4e' },
  { id: 'blue-stone', label: 'Blue', light: '#d9d7bf', dark: '#4f769e' },
  { id: 'walnut', label: 'Walnut', light: '#e6d1b1', dark: '#a77f57' },
  { id: 'marble', label: 'Marble', light: '#e8ebef', dark: '#9ba5b3' },
  { id: 'violet', label: 'Violet', light: '#eceaf2', dark: '#7f6ca8' },
  { id: 'emerald', label: 'Emerald', light: '#dde8dc', dark: '#3f6f58' },
] as const

export type BoardThemeId = (typeof BOARD_THEME_OPTIONS)[number]['id']

export type DisplayPreferences = {
  theme: DisplayTheme
  boardTheme: BoardThemeId
  showCoordinates: boolean
  animationSpeed: DisplayAnimationSpeed
}

export function readLocalToggle(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === '1') return true
    if (raw === '0') return false
    return fallback
  } catch {
    return fallback
  }
}

export function writeLocalToggle(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // noop in restrictive environments
  }
}

export function readLocalValue(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem(key)
    return raw && raw.trim() ? raw : fallback
  } catch {
    return fallback
  }
}

export function writeLocalValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // noop in restrictive environments
  }
}

export function getSavedDisplayPreferences(): DisplayPreferences {
  const themeRaw = readLocalValue(DISPLAY_THEME_KEY, 'dark')
  const theme: DisplayTheme = themeRaw === 'light' ? 'light' : 'dark'

  const boardRaw = readLocalValue(DISPLAY_BOARD_THEME_KEY, BOARD_THEME_OPTIONS[0].id)
  const boardTheme = BOARD_THEME_OPTIONS.some((v) => v.id === boardRaw)
    ? (boardRaw as BoardThemeId)
    : BOARD_THEME_OPTIONS[0].id

  const animationRaw = readLocalValue(DISPLAY_ANIMATION_SPEED_KEY, 'normal')
  const animationSpeed: DisplayAnimationSpeed =
    animationRaw === 'slow' || animationRaw === 'fast' ? animationRaw : 'normal'

  return {
    theme,
    boardTheme,
    showCoordinates: readLocalToggle(DISPLAY_COORDS_KEY, true),
    animationSpeed,
  }
}

export function animationSpeedMs(speed: DisplayAnimationSpeed): number {
  if (speed === 'slow') return 220
  if (speed === 'fast') return 90
  return 140
}

export function demoReplayStepMs(speed: DisplayAnimationSpeed): number {
  if (speed === 'slow') return 1900
  if (speed === 'fast') return 950
  return 1400
}

export function applyDisplayPreferencesToDocument(pref: DisplayPreferences): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.appTheme = pref.theme
  root.dataset.showCoordinates = pref.showCoordinates ? '1' : '0'
  const selected = BOARD_THEME_OPTIONS.find((v) => v.id === pref.boardTheme) ?? BOARD_THEME_OPTIONS[0]
  root.style.setProperty('--board-light-square', selected.light)
  root.style.setProperty('--board-dark-square', selected.dark)
  root.style.setProperty('--ui-anim-ms', `${animationSpeedMs(pref.animationSpeed)}ms`)
}
