import { describe, expect, it } from 'vitest'
import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { displayLyricsOffset, listenTimingKey } from '../lib/listened-offset'
import { useAppStore } from './useAppStore'

// Regressions from the eighth review (0.4.73): what the editor does to the stored song.

const song = { id: 'playing', name: 'Song', artist: 'Artist', album: '', coverUrl: '', durationMs: 200_000 }
const playback = { track: song, positionMs: 30_000, observedAtMs: Date.now(), isPlaying: true, playbackSource: 'local' } as unknown as PlaybackSnapshot
const lines = Array.from({ length: 8 }, (_, index) => ({ startMs: 10_000 + index * 5000, text: `line number ${index}` }))
const original = { id: 'playing-original', language: 'en', label: 'English', kind: 'original' as const, source: 'LRCLIB · 精确匹配', lines }
const listened = (): LyricsDocument => ({ trackId: 'playing', track: song, updatedAt: 1, providerRevision: 46, tracks: [original],
  listenedOffset: { timingKey: listenTimingKey(original), state: 'decided', offsetMs: 850, measuredDeltaMs: 850, lines: 8, measuredAt: 1 } })
const withStore = (run: () => void) => {
  const before = useAppStore.getState()
  try { run() } finally { useAppStore.setState(before) }
}
const shown = () => useAppStore.getState().lyrics!

describe('editing the original of a song with a listened offset', () => {
  it('keeps the offset after a 100 ms nudge', () => withStore(() => {
    const document = listened()
    useAppStore.setState({ playback, demoMode: false, lyrics: document, library: { playing: document } })
    expect(displayLyricsOffset(shown(), 0)).toBe(850)
    useAppStore.getState().shiftLyricTrack('playing-original', 100)
    // Before: the offset stopped applying, so the lines showed 750 ms earlier instead of 100 ms later.
    expect(shown().tracks[0].lines[0].startMs).toBe(10_100)
    expect(displayLyricsOffset(shown(), 0)).toBe(850)
    expect(displayLyricsOffset(useAppStore.getState().library.playing, 0)).toBe(850)
  }))

  it('keeps the offset after a word is corrected or one line is re-timed', () => withStore(() => {
    const document = listened()
    useAppStore.setState({ playback, demoMode: false, lyrics: document, library: { playing: document } })
    useAppStore.getState().updateLyricLine('playing-original', 2, { text: 'line number two' })
    expect(displayLyricsOffset(shown(), 0)).toBe(850)
    useAppStore.getState().updateLyricLine('playing-original', 3, { startMs: 25_400 })
    expect(displayLyricsOffset(shown(), 0)).toBe(850)
  }))

  it('does not revive an offset that belonged to other lyrics', () => withStore(() => {
    const document: LyricsDocument = { ...listened(), listenedOffset: { timingKey: 'another file', state: 'decided', offsetMs: 850, measuredDeltaMs: 850, lines: 8, measuredAt: 1 } }
    useAppStore.setState({ playback, demoMode: false, lyrics: document, library: { playing: document } })
    useAppStore.getState().shiftLyricTrack('playing-original', 100)
    expect(displayLyricsOffset(shown(), 0)).toBe(0)
  }))
})

describe('editing the original during a heard-line calibration', () => {
  it('keeps the calibration, so a line stamped on the calibrated clock stays where it was put', () => withStore(() => {
    // The file is 2 s early; the user marked a heard line (session offset +2000) and then edits.
    const document: LyricsDocument = { trackId: 'playing', track: song, updatedAt: 1, tracks: [original] }
    useAppStore.setState({ playback, demoMode: false, lyrics: document, library: { playing: document } })
    useAppStore.getState().calibrateHeardLine('playing-original', 2, playback.observedAtMs)
    const offset = useAppStore.getState().sessionCalibration?.offsetMs
    expect(offset).toBe(30_000 - 20_000)
    useAppStore.getState().updateLyricLine('playing-original', 3, { startMs: 25_300 })
    // Before: the edit changed the original's key and the calibration became null.
    expect(useAppStore.getState().sessionCalibration?.offsetMs).toBe(offset)
    useAppStore.getState().shiftLyricTrack('playing-original', 100)
    expect(useAppStore.getState().sessionCalibration?.offsetMs).toBe(offset)
  }))
})

describe('editing a word-timed line', () => {
  const timed = (): LyricsDocument => ({ trackId: 'playing', track: song, updatedAt: 1, tracks: [{ ...original, lines: [
    { startMs: 10_000, text: 'hello wrold', words: [{ text: 'hello ', startMs: 10_000 }, { text: 'wrold', startMs: 10_600 }] }, { startMs: 15_000, text: 'next' }] }] })

  it('shows the corrected text', () => withStore(() => {
    useAppStore.setState({ playback, demoMode: false, lyrics: timed(), library: {} })
    useAppStore.getState().updateLyricLine('playing-original', 0, { text: 'hello world' })
    const line = shown().tracks[0].lines[0]
    // Rows render `words` when a line has them; the stale words kept "wrold" on screen.
    expect(line.text).toBe('hello world')
    expect(line.words).toBeUndefined()
  }))

  it('moves the word times with the line', () => withStore(() => {
    useAppStore.setState({ playback, demoMode: false, lyrics: timed(), library: {} })
    useAppStore.getState().updateLyricLine('playing-original', 0, { startMs: 10_300 })
    expect(shown().tracks[0].lines[0].words).toEqual([{ text: 'hello ', startMs: 10_300 }, { text: 'wrold', startMs: 10_900 }])
  }))
})

describe('applying lyrics while the automatic lookup is still running', () => {
  it('starts the playing song\'s document instead of dropping the track', () => withStore(() => {
    useAppStore.setState({ playback, demoMode: false, lyrics: null, library: {} })
    useAppStore.getState().addLyricTrack({ ...original, id: 'remote-7', source: 'LRCLIB · 手动选择' })
    expect(shown().trackId).toBe('playing')
    expect(shown().tracks.map(track => track.id)).toEqual(['remote-7'])
    expect(shown().userEditedTrackIds).toEqual(['remote-7'])
    expect(useAppStore.getState().library.playing?.tracks).toHaveLength(1)
  }))

  it('still does nothing when no song is playing', () => withStore(() => {
    useAppStore.setState({ playback: null, demoMode: false, lyrics: null, library: {} })
    useAppStore.getState().addLyricTrack({ ...original, id: 'remote-7' })
    expect(useAppStore.getState().lyrics).toBeNull()
  }))
})

describe('choosing a source for a song whose original is the user\'s', () => {
  it('keeps the manual offset: the lyrics on screen do not change', () => withStore(() => {
    const document: LyricsDocument = { trackId: 'playing', track: song, updatedAt: 1, providerRevision: 46, offsetMs: 400,
      tracks: [{ ...original, id: 'local-1-0', source: 'song.en.lrc' }], userEditedTrackIds: ['local-1-0'] }
    useAppStore.setState({ playback, demoMode: false, lyrics: document, library: { playing: document } })
    useAppStore.getState().setLyricsSource('netease')
    expect(shown().offsetMs).toBe(400)
    expect(useAppStore.getState().library.playing.offsetMs).toBe(400)
  }))

  it('still drops it when the original comes from a provider', () => withStore(() => {
    const document: LyricsDocument = { trackId: 'playing', track: song, updatedAt: 1, providerRevision: 46, offsetMs: 400, tracks: [original] }
    useAppStore.setState({ playback, demoMode: false, lyrics: document, library: { playing: document } })
    useAppStore.getState().setLyricsSource('netease')
    expect(shown().offsetMs).toBeUndefined()
  }))
})
