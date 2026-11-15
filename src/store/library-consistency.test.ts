import { describe, expect, it } from 'vitest'
import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { useAppStore } from './useAppStore'

const song = { id: 'playing', name: '夜行', artist: 'ヨルシカ', album: '盗作', coverUrl: '', durationMs: 200_000 }
const playback = { track: song, positionMs: 30_000, observedAtMs: Date.now(), isPlaying: true, playbackSource: 'local' } as unknown as PlaybackSnapshot
const document = (id: string, updatedAt: number, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({
  trackId: id, updatedAt, providerRevision: 44,
  tracks: [{ id: `${id}-original`, language: 'ja', label: '日本語', kind: 'original', source: 'LRCLIB · 精确匹配', lines: [{ startMs: 1000, text: '歌詞' }] }],
  ...extra
})
/** Runs a case against a clean store and restores it afterwards. */
const withStore = (run: () => void) => {
  const before = useAppStore.getState()
  try { run() } finally { useAppStore.setState(before) }
}

describe('the view and the saved library stay in step', () => {
  it('forgets the song on screen when it is removed from the library, and looks it up again', () => withStore(() => {
    const saved = document('playing', 10, { offsetMs: 300 })
    useAppStore.setState({ playback, demoMode: false, lyrics: saved, library: { playing: saved, other: document('other', 5) } })
    const token = useAppStore.getState().lyricsRetryToken
    useAppStore.getState().deleteLibraryDocument('playing')
    const state = useAppStore.getState()
    expect(state.library.playing).toBeUndefined()
    // The view is dropped too, so a later offset or listening result cannot write the removed copy back.
    expect(state.lyrics).toBeNull()
    expect(state.lyricsRetryToken).toBe(token + 1)
    state.setListenedOffset('playing', { timingKey: 'k', state: 'decided', offsetMs: 100, lines: 6, measuredAt: 1 })
    expect(useAppStore.getState().library.playing).toBeUndefined()
  }))

  it('removes another song without touching the view', () => withStore(() => {
    const shown = document('playing', 10)
    useAppStore.setState({ playback, demoMode: false, lyrics: shown, library: { playing: shown, other: document('other', 5) } })
    const token = useAppStore.getState().lyricsRetryToken
    useAppStore.getState().deleteLibraryDocument('other')
    expect(useAppStore.getState().lyrics).toBe(shown)
    expect(useAppStore.getState().lyricsRetryToken).toBe(token)
  }))

  it('undo puts back exactly what was removed, also over a copy looked up since', () => withStore(() => {
    const removed = document('playing', 10, { offsetMs: 300, userEditedTrackIds: ['playing-original'] })
    const refetched = document('playing', 20)
    useAppStore.setState({ playback, demoMode: false, lyrics: refetched, library: { playing: refetched } })
    useAppStore.getState().restoreLibraryDocument(removed)
    expect(useAppStore.getState().library.playing).toBe(removed)
    expect(useAppStore.getState().lyrics).toBe(removed)
    // A song that is not on screen is only put back when it is still missing.
    const other = document('other', 3)
    useAppStore.setState({ library: { ...useAppStore.getState().library, other } })
    useAppStore.getState().restoreLibraryDocument(document('other', 1))
    expect(useAppStore.getState().library.other).toBe(other)
  }))

  it('does not save an empty entry when a song without lyrics is re-matched or given a source', () => withStore(() => {
    const notFound: LyricsDocument = { trackId: 'playing', track: { ...song, coverUrl: 'data:image/png;base64,AAAA' }, tracks: [], providerRevision: 44 }
    useAppStore.setState({ playback, demoMode: false, lyrics: notFound, library: {} })
    useAppStore.getState().retryCurrentLyrics()
    expect(useAppStore.getState().library.playing).toBeUndefined()
    expect(useAppStore.getState().lyrics).toMatchObject({ trackId: 'playing', providerRevision: undefined })
    useAppStore.getState().setLyricsSource('netease')
    expect(useAppStore.getState().library.playing).toBeUndefined()
    // The choice lives on the view, where the lookup reads it.
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'netease', sourceChosenBy: 'user' })
  }))

  it('keeps the last good saved lyrics when a partial view is re-matched', () => withStore(() => {
    const saved = document('playing', 10)
    const partial: LyricsDocument = { trackId: 'playing', tracks: [], untimedOriginal: { text: '歌詞', language: 'ja', source: 'Spotify' } }
    useAppStore.setState({ playback, demoMode: false, lyrics: partial, library: { playing: saved } })
    useAppStore.getState().retryCurrentLyrics()
    const state = useAppStore.getState()
    expect(state.library.playing.tracks).toBe(saved.tracks)
    // Marked for refresh, not replaced.
    expect(state.library.playing.providerRevision).toBeUndefined()
    expect(state.lyrics?.untimedOriginal).toBeTruthy()
  }))

  it('applies a source choice to the saved copy and the view alike', () => withStore(() => {
    const saved = document('playing', 10, { offsetMs: 300, sourceTrials: { lrclib: 'inconsistent' } })
    useAppStore.setState({ playback, demoMode: false, lyrics: saved, library: { playing: saved } })
    useAppStore.getState().setLyricsSource('kugou')
    const state = useAppStore.getState()
    for (const copy of [state.lyrics!, state.library.playing]) {
      expect(copy).toMatchObject({ sourcePreference: 'kugou', sourceChosenBy: 'user', providerRevision: undefined })
      expect(copy.offsetMs).toBeUndefined()
      expect(copy.sourceTrials).toBeUndefined()
      expect(copy.tracks).toBe(saved.tracks)
    }
  }))

  it('forgets the edit flag of a track that is removed', () => withStore(() => {
    const edited = document('playing', 10, { userEditedTrackIds: ['playing-zh', 'playing-original'],
      tracks: [...document('playing', 10).tracks, { id: 'playing-zh', language: 'zh-Hans', label: '中文', kind: 'translation', source: 'User', lines: [{ startMs: 1000, text: '歌词' }] }] })
    useAppStore.setState({ playback, demoMode: false, lyrics: edited, library: { playing: edited } })
    useAppStore.getState().removeLyricTrack('playing-zh')
    expect(useAppStore.getState().lyrics?.userEditedTrackIds).toEqual(['playing-original'])
    expect(useAppStore.getState().library.playing.userEditedTrackIds).toEqual(['playing-original'])
  }))

  it('runs a dropped lookup again, keeping a source switch a source switch', () => withStore(() => {
    useAppStore.setState({ playback, demoMode: false, lyrics: document('playing', 10), library: {}, sourceSwitchToken: null })
    const token = useAppStore.getState().lyricsRetryToken
    useAppStore.getState().rerunLyricsLookup()
    expect(useAppStore.getState().lyricsRetryToken).toBe(token + 1)
    expect(useAppStore.getState().sourceSwitchToken).toBeNull()
    useAppStore.getState().setLyricsSource('netease')
    useAppStore.getState().rerunLyricsLookup()
    const state = useAppStore.getState()
    expect(state.lyricsRetryToken).toBe(token + 3)
    expect(state.sourceSwitchToken).toBe(state.lyricsRetryToken)
  }))

  it('never saves the view-only "lookup failed" flag', () => withStore(() => {
    useAppStore.setState({ playback, demoMode: false, lyrics: null, library: {} })
    useAppStore.getState().setLyrics({ ...document('playing', 10), lookupFailed: true })
    expect(useAppStore.getState().library.playing.lookupFailed).toBeUndefined()
  }))
})

