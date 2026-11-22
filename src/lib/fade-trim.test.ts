import { beforeEach, describe, expect, it } from 'vitest'
import { fadeGapSeconds, fadeMemory, fadeTrimOfDrop, matchedLengthOf, releaseDurationOf, resetFadeMemory, withReleaseDuration } from './fade-trim'

// Numbers measured on 2026-11-22 with a 7 s crossfade: Lemon 256 116 -> 249 116 ms five
// seconds in; ワンダー 220 053 ms from its first sample (the recording is 227 053 ms).

describe('the crossfade time, from a drop of the reported length', () => {
  it('is the drop when it is a whole number of seconds between 1 and 12', () => {
    expect(fadeTrimOfDrop(256_116, 249_116)).toBe(7000)
    expect(fadeTrimOfDrop(200_040, 195_000)).toBe(5000)
    expect(fadeTrimOfDrop(200_000, 188_000)).toBe(12_000)
  })

  it('is nothing for other changes: another recording, a longer length, more than 12 s', () => {
    expect(fadeTrimOfDrop(256_116, 251_600)).toBeNull()
    expect(fadeTrimOfDrop(249_116, 256_116)).toBeNull()
    expect(fadeTrimOfDrop(256_116, 243_000)).toBeNull()
    expect(fadeTrimOfDrop(256_116, 256_116)).toBeNull()
    expect(fadeTrimOfDrop(0, 249_116)).toBeNull()
  })
})

describe("the recording's length behind a reported one", () => {
  const base = { fadeTrimMs: 7000, believedOn: null, settled: true } as const

  it('is restored when the saved lyric file has the longer length', () => {
    expect(releaseDurationOf({ ...base, durationMs: 220_053, matchedDurationMs: 227_000 })).toEqual({ durationMs: 227_053, verdict: 'reduced', fitMs: 53 })
  })

  it('stands when the saved lyric file has the reported length', () => {
    expect(releaseDurationOf({ ...base, durationMs: 256_116, matchedDurationMs: 256_000 })).toEqual({ verdict: 'full', fitMs: 116 })
  })

  it('is not decided by a lyric file of another edit', () => {
    // The 251 s file once matched for the shortened Lemon fits neither 249 nor 256.
    expect(releaseDurationOf({ ...base, durationMs: 249_116, matchedDurationMs: 251_000 })).toEqual({ verdict: 'unknown' })
    expect(releaseDurationOf({ ...base, durationMs: 249_116, matchedDurationMs: 251_000, believedOn: true })).toEqual({ durationMs: 256_116, verdict: 'assumed' })
  })

  it('is assumed restored for a new song only while crossfade is believed on and the length has settled', () => {
    expect(releaseDurationOf({ ...base, durationMs: 220_053, believedOn: true })).toEqual({ durationMs: 227_053, verdict: 'assumed' })
    expect(releaseDurationOf({ ...base, durationMs: 220_053, believedOn: true, settled: false })).toEqual({ verdict: 'unknown' })
    expect(releaseDurationOf({ ...base, durationMs: 220_053, believedOn: false })).toEqual({ verdict: 'unknown' })
    expect(releaseDurationOf({ ...base, durationMs: 220_053, believedOn: null })).toEqual({ verdict: 'unknown' })
  })

  it('does nothing before a crossfade time is known', () => {
    expect(releaseDurationOf({ durationMs: 220_053, matchedDurationMs: 227_000, believedOn: true, settled: true })).toEqual({ verdict: 'unknown' })
    expect(releaseDurationOf({ durationMs: 0, fadeTrimMs: 7000, believedOn: true, settled: true })).toEqual({ verdict: 'unknown' })
  })

  it('needs one length to fit clearly better with a one-second crossfade', () => {
    expect(releaseDurationOf({ durationMs: 200_400, fadeTrimMs: 1000, matchedDurationMs: 200_000, believedOn: null, settled: true }).verdict).toBe('full')
    // 199.6 and 200.6 against 200: 400 and 600 ms away, too close to call.
    expect(releaseDurationOf({ durationMs: 199_600, fadeTrimMs: 1000, matchedDurationMs: 200_000, believedOn: null, settled: true })).toEqual({ verdict: 'unknown' })
  })

  it('measures the gap of a lyric file in whole seconds', () => {
    expect(fadeGapSeconds(220_053, 227_000)).toBe(7)
    expect(fadeGapSeconds(214_000, 221_000)).toBe(7)
    expect(fadeGapSeconds(195_383, 197_000)).toBe(0)
    expect(fadeGapSeconds(200_000, 200_000)).toBe(0)
    expect(fadeGapSeconds(200_000, 214_000)).toBe(0)
  })
})

