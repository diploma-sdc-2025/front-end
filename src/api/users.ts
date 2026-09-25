import { getAuthApi } from './config.ts'
import { readApiError } from './client.ts'

export interface UserPublic {
  id: number
  username: string
  rating: number
  guest: boolean
}

/** Fill-opponent id (AI). Shown as a normal rated player in the client. */
export const BOT_USER_ID = 1_000_001

const BOT_PUBLIC: UserPublic = {
  id: BOT_USER_ID,
  username: 'Mira',
  rating: 1016,
  guest: false,
}

/** Brackets with rating only for registered users; guests never show a rating. */
export function formatPlayerLine(profile: UserPublic | undefined, fallback: string, treatAsGuest: boolean): string {
  const name = (profile?.username ?? fallback).trim() || fallback
  const guest = treatAsGuest || profile?.guest === true
  if (guest) return name
  const r = profile?.rating
  if (typeof r === 'number' && Number.isFinite(r)) return `${name} (${r})`
  return name
}

export async function fetchUsersByIds(accessToken: string, ids: number[]): Promise<Map<number, UserPublic>> {
  const map = new Map<number, UserPublic>()
  if (!ids.length) return map
  for (const id of ids) {
    if (id === BOT_USER_ID) {
      map.set(BOT_USER_ID, BOT_PUBLIC)
    }
  }
  const lookupIds = ids.filter((id) => id !== BOT_USER_ID)
  if (!lookupIds.length) return map
  const params = new URLSearchParams()
  for (const id of lookupIds) {
    params.append('ids', String(id))
  }
  const res = await fetch(getAuthApi(`/api/users/by-ids?${params}`), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) {
    throw new Error(await readApiError(res))
  }
  const data = (await res.json()) as unknown
  if (!Array.isArray(data)) return map
  for (const row of data) {
    const r = row as Record<string, unknown>
    const id = Number(r.id)
    const username = r.username
    const rating = Number(r.rating)
    const guest = r.guest === true
    if (
      Number.isFinite(id) &&
      typeof username === 'string' &&
      username.trim() &&
      Number.isFinite(rating)
    ) {
      map.set(id, { id, username: username.trim(), rating, guest })
    }
  }
  return map
}
