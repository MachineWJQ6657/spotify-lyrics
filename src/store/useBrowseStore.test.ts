import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricsDocument } from '../types'
import type { SongHit } from '../lib/song-reader'
import { resetBrowseStore, useBrowseStore } from './useBrowseStore'
import { useAppStore } from './useAppStore'

const hit = (key: string, name = '群青', extra: Partial<SongHit> = {}): SongHit =>
  ({ key, name, artist: 'YOASOBI', album: 'THE BOOK', durationMs: 248_000, sources: ['netease'], ...extra })
const EN = '[00:10.00]first line of the song\n[00:14.00]second line of the song'
const JA = '[00:10.00]嗚呼、いつもの様に\n[00:14.00]過ぎる日々にあくびが出る'
const answer = (syncedLyrics: string | null, extra: Record<string, unknown> = {}) => ({ syncedLyrics, plainLyrics: null, source: 'LRCLIB · 精确匹配', ...extra })

let findSongs: ReturnType<typeof vi.fn>
let fetchLyrics: ReturnType<typeof vi.fn>
let romanize: ReturnType<typeof vi.fn>
const state = () => useBrowseStore.getState()

beforeEach(() => {
  resetBrowseStore()
  findSongs = vi.fn(async () => ({ hits: [hit('netease-1')], failed: [] }))
  fetchLyrics = vi.fn(async () => answer(EN))
  romanize = vi.fn(async (lines: string[]) => lines.map(() => 'romaji'))
  vi.stubGlobal('window', { syllable: { lyrics: { findSongs, fetch: fetchLyrics, romanize } } })
})
afterEach(() => vi.unstubAllGlobals())

describe('searching for a song', () => {
  it('asks with the trimmed text and shows the hits', async () => {
    state().setQuery('  群青  ')
    await state().search()
    expect(findSongs).toHaveBeenCalledWith('群青')
    expect(state()).toMatchObject({ searchedQuery: '群青', searching: false, searchError: '' })
    expect(state().hits.map(item => item.key)).toEqual(['netease-1'])
  })

  it('does not search for nothing, and an emptied box clears the results', async () => {
    state().setQuery('   ')
    await state().search()
    expect(findSongs).not.toHaveBeenCalled()
    state().setQuery('群青')
    await state().search()
    state().setQuery('')
    expect(state()).toMatchObject({ hits: [], searchedQuery: '' })
  })

  it('keeps only the newest search when answers arrive out of order', async () => {
    let releaseFirst: (value: unknown) => void = () => {}
    findSongs.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve }))
    findSongs.mockImplementationOnce(async () => ({ hits: [hit('netease-2', '怪物')], failed: [] }))
    state().setQuery('群青')
    const first = state().search()
    state().setQuery('怪物')
    await state().search()
    releaseFirst({ hits: [hit('netease-1')], failed: [] })
    await first
    expect(state().hits.map(item => item.name)).toEqual(['怪物'])
    expect(state().searchedQuery).toBe('怪物')
  })

  it('reports a failed search without leaving the spinner on', async () => {
    findSongs.mockRejectedValueOnce(new Error('down'))
    state().setQuery('群青')
    await state().search()
    expect(state().searching).toBe(false)
    expect(state().searchError).not.toBe('')
  })
})

