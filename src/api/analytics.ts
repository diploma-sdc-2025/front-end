import { getAnalyticsApi } from './config.ts'
import { readApiError } from './client.ts'

export interface LeaderboardRow {
  userId: number
  totalEvents: number
  queueJoins: number
  queueLeaves: number
  rank: number
}

export interface PlayerStats {
  userId: number
  totalEvents: number
  queueJoins: number
  queueLeaves: number
}

export interface LiveAnalyticsMetrics {
  currentQueueSize: number
  totalQueueJoins: number
  eventsLastMinute: number
  lastUpdated: string | null
  eventsByType: Record<string, number>
}

function normalizeLeaderboardRow(raw: Record<string, unknown>): LeaderboardRow {
  const userId = Number(raw.userId ?? raw.user_id)
  return {
    userId: Number.isFinite(userId) ? userId : 0,
    totalEvents: Number(raw.totalEvents ?? raw.total_events ?? 0) || 0,
    queueJoins: Number(raw.queueJoins ?? raw.queue_joins ?? 0) || 0,
    queueLeaves: Number(raw.queueLeaves ?? raw.queue_leaves ?? 0) || 0,
    rank: Number(raw.rank ?? 0) || 0,
  }
}

function normalizePlayerStats(raw: Record<string, unknown>): PlayerStats {
  const userId = Number(raw.userId ?? raw.user_id)
  return {
    userId: Number.isFinite(userId) ? userId : 0,
    totalEvents: Number(raw.totalEvents ?? raw.total_events ?? 0) || 0,
    queueJoins: Number(raw.queueJoins ?? raw.queue_joins ?? 0) || 0,
    queueLeaves: Number(raw.queueLeaves ?? raw.queue_leaves ?? 0) || 0,
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
  const last = raw.lastUpdated ?? raw.last_updated
  return {
    currentQueueSize: num(raw.currentQueueSize ?? raw.current_queue_size),
    totalQueueJoins: num(raw.totalQueueJoins ?? raw.total_queue_joins),
    eventsLastMinute: num(raw.eventsLastMinute ?? raw.events_last_minute),
    lastUpdated: typeof last === 'string' && last.trim() ? last : null,
    eventsByType,
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
}
