import { beforeEach, describe, expect, it } from 'vitest'
import type { LyricsDocument, LyricsSourceId, PlaybackSnapshot } from '../types'
import { useAppStore } from '../store/useAppStore'
import { adoptEarlierVerdict, advanceSource, afterVerdict, giveUpUnmeasuredTrial, listenTarget, resetSourceAdvanceForTests } from './listen-controller'
import { listenTimingKey } from './listened-offset'
import { automaticSourceOf, nextSourceToTry, sourcesVetted } from './lyrics-source'

const LABEL: Record<LyricsSourceId, string> = { lrclib: 'LRCLIB · 精确匹配', netease: '网易云音乐 · 搜索候选', kugou: '酷狗音乐 · 搜索候选', spotify: 'Spotify · Musixmatch' }
const track = { id: 'song', name: '夜行', artist: 'ヨルシカ', album: '盗作', coverUrl: '', durationMs: 200_000 }
const playback = { track, positionMs: 30_000, observedAtMs: Date.now(), isPlaying: true, playbackSource: 'local' } as unknown as PlaybackSnapshot
/** Providers that have the song and agree with the automatic choice, as a 0.4.65 lookup reports them. */
const sources = (...ids: LyricsSourceId[]) => ids.map(id => ({ id, lines: 12, agrees: true }))
const document = (shown: LyricsSourceId, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({
  trackId: track.id, track, providerRevision: 1,
  tracks: [{ id: 'o', language: 'ja', label: '日本語', kind: 'original', source: LABEL[shown],
    lines: Array.from({ length: 12 }, (_, index) => ({ startMs: 10_000 + index * 5000 + (shown === 'lrclib' ? 0 : 300), text: `歌詞の行その${index}` })) }],
  availableSources: sources('lrclib', 'netease', 'kugou'),
  ...extra
})
/** What the lyrics lookup does after a switch: the chosen provider's timeline is shown. */
const showChosen = () => {
  const current = useAppStore.getState().lyrics!
  const shown = current.sourcePreference ?? 'lrclib'
  useAppStore.setState({ lyrics: { ...document(shown), sourcePreference: current.sourcePreference, sourceChosenBy: current.sourceChosenBy, sourceTrials: current.sourceTrials } })
}
const decide = (extra: Partial<Parameters<typeof listenTarget>[0]> = {}) =>
  listenTarget({ playback, lyrics: useAppStore.getState().lyrics, enabled: true, demoMode: false, manualActive: false, ...extra })
const token = () => useAppStore.getState().lyricsRetryToken

beforeEach(() => {
  resetSourceAdvanceForTests()
  useAppStore.setState({ playback, demoMode: false, lyrics: document('lrclib'), library: {}, sourceSwitchToken: null })
})

describe('next source to try', () => {
  it('prefers NetEase, skips the one on screen and anything already judged', () => {
    expect(nextSourceToTry(document('lrclib'))).toBe('netease')
    expect(nextSourceToTry(document('netease'))).toBe('lrclib')
    expect(nextSourceToTry(document('lrclib', { sourceTrials: { netease: 'inconsistent' } }))).toBe('kugou')
    expect(nextSourceToTry(document('lrclib', { sourceTrials: { netease: 'unmeasurable' } }))).toBe('kugou')
    expect(nextSourceToTry(document('kugou', { sourceTrials: { netease: 'inconsistent', lrclib: 'inconsistent' } }))).toBeUndefined()
  })
  it('only offers providers that have timed lyrics for the song', () => {
    expect(nextSourceToTry(document('lrclib', { availableSources: sources('lrclib') }))).toBeUndefined()
    expect(nextSourceToTry(document('lrclib', { availableSources: undefined }))).toBeUndefined()
    expect(nextSourceToTry(null)).toBeUndefined()
  })
  it('never offers a provider whose words or length disagree with the automatic choice', () => {
    const mixed = [{ id: 'lrclib' as const, lines: 12, agrees: true }, { id: 'netease' as const, lines: 40, agrees: false }, { id: 'kugou' as const, lines: 12, agrees: true }]
    expect(nextSourceToTry(document('lrclib', { availableSources: mixed }))).toBe('kugou')
    expect(sourcesVetted(document('lrclib', { availableSources: mixed }))).toBe(true)
    expect(sourcesVetted(document('lrclib', { availableSources: [{ id: 'lrclib', lines: 12 }] }))).toBe(false)
    expect(sourcesVetted(document('lrclib', { availableSources: undefined }))).toBe(false)
  })
})

describe('whose lyrics are on screen', () => {
  it('names the provider for its own result only', () => {
    expect(automaticSourceOf(document('netease'))).toBe('netease')
    // Picked by hand in the search panel: carries the provider's name but is the user's.
    const picked = document('lrclib')
    picked.tracks[0] = { ...picked.tracks[0], id: 'remote-123', source: 'LRCLIB · 手动选择' }
    expect(automaticSourceOf(picked)).toBeUndefined()
    expect(automaticSourceOf(document('lrclib', { userEditedTrackIds: ['o'] }))).toBeUndefined()
    const imported = document('lrclib')
    imported.tracks[0] = { ...imported.tracks[0], id: 'local-1700000000-0', source: 'song.ja.lrc' }
    expect(automaticSourceOf(imported)).toBeUndefined()
    expect(automaticSourceOf(null)).toBeUndefined()
  })
  it('keeps provider tracks of a locally detected song (their ids start with the song id)', () => {
    const local = document('lrclib', { trackId: 'local-abc' })
    local.tracks[0] = { ...local.tracks[0], id: 'local-abc-original' }
    expect(automaticSourceOf(local)).toBe('lrclib')
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
    expect(decide()).toEqual({ reason: 'source-inconsistent' })
    expect(advanceSource(track.id)).toBe(false)
  })

  it('keeps a source whose lines agree', () => {
    afterVerdict(track.id, 'inconsistent')
    showChosen()
    afterVerdict(track.id, 'decided')
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'netease', sourceChosenBy: 'listening', sourceTrials: { lrclib: 'inconsistent', netease: 'consistent' } })
    expect(advanceSource(track.id)).toBe(false)
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

  it('ignores imported lyrics, lyrics picked by hand, and other songs', () => {
    useAppStore.setState({ lyrics: { ...document('lrclib'), tracks: [{ ...document('lrclib').tracks[0], source: 'song.ja.lrc' }] } })
    afterVerdict(track.id, 'inconsistent')
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
    afterVerdict('another-song', 'inconsistent')
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
    // "LRCLIB · 手动选择" is not LRCLIB's automatic result: no verdict against LRCLIB, no switch.
    useAppStore.setState({ lyrics: { ...document('lrclib'), tracks: [{ ...document('lrclib').tracks[0], id: 'remote-9', source: 'LRCLIB · 手动选择' }] } })
    afterVerdict(track.id, 'inconsistent')
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
  })

  it('still listens to lyrics picked by hand after the provider of the same name was judged', () => {
    const picked = document('lrclib', { sourceTrials: { lrclib: 'inconsistent' } })
    picked.tracks[0] = { ...picked.tracks[0], id: 'remote-9', source: 'LRCLIB · 手动选择' }
    useAppStore.setState({ lyrics: picked })
    expect(decide()).toHaveProperty('target')
  })

  it('does not apply a verdict to the next song', () => {
    // The verdict's song is still in `lyrics` for a moment after playback moved on.
    useAppStore.setState({ playback: { ...playback, track: { ...track, id: 'next-song' } } as PlaybackSnapshot })
    const before = token()
    afterVerdict(track.id, 'inconsistent')
    expect(token()).toBe(before)
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
  })
})

describe('a verdict from before per-source records', () => {
  const judged = (state: 'decided' | 'inconsistent', extra: Partial<LyricsDocument> = {}) => {
    const base = document('lrclib')
    return { ...base, listenedOffset: { timingKey: listenTimingKey(base.tracks[0])!, state, offsetMs: 0, measuredDeltaMs: 0, lines: 6, measuredAt: 1 }, ...extra } as LyricsDocument
  }
  it('moves an inconsistent song to another provider the next time it plays', () => {
    useAppStore.setState({ lyrics: judged('inconsistent') })
    expect(decide()).toEqual({ reason: 'already-measured' })
    adoptEarlierVerdict()
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'netease', sourceChosenBy: 'listening', sourceTrials: { lrclib: 'inconsistent' } })
  })
  it('does it once per provider', () => {
    useAppStore.setState({ lyrics: judged('inconsistent', { sourceTrials: { lrclib: 'inconsistent' } }) })
    adoptEarlierVerdict()
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
  })
  it('leaves decided songs, hand-picked sources and other timelines alone', () => {
    useAppStore.setState({ lyrics: judged('decided') })
    adoptEarlierVerdict()
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()

    useAppStore.setState({ lyrics: judged('inconsistent', { sourcePreference: 'lrclib', sourceChosenBy: 'user' }) })
    adoptEarlierVerdict()
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'lrclib', sourceChosenBy: 'user', sourceTrials: { lrclib: 'inconsistent' } })

    // The stored verdict is about another timeline (lyrics were rebuilt since): not this provider's.
    const other = judged('inconsistent')
    useAppStore.setState({ lyrics: { ...other, listenedOffset: { ...other.listenedOffset!, timingKey: 'another-timeline' } } })
    adoptEarlierVerdict()
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
  })
  it('asks who has the song when the saved copy predates that record, then moves on', () => {
    // Saved before 0.4.60: no list of providers at all.
    useAppStore.setState({ lyrics: judged('inconsistent', { availableSources: undefined }) })
    const before = token()
    adoptEarlierVerdict()
    expect(useAppStore.getState().lyrics).toMatchObject({ sourceTrials: { lrclib: 'inconsistent' } })
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
    expect(token()).toBe(before + 1)
    // The lookup answered with the same LRCLIB timeline and the list of providers.
    useAppStore.setState({ lyrics: { ...judged('inconsistent'), sourceTrials: { lrclib: 'inconsistent' } } })
    expect(advanceSource(track.id)).toBe(true)
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'netease', sourceChosenBy: 'listening' })
  })
})

