import { afterEach, expect, it, vi } from 'vitest'
import type { LyricsDocument } from '../types'

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>)
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect) },
  useState: (value: unknown) => [value, () => undefined]
}))
vi.mock('../store/useAppStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/useAppStore')>()
  const store = actual.useAppStore
  return { ...actual, useAppStore: Object.assign((selector?: (state: ReturnType<typeof store.getState>) => unknown) =>
    selector ? selector(store.getState()) : store.getState(), store) }
})

it('rejects a previous song romanization even before its effect cleanup runs', async () => {
  vi.useFakeTimers()
  const track = { id: 'flow-outgoing', name: 'test', artist: '', album: '', coverUrl: '', durationMs: 10000 }
  let finish!: (value: string[]) => void
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { lyrics: {
    fetch: vi.fn().mockResolvedValue({ syncedLyrics: '[00:01.00]喜んで会いに行くから', source: 'test' }),
    romanize: () => new Promise<string[]>(resolve => { finish = resolve })
  } } })
  useAppStore.setState({ demoMode: false, connected: false, lyrics: null, library: {},
    playback: { track, positionMs: 0, observedAtMs: 0, isPlaying: false } })
  usePlaybackConnection()
  cleanup = effects[2]()
  await vi.advanceTimersByTimeAsync(320)
  const outgoing = useAppStore.getState().library[track.id]
  const incoming: LyricsDocument = { trackId: 'flow-incoming', tracks: [] }
  useAppStore.setState({ lyrics: incoming, playback: { track: { ...track, id: incoming.trackId },
    positionMs: 0, observedAtMs: 0, isPlaying: true } })
  finish(['yorokonde ai ni iku kara'])
  await vi.advanceTimersByTimeAsync(0)
  expect(useAppStore.getState().lyrics).toBe(incoming)
  expect(useAppStore.getState().library[track.id]).toBe(outgoing)
  expect(outgoing.tracks.some(item => item.kind === 'romanization')).toBe(false)
})

it('keeps visible and persisted lyrics when provider IPC fails and cancels the pending retry on cleanup', async () => {
  vi.useFakeTimers()
  const track = { id: 'flow-failure', name: 'test', artist: '', album: '', coverUrl: '', durationMs: 10000 }
  const baseline: LyricsDocument = { trackId: track.id, offsetMs: -1700, tracks: [
    { id: 'original', kind: 'original', language: 'en', label: 'English', source: 'test', lines: [{ startMs: 1000, text: 'keep me' }] }
  ] }
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { lyrics: {
    fetch: vi.fn().mockRejectedValue(new Error('IPC unavailable'))
  } } })
  useAppStore.setState({ demoMode: false, connected: false, lyrics: baseline, library: { [track.id]: baseline },
    playback: { track, positionMs: 0, observedAtMs: 0, isPlaying: false } })
  usePlaybackConnection()
  cleanup = effects[2]()
  await vi.advanceTimersByTimeAsync(320)
  expect(useAppStore.getState().lyrics).toBe(baseline)
  expect(useAppStore.getState().library[track.id]).toBe(baseline)
  expect(vi.getTimerCount()).toBe(1)
  const token = useAppStore.getState().lyricsRetryToken
  cleanup?.(); cleanup = undefined
  await vi.advanceTimersByTimeAsync(12000)
  expect(useAppStore.getState().lyricsRetryToken).toBe(token)
  expect(vi.getTimerCount()).toBe(0)
})
import { useAppStore } from '../store/useAppStore'
import { usePlaybackConnection } from './usePlayback'
import { visibleTracks } from '../lib/lyrics'

const initial = useAppStore.getState()
let cleanup: void | (() => void)
afterEach(() => {
  cleanup?.(); cleanup = undefined
  effects.length = 0
  useAppStore.setState(initial)
  vi.useRealTimers(); vi.unstubAllGlobals()
})

