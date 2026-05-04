import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import {
  analyticsApi,
  getAdminLiveStreamUrl,
  type LiveAnalyticsMetrics,
  type RecentEventEntry,
} from '../api/analytics.ts'
import { isAdminFromAccessToken } from '../util/adminAccess.ts'
import style from './AdminAnalytics.module.css'

type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

const EMPTY: LiveAnalyticsMetrics = {
  currentQueueSize: 0,
  totalQueueJoins: 0,
  totalMatchesCreated: 0,
  totalMatchesFinished: 0,
  eventsLastMinute: 0,
  eventsLastFiveMinutes: 0,
  queueJoinsLastMinute: 0,
  matchesCreatedLastMinute: 0,
  matchesFinishedLastMinute: 0,
  battlesLastMinute: 0,
  piecesPurchasedLastMinute: 0,
  matchConversionRatePct: 0,
  activeMatches: 0,
  playersInMatches: 0,
  playersOnline: 0,
  averageMatchSeconds: 0,
  lastUpdated: null,
  lastEvent: null,
  eventsByType: {},
  eventsPerSecond: [],
  recentEvents: [],
}

const EVENT_TYPE_COLOR: Record<string, string> = {
  queue_join: '#3b82f6',
  queue_leave: '#94a3b8',
  match_created: '#22c55e',
  match_started: '#14b8a6',
  battle_round: '#f59e0b',
  piece_purchased: '#a855f7',
  match_finished: '#ef4444',
  player_join: '#3b82f6',
  player_leave: '#94a3b8',
}

const KNOWN_EVENT_TYPES: string[] = [
  'queue_join',
  'queue_leave',
  'match_created',
  'match_started',
  'battle_round',
  'piece_purchased',
  'match_finished',
]

export function AdminAnalytics() {
  const { accessToken } = useAuth()
  const isAdmin = useMemo(() => isAdminFromAccessToken(accessToken), [accessToken])
  const [metrics, setMetrics] = useState<LiveAnalyticsMetrics>(EMPTY)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [lastTickAt, setLastTickAt] = useState<number | null>(null)
  const retryRef = useRef(0)

  useEffect(() => {
    if (!accessToken || !isAdmin) return
    let cancelled = false
    let source: EventSource | null = null
    let timer: number | null = null

    const open = () => {
      if (cancelled) return
      const retry = retryRef.current
      setConn(retry === 0 ? 'connecting' : 'reconnecting')
      const url = getAdminLiveStreamUrl(accessToken)
      source = new EventSource(url)

      source.addEventListener('metrics', (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent).data) as Record<string, unknown>
          const merged = mergeMetrics(parsed)
          setMetrics(merged)
          setError(null)
          setConn('connected')
          setLastTickAt(Date.now())
          retryRef.current = 0
        } catch {
          setError('Malformed realtime payload')
        }
      })

      source.onerror = () => {
        setConn('disconnected')
        setError('Live stream unavailable. Reconnecting…')
        try {
          source?.close()
        } catch {
          // no-op
        }
        const next = Math.min(15_000, 1000 * Math.pow(2, retryRef.current))
        retryRef.current += 1
        timer = window.setTimeout(open, next)
      }
    }

    void analyticsApi
      .fetchAdminLiveMetrics(accessToken)
      .then((m) => {
        setMetrics(m)
        setLastTickAt(Date.now())
      })
      .catch(() => setError('Could not load initial live snapshot'))

    open()

    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
      try {
        source?.close()
      } catch {
        // no-op
      }
    }
  }, [accessToken, isAdmin])

  if (!accessToken) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/" replace />

  const stale = isStale(lastTickAt, conn)

  return (
    <div className={style.page}>
      <header className={style.topbar}>
        <div className={style.titleBlock}>
          <Link to="/" className={style.back}>
            <span className={style.backIconWrap} aria-hidden>
              <svg className={style.backIcon} viewBox="0 0 24 24" focusable="false">
                <path
                  fill="currentColor"
                  d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"
                />
              </svg>
            </span>
            <span>Back</span>
          </Link>
          <div>
            <h1>Live Game Analytics</h1>
          </div>
        </div>
        <ConnectionPill state={conn} stale={stale} />
      </header>

      {error ? <p className={style.errorBanner}>{error}</p> : null}

      <section className={style.hero}>
        <HeroCard
          label="Players online"
          value={metrics.playersOnline}
          accent="#3b82f6"
          hint={`${metrics.currentQueueSize} in queue · ${metrics.playersInMatches} in matches`}
        />
        <HeroCard
          label="Active matches"
          value={metrics.activeMatches}
          accent="#22c55e"
          hint={`${metrics.totalMatchesCreated} created · ${metrics.totalMatchesFinished} finished`}
        />
        <HeroCard
          label="Events / minute"
          value={metrics.eventsLastMinute}
          accent="#f59e0b"
          hint={`${metrics.eventsLastFiveMinutes} in last 5 min`}
        />
        <HeroCard
          label="Avg match duration"
          value={formatDuration(metrics.averageMatchSeconds)}
          accent="#a855f7"
          hint="rolling 100 finished matches"
        />
      </section>

      <section className={style.sparkSection}>
        <div className={style.sparkHeader}>
          <span className={style.sectionTitle}>Events / second (last 60s)</span>
          <span className={style.sparkLegend}>peak {peak(metrics.eventsPerSecond)}/s</span>
        </div>
        <Sparkline data={metrics.eventsPerSecond} />
      </section>

      <section className={style.grid}>
        <Group title="Matchmaking">
          <Stat label="Queue size now" value={metrics.currentQueueSize} />
          <Stat label="Joins / 1m" value={metrics.queueJoinsLastMinute} />
          <Stat
            label="Conversion to match"
            value={`${metrics.matchConversionRatePct.toFixed(1)}%`}
            barPercent={Math.min(100, metrics.matchConversionRatePct)}
          />
        </Group>
        <Group title="Matches">
          <Stat label="Created / 1m" value={metrics.matchesCreatedLastMinute} />
          <Stat label="Finished / 1m" value={metrics.matchesFinishedLastMinute} />
          <Stat label="Active right now" value={metrics.activeMatches} />
        </Group>
        <Group title="Gameplay">
          <Stat label="Battles / 1m" value={metrics.battlesLastMinute} />
          <Stat label="Pieces purchased / 1m" value={metrics.piecesPurchasedLastMinute} />
          <Stat label="Total events lifetime" value={sumValues(metrics.eventsByType)} />
        </Group>
      </section>

      <section className={style.dualPane}>
        <div className={style.eventTypePanel}>
          <h2 className={style.sectionTitle}>Event-type distribution</h2>
          <EventTypeBars eventsByType={metrics.eventsByType} />
        </div>

        <div className={style.feedPanel}>
          <div className={style.feedHeader}>
            <h2 className={style.sectionTitle}>Live event feed</h2>
            <span className={style.feedHint}>last {metrics.recentEvents.length} · masked IDs</span>
          </div>
          <LiveEventFeed events={metrics.recentEvents} />
        </div>
      </section>

      <footer className={style.footer}>
        <span>
          Last update: <strong>{formatTime(metrics.lastUpdated)}</strong>
        </span>
      </footer>
    </div>
  )
}