describe('moving on from an inconsistent provider', () => {
  it('does not ask twice while the lookup for the next provider is running', () => {
    afterVerdict(track.id, 'inconsistent')
    const asked = token()
    // The timeline on screen is still LRCLIB's until the lookup answers.
    expect(advanceSource(track.id)).toBe(false)
    expect(advanceSource(track.id)).toBe(false)
    expect(token()).toBe(asked)
    expect(useAppStore.getState().lyrics?.sourcePreference).toBe('netease')
  })

  it('does not listen while the lookup for another source is running', () => {
    useAppStore.getState().setLyricsSource('kugou')
    const state = useAppStore.getState()
    const switching = state.sourceSwitchToken !== null && state.sourceSwitchToken === state.lyricsRetryToken && state.lyrics?.providerRevision === undefined
    expect(switching).toBe(true)
    expect(decide({ switching })).toEqual({ reason: 'source-switching' })
    // The lookup answered.
    showChosen()
    expect(useAppStore.getState().lyrics?.providerRevision).toBe(1)
    expect(decide({ switching: false })).toHaveProperty('target')
  })

  it('skips a provider that turned out to have nothing', () => {
    afterVerdict(track.id, 'inconsistent')
    // The lookup answered: NetEase has no timed lyrics, so the automatic (LRCLIB) timeline stays.
    const current = useAppStore.getState().lyrics!
    useAppStore.setState({ lyrics: { ...current, sourceUnavailable: true, availableSources: sources('lrclib', 'kugou') } })
    expect(advanceSource(track.id)).toBe(true)
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'kugou', sourceChosenBy: 'listening' })
  })

  it('returns to the automatic choice when the asked-for provider has nothing and none is left', () => {
    afterVerdict(track.id, 'inconsistent')
    const current = useAppStore.getState().lyrics!
    useAppStore.setState({ lyrics: { ...current, sourceUnavailable: true, availableSources: sources('lrclib') } })
    expect(advanceSource(track.id)).toBe(true)
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
    // Nothing more to do from here.
    showChosen()
    useAppStore.setState({ lyrics: { ...useAppStore.getState().lyrics!, availableSources: sources('lrclib') } })
    expect(advanceSource(track.id)).toBe(false)
  })

  it('returns to the automatic choice when the asked-for provider has nothing and the list is missing', () => {
    afterVerdict(track.id, 'inconsistent')
    const current = useAppStore.getState().lyrics!
    useAppStore.setState({ lyrics: { ...current, sourceUnavailable: true, availableSources: undefined } })
    expect(advanceSource(track.id)).toBe(true)
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
  })

  it('looks the song up once when its saved copy does not say who has it or who agrees', () => {
    for (const unknown of [undefined, [{ id: 'lrclib' as const, lines: 12 }, { id: 'kugou' as const, lines: 12 }]]) {
      resetSourceAdvanceForTests()
      useAppStore.setState({ lyrics: document('lrclib', { availableSources: unknown, sourceTrials: { lrclib: 'inconsistent' } }) })
      const before = token()
      expect(advanceSource(track.id)).toBe(true)
      expect(token()).toBe(before + 1)
      expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
      // Still unknown (the lookup failed): it is not asked again.
      expect(advanceSource(track.id)).toBe(false)
      expect(token()).toBe(before + 1)
      // The lookup answered: the next provider is tried.
      useAppStore.setState({ lyrics: { ...useAppStore.getState().lyrics!, availableSources: sources('lrclib', 'kugou') } })
      expect(advanceSource(track.id)).toBe(true)
      expect(useAppStore.getState().lyrics?.sourcePreference).toBe('kugou')
    }
  })

  it('does nothing for a consistent provider, a hand-picked one, or another song', () => {
    useAppStore.setState({ lyrics: document('lrclib', { sourceTrials: { lrclib: 'consistent' } }) })
    expect(advanceSource(track.id)).toBe(false)
    useAppStore.setState({ lyrics: document('lrclib', { sourceTrials: { lrclib: 'inconsistent' }, sourcePreference: 'lrclib', sourceChosenBy: 'user' }) })
    expect(advanceSource(track.id)).toBe(false)
    useAppStore.setState({ lyrics: document('lrclib', { sourceTrials: { lrclib: 'inconsistent' } }) })
    expect(advanceSource('another-song')).toBe(false)
  })
})