describe('the saved lyric file as evidence', () => {
  const track = (source: string) => ({ kind: 'original', source })
  it('is its matched length, except for lyrics that carry none', () => {
    expect(matchedLengthOf({ sourceDurationMs: 227_000, tracks: [track('LRCLIB · 精确匹配')] })).toBe(227_000)
    // Spotify's own lyrics are saved with the length the lookup was asked with.
    expect(matchedLengthOf({ sourceDurationMs: 234_053, tracks: [track('Spotify · Musixmatch')] })).toBeUndefined()
    expect(matchedLengthOf({ tracks: [track('本地')] })).toBeUndefined()
    expect(matchedLengthOf({ sourceDurationMs: 227_000, tracks: [] })).toBeUndefined()
    expect(matchedLengthOf(null)).toBeUndefined()
  })
})

describe('the playback the windows use', () => {
  type Track = { id: string; durationMs: number; sourceDurationMs?: number }
  const song = (id: string, durationMs: number, extra: Record<string, unknown> = {}) =>
    ({ track: { id, durationMs } as Track, positionMs: 30_000, playbackSource: 'local', ...extra })
  const T0 = 1_000_000
  /** The song has been the current one for `seconds`. */
  const after = (seconds: number) => T0 + seconds * 1000
  const lengthOf = (playback: { track: Track | null } | null) => playback?.track?.sourceDurationMs
  beforeEach(() => resetFadeMemory({ trimMs: 0, on: null }))

  it('keeps what the main process is sure of, and learns from it once the song has stayed', () => {
    // Lemon after its drop: the main process kept the real length.
    const playback = { track: { id: 'lemon', durationMs: 249_116, sourceDurationMs: 256_116 }, positionMs: 9000, playbackSource: 'local', fadeTrimMs: 7000 }
    expect(withReleaseDuration(playback, undefined, true, T0)).toBe(playback)
    expect(fadeMemory()).toEqual({ trimMs: 0, on: null })
    withReleaseDuration(playback, undefined, true, after(6))
    expect(fadeMemory()).toEqual({ trimMs: 7000, on: true })
  })

  it("does not learn from a moment's mix-up of two songs' lengths at a queue boundary", () => {
    const mixUp = { track: { id: 'old', durationMs: 200_000, sourceDurationMs: 203_000 }, positionMs: 190_000, playbackSource: 'local', fadeTrimMs: 3000 }
    withReleaseDuration(mixUp, undefined, true, T0)
    withReleaseDuration(mixUp, undefined, true, after(3))
    // The next song arrives: nothing was learned.
    withReleaseDuration(song('new', 180_000), undefined, true, after(4))
    expect(fadeMemory()).toEqual({ trimMs: 0, on: null })
  })

  it('restores a song that came in at the end of the previous one, from its first sample', () => {
    resetFadeMemory({ trimMs: 7000, on: true })
    const next = withReleaseDuration(song('wonder', 220_053, { positionMs: 12, enteredAtEnd: true }), undefined, true, T0)
    expect(lengthOf(next)).toBe(227_053)
    expect(next?.track?.durationMs).toBe(220_053)
  })

  it('waits until a picked song has been current for ten seconds before assuming anything', () => {
    resetFadeMemory({ trimMs: 7000, on: true })
    // In its first seconds a picked song still reports its real length: adding 7 s would be wrong.
    expect(lengthOf(withReleaseDuration(song('x', 235_066, { positionMs: 3000 }), undefined, true, T0))).toBeUndefined()
    // Seeking ahead does not make the length settle sooner.
    expect(lengthOf(withReleaseDuration(song('x', 235_066, { positionMs: 90_000 }), undefined, true, after(4)))).toBeUndefined()
    expect(lengthOf(withReleaseDuration(song('x', 235_066, { positionMs: 96_000 }), undefined, true, after(10)))).toBe(242_066)
  })

  it('keeps a decision for the whole play: seeking back or repeating does not undo it', () => {
    resetFadeMemory({ trimMs: 7000, on: true })
    withReleaseDuration(song('x', 235_066, { positionMs: 500 }), undefined, true, T0)
    expect(lengthOf(withReleaseDuration(song('x', 235_066, { positionMs: 11_000 }), undefined, true, after(11)))).toBe(242_066)
    // Back to the start, and crossfade is meanwhile believed off.
    const memory = fadeMemory()
    memory.on = false
    expect(lengthOf(withReleaseDuration(song('x', 235_066, { positionMs: 800 }), undefined, true, after(20)))).toBe(242_066)
    // Evidence still wins: the lookup saved a lyric file with the reported length.
    expect(lengthOf(withReleaseDuration(song('x', 235_066, { positionMs: 5000 }), 235_000, true, after(25)))).toBeUndefined()
    // And the next song starts fresh.
    expect(lengthOf(withReleaseDuration(song('y', 200_000, { positionMs: 500 }), undefined, true, after(30)))).toBeUndefined()
  })

  it('follows the saved lyric file whatever is believed, and updates the belief on a close fit', () => {
    resetFadeMemory({ trimMs: 7000, on: false })
    expect(lengthOf(withReleaseDuration(song('a', 220_053), 227_000, true, T0))).toBe(227_053)
    expect(fadeMemory().on).toBe(true)
    // Crossfade switched off: a known song plays with its real length.
    withReleaseDuration(song('b', 227_053), 227_000, true, after(100))
    expect(lengthOf(withReleaseDuration(song('b', 227_053), 227_000, true, after(113)))).toBeUndefined()
    expect(fadeMemory().on).toBe(false)
    // After that a new song is no longer lengthened.
    expect(lengthOf(withReleaseDuration(song('c', 180_000, { enteredAtEnd: true }), undefined, true, after(200)))).toBeUndefined()
  })

  it('does not call crossfade off from a loose fit or from the first seconds of a song', () => {
    resetFadeMemory({ trimMs: 7000, on: true })
    // A lyric file 1.4 s from the reported length may be a near edit matched while the length was short.
    withReleaseDuration(song('near', 249_600), 251_000, true, T0)
    withReleaseDuration(song('near', 249_600), 251_000, true, after(20))
    expect(fadeMemory().on).toBe(true)
    // Five seconds in, a picked song still reports its real length; the drop comes next.
    withReleaseDuration(song('lemon', 256_116), 256_000, true, after(100))
    withReleaseDuration(song('lemon', 256_116), 256_000, true, after(105))
    expect(fadeMemory().on).toBe(true)
  })

  it('learns the crossfade time from two songs in a row whose lyric files are the same seconds longer', () => {
    // Songs running into each other: no drop is ever seen. ワンダー 220 053 / 227 000, then ミッドナイト 214 000 / 221 000.
    expect(lengthOf(withReleaseDuration(song('a', 220_053, { enteredAtEnd: true }), 227_000, true, T0))).toBeUndefined()
    expect(fadeMemory()).toEqual({ trimMs: 0, on: null })
    // The same song again proves nothing new.
    withReleaseDuration(song('a', 220_053, { enteredAtEnd: true }), 227_000, true, after(30))
    expect(fadeMemory().trimMs).toBe(0)
    const second = withReleaseDuration(song('b', 214_000, { enteredAtEnd: true }), 221_000, true, after(230))
    expect(fadeMemory()).toEqual({ trimMs: 7000, on: true })
    expect(lengthOf(second)).toBe(221_000)
  })

  it('does not learn from one longer edit, from different gaps, or across a song that fits', () => {
    withReleaseDuration(song('a', 220_053, { enteredAtEnd: true }), 227_000, true, T0)
    withReleaseDuration(song('b', 214_000, { enteredAtEnd: true }), 218_000, true, after(100))
    expect(fadeMemory().trimMs).toBe(0)
    resetFadeMemory({ trimMs: 0, on: null })
    withReleaseDuration(song('a', 220_053, { enteredAtEnd: true }), 227_000, true, T0)
    withReleaseDuration(song('c', 200_000, { enteredAtEnd: true }), 200_000, true, after(100))
    withReleaseDuration(song('b', 214_000, { enteredAtEnd: true }), 221_000, true, after(200))
    expect(fadeMemory().trimMs).toBe(0)
  })

  it('follows a changed crossfade time', () => {
    resetFadeMemory({ trimMs: 7000, on: true })
    withReleaseDuration(song('a', 224_053, { enteredAtEnd: true }), 227_000, true, T0)
    withReleaseDuration(song('b', 218_000, { enteredAtEnd: true }), 221_000, true, after(100))
    expect(fadeMemory()).toEqual({ trimMs: 3000, on: true })
  })

  it('leaves Web API playback alone, and other windows never rewrite what was learned', () => {
    resetFadeMemory({ trimMs: 7000, on: true })
    const web = { track: { id: 'w', durationMs: 220_053 } as Track, positionMs: 30_000, playbackSource: 'web' }
    expect(withReleaseDuration(web, 227_000, true, T0)).toBe(web)
    resetFadeMemory({ trimMs: 7000, on: false })
    expect(lengthOf(withReleaseDuration(song('a', 220_053), 227_000, false, T0))).toBe(227_053)
    expect(fadeMemory().on).toBe(false)
    expect(withReleaseDuration(null, undefined)).toBeNull()
  })
})