function ConnectionPill({ state, stale }: { state: ConnState; stale: boolean }) {
  const label =
    state === 'connected'
      ? stale
        ? 'Idle (no events yet)'
        : 'Connected · live'
      : state === 'connecting'
        ? 'Connecting…'
        : state === 'reconnecting'
          ? 'Reconnecting…'
          : 'Disconnected'
  const cls =
    state === 'connected' && !stale
      ? style.pillConnected
      : state === 'connected' && stale
        ? style.pillIdle
        : state === 'disconnected'
          ? style.pillDisconnected
          : style.pillConnecting
  return (
    <span className={`${style.pill} ${cls}`}>
      <span className={style.pillDot} />
      {label}
    </span>
  )
}

function HeroCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: number | string
  hint?: string
  accent: string
}) {
  return (
    <div className={style.heroCard} style={{ borderTopColor: accent }}>
      <div className={style.heroLabel}>{label}</div>
      <div className={style.heroValue}>{value}</div>
      {hint ? <div className={style.heroHint}>{hint}</div> : null}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={style.groupCard}>
      <h3 className={style.groupTitle}>{title}</h3>
      <div className={style.groupBody}>{children}</div>
    </div>
  )
}

function Stat({
  label,
  value,
  barPercent,
}: {
  label: string
  value: number | string
  barPercent?: number
}) {
  return (
    <div className={style.stat}>
      <div className={style.statTop}>
        <span className={style.statLabel}>{label}</span>
        <span className={style.statValue}>{value}</span>
      </div>
      {typeof barPercent === 'number' ? (
        <div className={style.bar}>
          <div className={style.barFill} style={{ width: `${barPercent}%` }} />
        </div>
      ) : null}
    </div>
  )
}

