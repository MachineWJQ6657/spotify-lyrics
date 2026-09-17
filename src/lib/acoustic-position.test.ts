import { describe, expect, it } from 'vitest'
import { lyricPlaybackPosition } from './clock'
import type { PlaybackSnapshot } from '../types'

const playback: PlaybackSnapshot = {
  track: { id: 'song', name: '', artist: '', album: '', coverUrl: '', durationMs: 200000 },
  positionMs: 80000, isPlaying: true, observedAtMs: 100000,
  acousticAnchor: { trackId: 'song', sourcePositionMs: 60000, observedAtMs: 100000, expiresAtMs: 120000, rate: 1.08, score: .95 },
}
describe('lyric-only audio clock', () => {
  it('projects from capture time, not completion time, without changing transport', () => {
    expect(lyricPlaybackPosition(82000, playback, undefined, 102000)).toBe(62160)
    expect(playback.positionMs).toBe(80000)
  })
  it('does not apply Spotify automation a second time', () => {
    const mixed = { ...playback, transition: { kind: 'spotify-mix' as const, title: '', cuePointMs: 0, outputDurationMs: 190000, sourceDurationMs: 200000, speedAutomation: [{ fromPositionMs: 0, speed: 1.1 }] } }
    expect(lyricPlaybackPosition(82000, mixed, 210000, 102000)).toBe(62160)
  })
  it('falls back on expiry, pause, future or wrong-track anchors', () => {
    expect(lyricPlaybackPosition(82000, playback, undefined, 120000)).toBe(82000)
    expect(lyricPlaybackPosition(82000, playback, undefined, 99000)).toBe(82000)
    expect(lyricPlaybackPosition(82000, { ...playback, isPlaying: false }, undefined, 102000)).toBe(82000)
    expect(lyricPlaybackPosition(82000, { ...playback, acousticAnchor: { ...playback.acousticAnchor!, trackId: 'other' } }, undefined, 102000)).toBe(82000)
  })
  it('does not propagate malformed anchors into the lyric renderer', () => {
    expect(lyricPlaybackPosition(82000, { ...playback, acousticAnchor: { ...playback.acousticAnchor!, rate: NaN } }, undefined, 102000)).toBe(82000)
  })
})
