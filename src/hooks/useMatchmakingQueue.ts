import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { gameApi } from '../api/game.ts'
import { matchmakingApi, matchIdFromJoinOrStatus } from '../api/matchmaking.ts'
import { parseUserIdFromAccessToken } from '../util/jwtClaims.ts'

const POLL_MS = 1500
/** Avoid treating a single early `inQueue: false` as an error before the server catches up */
const MIN_POLLS_BEFORE_NOT_IN_QUEUE_ERROR = 2

/**
 * Joins the matchmaking queue, polls `/api/matchmaking/status`, and navigates when `matchId` appears
 * on the join or status payload (camelCase or snake_case).
 */
export function useMatchmakingQueue(accessToken: string | null, navigate: NavigateFunction) {
  const [phase, setPhase] = useState<'idle' | 'finding'>('idle')
  const [error, setError] = useState('')
  const [position, setPosition] = useState<number | null>(null)
  const [queueSize, setQueueSize] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [isJoining, setIsJoining] = useState(false)

  const pollRef = useRef<number | undefined>(undefined)
  const tickRef = useRef<number | undefined>(undefined)
  const cancelledByUser = useRef(false)
  const searchingRef = useRef(false)
  const pollCount = useRef(0)

  const clearTimers = useCallback(() => {
    if (pollRef.current !== undefined) {
      window.clearInterval(pollRef.current)
      pollRef.current = undefined
    }
    if (tickRef.current !== undefined) {
      window.clearInterval(tickRef.current)
      tickRef.current = undefined
    }
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const goToMatch = useCallback(
    async (matchId: number) => {
      if (!accessToken) return
      try {
        const m = await gameApi.getMatch(matchId, accessToken)
        const myId = parseUserIdFromAccessToken(accessToken)
        if (myId != null && !m.playerIds.includes(myId)) {
          setError('That match is not yours. Click Play again.')
          clearTimers()
          searchingRef.current = false
          setPhase('idle')
          setElapsedSec(0)
          setIsJoining(false)
          return
        }
      } catch {
        setError('Could not verify the match with game-service (check it is running and Vite proxies /api/game).')
        clearTimers()
        searchingRef.current = false
        setPhase('idle')
        setElapsedSec(0)
        setIsJoining(false)
        return
      }
      clearTimers()
      searchingRef.current = false
      pollCount.current = 0
      setPhase('idle')
      setElapsedSec(0)
      navigate(`/game/${matchId}`, {
        replace: true,
        state: { matchAssignedAt: Date.now() },
      })
    },
    [accessToken, clearTimers, navigate],
  )

  const startFinding = useCallback(async () => {
    if (!accessToken || phase !== 'idle' || isJoining) return
    setError('')
    cancelledByUser.current = false
    searchingRef.current = true
    pollCount.current = 0
    setIsJoining(true)

    try {
      await matchmakingApi.leave(accessToken).catch(() => {
        /* not in queue */
      })
      const joinRes = await matchmakingApi.join(accessToken)
      const immediate = matchIdFromJoinOrStatus(joinRes)
      if (immediate !== null) {
        setIsJoining(false)
        await goToMatch(immediate)
        return
      }

      setQueueSize(joinRes.queueSize ?? 0)
      setPhase('finding')
      setElapsedSec(0)

      tickRef.current = window.setInterval(() => {
        setElapsedSec((n) => n + 1)
      }, 1000)

      pollRef.current = window.setInterval(async () => {
        if (!accessToken) return
        pollCount.current += 1
        try {
          const s = await matchmakingApi.status(accessToken)
          setPosition(s.position ?? null)
          setQueueSize(s.queueSize ?? 0)
          const mid = matchIdFromJoinOrStatus(s)
          if (mid !== null) {
            setIsJoining(false)
            await goToMatch(mid)
            return
          }
          if (
            !s.inQueue &&
            searchingRef.current &&
            !cancelledByUser.current &&
            pollCount.current > MIN_POLLS_BEFORE_NOT_IN_QUEUE_ERROR
          ) {
            setError('You left the queue before a match was assigned.')
            clearTimers()
            searchingRef.current = false
            setPhase('idle')
            setElapsedSec(0)
            setIsJoining(false)
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Matchmaking error')
          clearTimers()
          searchingRef.current = false
          setPhase('idle')
          setElapsedSec(0)
          setIsJoining(false)
        }
      }, POLL_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join queue')
      searchingRef.current = false
      setPhase('idle')
    } finally {
      setIsJoining(false)
    }
  }, [accessToken, phase, isJoining, clearTimers, goToMatch])

  const cancelFinding = useCallback(async () => {
    if (!accessToken) return
    cancelledByUser.current = true
    clearTimers()
    searchingRef.current = false
    pollCount.current = 0
    setPhase('idle')
    setElapsedSec(0)
    setError('')
    try {
      await matchmakingApi.leave(accessToken)
    } catch {
      /* ignore */
    }
  }, [accessToken, clearTimers])

  return {
    phase,
    error,
    position,
    queueSize,
    elapsedSec,
    isJoining,
    startFinding,
    cancelFinding,
  }
}
