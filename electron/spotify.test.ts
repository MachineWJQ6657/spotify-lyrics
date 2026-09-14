import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: {} }))
vi.mock('./store', () => ({ SessionStore: class {
  async get() { return { accessToken: 'test-token', refreshToken: 'test-refresh', clientId: 'test-client', expiresAt: 1_000_000 } }
  async set() {}
} }))
import { SpotifyService } from './spotify'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Spotify playback observation timing', () => {
  it('cancels a stalled playback read and allows the next poll to recover', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const request = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', request)
    const service = new SpotifyService()
    await service.restore()
    const failed = expect(service.getPlayback()).rejects.toThrow('播放状态请求超时')
    await vi.advanceTimersByTimeAsync(8000)
    await failed
    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    request.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await service.getPlayback()).toMatchObject({ track: null, isPlaying: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a body that finishes after the playback deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => {
      await new Promise(resolve => setTimeout(resolve, 9000))
      return { item: null, progress_ms: 1000, is_playing: true }
    } })))
    const service = new SpotifyService()
    await service.restore()
    const failed = expect(service.getPlayback()).rejects.toThrow('播放状态请求超时')
    await vi.advanceTimersByTimeAsync(9000)
    await failed
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a stalled control request without replaying it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const request = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', request)
    const service = new SpotifyService()
    await service.restore()
    let failure: unknown
    void service.control('next').catch(error => { failure = error })
    await vi.advanceTimersByTimeAsync(5000)
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain('超时')
    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never sends a late skip when token refresh completes after the deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    let sends = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('accounts.spotify.com')) {
        // Simulate a delayed completion even after cancellation was requested.
        await new Promise(resolve => setTimeout(resolve, 6000))
        return new Response(JSON.stringify({ access_token: 'late-token', expires_in: 3600 }))
      }
      sends += 1
      return new Response('', { status: 401 })
    }))
    const service = new SpotifyService()
    await service.restore()
    let failure: unknown
    void service.control('next').catch(error => { failure = error })
    await vi.advanceTimersByTimeAsync(6500)
    expect(String(failure)).toContain('超时')
    expect(sends).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['next', 'seek'] as const)('bounds repeated authorization failures for %s', async command => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    let controls = 0
    let refreshes = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('accounts.spotify.com')) {
        refreshes += 1
        return new Response(JSON.stringify({ access_token: 'retry-token', expires_in: 3600 }))
      }
      controls += 1
      // Terminate even the old recursive implementation so regression is bounded.
      return controls < 3 ? new Response('', { status: 401 }) : new Response(null, { status: 204 })
    }))
    const service = new SpotifyService()
    await service.restore()
    await expect(command === 'next' ? service.control('next') : service.seek(1000)).rejects.toThrow('401')
    expect(controls).toBe(2)
    expect(refreshes).toBe(1)
  })

  it('does not replay a skip after an ambiguous network failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const request = vi.fn(async () => { throw new Error('network disconnected') })
    vi.stubGlobal('fetch', request)
    const service = new SpotifyService()
    await service.restore()
    await expect(service.control('next')).rejects.toThrow('network disconnected')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retries a definitively rejected command once with the refreshed token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'retry-token', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', request)
    const service = new SpotifyService()
    await service.restore()
    await service.control('next')
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[2]).toEqual(['https://api.spotify.com/v1/me/player/next', expect.objectContaining({
      method: 'POST', headers: { authorization: 'Bearer retry-token' }
    })])
  })
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
