import { getAnalyticsApi } from './config.ts'
import { readApiError } from './client.ts'

export interface LeaderboardRow {
  userId: number
  totalEvents: number
  queueJoins: number
  queueLeaves: number
  matchesPlayed: number
  winRatePercent: number
  currentRating: number
  rank: number
}

export interface PlayerStats {
  userId: number
  totalEvents: number
  queueJoins: number
  queueLeaves: number
  matchesPlayed: number
  wins: number
  losses: number
  winRatePercent: number | null
  currentRating: number | null
  recentMatches: Array<{
    opponent: string
    opponentUserId?: number
    result: 'W' | 'L' | 'D' | '-'
    ratingDelta: number | null
    playedAt: string | null
    finalFen: string | null
  }>
}

export interface RecentEventEntry {
  type: string
  userMasked: string
  matchId: number | null
  queueSize: number
  timestamp: string
  metadata: Record<string, unknown>
}

export interface LiveAnalyticsMetrics {
  currentQueueSize: number
  totalQueueJoins: number
  totalMatchesCreated: number
  totalMatchesFinished: number
  eventsLastMinute: number
  eventsLastFiveMinutes: number
  queueJoinsLastMinute: number
  matchesCreatedLastMinute: number
  matchesFinishedLastMinute: number
  battlesLastMinute: number
  piecesPurchasedLastMinute: number
  matchConversionRatePct: number
  activeMatches: number
  playersInMatches: number
  playersOnline: number
  averageMatchSeconds: number
  lastUpdated: string | null
  lastEvent?: {
    type: string
    userMasked: string
    queueSize: number
    timestamp: string
  } | null
  eventsByType: Record<string, number>
  eventsPerSecond: number[]
  recentEvents: RecentEventEntry[]
}

export function getAdminLiveStreamUrl(accessToken: string): string {
  const base = getAnalyticsApi('/api/analytics/admin/stream')
  const url =
    base.startsWith('http://') || base.startsWith('https://')
      ? new URL(base)
      : new URL(base.startsWith('/') ? base : `/${base}`, window.location.origin)
  url.searchParams.set('token', accessToken)
  return url.toString()
}

function normalizeLeaderboardRow(raw: Record<string, unknown>): LeaderboardRow {
  const userId = Number(raw.userId ?? raw.user_id)
  return {
    userId: Number.isFinite(userId) ? userId : 0,
    totalEvents: Number(raw.totalEvents ?? raw.total_events ?? 0) || 0,
    queueJoins: Number(raw.queueJoins ?? raw.queue_joins ?? 0) || 0,
    queueLeaves: Number(raw.queueLeaves ?? raw.queue_leaves ?? 0) || 0,
    matchesPlayed: Number(raw.matchesPlayed ?? raw.matches_played ?? 0) || 0,
    winRatePercent: Number(raw.winRatePercent ?? raw.win_rate_percent ?? 0) || 0,
    currentRating: Number(raw.currentRating ?? raw.current_rating ?? 1000) || 1000,
    rank: Number(raw.rank ?? 0) || 0,
  }
}

