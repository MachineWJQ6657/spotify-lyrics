import { beforeEach, describe, expect, it } from 'vitest'
import type { LyricsDocument, LyricsSourceId, PlaybackSnapshot } from '../types'
import { useAppStore } from '../store/useAppStore'
import { afterVerdict, listenTarget } from './listen-controller'
import { nextSourceToTry } from './lyrics-source'

const LABEL: Record<LyricsSourceId, string> = { lrclib: 'LRCLIB · 精确匹配', netease: '网易云音乐 · 搜索候选', kugou: '酷狗音乐 · 搜索候选', spotify: 'Spotify · Musixmatch' }
const track = { id: 'song', name: '夜行', artist: 'ヨルシカ', album: '盗作', coverUrl: '', durationMs: 200_000 }
const playback = { track, positionMs: 30_000, observedAtMs: Date.now(), isPlaying: true, playbackSource: 'local' } as unknown as PlaybackSnapshot
const document = (shown: LyricsSourceId, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({
  trackId: track.id, track, providerRevision: 1,
  tracks: [{ id: 'o', language: 'ja', label: '日本語', kind: 'original', source: LABEL[shown],
    lines: Array.from({ length: 12 }, (_, index) => ({ startMs: 10_000 + index * 5000 + (shown === 'lrclib' ? 0 : 300), text: `歌詞の行その${index}` })) }],
  availableSources: [{ id: 'lrclib', lines: 12 }, { id: 'netease', lines: 12 }, { id: 'kugou', lines: 12 }],
  ...extra
})
/** What the lyrics lookup does after a switch: the chosen provider's timeline is shown. */
const showChosen = () => {
  const current = useAppStore.getState().lyrics!
  const shown = current.sourcePreference ?? 'lrclib'
  useAppStore.setState({ lyrics: { ...document(shown), sourcePreference: current.sourcePreference, sourceChosenBy: current.sourceChosenBy, sourceTrials: current.sourceTrials } })
}

beforeEach(() => useAppStore.setState({ playback, demoMode: false, lyrics: document('lrclib'), library: {}, sourceSwitchToken: null }))

describe('next source to try', () => {
  it('prefers NetEase, skips the one on screen and anything already judged', () => {
    expect(nextSourceToTry(document('lrclib'))).toBe('netease')
    expect(nextSourceToTry(document('netease'))).toBe('lrclib')
    expect(nextSourceToTry(document('lrclib', { sourceTrials: { netease: 'inconsistent' } }))).toBe('kugou')
    expect(nextSourceToTry(document('kugou', { sourceTrials: { netease: 'inconsistent', lrclib: 'inconsistent' } }))).toBeUndefined()
  })
  it('only offers providers that have timed lyrics for the song', () => {
    expect(nextSourceToTry(document('lrclib', { availableSources: [{ id: 'lrclib', lines: 12 }] }))).toBeUndefined()
    expect(nextSourceToTry(document('lrclib', { availableSources: undefined }))).toBeUndefined()
    expect(nextSourceToTry(null)).toBeUndefined()
  })
})

describe('listening moves to another source when one is inconsistent', () => {
  it('tries each available provider once, then returns to the automatic choice', () => {
    afterVerdict(track.id, 'inconsistent')
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'netease', sourceChosenBy: 'listening', sourceTrials: { lrclib: 'inconsistent' } })
    showChosen()
    afterVerdict(track.id, 'inconsistent')
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'kugou', sourceChosenBy: 'listening' })
    showChosen()
    afterVerdict(track.id, 'inconsistent')
    const settled = useAppStore.getState().lyrics!
    expect(settled.sourcePreference).toBeUndefined()
    expect(settled.sourceTrials).toEqual({ lrclib: 'inconsistent', netease: 'inconsistent', kugou: 'inconsistent' })
    // Back on the automatic (LRCLIB) timeline: it is not listened to again.
    showChosen()
    expect(listenTarget({ playback, lyrics: useAppStore.getState().lyrics, enabled: true, demoMode: false, manualActive: false })).toEqual({ reason: 'source-inconsistent' })
  })

  it('keeps a source whose lines agree', () => {
    afterVerdict(track.id, 'inconsistent')
    showChosen()
    afterVerdict(track.id, 'decided')
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'netease', sourceChosenBy: 'listening', sourceTrials: { lrclib: 'inconsistent', netease: 'consistent' } })
  })

  it('never overrides a source the user picked', () => {
    useAppStore.getState().setLyricsSource('kugou')
    showChosen()
    afterVerdict(track.id, 'inconsistent')
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'kugou', sourceChosenBy: 'user', sourceTrials: { kugou: 'inconsistent' } })
  })

  it('starts over when the user picks a source or asks to recalibrate', () => {
    afterVerdict(track.id, 'inconsistent')
    useAppStore.getState().setLyricsSource(null)
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
    useAppStore.getState().recordSourceTrial(track.id, 'lrclib', 'inconsistent')
    useAppStore.getState().clearSourceTrials(track.id)
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
  })

  it('ignores imported lyrics and other songs', () => {
    useAppStore.setState({ lyrics: { ...document('lrclib'), tracks: [{ ...document('lrclib').tracks[0], source: 'song.ja.lrc' }] } })
    afterVerdict(track.id, 'inconsistent')
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
    afterVerdict('another-song', 'inconsistent')
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
  })
})
