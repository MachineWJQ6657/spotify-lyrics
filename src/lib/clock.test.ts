import { describe, expect, it, vi } from 'vitest'
import { calibratedPosition, lyricDurationScale, lyricSourcePosition, spotifySourcePosition, TransportClock, formatTime } from './clock'

describe('TransportClock', () => {
  it('projects playback from the observation anchor without animation timing', () => {
    const clock = new TransportClock()
    clock.update({ track: { id: 'x', name: 'x', artist: 'a', album: 'b', coverUrl: '', durationMs: 100_000 }, positionMs: 12_000, observedAtMs: 1_000, isPlaying: true })
    expect(clock.position(2_250)).toBe(13_250)
  })

  it('does not advance while paused and clamps to duration', () => {
    const clock = new TransportClock()
    clock.update({ track: { id: 'x', name: 'x', artist: 'a', album: 'b', coverUrl: '', durationMs: 14_000 }, positionMs: 13_500, observedAtMs: 1_000, isPlaying: false })
    expect(clock.position(8_000)).toBe(13_500)
    expect(formatTime(125_000)).toBe('2:05')
    vi.restoreAllMocks()
  })

  it('treats a zero media-session duration as unknown instead of freezing at zero', () => {
    const clock = new TransportClock()
    clock.update({ track: { id: 'x', name: 'x', artist: 'a', album: 'b', coverUrl: '', durationMs: 0 }, positionMs: 12_000, observedAtMs: 1_000, isPlaying: true })
    expect(clock.position(2_250)).toBe(13_250)
  })

  it('ignores a delayed network sample for the same track', () => {
    const clock = new TransportClock()
    const track = { id: 'x', name: 'x', artist: 'a', album: 'b', coverUrl: '', durationMs: 100_000 }
    clock.update({ track, positionMs: 20_000, observedAtMs: 5_000, isPlaying: true })
    clock.update({ track, positionMs: 17_000, observedAtMs: 4_000, isPlaying: true })
    expect(clock.position(6_000)).toBe(21_000)
  })

  it('blends small delayed SMTC corrections instead of jumping lyrics backwards', () => {
    const clock = new TransportClock()
    const track = { id: 'x', name: 'x', artist: 'a', album: 'b', coverUrl: '', durationMs: 100_000 }
    clock.update({ track, positionMs: 10_000, observedAtMs: 1_000, isPlaying: true })
    clock.update({ track, positionMs: 10_800, observedAtMs: 2_000, isPlaying: true })
    expect(clock.position(3_000)).toBe(11_890)
  })

  it('snaps immediately after a real seek', () => {
    const clock = new TransportClock()
    const track = { id: 'x', name: 'x', artist: 'a', album: 'b', coverUrl: '', durationMs: 100_000 }
    clock.update({ track, positionMs: 10_000, observedAtMs: 1_000, isPlaying: true })
    clock.update({ track, positionMs: 45_000, observedAtMs: 2_000, isPlaying: true })
    expect(clock.position(2_000)).toBe(45_000)
  })

  it('delays lyrics for a positive calibration offset', () => {
    expect(calibratedPosition(10_000, 500)).toBe(9_500)
    expect(calibratedPosition(10_000, -500)).toBe(10_500)
  })

  it('integrates Spotify Mix speed steps without treating its cue as a transport offset', () => {
    const transition = {
      kind: 'spotify-mix' as const,
      title: 'パレード',
      cuePointMs: 9090,
      outputDurationMs: 291585,
      sourceDurationMs: 299585,
      speedAutomation: [
        { fromPositionMs: 0, speed: .95405 },
        { fromPositionMs: 18310, speed: .95905 },
        { fromPositionMs: 26310, speed: 1 }
      ]
    }
    expect(spotifySourcePosition(0, transition)).toBe(0)
    expect(spotifySourcePosition(10_000, transition)).toBeCloseTo(9_540.5, 3)
    expect(spotifySourcePosition(20_000, transition)).toBeCloseTo(19_089.45, 3)
    expect(spotifySourcePosition(291_585, transition)).toBeCloseTo(290_416.0555, 3)
  })

  it('does not add large transition cues or clamp at a fade-derived endpoint', () => {
    const transition = {
      kind: 'spotify-mix' as const,
      title: '風のアンセム', cuePointMs: 16_910, outputDurationMs: 214_237,
      sourceDurationMs: 221_108, speedAutomation: []
    }
    expect(spotifySourcePosition(60_000, transition)).toBe(60_000)
    expect(spotifySourcePosition(225_000, transition)).toBe(225_000)
  })

  it('falls back to native Spotify time for malformed speed curves', () => {
    const transition = {
      kind: 'spotify-mix' as const,
      title: 'bad curve', cuePointMs: 9_270,
      speedAutomation: [{ fromPositionMs: 10_000, speed: 1 }, { fromPositionMs: 5_000, speed: .9 }]
    }
    expect(spotifySourcePosition(42_000, transition)).toBe(42_000)
  })

  it('leaves ordinary Spotify playback on a 1:1 source clock', () => {
    expect(spotifySourcePosition(42_000)).toBe(42_000)
  })

  it('does not infer whole-song tempo from release and transport endpoints', () => {
    expect(lyricDurationScale(233_081, 212_000)).toBe(1)
    expect(lyricSourcePosition(116_540.5, 233_081, 212_000)).toBe(116_540.5)
  })

  it('keeps intro, middle and outro on native time when a mix only supplies fade endpoints', () => {
    const transition = { kind: 'spotify-mix' as const, title: 'fade', cuePointMs: 16910,
      outputDurationMs: 214237, sourceDurationMs: 221108, speedAutomation: [] }
    for (const position of [0, 10000, 60000, 120000, 210000]) {
      expect(lyricSourcePosition(position, 214237, 221108, transition)).toBe(position)
    }
  })

  it('ignores tiny duration noise and implausible version mismatches', () => {
    expect(lyricDurationScale(242_182, 242_233)).toBe(1)
    expect(lyricDurationScale(240_000, 175_000)).toBe(1)
    expect(lyricSourcePosition(60_000, 242_182, 242_233)).toBe(60_000)
  })

  it('does not double-scale an explicit Spotify speed curve', () => {
    const transition = {
      kind: 'spotify-mix' as const, title: 'mix', cuePointMs: 0, outputDurationMs: 233_081,
      speedAutomation: [{ fromPositionMs: 0, speed: .91 }]
    }
    expect(lyricDurationScale(233_081, 212_000, transition)).toBe(1)
    expect(lyricSourcePosition(100_000, 233_081, 212_000, transition)).toBe(91_000)
  })

})
