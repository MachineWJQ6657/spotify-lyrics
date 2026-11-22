import { beforeEach, describe, expect, it } from 'vitest'
import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { resetFadeMemory } from '../lib/fade-trim'
import { useAppStore } from './useAppStore'

// The length lyric matching goes by, as the store hands it to the windows (src/lib/fade-trim.ts).
const track = { id: 'local-wonder', name: 'ワンダー', artist: 'tayori', album: 'ワンダー', coverUrl: '', durationMs: 220_053 }
const snapshot = (patch: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot =>
  ({ track, positionMs: 15_000, observedAtMs: Date.now(), isPlaying: true, playbackSource: 'local', ...patch }) as PlaybackSnapshot
const saved = (source: string, sourceDurationMs: number): LyricsDocument => ({ trackId: track.id, track, updatedAt: 1, sourceDurationMs,
  tracks: [{ id: 'o', language: 'ja', label: '日本語', kind: 'original', source, lines: [{ startMs: 1000, text: 'あ' }] }] })
const withStore = (library: Record<string, LyricsDocument>, run: () => void) => {
  const before = useAppStore.getState()
  useAppStore.setState({ library, playback: null })
  try { run() } finally { useAppStore.setState(before) }
}
const lookupLength = () => { const playing = useAppStore.getState().playback?.track; return playing?.sourceDurationMs ?? playing?.durationMs }

describe('the length a lookup uses while Spotify reports a shortened one', () => {
  beforeEach(() => resetFadeMemory({ trimMs: 7000, on: null }))

  it("is the recording's when the song's saved lyric file says so", () => withStore({ [track.id]: saved('LRCLIB · 精确匹配', 227_000) }, () => {
    useAppStore.getState().setPlayback(snapshot())
    expect(lookupLength()).toBe(227_053)
    // What the player bar shows is still what Spotify reports.
    expect(useAppStore.getState().playback?.track?.durationMs).toBe(220_053)
  }))

  it('stays the same through later snapshots of the play, including a seek to the start', () => withStore({ [track.id]: saved('LRCLIB · 精确匹配', 227_000) }, () => {
    useAppStore.getState().setPlayback(snapshot())
    useAppStore.getState().setPlayback(snapshot({ positionMs: 400, observedAtMs: Date.now() + 1 }))
    expect(lookupLength()).toBe(227_053)
  }))

  it("is not taken from Spotify's own lyrics, which are saved with the length they were asked with", () => withStore({ [track.id]: saved('Spotify · Musixmatch', 227_053) }, () => {
    useAppStore.getState().setPlayback(snapshot())
    expect(lookupLength()).toBe(220_053)
  }))

  it('is the reported one when crossfade is off and the saved lyric file fits it', () => withStore({ [track.id]: saved('LRCLIB · 精确匹配', 220_000) }, () => {
    useAppStore.getState().setPlayback(snapshot())
    expect(lookupLength()).toBe(220_053)
  }))
})
