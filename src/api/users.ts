import { getAuthApi } from './config.ts'
import { readApiError } from './client.ts'

export interface UserPublic {
  id: number
  username: string
}

export async function fetchUsersByIds(accessToken: string, ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  if (!ids.length) return map
  const params = new URLSearchParams()
  for (const id of ids) {
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
    if (Number.isFinite(id) && typeof username === 'string' && username.trim()) {
      map.set(id, username.trim())
    }
  }
  return map
}
