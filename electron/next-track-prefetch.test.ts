import { describe, expect, it, vi } from 'vitest'
import { NextTrackPrefetcher, PREFETCH_LEAD_MS, PREFETCH_RETRY_MS, PREFETCH_TTL_MS, prefetchedResultUsable, playbackRemainingMs, sameRecording, type PrefetchQueue } from './next-track-prefetch'
import type { LyricsResult } from './lyrics-provider'
import type { PlaybackSnapshot } from './spotify'

type Track = NonNullable<PlaybackSnapshot['track']>
const track = (name: string, extra: Partial<Track> = {}): Track => ({ id: `id-${name}`, name, artist: 'ヨルシカ', album: 'Album', coverUrl: '', durationMs: 200_000, ...extra })
const playing = (current: Track, positionMs: number, observedAtMs = 0): PlaybackSnapshot => ({ track: current, positionMs, observedAtMs, isPlaying: true, sampleId: 1, playbackSource: 'local' })
const lyric = (extra: Partial<LyricsResult> = {}): LyricsResult => ({ syncedLyrics: '[00:01.00]一行目\n[00:05.00]二行目', plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, ...extra })

function harness(queue: PrefetchQueue | null | (() => Promise<PrefetchQueue | null>), result: LyricsResult | null | (() => Promise<LyricsResult | null>) = lyric()) {
  let clock = 0
  const getQueue = vi.fn(typeof queue === 'function' ? queue : async () => queue)
  const fetchLyrics = vi.fn(typeof result === 'function' ? result : async () => result)
  const warmRomanization = vi.fn(async () => undefined)
  const log = vi.fn()
  const prefetcher = new NextTrackPrefetcher({ getQueue, fetchLyrics, warmRomanization, log, now: () => clock })
  return { prefetcher, getQueue, fetchLyrics, warmRomanization, log, advance: (ms: number) => { clock += ms }, at: (ms: number) => { clock = ms } }
}

describe('sameRecording', () => {
  it('matches the local and Web API description of one recording', () => {
    expect(sameRecording(track('雪国'), track('雪国', { id: 'other', durationMs: 201_500 }))).toBe(true)
    expect(sameRecording(track('Shout Baby', { artist: '緑黄色社会' }), track('Shout  baby', { artist: '緑黄色社会', album: 'Other', durationMs: 199_000 }))).toBe(true)
    // Multi-artist joins differ only in punctuation.
    expect(sameRecording(track('涼風', { artist: 'Atarayo, TOMONARI SORA' }), track('涼風', { artist: 'Atarayo,TOMONARI SORA\t', album: 'x' }))).toBe(true)
  })

  it('rejects another song, another edition length or a namesake by another artist', () => {
    expect(sameRecording(track('雪国'), track('修羅'))).toBe(false)
    expect(sameRecording(track('雪国', { album: 'A' }), track('雪国', { album: 'B', durationMs: 205_000 }))).toBe(false)
    expect(sameRecording(track('Parade', { artist: 'A', album: 'X' }), track('Parade', { artist: 'B', album: 'Y' }))).toBe(false)
    expect(sameRecording(track(''), track(''))).toBe(false)
    expect(sameRecording(track('!!!'), track('???'))).toBe(false)
  })

  it('accepts a Mix hand-off duration only when title, artist and album all agree', () => {
    expect(sameRecording(track('雪国'), track('雪国', { durationMs: 170_000 }))).toBe(true)
    expect(sameRecording(track('雪国', { album: 'A' }), track('雪国', { album: 'B', durationMs: 170_000 }))).toBe(false)
    expect(sameRecording(track('雪国', { durationMs: 0 }), track('雪国', { album: 'B' }))).toBe(false)
  })
})

describe('playbackRemainingMs and usability', () => {
  it('extrapolates only while playing with a known duration', () => {
    expect(playbackRemainingMs(playing(track('a'), 150_000, 1_000), 3_000)).toBe(48_000)
    expect(playbackRemainingMs({ ...playing(track('a'), 150_000), isPlaying: false }, 0)).toBeNull()
    expect(playbackRemainingMs(playing(track('a', { durationMs: 0 }), 0), 0)).toBeNull()
    expect(playbackRemainingMs(playing(track('a'), Number.NaN), 0)).toBeNull()
    expect(playbackRemainingMs(null, 0)).toBeNull()
    // A clock that ran backwards never adds time.
    expect(playbackRemainingMs(playing(track('a'), 150_000, 5_000), 1_000)).toBe(50_000)
  })

  it('reuses only a definitive timed answer', () => {
    expect(prefetchedResultUsable(lyric())).toBe(true)
    expect(prefetchedResultUsable(lyric({ transient: true }))).toBe(false)
    expect(prefetchedResultUsable(lyric({ syncedLyrics: null }))).toBe(false)
    expect(prefetchedResultUsable(lyric({ syncedLyrics: null, instrumental: true }))).toBe(false)
    expect(prefetchedResultUsable(null)).toBe(false)
  })
})