function Sparkline({ data }: { data: number[] }) {
  const padded = data.length === 60 ? data : [...new Array(60 - data.length).fill(0), ...data]
  const w = 600
  const h = 80
  const max = Math.max(1, ...padded)
  const stepX = w / (padded.length - 1)
  const points = padded
    .map((v, i) => `${(i * stepX).toFixed(2)},${(h - (v / max) * (h - 6) - 3).toFixed(2)}`)
    .join(' ')
  const areaPoints = `0,${h} ${points} ${w},${h}`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={style.sparkline} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(96, 165, 250, 0.45)" />
          <stop offset="100%" stopColor="rgba(96, 165, 250, 0.02)" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#sparkArea)" />
      <polyline
        points={points}
        fill="none"
        stroke="#60a5fa"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function EventTypeBars({ eventsByType }: { eventsByType: Record<string, number> }) {
  const types = KNOWN_EVENT_TYPES.filter((t) => (eventsByType[t] ?? 0) >= 0)
  const max = Math.max(1, ...types.map((t) => eventsByType[t] ?? 0))
  return (
    <div className={style.typeBars}>
      {types.map((t) => {
        const v = eventsByType[t] ?? 0
        const pct = (v / max) * 100
        const color = EVENT_TYPE_COLOR[t] ?? '#94a3b8'
        return (
          <div key={t} className={style.typeRow}>
            <span className={style.typeLabel} style={{ color }}>
              {t}
            </span>
            <div className={style.typeBar}>
              <div className={style.typeBarFill} style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className={style.typeValue}>{v.toLocaleString()}</span>
          </div>
        )
      })}
    </div>
  )
}

function LiveEventFeed({ events }: { events: RecentEventEntry[] }) {
  if (!events.length) {
    return (
      <div className={style.feedEmpty}>
        Waiting for events… join the queue or play a match to see the stream light up.
      </div>
    )
  }
  return (
    <ul className={style.feed}>
      {events.map((e, idx) => {
        const color = EVENT_TYPE_COLOR[e.type] ?? '#94a3b8'
        return (
          <li key={`${e.timestamp}-${idx}`} className={style.feedItem}>
            <span className={style.feedTime}>{formatTime(e.timestamp)}</span>
            <span
              className={style.feedChip}
              style={{ background: hexAlpha(color, 0.18), color, borderColor: hexAlpha(color, 0.4) }}
            >
              {e.type}
            </span>
            <span className={style.feedUser}>{e.userMasked}</span>
            {e.matchId ? <span className={style.feedMatch}>match #{e.matchId}</span> : null}
            <span className={style.feedMeta}>{describeMeta(e.type, e.metadata)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function mergeMetrics(parsed: Record<string, unknown>): LiveAnalyticsMetrics {
  const next: LiveAnalyticsMetrics = { ...EMPTY }
  const keys: (keyof LiveAnalyticsMetrics)[] = [
    'currentQueueSize',
    'totalQueueJoins',
    'totalMatchesCreated',
    'totalMatchesFinished',
    'eventsLastMinute',
    'eventsLastFiveMinutes',
    'queueJoinsLastMinute',
    'matchesCreatedLastMinute',
    'matchesFinishedLastMinute',
    'battlesLastMinute',
    'piecesPurchasedLastMinute',
    'matchConversionRatePct',
    'activeMatches',
    'playersInMatches',
    'playersOnline',
    'averageMatchSeconds',
  ]
  for (const k of keys) {
    const v = parsed[k as string]
    ;(next as unknown as Record<string, unknown>)[k as string] = numberOr(v, 0)
  }
  next.lastUpdated =
    typeof parsed.lastUpdated === 'string' && parsed.lastUpdated.trim() ? parsed.lastUpdated : null
  next.lastEvent =
    parsed.lastEvent && typeof parsed.lastEvent === 'object'
      ? {
          type: String((parsed.lastEvent as Record<string, unknown>).type ?? 'unknown'),
          userMasked: String(
            (parsed.lastEvent as Record<string, unknown>).userMasked ?? 'u-****'
          ),
          queueSize: numberOr((parsed.lastEvent as Record<string, unknown>).queueSize, 0),
          timestamp: String((parsed.lastEvent as Record<string, unknown>).timestamp ?? ''),
        }
      : null
  next.eventsByType =
    parsed.eventsByType && typeof parsed.eventsByType === 'object'
      ? Object.fromEntries(
          Object.entries(parsed.eventsByType as Record<string, unknown>).map(([k, v]) => [
            k,
            numberOr(v, 0),
          ])
        )
      : {}
  next.eventsPerSecond = Array.isArray(parsed.eventsPerSecond)
    ? (parsed.eventsPerSecond as unknown[]).map((v) => numberOr(v, 0))
    : []
  next.recentEvents = Array.isArray(parsed.recentEvents)
    ? (parsed.recentEvents as Record<string, unknown>[]).slice(0, 30).map((e) => ({
        type: String(e.type ?? 'unknown'),
        userMasked: String(e.userMasked ?? 'u-****'),
        matchId: typeof e.matchId === 'number' ? e.matchId : null,
        queueSize: numberOr(e.queueSize, 0),
        timestamp: String(e.timestamp ?? ''),
        metadata:
          e.metadata && typeof e.metadata === 'object' ? (e.metadata as Record<string, unknown>) : {},
      }))
    : []
  return next
}

function numberOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

function peak(series: number[]): number {
  return series.length ? Math.max(...series) : 0
}

function sumValues(map: Record<string, number>): number {
  let s = 0
  for (const k of Object.keys(map)) s += map[k] ?? 0
  return s
}

function isStale(lastTickAt: number | null, state: ConnState): boolean {
  if (state !== 'connected') return false
  if (lastTickAt == null) return true
  return Date.now() - lastTickAt > 30_000
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '-'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleTimeString()
}

function describeMeta(type: string, meta: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return ''
  switch (type) {
    case 'piece_purchased':
      return `${String(meta.piece ?? '')} · ${String(meta.cost ?? '')}g`
    case 'battle_round': {
      const cp = Number(meta.centipawns ?? 0)
      return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)} eval`
    }
    case 'match_finished':
      return `winner ${String(meta.winnerUserId ?? 'u-****')}`
    case 'queue_join':
    case 'queue_leave':
      return `queue=${String(meta.queueSize ?? '')}`
    default:
      return ''
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
