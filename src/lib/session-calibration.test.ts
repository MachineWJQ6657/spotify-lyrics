import { describe, expect, it } from 'vitest'
import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { continuesCalibration, createSessionCalibration, currentSessionCalibration, displayedLyricPosition } from './session-calibration'
import { lyricTimingKey } from './lyric-timing-key'

const document: LyricsDocument = { trackId: 'song', offsetMs: 500, tracks: [{ id: 'original', kind: 'original', language: 'ja', label: '', source: 'fixture',
  lines: [{ text: 'Synthetic first line', startMs: 30000 }, { text: 'Synthetic next line', startMs: 35000 }] }] }
const playback: PlaybackSnapshot = { track: { id: 'song', name: '', artist: '', album: '', coverUrl: '', durationMs: 200000 },
  isPlaying: true, observedAtMs: 100000, positionMs: 32000 }

describe('user heard-line calibration', () => {
  it('does not double-apply a saved offset to a vocal anchor or reuse it after a source edit', () => {
    const timed: PlaybackSnapshot = { ...playback, acousticAnchor: { trackId: 'song', coordinate: 'lyrics',
      lyricTimingKey: lyricTimingKey(document.tracks[0].lines), sourcePositionMs: 30000, observedAtMs: 100000, expiresAtMs: 110000, rate: 1, score: .95 } }
    expect(displayedLyricPosition(40000, timed, document, 8000, null, 101000)).toBe(31000)
    const edited = { ...document, tracks: [{ ...document.tracks[0], lines: [{ text: 'changed', startMs: 30000 }] }] }
    expect(displayedLyricPosition(40000, timed, edited, 8000, null, 101000)).toBe(32000)
    expect(displayedLyricPosition(40000, timed, document, 8000, null, 111000)).toBe(32000)
    const recording: PlaybackSnapshot = { ...timed, acousticAnchor: { ...timed.acousticAnchor!, coordinate: 'recording' } }
    expect(displayedLyricPosition(40000, recording, document, 8000, null, 101000)).toBe(23000)
    expect(lyricTimingKey(document.tracks[0].lines)).not.toContain('Synthetic')
  })
  it('delays an early lyric clock using actual click time and does not accumulate existing offsets', () => {
    const value = createSessionCalibration(playback, document, 'original', 0, 101000)
    expect(value.offsetMs).toBe(3000)
    expect(displayedLyricPosition(33000, playback, document, 500, value, 101000)).toBe(30000)
    const withAudio = { ...playback, acousticAnchor: { trackId: 'song', sourcePositionMs: 99000, observedAtMs: 101000, expiresAtMs: 120000, rate: 1, score: .95 } }
    expect(displayedLyricPosition(33000, withAudio, document, 500, value, 101000)).toBe(30000)
    expect(playback.positionMs).toBe(32000)
    expect(document.offsetMs).toBe(500)
  })
  it('rejects wrong tracks, paused/stale/future playback and invalid line indices', () => {
    for (const value of [{ ...playback, isPlaying: false }, { ...playback, track: null }, { ...playback, observedAtMs: 70000 }, { ...playback, observedAtMs: 120000 }]) {
      expect(() => createSessionCalibration(value, document, 'original', 0, 101000)).toThrow()
    }
    for (const index of [-1, 1.5, 8]) expect(() => createSessionCalibration(playback, document, 'original', index, 101000)).toThrow()
    expect(() => createSessionCalibration(playback, document, 'translation', 0, 101000)).toThrow()
  })
  it('rejects a replacement original but preserves translation-only refreshes', () => {
    const value = createSessionCalibration(playback, document, 'original', 0, 101000)
    expect(currentSessionCalibration(value, playback, { ...document, updatedAt: 500 })).toBe(value)
    expect(currentSessionCalibration(value, playback, { ...document, tracks: document.tracks.map(track => ({ ...track, lines: [{ text: 'changed', startMs: 30000 }] })) })).toBeNull()
    expect(currentSessionCalibration(value, { ...playback, track: { ...playback.track!, id: 'other' } }, document)).toBeNull()
  })
  it('ends the session on pause, seek, replay or song change, not on normal samples', () => {
    expect(continuesCalibration(playback, { ...playback, positionMs: 36500, observedAtMs: 104500 })).toBe(true)
    expect(continuesCalibration(playback, playback)).toBe(true)
    expect(continuesCalibration(playback, { ...playback, positionMs: 0, observedAtMs: 104500 })).toBe(false)
    expect(continuesCalibration(playback, { ...playback, isPlaying: false })).toBe(false)
  })
})
