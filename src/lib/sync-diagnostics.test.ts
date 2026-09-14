import { describe, expect, it } from 'vitest'
import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { lyricDiagnosticContext, sanitizeLyricDiagnosticContext } from './sync-diagnostics'

const playback: PlaybackSnapshot = { track: { id: 'current', name: 'song', artist: 'artist', album: 'album', coverUrl: '', durationMs: 100_000 },
  positionMs: 10_000, observedAtMs: 1000, isPlaying: true,
  transition: { kind: 'spotify-mix', title: 'song', cuePointMs: 0, speedAutomation: [{ fromPositionMs: 0, speed: .95 }] } }
const lyrics: LyricsDocument = { trackId: 'current', offsetMs: 500, sourceDurationMs: 110_000, providerRevision: 34,
  tracks: [{ id: 'private-track-id', language: 'ja', label: 'Japanese', kind: 'original', source: 'LRCLIB', lines: [
    { startMs: 1000, text: 'secret lyric' }, { startMs: 9400, text: 'secret second lyric' }, { startMs: 20_000, text: 'secret third lyric' }] }] }

describe('lyric diagnostics without lyric bodies', () => {
  it('records calibrated projected timing and source metadata', () => {
    const report = lyricDiagnosticContext(playback, lyrics, 2000, 2000)
    expect(report).toMatchObject({ capturedAtMs: 2000, matchesPlayback: true, offsetMs: 500, estimatedLyricPositionMs: 9950,
      tracks: [{ source: 'LRCLIB', lineCount: 3, firstMs: 1000, lastMs: 20_000, estimatedActiveIndex: 1 }] })
    expect(JSON.stringify(report)).not.toMatch(/secret|private-track-id/)
  })
  it('does not attach outgoing lyrics after a track change', () => {
    expect(lyricDiagnosticContext(playback, { ...lyrics, trackId: 'old-song' }, 0, 2000)).toMatchObject({ matchesPlayback: false, tracks: [], offsetMs: 0, sourceDurationMs: null })
  })
  it('does not advance paused observations', () => {
    expect(lyricDiagnosticContext({ ...playback, isPlaying: false }, lyrics, 0, 99_000).estimatedLyricPositionMs).toBe(9000)
  })
  it('whitelists and bounds renderer report fields', () => {
    const result = sanitizeLyricDiagnosticContext({ token: 'secret', offsetMs: Infinity, tracks: Array.from({ length: 50 }, () => ({ source: 'a'.repeat(500), text: 'secret', firstMs: NaN })) })
    expect(result?.offsetMs).toBe(0)
    expect(result?.tracks).toHaveLength(16)
    expect(result?.tracks[0].source).toHaveLength(200)
    expect(result?.tracks[0].firstMs).toBeNull()
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(sanitizeLyricDiagnosticContext(null)).toBeNull()
  })
})