describe('a provider listening switched to but cannot measure', () => {
  it('is given up and the next one is tried', () => {
    afterVerdict(track.id, 'inconsistent')
    showChosen()
    // NetEase is on screen, chosen by listening, and no line could be placed.
    giveUpUnmeasuredTrial(track.id)
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'kugou', sourceChosenBy: 'listening', sourceTrials: { lrclib: 'inconsistent', netease: 'unmeasurable' } })
  })

  it('ends at the automatic choice when nothing else is left', () => {
    useAppStore.setState({ lyrics: document('lrclib', { availableSources: sources('lrclib', 'netease') }) })
    afterVerdict(track.id, 'inconsistent')
    showChosen()
    useAppStore.setState({ lyrics: { ...useAppStore.getState().lyrics!, availableSources: sources('lrclib', 'netease') } })
    giveUpUnmeasuredTrial(track.id)
    const settled = useAppStore.getState().lyrics!
    expect(settled.sourcePreference).toBeUndefined()
    expect(settled.sourceTrials).toEqual({ lrclib: 'inconsistent', netease: 'unmeasurable' })
  })

  it('only concerns the timeline that failed, a source listening chose, and one without a verdict', () => {
    afterVerdict(track.id, 'inconsistent')
    // Still LRCLIB on screen (lookup running): nothing to give up.
    giveUpUnmeasuredTrial(track.id)
    expect(useAppStore.getState().lyrics?.sourceTrials).toEqual({ lrclib: 'inconsistent' })
    showChosen()
    // Another timeline's failure.
    giveUpUnmeasuredTrial(track.id, 'some-other-timeline')
    expect(useAppStore.getState().lyrics?.sourceTrials).toEqual({ lrclib: 'inconsistent' })
    // The user's own pick is never given up.
    useAppStore.setState({ lyrics: document('kugou', { sourcePreference: 'kugou', sourceChosenBy: 'user' }) })
    giveUpUnmeasuredTrial(track.id)
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
    // The automatic choice is never given up either.
    useAppStore.setState({ lyrics: document('lrclib') })
    giveUpUnmeasuredTrial(track.id)
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
  })
})
