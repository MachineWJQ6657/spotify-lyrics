import { describe, expect, it } from 'vitest'
import type { PlaybackSnapshot, SpotifyTransitionProfile } from '../types'
import { lyricPlaybackPosition, lyricSourcePosition, TransportClock } from './clock'

// These recipes are synthetic. Their presence does not prove whether an
// observed native position is output time or recording time.
const recipe = (speed: number): SpotifyTransitionProfile => ({
  kind: 'spotify-mix', title: 'Synthetic recording', cuePointMs: 9_000,
  outputDurationMs: 190_000, sourceDurationMs: 200_000,
  speedAutomation: [{ fromPositionMs: 0, speed }, { fromPositionMs: 30_000, speed: 1 }]
})
const playback: PlaybackSnapshot = {
  track: { id: 'synthetic', name: 'Synthetic recording', artist: 'Fixture artist', album: 'Fixture album', coverUrl: '', durationMs: 190_000 },
  positionMs: 60_000, observedAtMs: 100_000, isPlaying: true, playbackSource: 'local'
}

describe('unverified transition-coordinate safety', () => {
  it.each([1.12, .9])('does not automatically transform native time using a %s private speed recipe', speed => {
    for (const position of [0, 10_000, 30_000, 60_000, 120_000]) {
      expect(lyricSourcePosition(position, 190_000, 200_000, recipe(speed))).toBe(position)
      expect(lyricPlaybackPosition(position, { ...playback, transition: recipe(speed) }, 200_000, 100_000)).toBe(position)
    }
  })

  it('does not jump lyrics when transition metadata arrives after the same native observation', () => {
    const clock = new TransportClock()
    clock.update(playback)
    const before = lyricPlaybackPosition(clock.position(102_000), playback, 200_000, 102_000)
    const decorated = { ...playback, transition: recipe(1.12), transitionResolved: true }
    clock.update(decorated)
    expect(clock.position(102_000)).toBe(62_000)
    expect(lyricPlaybackPosition(clock.position(102_000), decorated, 200_000, 102_000)).toBe(before)
  })

  it('does not jump when a private recipe is refreshed or disappears', () => {
    const position = 62_000
    for (const transition of [recipe(1.12), recipe(.9), undefined]) {
      expect(lyricPlaybackPosition(position, { ...playback, transition }, 200_000, 102_000)).toBe(position)
    }
  })

  it('allows a valid independent audio anchor to own the lyric clock without transforming it again', () => {
    const anchored = { ...playback, transition: recipe(1.12), acousticAnchor: {
      trackId: 'synthetic', sourcePositionMs: 54_000, observedAtMs: 100_000,
      expiresAtMs: 112_000, rate: 1.03, score: .96
    } }
    expect(lyricPlaybackPosition(62_000, anchored, 200_000, 102_000)).toBe(56_060)
    expect(anchored.positionMs).toBe(60_000)
    expect(lyricPlaybackPosition(72_000, anchored, 200_000, 112_000)).toBe(72_000)
  })
})