it.each([false, true])('repairs a stale generated cache without provider refetch; userEdited=%s', async userEdited => {
  vi.useFakeTimers()
  const track = { id: `flow-romaji-revision-${userEdited}`, name: 'test', artist: '', album: '', coverUrl: '', durationMs: 10000 }
  const cached: LyricsDocument = { trackId: track.id, providerRevision: 43, providerContext: 'community::10000', offsetMs: 1400, tracks: [
    { id: `${track.id}-original`, kind: 'original', language: 'ja', label: '日本語', source: 'provider', lines: [{ startMs: 1000, text: '待って' }] },
    { id: `${track.id}-romaji`, kind: 'romanization', language: 'romaji', label: 'Romaji', source: 'Kuroshiro · Kuromoji', lines: [{ startMs: 1000, text: 'mate' }] },
    { id: 'local-zh', kind: 'translation', language: 'zh-Hans', label: '中文', source: 'user', lines: [{ startMs: 1000, text: '等一下' }] }
  ], ...(userEdited ? { userEditedTrackIds: [`${track.id}-romaji`] } : {}) }
  const fetch = vi.fn(), romanize = vi.fn().mockResolvedValue(['matte'])
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { lyrics: { fetch, romanize } } })
  useAppStore.setState({ demoMode: false, connected: false, lyrics: null, library: { [track.id]: cached },
    playback: { track, positionMs: 0, observedAtMs: 0, isPlaying: false } })
  usePlaybackConnection(); cleanup = effects[2]()
  await vi.advanceTimersByTimeAsync(320)
  const result = useAppStore.getState().lyrics!
  expect(fetch).not.toHaveBeenCalled()
  expect(romanize).toHaveBeenCalledTimes(userEdited ? 0 : 1)
  expect(result.tracks[1].lines[0].text).toBe(userEdited ? 'mate' : 'matte')
  expect(result.offsetMs).toBe(1400)
  expect(result.tracks[0]).toBe(cached.tracks[0])
  expect(result.tracks[2]).toBe(cached.tracks[2])
})

it.each([false, true])('replaces rejected automatic lyrics with untimed Spotify words, even when transient=%s', async transient => {
  vi.useFakeTimers()
  const track = { id: `flow-conflict-${transient}`, name: 'test', artist: '', album: '', coverUrl: '', durationMs: 10000 }
  const baseline: LyricsDocument = { trackId: track.id, tracks: [
    { id: `${track.id}-original`, kind: 'original', language: 'en', label: 'English', source: 'wrong', lines: [{ startMs: 1000, text: 'wrong version' }] },
    { id: 'local-zh', kind: 'translation', language: 'zh-Hans', label: '中文', source: 'User', lines: [{ startMs: 1000, text: '保留用户翻译' }] }
  ], userEditedTrackIds: ['local-zh'] }
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { lyrics: { fetch: vi.fn().mockResolvedValue({
    syncedLyrics: null, plainLyrics: 'テストの原文です', source: 'Spotify · Musixmatch', transient,
    textReference: { referenceSource: 'Spotify · Musixmatch', status: 'conflict', matchedLines: 0, referenceLines: 12 }
  }) } } })
  useAppStore.setState({ demoMode: false, connected: false, lyrics: baseline, library: { [track.id]: baseline },
    playback: { track, positionMs: 0, observedAtMs: 0, isPlaying: false } })
  usePlaybackConnection(); cleanup = effects[2]()
  await vi.advanceTimersByTimeAsync(320)
  const result = useAppStore.getState().lyrics!
  expect(result.untimedOriginal?.text).toBe('テストの原文です')
  expect(result.tracks.map(track => track.id)).toEqual(['local-zh'])
  expect(visibleTracks(result, ['zh-Hans'], true)).toEqual([])
  expect(result.providerRevision).toBeUndefined()
  expect(result.textReference?.status).toBe('conflict')
  expect(useAppStore.getState().library[track.id].untimedOriginal).toEqual(result.untimedOriginal)
})

// Runs the actual provider effect against the real store; not a React DOM test.
it('preserves translations and calibration from partial fetch through delayed romanization', async () => {
  vi.useFakeTimers()
  const track = { id: 'flow-partial', name: 'test', artist: '', album: '', coverUrl: '', durationMs: 10000 }
  const baseline: LyricsDocument = { trackId: track.id, offsetMs: 2300, userEditedTrackIds: ['local-zh'], tracks: [
    { id: 'local-zh', kind: 'translation', language: 'zh-Hans', label: '中文', source: 'User', lines: [{ startMs: 1000, text: '我的翻译' }] }
  ] }
  let finish!: (value: string[]) => void
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { lyrics: {
    fetch: vi.fn().mockResolvedValue({ syncedLyrics: '[00:01.00]喜んで会いに行くから', source: 'test', transient: true }),
    romanize: () => new Promise<string[]>(resolve => { finish = resolve })
  } } })
  useAppStore.setState({ demoMode: false, connected: false, lyrics: baseline, library: { [track.id]: baseline },
    playback: { track, positionMs: 0, observedAtMs: 0, isPlaying: false } })
  usePlaybackConnection()
  cleanup = effects[2]()
  await vi.advanceTimersByTimeAsync(320)
  expect(useAppStore.getState().lyrics?.offsetMs).toBe(2300)
  expect(useAppStore.getState().lyrics?.tracks).toContain(baseline.tracks[0])
  expect(useAppStore.getState().library[track.id]).toBe(baseline)
  finish(['yorokonde ai ni iku kara'])
  await vi.advanceTimersByTimeAsync(0)
  expect(useAppStore.getState().lyrics?.tracks.some(item => item.kind === 'romanization')).toBe(true)
  expect(useAppStore.getState().lyrics?.offsetMs).toBe(2300)
  expect(useAppStore.getState().lyrics?.tracks).toContain(baseline.tracks[0])
  expect(useAppStore.getState().library[track.id]).toBe(baseline)
})