function normalizePlayerStats(raw: Record<string, unknown>): PlayerStats {
  const userId = Number(raw.userId ?? raw.user_id)
  const matchesPlayed = Number(raw.matchesPlayed ?? raw.matches_played ?? 0) || 0
  const wins = Number(raw.wins ?? raw.win_count ?? 0) || 0
  const losses = Number(raw.losses ?? raw.loss_count ?? 0) || 0
  const winRateRaw = Number(raw.winRatePercent ?? raw.win_rate_percent ?? raw.winRate ?? raw.win_rate)
  const ratingRaw = Number(raw.currentRating ?? raw.current_rating ?? raw.rating)

  const recentMatchesRaw = raw.recentMatches ?? raw.recent_matches ?? raw.lastMatches ?? raw.last_matches
  const recentMatches = Array.isArray(recentMatchesRaw)
    ? recentMatchesRaw.slice(0, 5).map((entry) => {
        const e = entry as Record<string, unknown>
        const opponentUserIdRaw = Number(e.opponentUserId ?? e.opponent_user_id)
        const opponentUserId =
          Number.isFinite(opponentUserIdRaw) && opponentUserIdRaw > 0 ? Math.trunc(opponentUserIdRaw) : undefined
        const opponentRaw = e.opponent ?? e.opponentName ?? e.opponent_name
        const resultRaw = String(e.result ?? e.outcome ?? '-')
          .trim()
          .toUpperCase()
        const parsedResult: 'W' | 'L' | 'D' | '-' =
          resultRaw === 'W' || resultRaw === 'WIN'
            ? 'W'
            : resultRaw === 'L' || resultRaw === 'LOSS'
              ? 'L'
              : resultRaw === 'D' || resultRaw === 'DRAW'
                ? 'D'
                : '-'
        const ratingDeltaRaw = Number(e.ratingDelta ?? e.rating_delta)
        const playedAtRaw = e.playedAt ?? e.played_at ?? e.createdAt ?? e.created_at
        return {
          opponent:
            typeof opponentRaw === 'string' && opponentRaw.trim()
              ? opponentRaw.trim()
              : opponentUserId != null
                ? `Player #${opponentUserId}`
                : 'Unknown opponent',
          opponentUserId,
          result: parsedResult,
          ratingDelta: Number.isFinite(ratingDeltaRaw) ? Math.trunc(ratingDeltaRaw) : null,
          playedAt: typeof playedAtRaw === 'string' && playedAtRaw.trim() ? playedAtRaw : null,
          finalFen:
            typeof (e.finalFen ?? e.final_fen ?? e.endFen ?? e.end_fen ?? e.fen) === 'string' &&
            String(e.finalFen ?? e.final_fen ?? e.endFen ?? e.end_fen ?? e.fen).trim()
              ? String(e.finalFen ?? e.final_fen ?? e.endFen ?? e.end_fen ?? e.fen).trim()
              : null,
        }
      })
    : []

  const computedWinRate =
    matchesPlayed > 0 ? Math.round((Math.max(0, wins) / Math.max(1, matchesPlayed)) * 1000) / 10 : null

  return {
    userId: Number.isFinite(userId) ? userId : 0,
    totalEvents: Number(raw.totalEvents ?? raw.total_events ?? 0) || 0,
    queueJoins: Number(raw.queueJoins ?? raw.queue_joins ?? 0) || 0,
    queueLeaves: Number(raw.queueLeaves ?? raw.queue_leaves ?? 0) || 0,
    matchesPlayed: Math.max(0, Math.trunc(matchesPlayed)),
    wins: Math.max(0, Math.trunc(wins)),
    losses: Math.max(0, Math.trunc(losses)),
    winRatePercent: Number.isFinite(winRateRaw)
      ? Math.max(0, Math.min(100, Math.round(winRateRaw * 10) / 10))
      : computedWinRate,
    currentRating: Number.isFinite(ratingRaw) ? Math.trunc(ratingRaw) : null,
    recentMatches,
  }
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function normalizeLiveMetrics(raw: Record<string, unknown>): LiveAnalyticsMetrics {
  const byTypeRaw = raw.eventsByType ?? raw.events_by_type
  const eventsByType: Record<string, number> = {}
  if (byTypeRaw && typeof byTypeRaw === 'object' && !Array.isArray(byTypeRaw)) {
    for (const [k, v] of Object.entries(byTypeRaw as Record<string, unknown>)) {
      eventsByType[k] = num(v)
    }
  }

  const seriesRaw = raw.eventsPerSecond ?? raw.events_per_second
  const eventsPerSecond = Array.isArray(seriesRaw) ? seriesRaw.map(num) : []

  const recentRaw = raw.recentEvents ?? raw.recent_events
  const recentEvents: RecentEventEntry[] = Array.isArray(recentRaw)
    ? recentRaw.slice(0, 30).map((entry) => {
        const e = entry as Record<string, unknown>
        const matchIdNum = Number(e.matchId ?? e.match_id)
        const metaRaw = e.metadata
        return {
          type: String(e.type ?? 'unknown'),
          userMasked: String(e.userMasked ?? e.user_masked ?? 'u-****'),
          matchId: Number.isFinite(matchIdNum) ? matchIdNum : null,
          queueSize: num(e.queueSize ?? e.queue_size),
          timestamp: String(e.timestamp ?? ''),
          metadata: metaRaw && typeof metaRaw === 'object' ? (metaRaw as Record<string, unknown>) : {},
        }
      })
    : []

  const last = raw.lastUpdated ?? raw.last_updated
  const lastEvent = raw.lastEvent ?? raw.last_event
  return {
    currentQueueSize: num(raw.currentQueueSize ?? raw.current_queue_size),
    totalQueueJoins: num(raw.totalQueueJoins ?? raw.total_queue_joins),
    totalMatchesCreated: num(raw.totalMatchesCreated ?? raw.total_matches_created),
    totalMatchesFinished: num(raw.totalMatchesFinished ?? raw.total_matches_finished),
    eventsLastMinute: num(raw.eventsLastMinute ?? raw.events_last_minute),
    eventsLastFiveMinutes: num(raw.eventsLastFiveMinutes ?? raw.events_last_five_minutes),
    queueJoinsLastMinute: num(raw.queueJoinsLastMinute ?? raw.queue_joins_last_minute),
    matchesCreatedLastMinute: num(raw.matchesCreatedLastMinute ?? raw.matches_created_last_minute),
    matchesFinishedLastMinute: num(raw.matchesFinishedLastMinute ?? raw.matches_finished_last_minute),
    battlesLastMinute: num(raw.battlesLastMinute ?? raw.battles_last_minute),
    piecesPurchasedLastMinute: num(raw.piecesPurchasedLastMinute ?? raw.pieces_purchased_last_minute),
    matchConversionRatePct: num(raw.matchConversionRatePct ?? raw.match_conversion_rate_pct),
    activeMatches: num(raw.activeMatches ?? raw.active_matches),
    playersInMatches: num(raw.playersInMatches ?? raw.players_in_matches),
    playersOnline: num(raw.playersOnline ?? raw.players_online),
    averageMatchSeconds: num(raw.averageMatchSeconds ?? raw.average_match_seconds),
    lastUpdated: typeof last === 'string' && last.trim() ? last : null,
    lastEvent:
      lastEvent && typeof lastEvent === 'object'
        ? {
            type: String((lastEvent as Record<string, unknown>).type ?? 'unknown'),
            userMasked: String((lastEvent as Record<string, unknown>).userMasked ?? 'u-****'),
            queueSize: num((lastEvent as Record<string, unknown>).queueSize ?? 0),
            timestamp: String((lastEvent as Record<string, unknown>).timestamp ?? ''),
          }
        : null,
    eventsByType,
    eventsPerSecond,
    recentEvents,
  }
}

export const analyticsApi = {
  async fetchLeaderboard(limit = 50): Promise<LeaderboardRow[]> {
    const q = new URLSearchParams()
    q.set('limit', String(limit))
    const res = await fetch(getAnalyticsApi(`/api/analytics/leaderboard?${q}`))
    if (!res.ok) throw new Error(await readApiError(res))
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []
    return data.map((row) => normalizeLeaderboardRow(row as Record<string, unknown>))
  },

  async fetchPlayerStats(userId: number): Promise<PlayerStats> {
    const res = await fetch(getAnalyticsApi(`/api/analytics/players/${userId}/stats`))
    if (!res.ok) throw new Error(await readApiError(res))
    const raw = (await res.json()) as Record<string, unknown>
    return normalizePlayerStats(raw)
  },

  async fetchLiveMetrics(): Promise<LiveAnalyticsMetrics> {
    const res = await fetch(getAnalyticsApi('/api/analytics/live'))
    if (!res.ok) throw new Error(await readApiError(res))
    const raw = (await res.json()) as Record<string, unknown>
    return normalizeLiveMetrics(raw)
  },

  async fetchAdminLiveMetrics(accessToken: string): Promise<LiveAnalyticsMetrics> {
    const res = await fetch(getAnalyticsApi('/api/analytics/admin/live'), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!res.ok) throw new Error(await readApiError(res))
    const raw = (await res.json()) as Record<string, unknown>
    return normalizeLiveMetrics(raw)
  },
}
