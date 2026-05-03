import { readLocalToggle } from './displayPreferences.ts'

/** localStorage keys - keep in sync with Settings - Audio toggles */
export const AUDIO_MUTE_ALL_KEY = 'menu_audio_mute_all'
export const AUDIO_MATCH_SOUND_KEY = 'menu_audio_match_found_sound'
export const AUDIO_CLICK_SOUND_KEY = 'menu_audio_click_sound'
/** Shop moves, king moves, and battle-start fanfare during a match */
export const AUDIO_GAME_SOUNDS_KEY = 'menu_audio_game_sounds'

export function shouldPlayMatchFoundSound(): boolean {
  if (readLocalToggle(AUDIO_MUTE_ALL_KEY, false)) return false
  return readLocalToggle(AUDIO_MATCH_SOUND_KEY, true)
}

export function shouldPlayGameSounds(): boolean {
  if (readLocalToggle(AUDIO_MUTE_ALL_KEY, false)) return false
  return readLocalToggle(AUDIO_GAME_SOUNDS_KEY, true)
}

let sharedCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const AC =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!sharedCtx || sharedCtx.state === 'closed') {
      sharedCtx = new AC()
    }
    return sharedCtx
  } catch {
    return null
  }
}

/**
 * Short two-tone chime when matchmaking assigns a match (after queue / join).
 * Respects Settings → Mute all / Play sound on match found.
 */
export function playMatchFoundSound(): void {
  if (!shouldPlayMatchFoundSound()) return

  const ctx = getAudioContext()
  if (!ctx) return

  const schedule = () => {
    const now = ctx.currentTime

    const tone = (frequency: number, start: number, duration: number, peak = 0.11) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = frequency
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(peak, start + 0.025)
      g.gain.exponentialRampToValueAtTime(0.001, start + duration)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(start)
      o.stop(start + duration + 0.04)
    }

    tone(523.25, now, 0.14)
    tone(784.0, now + 0.11, 0.18)
  }

  void ctx.resume().then(schedule).catch(() => {
    try {
      schedule()
    } catch {
      /* ignore */
    }
  })
}

function resumeAndRun(ctx: AudioContext, schedule: () => void): void {
  void ctx.resume().then(schedule).catch(() => {
    try {
      schedule()
    } catch {
      /* ignore */
    }
  })
}

let lastBattleStartAtMs = 0

/**
 * When the battle phase / replay begins. Soft ascending sine pings (distinct from match-found).
 * Debounced against duplicate evaluates or Strict Mode.
 */
export function playBattleStartSound(): void {
  if (!shouldPlayGameSounds()) return
  const stamp = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (stamp - lastBattleStartAtMs < 500) return
  lastBattleStartAtMs = stamp

  const ctx = getAudioContext()
  if (!ctx) return

  const schedule = () => {
    const t0 = ctx.currentTime
    const ping = (freq: number, start: number, duration: number, peak: number) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(peak, start + 0.018)
      g.gain.exponentialRampToValueAtTime(0.001, start + duration)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(start)
      o.stop(start + duration + 0.03)
    }
    ping(440, t0, 0.12, 0.052)
    ping(554.37, t0 + 0.075, 0.12, 0.046)
    ping(659.25, t0 + 0.15, 0.14, 0.038)
  }

  resumeAndRun(ctx, schedule)
}

let lastPieceMoveSoundAtMs = 0

function runPieceMoveTone(ctx: AudioContext): void {
  const schedule = () => {
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    const filter = ctx.createBiquadFilter()

    o.type = 'triangle'
    o.frequency.value = 220

    filter.type = 'lowpass'
    filter.frequency.value = 420
    filter.Q.value = 0.9

    g.gain.setValueAtTime(0.001, t)
    g.gain.linearRampToValueAtTime(0.09, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)

    o.connect(filter)
    filter.connect(g)
    g.connect(ctx.destination)
    o.start(t)
    o.stop(t + 0.1)
  }

  resumeAndRun(ctx, schedule)
}

/**
 * Placement or slide during shop phase (bench, board piece, or king).
 * Debounced to absorb React Strict Mode double-invocation in dev.
 */
export function playPieceMoveSound(): void {
  if (!shouldPlayGameSounds()) return
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (nowMs - lastPieceMoveSoundAtMs < 45) return
  lastPieceMoveSoundAtMs = nowMs

  const ctx = getAudioContext()
  if (!ctx) return
  runPieceMoveTone(ctx)
}

/**
 * Each step of the battle PV replay (one ply advanced on the board).
 * No debounce so successive plies ~1s apart all play clearly.
 */
export function playBattleReplayMoveSound(): void {
  if (!shouldPlayGameSounds()) return
  const ctx = getAudioContext()
  if (!ctx) return
  runPieceMoveTone(ctx)
}