describe('restoring a backup while a song is on screen', () => {
  it('takes the backup copy for a song that was not found, and shows it', () => withStore(() => {
    const notFound: LyricsDocument = { trackId: 'playing', tracks: [], providerRevision: 44 }
    useAppStore.setState({ playback, demoMode: false, lyrics: notFound, library: {} })
    const fromBackup = document('playing', 5, { offsetMs: 250 })
    expect(useAppStore.getState().importLibrary([fromBackup])).toEqual({ added: 1, updated: 0, kept: 0 })
    expect(useAppStore.getState().library.playing).toBe(fromBackup)
    expect(useAppStore.getState().lyrics).toBe(fromBackup)
  }))

  it('takes the backup copy while the first lookup is still running', () => withStore(() => {
    useAppStore.setState({ playback, demoMode: false, lyrics: null, library: {} })
    const fromBackup = document('playing', 5)
    useAppStore.getState().importLibrary([fromBackup])
    expect(useAppStore.getState().lyrics).toBe(fromBackup)
  }))

  it('leaves a song that has lyrics on screen alone', () => withStore(() => {
    const live = document('playing', 10)
    useAppStore.setState({ playback, demoMode: false, lyrics: live, library: { playing: live } })
    expect(useAppStore.getState().importLibrary([document('playing', 99, { offsetMs: 9000 })])).toEqual({ added: 0, updated: 0, kept: 1 })
    expect(useAppStore.getState().lyrics).toBe(live)
    expect(useAppStore.getState().library.playing).toBe(live)
  }))
})
