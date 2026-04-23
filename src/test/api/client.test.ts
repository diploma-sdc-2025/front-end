import { describe, expect, it } from 'vitest'
import { coerceMatchId, extractAuthTokens, joinApiUrl, readApiError } from '../../api/client'

describe('api/client', () => {
  it('joins base URL and path safely', () => {
    expect(joinApiUrl('http://localhost:8081/', '/api/auth/login')).toBe('http://localhost:8081/api/auth/login')
    expect(joinApiUrl('', 'api/auth/login')).toBe('/api/auth/login')
  })

  it('extracts auth tokens from camelCase and snake_case payloads', () => {
    expect(extractAuthTokens({ accessToken: '  a ', refreshToken: ' r ' })).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
    })
    expect(extractAuthTokens({ access_token: 't' })).toEqual({
      accessToken: 't',
      refreshToken: null,
    })
  })

  it('throws when access token is missing', () => {
    expect(() => extractAuthTokens({ refreshToken: 'x' })).toThrow('Server did not return an access token')
  })

  it('coerces match ids from numbers and strings', () => {
    expect(coerceMatchId(123)).toBe(123)
    expect(coerceMatchId('456')).toBe(456)
    expect(coerceMatchId('bad')).toBeNull()
    expect(coerceMatchId(null)).toBeNull()
  })

  it('reads message from JSON api error body', async () => {
    const res = new Response(JSON.stringify({ message: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(readApiError(res)).resolves.toBe('Invalid token')
  })

  it('falls back to status text or body truncation', async () => {
    const empty = new Response('', { status: 503, statusText: 'Service Unavailable' })
    await expect(readApiError(empty)).resolves.toBe('Service Unavailable')

    const longText = 'x'.repeat(250)
    const longRes = new Response(longText, { status: 400 })
    const message = await readApiError(longRes)
    expect(message.endsWith('…')).toBe(true)
    expect(message.length).toBe(201)
  })
})