it('asks again when the document changed while its lookup was running', async () => {
  vi.useFakeTimers()
  const track = { id: 'flow-concurrent', name: 'test', artist: '', album: '', coverUrl: '', durationMs: 10000 }
  // A source was just chosen: the pending document has no provider revision.
  const pending: LyricsDocument = { trackId: track.id, sourcePreference: 'netease', sourceChosenBy: 'user', tracks: [
    { id: `${track.id}-original`, kind: 'original', language: 'en', label: 'English', source: 'LRCLIB · 精确匹配', lines: [{ startMs: 1000, text: 'old source line' }] }
  ] }
  let answer!: (value: unknown) => void
  const fetch = vi.fn().mockImplementation(() => new Promise(resolve => { answer = resolve }))
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { lyrics: { fetch } } })
  useAppStore.setState({ demoMode: false, connected: false, lyrics: pending, library: { [track.id]: pending },
    playback: { track, positionMs: 0, observedAtMs: 0, isPlaying: false } })
  usePlaybackConnection()
  cleanup = effects[2]()
  await vi.advanceTimersByTimeAsync(320)
  expect(fetch).toHaveBeenCalledTimes(1)
  // The user nudges the offset before the answer arrives: the document is a new object.
  useAppStore.getState().setLyricsOffset(500)
  const nudged = useAppStore.getState().lyrics
  const token = useAppStore.getState().lyricsRetryToken
  answer({ syncedLyrics: '[00:01.00]new source line', source: '网易云音乐 · 搜索候选' })
  await vi.advanceTimersByTimeAsync(0)
  // The stale answer is not applied over the nudge, and the lookup is asked for again
  // instead of leaving the chosen source unapplied for the rest of the song.
  expect(useAppStore.getState().lyrics).toBe(nudged)
  expect(useAppStore.getState().lyricsRetryToken).toBe(token + 1)
})

it('says the providers are unavailable once the automatic retry has failed too', async () => {
  vi.useFakeTimers()
  const track = { id: 'flow-exhausted', name: 'test', artist: '', album: '', coverUrl: '', durationMs: 10000 }
  const fetch = vi.fn().mockRejectedValue(new Error('IPC unavailable'))
  vi.stubGlobal('window', { setTimeout, clearTimeout, syllable: { lyrics: { fetch } } })
  useAppStore.setState({ demoMode: false, connected: false, lyrics: null, library: {},
    playback: { track, positionMs: 0, observedAtMs: 0, isPlaying: false } })
  usePlaybackConnection()
  cleanup = effects[2]()
  await vi.advanceTimersByTimeAsync(320)
  // First failure: an empty view, with the one retry pending.
  expect(useAppStore.getState().lyrics?.tracks).toEqual([])
  expect(useAppStore.getState().lyrics?.lookupFailed).toBeUndefined()
  const token = useAppStore.getState().lyricsRetryToken
  await vi.advanceTimersByTimeAsync(12_000)
  expect(useAppStore.getState().lyricsRetryToken).toBe(token + 1)
  // React re-runs the effect for the new token.
  cleanup?.()
  const before = effects.length
  usePlaybackConnection()
  cleanup = effects[before + 2]()
  await vi.advanceTimersByTimeAsync(320)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(useAppStore.getState().lyrics?.lookupFailed).toBe(true)
  // Nothing more is pending, and nothing was saved.
  expect(vi.getTimerCount()).toBe(0)
  expect(useAppStore.getState().library[track.id]).toBeUndefined()
})