describe('opening a found song', () => {
  it('looks the song up with its own metadata and shows the lyrics', async () => {
    await state().openHit(hit('netease-1'))
    expect(fetchLyrics.mock.calls[0][0]).toMatchObject({ id: 'browse:netease-1', name: '群青', artist: 'YOASOBI', durationMs: 248_000 })
    expect(state().reading).toMatchObject({ key: 'netease-1', origin: 'search', status: 'ready' })
    expect(state().reading?.document?.tracks[0].lines).toHaveLength(2)
  })

  it('adds readings to a Japanese song', async () => {
    fetchLyrics.mockResolvedValueOnce(answer(JA))
    await state().openHit(hit('netease-1'))
    expect(romanize).toHaveBeenCalledTimes(1)
    expect(state().reading?.document?.tracks.map(track => track.kind)).toEqual(['original', 'romanization'])
  })

  it('never writes to the playing song or the library', async () => {
    const before = useAppStore.getState()
    await state().openHit(hit('netease-1'))
    expect(useAppStore.getState().lyrics).toBe(before.lyrics)
    expect(useAppStore.getState().library).toBe(before.library)
  })

  it('says so when nobody has the lyrics, and when the sources did not answer', async () => {
    fetchLyrics.mockResolvedValueOnce(answer(null))
    await state().openHit(hit('netease-1'))
    expect(state().reading).toMatchObject({ status: 'missing', document: null })
    fetchLyrics.mockResolvedValueOnce(answer(null, { transient: true }))
    await state().openHit(hit('netease-2'))
    expect(state().reading).toMatchObject({ status: 'failed', document: null })
  })

  it("falls back to the entry's own lyrics when the lookup throws", async () => {
    fetchLyrics.mockRejectedValueOnce(new Error('ipc'))
    await state().openHit(hit('lrclib-7', 'Song', { sources: ['lrclib'], syncedLyrics: EN }))
    expect(state().reading).toMatchObject({ status: 'ready' })
    expect(state().reading?.document?.tracks[0].source).toBe('LRCLIB')
  })

  it('opens a song read before without asking again, unless retried', async () => {
    await state().openHit(hit('netease-1'))
    state().close()
    await state().openHit(hit('netease-1'))
    expect(fetchLyrics).toHaveBeenCalledTimes(1)
    await state().openHit(hit('netease-1'), true)
    expect(fetchLyrics).toHaveBeenCalledTimes(2)
    // Never bypassCache: that would also drop a playing song's provider results under the same key.
    expect(fetchLyrics.mock.calls[1]).toHaveLength(1)
  })

  it('still shows readings when the analyzer fails', async () => {
    fetchLyrics.mockResolvedValueOnce(answer(JA))
    romanize.mockRejectedValueOnce(new Error('worker'))
    await state().openHit(hit('netease-1'))
    expect(state().reading?.document?.tracks.map(track => track.kind)).toEqual(['original', 'romanization'])
  })

  it('does not remember an unfinished answer', async () => {
    fetchLyrics.mockResolvedValueOnce(answer(EN, { transient: true }))
    await state().openHit(hit('netease-1'))
    expect(state().reading?.status).toBe('ready')
    state().close()
    await state().openHit(hit('netease-1'))
    expect(fetchLyrics).toHaveBeenCalledTimes(2)
  })

  it('shows the song opened last when an earlier lookup finishes later', async () => {
    let releaseFirst: (value: unknown) => void = () => {}
    fetchLyrics.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve }))
    const first = state().openHit(hit('netease-1'))
    await state().openHit(hit('netease-2', '怪物'))
    releaseFirst(answer(EN))
    await first
    expect(state().reading?.key).toBe('netease-2')
  })

  it('going back while a lookup runs leaves the results on screen', async () => {
    let release: (value: unknown) => void = () => {}
    fetchLyrics.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = state().openHit(hit('netease-1'))
    state().close()
    release(answer(EN))
    await pending
    expect(state().reading).toBeNull()
  })
})

describe('reading a song of the library', () => {
  it('opens the saved document as it is', () => {
    const document: LyricsDocument = { trackId: 'saved-1', tracks: [{ id: 'saved-1-original', language: 'en', label: 'English', kind: 'original', source: 'LRCLIB', lines: [{ startMs: 1000, text: 'hello' }] }] }
    state().openSaved(document)
    expect(state().reading).toEqual({ key: 'saved:saved-1', origin: 'library', status: 'ready', document })
    expect(fetchLyrics).not.toHaveBeenCalled()
  })
})