describe('NextTrackPrefetcher', () => {
  const current = track('現在の曲')
  const next = track('次の曲', { id: 'next-id' })

  it('waits for the lead window, prefetches once, and hands the result to the switch', async () => {
    const h = harness({ current, next })
    await h.prefetcher.maybePrefetch(playing(current, 200_000 - PREFETCH_LEAD_MS - 5_000))
    expect(h.getQueue).not.toHaveBeenCalled()
    await h.prefetcher.maybePrefetch(playing(current, 150_000))
    await h.prefetcher.maybePrefetch(playing(current, 160_000))
    expect(h.getQueue).toHaveBeenCalledTimes(1)
    expect(h.fetchLyrics).toHaveBeenCalledWith(next)
    expect(h.warmRomanization).toHaveBeenCalledTimes(1)
    // The local SMTC description of the next song (different id) still matches.
    expect(await h.prefetcher.take(track('次の曲', { id: 'local-abc', durationMs: 199_400 }))).toEqual(lyric())
    expect(await h.prefetcher.take(track('別の曲'))).toBeNull()
  })

  it('skips paused playback, the last seconds and missing tracks', async () => {
    const h = harness({ current, next })
    await h.prefetcher.maybePrefetch({ ...playing(current, 170_000), isPlaying: false })
    await h.prefetcher.maybePrefetch(playing(current, 198_000))
    await h.prefetcher.maybePrefetch(null)
    await h.prefetcher.maybePrefetch({ ...playing(current, 0), track: null })
    expect(h.getQueue).not.toHaveBeenCalled()
  })

  it('ignores a Web API queue that belongs to another device or lags behind a skip', async () => {
    const h = harness({ current: track('MacBookで再生中'), next })
    await h.prefetcher.maybePrefetch(playing(current, 170_000))
    expect(h.fetchLyrics).not.toHaveBeenCalled()
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('skipped'))
    expect(await h.prefetcher.take(next)).toBeNull()
  })

  it('does nothing for an empty queue, repeat-one, or an unavailable Web API', async () => {
    for (const queue of [{ current, next: null }, { current, next: { ...current, id: 'same-song' } }, null]) {
      const h = harness(queue)
      await h.prefetcher.maybePrefetch(playing(current, 170_000))
      expect(h.fetchLyrics).not.toHaveBeenCalled()
    }
  })

  it('retries a transient or failed prefetch once after a pause, then gives up', async () => {
    const results = [lyric({ transient: true }), lyric()]
    const h = harness({ current, next }, async () => results.shift() ?? null)
    await h.prefetcher.maybePrefetch(playing(current, 150_000))
    expect(await h.prefetcher.take(next)).toBeNull()
    h.advance(PREFETCH_RETRY_MS - 1)
    await h.prefetcher.maybePrefetch(playing(current, 150_000, 0))
    expect(h.fetchLyrics).toHaveBeenCalledTimes(1)
    h.advance(1)
    await h.prefetcher.maybePrefetch(playing(current, 150_000, PREFETCH_RETRY_MS))
    expect(h.fetchLyrics).toHaveBeenCalledTimes(2)
    expect(await h.prefetcher.take(next)).toEqual(lyric())
    h.advance(PREFETCH_RETRY_MS)
    await h.prefetcher.maybePrefetch(playing(current, 150_000, 2 * PREFETCH_RETRY_MS))
    expect(h.fetchLyrics).toHaveBeenCalledTimes(2)
  })

  it('survives a throwing queue request and a throwing lyric pipeline', async () => {
    const h = harness(async () => { throw new Error('Spotify 登录已过期') })
    await expect(h.prefetcher.maybePrefetch(playing(current, 170_000))).resolves.toBeUndefined()
    const g = harness({ current, next }, async () => { throw new Error('boom') })
    await g.prefetcher.maybePrefetch(playing(current, 170_000))
    expect(await g.prefetcher.take(next)).toBeNull()
  })

  it('lets the switch await a prefetch still in flight instead of fetching twice', async () => {
    let release!: (value: LyricsResult) => void
    const h = harness({ current, next }, () => new Promise<LyricsResult>(resolve => { release = resolve }))
    const running = h.prefetcher.maybePrefetch(playing(current, 170_000))
    await vi.waitFor(() => expect(h.fetchLyrics).toHaveBeenCalledTimes(1))
    // A concurrent observation does not start a second prefetch.
    await h.prefetcher.maybePrefetch(playing(current, 175_000))
    const taken = h.prefetcher.take(next)
    release(lyric())
    expect(await taken).toEqual(lyric())
    await running
    expect(h.fetchLyrics).toHaveBeenCalledTimes(1)
  })

  it('expires old prefetches', async () => {
    const h = harness({ current, next })
    await h.prefetcher.maybePrefetch(playing(current, 170_000))
    h.advance(PREFETCH_TTL_MS + 1)
    expect(await h.prefetcher.take(next)).toBeNull()
  })

  it('does not reuse a result that is not usable at the switch', async () => {
    for (const result of [lyric({ transient: true }), lyric({ syncedLyrics: null }), null]) {
      const h = harness({ current, next }, result)
      await h.prefetcher.maybePrefetch(playing(current, 170_000))
      expect(await h.prefetcher.take(next)).toBeNull()
      expect(h.warmRomanization).not.toHaveBeenCalled()
    }
  })

  it('keeps a warm-up failure from affecting the prefetched lyrics', async () => {
    const h = harness({ current, next })
    h.warmRomanization.mockRejectedValueOnce(new Error('dictionary failed'))
    await h.prefetcher.maybePrefetch(playing(current, 170_000))
    expect(await h.prefetcher.take(next)).toEqual(lyric())
  })

  it('bounds remembered songs and entries during a long session', async () => {
    const h = harness(null)
    for (let index = 0; index < 80; index += 1) {
      const song = track(`song-${index}`)
      h.getQueue.mockResolvedValueOnce({ current: song, next: track(`song-${index + 1}`) })
      await h.prefetcher.maybePrefetch(playing(song, 170_000))
    }
    expect(h.fetchLyrics).toHaveBeenCalledTimes(80)
    expect(await h.prefetcher.take(track('song-80'))).toEqual(lyric())
    expect(await h.prefetcher.take(track('song-10'))).toBeNull()
  })
})
