import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: {} }))
vi.mock('./store', () => ({ SessionStore: class {
  async get() { return { accessToken: 'test-token', refreshToken: 'test-refresh', clientId: 'test-client', expiresAt: 1_000_000 } }
  async set() {}
} }))
import { SpotifyService } from './spotify'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Spotify playback observation timing', () => {
  it('keeps the normal request midpoint without issuing extra requests', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const request = vi.fn(async () => {
      vi.setSystemTime(1400)
      return new Response(JSON.stringify({ progress_ms: 9000, is_playing: false, item: null }))
    })
    vi.stubGlobal('fetch', request)
    const service = new SpotifyService()
    await service.restore()
    const snapshot = await service.getPlayback()
    expect(request).toHaveBeenCalledTimes(1)
    expect(snapshot).toMatchObject({ observedAtMs: 1200, positionMs: 9000, isPlaying: false })
  })
  it('excludes token refresh time from the successful playback request midpoint', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) { vi.setSystemTime(1200); return new Response('', { status: 401 }) }
      if (calls === 2) {
        vi.setSystemTime(12000)
        return new Response(JSON.stringify({ access_token: 'new-test-token', expires_in: 3600 }))
      }
      vi.setSystemTime(12200)
      return new Response(JSON.stringify({ progress_ms: 50000, is_playing: true, item: { id: 'song', name: 'song', duration_ms: 200000 } }))
    }))
    const service = new SpotifyService()
    await service.restore()
    const snapshot = await service.getPlayback()
    expect(calls).toBe(3)
    expect(snapshot?.observedAtMs).toBe(12100)
    expect(snapshot?.positionMs).toBe(50000)
  })
})
