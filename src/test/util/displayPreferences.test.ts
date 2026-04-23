import { describe, expect, it } from 'vitest'
import {
  DISPLAY_ANIMATION_SPEED_KEY,
  DISPLAY_BOARD_THEME_KEY,
  DISPLAY_COORDS_KEY,
  DISPLAY_THEME_KEY,
  animationSpeedMs,
  applyDisplayPreferencesToDocument,
  demoReplayStepMs,
  getSavedDisplayPreferences,
  writeLocalToggle,
  writeLocalValue,
} from '../../util/displayPreferences'

describe('display preferences', () => {
  it('reads defaults when no values are saved', () => {
    localStorage.clear()
    const pref = getSavedDisplayPreferences()
    expect(pref.theme).toBe('dark')
    expect(pref.showCoordinates).toBe(true)
    expect(pref.animationSpeed).toBe('normal')
  })

  it('reads and normalizes saved values', () => {
    writeLocalValue(DISPLAY_THEME_KEY, 'light')
    writeLocalValue(DISPLAY_BOARD_THEME_KEY, 'walnut')
    writeLocalValue(DISPLAY_ANIMATION_SPEED_KEY, 'fast')
    writeLocalToggle(DISPLAY_COORDS_KEY, false)

    const pref = getSavedDisplayPreferences()
    expect(pref.theme).toBe('light')
    expect(pref.boardTheme).toBe('walnut')
    expect(pref.animationSpeed).toBe('fast')
    expect(pref.showCoordinates).toBe(false)
  })

  it('maps animation speed helpers correctly', () => {
    expect(animationSpeedMs('slow')).toBe(220)
    expect(animationSpeedMs('normal')).toBe(140)
    expect(animationSpeedMs('fast')).toBe(90)
    expect(demoReplayStepMs('slow')).toBe(1900)
    expect(demoReplayStepMs('normal')).toBe(1400)
    expect(demoReplayStepMs('fast')).toBe(950)
  })

  it('applies CSS variables and data attributes to document', () => {
    applyDisplayPreferencesToDocument({
      theme: 'light',
      boardTheme: 'emerald',
      showCoordinates: false,
      animationSpeed: 'slow',
    })
    expect(document.documentElement.dataset.appTheme).toBe('light')
    expect(document.documentElement.dataset.showCoordinates).toBe('0')
    expect(document.documentElement.style.getPropertyValue('--board-light-square')).toBe('#dde8dc')
    expect(document.documentElement.style.getPropertyValue('--ui-anim-ms')).toBe('220ms')
  })
})
