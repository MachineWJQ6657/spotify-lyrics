import { describe, expect, it } from 'vitest'
import type { ListenedOffset, LyricsDocument, PlaybackSnapshot } from '../types'
import { awaitsConfirmation, confirmedBy } from './listen-confirmation'
import { listenTarget } from './listen-controller'
import { listenTimingKey } from './listened-offset'

const result = (offsetMs: number, extra: Partial<ListenedOffset> = {}): ListenedOffset =>
  ({ timingKey: 'k', state: 'decided', offsetMs, measuredDeltaMs: offsetMs + 150, spreadMs: 50, lines: 8, measuredAt: 1, ...extra })

describe('a large listened offset is checked on another play', () => {
  it('awaits confirmation from 1.5 s, in either direction, until confirmed', () => {
    expect(awaitsConfirmation(result(4010))).toBe(true)
    expect(awaitsConfirmation(result(-1500))).toBe(true)
    expect(awaitsConfirmation(result(1130))).toBe(false)
    expect(awaitsConfirmation(result(0))).toBe(false)
    expect(awaitsConfirmation(result(4010, { confirmed: true }))).toBe(false)
    expect(awaitsConfirmation(result(0, { state: 'inconsistent' }))).toBe(false)
    expect(awaitsConfirmation(null)).toBe(false)
  })

  it('is confirmed by a second measurement within 0.35 s on the same timeline', () => {
    expect(confirmedBy(result(4010), result(3900))).toBe(true)
    expect(confirmedBy(result(4010), result(4400))).toBe(false)
    // The play after a glitch measures the song as it is: nothing to confirm, the new result stands.
    expect(confirmedBy(result(4010), result(0, { measuredDeltaMs: 80 }))).toBe(false)
    expect(confirmedBy(result(4010), result(3950, { timingKey: 'other' }))).toBe(false)
    expect(confirmedBy(result(4010), result(0, { state: 'inconsistent' }))).toBe(false)
    expect(confirmedBy(result(300), result(320))).toBe(false)
  })
})

describe('when a measured song is listened to again', () => {
  const lines = Array.from({ length: 12 }, (_, index) => ({ startMs: 5000 + index * 4000, text: `歌詞の行 ${index}` }))
  const original = { id: 'o', language: 'ja', label: '日本語', kind: 'original' as const, source: 'LRCLIB · 精确匹配', lines }
  const track = { id: 'song', name: 'Song', artist: 'Artist', album: '', coverUrl: '', durationMs: 200_000 }
  const playback = { track, positionMs: 20_000, observedAtMs: 1, isPlaying: true, playbackSource: 'local' } as unknown as PlaybackSnapshot
  const document = (offsetMs: number, extra: Partial<ListenedOffset> = {}): LyricsDocument =>
    ({ trackId: 'song', track, tracks: [original], listenedOffset: result(offsetMs, { timingKey: listenTimingKey(original), ...extra }) })
  const decide = (lyrics: LyricsDocument, confirmable: boolean) =>
    listenTarget({ playback, lyrics, enabled: true, demoMode: false, manualActive: false, confirmable })

  it('listens once more to a large offset on another play', () => {
    expect(decide(document(4010), true)).toHaveProperty('target')
  })

  it('does not listen again during the play that measured it, once confirmed, or for an ordinary offset', () => {
    expect(decide(document(4010), false)).toEqual({ reason: 'already-measured' })
    expect(decide(document(4010, { confirmed: true }), true)).toEqual({ reason: 'already-measured' })
    expect(decide(document(330), true)).toEqual({ reason: 'already-measured' })
    expect(decide(document(0), true)).toEqual({ reason: 'already-measured' })
  })
})
