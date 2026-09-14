import { describe, expect, it, vi } from 'vitest'
import { recordingEdition, repairRepeatedWords } from './lyrics-provider'
import { alignSupplementalTimeline, cleanTrackTitle, durationPlausibleForPlayback, fetchLyrics, fetchWithTimeout, isSpotifySyncedLyricsType, isTimedLyrics, lyricsCacheKey, mergeProviderResults, mergeProviderSet, parseTimedRows, primaryArtist, repairBoundedGaps, spotifyLinesToLrc, splitEmbeddedTranslation, stripTimedTrackMetadata, timedLyricsStats, weightedScore, type LyricsResult } from './lyrics-provider'

const timed: LyricsResult = {
  syncedLyrics: '[00:01.00]line', plainLyrics: 'line', source: 'timed', confidence: 92,
  additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: '[00:01.00]行', source: 'translation' }]
}

describe('recording edition identity', () => {
  it('does not prefer contradictory duration metadata for an identical full timeline', () => {
    const syncedLyrics = Array.from({ length: 26 }, (_, index) => `[${String(Math.floor(index * 10 / 60)).padStart(2, '0')}:${String(index * 10 % 60).padStart(2, '0')}.00]verse number ${index}`).join('\n')
    const accurate: LyricsResult = { syncedLyrics, plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 256000 }
    const contradictory = { ...accurate, matchedDurationMs: 230000 }
    for (const results of [[contradictory, accurate], [accurate, contradictory]]) {
      const selected = mergeProviderSet(results, 220410)
      expect(selected?.matchedDurationMs).toBe(256000)
      expect(selected?.syncedLyrics).toBe(syncedLyrics)
    }
  })
  it('requires independent release evidence for mixed-script artist localization', () => {
    const query = { track: 'Blue Day', artist: 'Example鬍子男Band', album: 'Blue Day', durationMs: 237836 }
    const score = (artist: string, duration = 237837, album = 'Blue Day') => weightedScore('Blue Day', artist, duration, query, true, album)
    expect(score('Example髭男Band')).toBeGreaterThan(score('Unrelated髭男Band'))
    expect(score('Example髭男Band')).toBeGreaterThan(score('Example髭男Band', 247837))
    expect(score('Example髭男Band')).toBeGreaterThan(score('Example髭男Band', 237837, 'Another Album'))
    expect(score('Example別Band')).toBeLessThan(score('Example髭男Band'))
  })

  it('removes provider-native headers and early short-form credits, retaining real lyric phrases', () => {
    const cleaned = stripTimedTrackMetadata('[00:00.10]Same Blue - Official髭男dism\n[00:01.00]词：Composer\n[00:02.00]曲：Composer\n[00:10.00]曲がり角で待っている\n[00:20.00]Same Blue',
      { name: 'Same Blue', artist: 'Official髭男dism' })
    expect(cleaned).not.toContain('Official髭男dism')
    expect(cleaned).not.toContain('Composer')
    expect(cleaned).toContain('曲がり角で待っている')
    expect(cleaned).toContain('[00:20.00]Same Blue')
  })

  it('rejects edition mismatches even when title, artist and duration match', () => {
    const query = { track: 'Same Blue', artist: 'Artist', album: 'Same Blue', durationMs: 237836 }
    for (const edition of ['Live at Stadium 2025', 'Instrumental', 'Acoustic', 'Remix', '现场版']) {
      expect(weightedScore(`Same Blue (${edition})`, 'Artist', 237836, query, true)).toBe(0)
    }
    expect(weightedScore('Same Blue (Live)', 'Artist', 237836, { ...query, track: 'Same Blue (Live)' }, true)).toBeGreaterThan(70)
  })

  it('does not confuse a title word with an edition descriptor', () => {
    expect(recordingEdition('Live Forever')).toBe('unspecified')
    expect(recordingEdition('Same Blue - Live')).toBe('live')
    expect(recordingEdition('Same Blue (Live at Stadium 2025) - Artist')).toBe('live')
  })
})

describe('conservative repeated-word repair', () => {
  const lines = Array.from({ length: 12 }, (_, index) =>
    `[${String(Math.floor(index / 6)).padStart(2, '0')}:${String(index % 6 * 10).padStart(2, '0')}.00]shared surrounding sentence with unique anchor number ${index}`)
  lines[2] = '[00:20.00]まだないんだよね'
  lines[8] = '[01:20.00]会いたくなるよね'
  const base: LyricsResult = { source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 120000,
    syncedLyrics: lines.join('\n'), plainLyrics: null }
  const reference: LyricsResult = { ...base, source: '网易云音乐', confidence: 80,
    syncedLyrics: base.syncedLyrics!.replace('まだない', 'まだないないない').replace('会いたく', '会い会い会いたく') }

  it('restores independently corroborated repetitions while keeping every base timestamp', () => {
    const result = repairRepeatedWords(base, [reference])
    expect(result.syncedLyrics).toContain('まだないないない')
    expect(result.syncedLyrics).toContain('会い会い会いたく')
    expect(parseTimedRows(result.syncedLyrics).map(row => row.timeMs)).toEqual(parseTimedRows(base.syncedLyrics).map(row => row.timeMs))
    expect(base.syncedLyrics).not.toContain('ないないない')
  })

  it('leaves lone, shifted, low-identity, different-edit and official-source disagreements untouched', () => {
    const lone = { ...reference, syncedLyrics: reference.syncedLyrics!.replace('会い会い会いたく', '会いたく') }
    for (const candidate of [lone, { ...reference, confidence: 79 }, { ...reference, matchedDurationMs: 125000 },
      { ...reference, syncedLyrics: reference.syncedLyrics!.replaceAll('.00]', '.90]') }]) {
      expect(repairRepeatedWords(base, [candidate])).toBe(base)
    }
    const official = { ...base, source: 'Spotify' }
    expect(repairRepeatedWords(official, [reference])).toBe(official)
  })

  it('preserves metadata and instrumental clearing rows during a text repair', () => {
    const withClearing = { ...base, syncedLyrics: `[offset:0]\n${base.syncedLyrics}\n[01:59.00]` }
    const result = repairRepeatedWords(withClearing, [reference])
    expect(result.syncedLyrics).toContain('ないないない')
    expect(result.syncedLyrics).toContain('[offset:0]')
    expect(result.syncedLyrics).toContain('[01:59.00]')
  })

  it('rejects conflicting expansion counts and ordinary added phrases', () => {
    const conflicting = { ...reference, syncedLyrics: reference.syncedLyrics!.replace('ないないない', 'ないないないない').replace('会い会い会い', '会い会い会い会い') }
    expect(repairRepeatedWords(base, [reference, conflicting])).toBe(base)
    const rewrite = { ...reference, syncedLyrics: base.syncedLyrics!.replace('まだない', 'まだきっとない').replace('会いたく', 'また会いたく') }
    expect(repairRepeatedWords(base, [rewrite])).toBe(base)
  })
})

describe('lyrics provider request budget', () => {
  it('rejects an exact-get studio response for an explicitly live request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/api/get')) return new Response(JSON.stringify({ trackName: 'Version Test', artistName: 'Artist', albumName: 'Studio', duration: 100,
        syncedLyrics: '[00:05.00]wrong recording\n[00:40.00]second phrase\n[01:30.00]ending' }))
      if (url.includes('lrclib.net')) return new Response('[]')
      if (url.includes('music.163.com')) return new Response('{"result":{"songs":[]}}')
      if (url.includes('songsearch.kugou.com')) return new Response('{"data":{"lists":[]}}')
      throw new Error('unexpected test URL')
    }))
    try {
      const result = await fetchLyrics({ id: 'qa-explicit-live-identity', name: 'Version Test (Live)', artist: 'Artist', album: 'Live at Test Hall', durationMs: 100000, coverUrl: '' }, null, true)
      expect(result?.syncedLyrics ?? null).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps same-title recording editions in separate provider cache keys', () => {
    const base = { id: 'song', name: 'Same Song', artist: 'Artist', album: 'Studio', coverUrl: '', durationMs: 200_400 }
    expect(lyricsCacheKey(base, false)).not.toBe(lyricsCacheKey({ ...base, album: 'Live' }, false))
    expect(lyricsCacheKey(base, true)).toContain('spotify-oauth')
  })

  it('aborts an in-flight provider request without starting another retry', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const controller = new AbortController()
      const request = fetchWithTimeout('https://provider.invalid/lyrics', undefined, 1000, 2, controller.signal)
      setTimeout(() => controller.abort(), 10)
      await expect(request).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('displays but does not cache a result that missed a temporarily failed provider', async () => {
    let failNetease = true
    const record = {
      id: 990_041, trackName: 'Transient Cache Song', artistName: 'Transient Artist', albumName: 'Transient Album',
      duration: 100, instrumental: false,
      syncedLyrics: '[00:05.00]first complete lyric\n[00:35.00]second complete lyric\n[01:10.00]third complete lyric\n[01:35.00]final complete lyric',
      plainLyrics: 'first complete lyric\nsecond complete lyric\nthird complete lyric\nfinal complete lyric'
    }
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('lrclib.net/api/get')) return new Response(JSON.stringify(record), { status: 200 })
      if (url.includes('lrclib.net/api/search')) return new Response('[]', { status: 200 })
      if (url.includes('music.163.com')) {
        if (failNetease) return new Response('', { status: 503 })
        return new Response(JSON.stringify({ result: { songs: [] } }), { status: 200 })
      }
      if (url.includes('songsearch.kugou.com')) return new Response(JSON.stringify({ data: { lists: [] } }), { status: 200 })
      throw new Error(`unexpected provider URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const track = {
        id: 'local-transient-cache-test', name: record.trackName, artist: record.artistName,
        album: record.albumName, coverUrl: '', durationMs: 100_000
      }
      const partial = await fetchLyrics(track)
      expect(partial?.syncedLyrics).toContain('final complete lyric')
      expect(partial?.transient).toBe(true)
      const callsAfterPartial = fetchMock.mock.calls.length

      failNetease = false
      const recovered = await fetchLyrics(track)
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterPartial)
      expect(recovered?.transient).toBeUndefined()
      const callsAfterRecovery = fetchMock.mock.calls.length

      expect((await fetchLyrics(track))?.syncedLyrics).toContain('final complete lyric')
      expect(fetchMock.mock.calls.length).toBe(callsAfterRecovery)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not let one empty search response hide a failed sibling query', async () => {
    const record = {
      id: 990_042, trackName: 'Mixed Provider Song', artistName: 'Mixed Provider Artist', albumName: 'Mixed Provider Album',
      duration: 100, instrumental: false,
      syncedLyrics: '[00:05.00]first lyric\n[00:35.00]second lyric\n[01:10.00]third lyric\n[01:35.00]last lyric',
      plainLyrics: 'first lyric\nsecond lyric\nthird lyric\nlast lyric'
    }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('lrclib.net/api/get')) return new Response(JSON.stringify(record), { status: 200 })
      if (url.includes('lrclib.net/api/search')) return new Response('[]', { status: 200 })
      if (url.includes('music.163.com')) {
        const search = new URLSearchParams(String(init?.body ?? '')).get('s')
        return search === record.trackName
          ? new Response(JSON.stringify({ result: { songs: [] } }), { status: 200 })
          : new Response('', { status: 503 })
      }
      if (url.includes('songsearch.kugou.com')) return new Response(JSON.stringify({ data: { lists: [] } }), { status: 200 })
      throw new Error(`unexpected provider URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await fetchLyrics({
        id: 'local-mixed-provider-failure', name: record.trackName, artist: record.artistName,
        album: record.albumName, coverUrl: '', durationMs: 100_000
      })
      expect(result?.syncedLyrics).toContain('last lyric')
      expect(result?.transient).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('lets an explicit retry bypass a stable cached provider match', async () => {
    let version = 'first cached lyric'
    const record = {
      id: 990_043, trackName: 'Forced Refresh Song', artistName: 'Forced Refresh Artist', albumName: 'Forced Refresh Album',
      duration: 100, instrumental: false,
      get syncedLyrics() { return `[00:05.00]${version}\n[00:35.00]middle lyric\n[01:10.00]later lyric\n[01:35.00]final lyric` },
      plainLyrics: 'lyric'
    }
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('lrclib.net/api/get')) return new Response(JSON.stringify(record), { status: 200 })
      if (url.includes('lrclib.net/api/search')) return new Response('[]', { status: 200 })
      if (url.includes('music.163.com')) return new Response(JSON.stringify({ result: { songs: [] } }), { status: 200 })
      if (url.includes('songsearch.kugou.com')) return new Response(JSON.stringify({ data: { lists: [] } }), { status: 200 })
      throw new Error(`unexpected provider URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const track = {
        id: 'local-force-refresh-test', name: record.trackName, artist: record.artistName,
        album: record.albumName, coverUrl: '', durationMs: 100_000
      }
      expect((await fetchLyrics(track))?.syncedLyrics).toContain('first cached lyric')
      const callsAfterFirst = fetchMock.mock.calls.length
      version = 'second refreshed lyric'
      expect((await fetchLyrics(track))?.syncedLyrics).toContain('first cached lyric')
      expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
      expect((await fetchLyrics(track, null, true))?.syncedLyrics).toContain('second refreshed lyric')
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst)
      const callsAfterRefresh = fetchMock.mock.calls.length
      expect((await fetchLyrics(track))?.syncedLyrics).toContain('second refreshed lyric')
      expect(fetchMock.mock.calls.length).toBe(callsAfterRefresh)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('lyrics provider merging', () => {
  it('splits duplicate-timestamp Japanese and Chinese rows into aligned tracks', () => {
    const mixed: LyricsResult = {
      syncedLyrics: '[00:01.00]夏の匂いがした\n[00:01.00]闻到了夏天的气息\n[00:04.00]君に会いたい\n[00:04.00]我想见你\n[00:08.00]感情\n[00:08.00]这份感情',
      plainLyrics: null, source: 'mixed', confidence: 90
    }
    const split = splitEmbeddedTranslation(mixed)
    expect(split.syncedLyrics).toContain('[00:01.00]夏の匂いがした')
    expect(split.syncedLyrics).not.toContain('闻到了夏天的气息')
    expect(split.syncedLyrics).toContain('[00:08.00]感情')
    expect(split.additionalTracks?.[0].syncedLyrics).toContain('[00:08.00]这份感情')
  })

  it('does not split ordinary monolingual Chinese lyrics', () => {
    const chinese: LyricsResult = { syncedLyrics: '[00:01.00]夏天来了\n[00:04.00]我想见你', plainLyrics: null, source: 'zh', confidence: 90 }
    expect(splitEmbeddedTranslation(chinese)).toEqual(chinese)
  })

  it('aligns bilingual rows whose provider timestamps differ slightly', () => {
    const mixed: LyricsResult = {
      syncedLyrics: '[00:01.00]夏の匂いがした\n[00:01.08]闻到了夏天的气息\n[00:04.00]君に会いたい\n[00:04.12]我想见你',
      plainLyrics: null, source: 'rounded bilingual', confidence: 90
    }
    const split = splitEmbeddedTranslation(mixed)
    expect(split.syncedLyrics).not.toContain('闻到了夏天的气息')
    expect(split.additionalTracks?.[0].syncedLyrics).toBe('[00:01.00]闻到了夏天的气息\n[00:04.00]我想见你')
  })

  it('splits a repeated bilingual layout with a stable 400ms translation offset', () => {
    const mixed: LyricsResult = {
      syncedLyrics: '[00:01.00]夏の匂いがした\n[00:01.40]闻到了夏天的气息\n[00:05.00]君に会いたい\n[00:05.40]我想见你\n[00:09.00]空を見上げる\n[00:09.40]抬头仰望天空',
      plainLyrics: null, source: 'offset bilingual', confidence: 90
    }
    const split = splitEmbeddedTranslation(mixed)
    expect(split.syncedLyrics).not.toContain('闻到了夏天的气息')
    expect(split.additionalTracks?.[0].syncedLyrics).toContain('[00:09.00]抬头仰望天空')
  })

  it('removes interleaved Chinese rows identified by a dedicated translation track', () => {
    const mixed: LyricsResult = {
      syncedLyrics: [
        '[00:01.00]言って',
        '[00:04.20]说吧',
        '[00:10.00]君に会いたい',
        '[00:13.75]我想见你',
        '[00:20.00]空を見上げる',
        '[00:25.30]抬头仰望天空',
        '[00:31.00]感情'
      ].join('\n'),
      plainLyrics: null,
      source: 'interleaved provider',
      confidence: 90,
      additionalTracks: [{
        language: 'zh-Hans', label: '中文', kind: 'translation', source: 'dedicated translation',
        syncedLyrics: '[00:04.21]说出来吧\n[00:13.74]想与你相见\n[00:25.31]仰望这片天空'
      }]
    }
    const split = splitEmbeddedTranslation(mixed)
    expect(split.syncedLyrics).toBe('[00:01.00]言って\n[00:10.00]君に会いたい\n[00:20.00]空を見上げる\n[00:31.00]感情')
    expect(split.additionalTracks).toEqual(mixed.additionalTracks)
  })

  it('splits a repeated variable-offset Japanese and Chinese layout without tlyric', () => {
    const mixed: LyricsResult = {
      syncedLyrics: [
        '[00:01.00]言って', '[00:04.20]说吧',
        '[00:10.00]君に会いたい', '[00:12.10]我想见你',
        '[00:20.00]空を見上げる', '[00:25.30]抬头仰望天空',
        '[00:31.00]声を聞かせて', '[00:32.40]让我听见你的声音',
        '[00:40.00]感情'
      ].join('\n'),
      plainLyrics: null, source: 'interleaved only', confidence: 90
    }
    const split = splitEmbeddedTranslation(mixed)
    expect(split.syncedLyrics).toBe('[00:01.00]言って\n[00:10.00]君に会いたい\n[00:20.00]空を見上げる\n[00:31.00]声を聞かせて\n[00:40.00]感情')
    expect(split.additionalTracks?.[0].syncedLyrics).toBe('[00:01.00]说吧\n[00:10.00]我想见你\n[00:20.00]抬头仰望天空\n[00:31.00]让我听见你的声音')
  })

  it('does not infer a bilingual layout from only one 400ms pair', () => {
    const mixed: LyricsResult = {
      syncedLyrics: '[00:01.00]夏の匂いがした\n[00:01.40]闻到了夏天的气息\n[00:05.00]君に会いたい',
      plainLyrics: null, source: 'one offset pair', confidence: 90
    }
    expect(splitEmbeddedTranslation(mixed)).toEqual(mixed)
  })

  it('splits inline bilingual rows separated by a single spaced slash', () => {
    const mixed: LyricsResult = {
      syncedLyrics: '[00:01.00]夏の匂いがした / 闻到了夏天的气息\n[00:04.00]君に会いたい / 我想见你',
      plainLyrics: null, source: 'inline bilingual', confidence: 90
    }
    const split = splitEmbeddedTranslation(mixed)
    expect(split.syncedLyrics).toBe('[00:01.00]夏の匂いがした\n[00:04.00]君に会いたい')
    expect(split.additionalTracks?.[0].syncedLyrics).toContain('[00:04.00]我想见你')
  })

  it('keeps an embedded romaji row as its own synchronized track', () => {
    const mixed: LyricsResult = {
      syncedLyrics: '[00:01.00]夏の匂いがした\n[00:01.00]natsu no nioi ga shita\n[00:01.00]闻到了夏天的气息\n[00:04.00]君に会いたい\n[00:04.00]kimi ni aitai\n[00:04.00]我想见你',
      plainLyrics: null, source: 'trilingual', confidence: 90
    }
    const split = splitEmbeddedTranslation(mixed)
    expect(split.syncedLyrics).not.toContain('natsu no nioi')
    expect(split.additionalTracks?.find(track => track.language === 'romaji')?.syncedLyrics).toContain('[00:04.00]kimi ni aitai')
    expect(split.additionalTracks?.find(track => track.language === 'zh-Hans')?.syncedLyrics).toContain('[00:04.00]我想见你')
  })

  it('adopts untimed Chinese rows placed directly below timed Japanese rows', () => {
    const mixed: LyricsResult = {
      syncedLyrics: '[00:01.00]夏の匂いがした\n闻到了夏天的气息\n[00:04.00]君に会いたい\n我想见你',
      plainLyrics: null, source: 'untimed translation', confidence: 90
    }
    const split = splitEmbeddedTranslation(mixed)
    expect(split.syncedLyrics).toBe('[00:01.00]夏の匂いがした\n[00:04.00]君に会いたい')
    expect(split.additionalTracks?.[0].syncedLyrics).toBe('[00:01.00]闻到了夏天的气息\n[00:04.00]我想见你')
  })

  it('prefers a timed fallback over an exact result without timestamps', () => {
    const exact = { syncedLyrics: null, plainLyrics: 'line', source: 'exact', confidence: 100 }
    expect(mergeProviderResults(exact, timed)?.source).toBe('timed')
  })

  it('does not report an untimed-only lookup as synchronized lyrics', () => {
    const plainOnly: LyricsResult = {
      syncedLyrics: null,
      plainLyrics: 'first line\nsecond line',
      source: 'LRCLIB · 精确匹配',
      confidence: 100
    }
    expect(mergeProviderSet([plainOnly], 120_000)).toBeNull()
  })

  it('rejects an unrelated low-confidence timed search result when exact plain lyrics disagree', () => {
    const plainOnly: LyricsResult = {
      syncedLyrics: null,
      plainLyrics: '慌しく過ぎる朝に重い瞼に少し疲れ気味の君に甘いミルク入りのコーヒーを始まりの朝は君の声で眠い目を擦って',
      source: 'LRCLIB · 精确匹配',
      confidence: 100
    }
    const wrongTimed: LyricsResult = {
      syncedLyrics: '[00:10.00]Hey what do you mean\n[00:20.00]Better make up your mind\n[00:30.00]What do you mean',
      plainLyrics: null,
      source: '网易云音乐 · 搜索匹配 65%',
      confidence: 65
    }
    expect(mergeProviderSet([plainOnly, wrongTimed], 241_500)).toBeNull()
  })

  it('keeps supplemental language tracks with a timed primary', () => {
    const primary = { syncedLyrics: '[00:01.00]line', plainLyrics: null, source: 'primary', confidence: 100 }
    const result = mergeProviderResults(primary, timed)
    expect(result?.source).toBe('primary')
    expect(result?.additionalTracks?.[0].language).toBe('zh-Hans')
  })

  it('does not attach a same-duration wrong song translation by timestamp coincidence', () => {
    const primary: LyricsResult = {
      syncedLyrics: '[00:01.00]正しい歌詞一\n[00:12.00]正しい歌詞二\n[00:24.00]正しい歌詞三\n[00:36.00]正しい歌詞四',
      plainLyrics: null, source: 'exact', confidence: 100
    }
    const wrong: LyricsResult = {
      syncedLyrics: '[00:01.00]unrelated one\n[00:12.00]unrelated two\n[00:24.00]unrelated three\n[00:36.00]unrelated four',
      plainLyrics: null, source: 'wrong', confidence: 80,
      additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: '[00:01.00]错误翻译一\n[00:12.00]错误翻译二\n[00:24.00]错误翻译三\n[00:36.00]错误翻译四', source: 'wrong translation' }]
    }
    expect(mergeProviderSet([primary, wrong], 45_000)?.additionalTracks).toEqual([])
  })

  it('keeps translations with identical sung text and clocks despite different trailing durations', () => {
    const original = '[00:01.00]朝の光が窓を照らしている\n[00:15.00]遠い海まであなたと歩こう\n[00:30.00]風に揺れている花を見つめて\n[00:45.00]夜の空にも明日を探している'
    const base: LyricsResult = { syncedLyrics: original, plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 50_000 }
    const owner: LyricsResult = { syncedLyrics: original, plainLyrics: null, source: '网易云音乐', confidence: 97, matchedDurationMs: 80_000,
      additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', source: '网易云音乐 · 翻译', syncedLyrics: '[00:01.00]晨光照窗\n[00:15.00]一起走向海边\n[00:30.00]凝望风中的花\n[00:45.00]夜空寻找明天' }] }
    const result = mergeProviderSet([base, owner], 50_000)
    expect(result?.source).toBe(base.source)
    expect(result?.additionalTracks?.find(track => track.language === 'zh-Hans')?.syncedLyrics).toContain('晨光照窗')
    const shifted = { ...owner, syncedLyrics: original.replace('[00:01.00]', '[00:09.00]').replace('[00:15.00]', '[00:23.00]').replace('[00:30.00]', '[00:38.00]').replace('[00:45.00]', '[00:53.00]') }
    expect(mergeProviderSet([base, shifted], 50_000)?.additionalTracks).toEqual([])
  })

  it('does not promote a dense Han-only translation over a plausible kana original', () => {
    const japanese: LyricsResult = {
      syncedLyrics: '[00:01.00]君に会いたい\n[00:10.00]空を見上げる\n[00:20.00]声を聞かせて\n[00:30.00]明日へ歩こう',
      plainLyrics: null, source: 'Japanese community original', confidence: 82
    }
    const chinese: LyricsResult = {
      syncedLyrics: Array.from({ length: 12 }, (_, index) => `[00:${String(index * 3 + 1).padStart(2, '0')}.00]这是中文翻译${index}`).join('\n'),
      plainLyrics: null, source: 'dense translated LRC', confidence: 100
    }
    expect(mergeProviderSet([chinese, japanese], 40_000, 'ja')?.source).toBe('Japanese community original')
  })

  it('retimes a provider translation to the selected original timeline', () => {
    const provider: LyricsResult = {
      syncedLyrics: '[00:03.00]first lyric\n[00:07.00]second lyric\n[00:11.00]third lyric',
      plainLyrics: null, source: '网易云音乐', confidence: 90,
      additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: '[00:03.00]第一行\n[00:07.00]第二行\n[00:11.00]第三行', source: '网易云音乐 · 翻译' }]
    }
    const spotify: LyricsResult = {
      syncedLyrics: '[00:01.00]first lyric\n[00:05.00]second lyric\n[00:09.00]third lyric',
      plainLyrics: null, source: 'Spotify · Musixmatch', confidence: 100
    }
    const aligned = alignSupplementalTimeline(provider.additionalTracks![0], provider, spotify)
    expect(aligned.syncedLyrics).toBe('[00:01.00]第一行\n[00:05.00]第二行\n[00:09.00]第三行')
    expect(aligned.source).toContain('对齐Spotify时轴')
  })

  it('keeps translation anchors monotonic when a provider has an extra repeated chorus', () => {
    const provider: LyricsResult = {
      syncedLyrics: '[00:03.00]same chorus\n[00:07.00]unique verse one\n[00:11.00]same chorus\n[00:15.00]unique verse two\n[00:19.00]same chorus',
      plainLyrics: null, source: '网易云音乐', confidence: 94,
      additionalTracks: [{
        language: 'zh-Hans', label: '中文', kind: 'translation', source: '网易云音乐 · 翻译',
        syncedLyrics: '[00:03.00]多出的副歌\n[00:07.00]第一段\n[00:11.00]副歌\n[00:15.00]第二段\n[00:19.00]末尾副歌'
      }]
    }
    const base: LyricsResult = {
      syncedLyrics: '[00:01.00]unique verse one\n[00:05.00]same chorus\n[00:09.00]unique verse two\n[00:13.00]same chorus',
      plainLyrics: null, source: 'Spotify · Musixmatch', confidence: 100
    }
    const aligned = alignSupplementalTimeline(provider.additionalTracks![0], provider, base)
    expect(aligned.syncedLyrics).toContain('[00:01.00]第一段')
    expect(aligned.syncedLyrics).toContain('[00:05.00]副歌')
    expect(aligned.syncedLyrics).toContain('[00:09.00]第二段')
    expect(aligned.syncedLyrics).toContain('[00:13.00]末尾副歌')
    expect(aligned.syncedLyrics).not.toContain('多出的副歌')
  })

  it('rejects translations of divergent original rows even between matching anchors', () => {
    const owner: LyricsResult = { syncedLyrics: '[00:01.00]shared opening\n[00:08.00]different bridge\n[00:16.00]shared ending\n[00:22.00]last chorus', plainLyrics: null, source: '网易云音乐', confidence: 90 }
    const base: LyricsResult = { ...owner, syncedLyrics: '[00:03.00]shared opening\n[00:10.00]another bridge\n[00:18.00]shared ending\n[00:24.00]last chorus', source: 'LRCLIB' }
    const translated = { language: 'zh-Hans', label: '中文', kind: 'translation' as const, source: owner.source, syncedLyrics: '[00:01.00]开头\n[00:08.00]不属于主歌词的段落\n[00:16.00]结尾\n[00:22.00]副歌' }
    expect(alignSupplementalTimeline(translated, owner, base).syncedLyrics).toBe('[00:03.00]开头\n[00:18.00]结尾\n[00:24.00]副歌')
  })

  it('preserves delayed translation phrases within a matched owner row', () => {
    const owner: LyricsResult = { syncedLyrics: '[00:01.00]first long sentence\n[00:12.00]second sentence\n[00:20.00]last sentence', plainLyrics: null, source: '网易云音乐', confidence: 90 }
    const base: LyricsResult = { ...owner, syncedLyrics: '[00:03.00]first long sentence\n[00:14.00]second sentence\n[00:22.00]last sentence', source: 'LRCLIB' }
    const translated = { language: 'zh-Hans', label: '中文', kind: 'translation' as const, source: owner.source, syncedLyrics: '[00:01.00]第一句上半\n[00:07.00]第一句下半\n[00:12.00]第二句' }
    expect(alignSupplementalTimeline(translated, owner, base).syncedLyrics).toBe('[00:03.00]第一句上半\n[00:09.00]第一句下半\n[00:14.00]第二句')
  })

  it('preserves split owner phrases when their combined original exactly matches a base row', () => {
    const owner: LyricsResult = { syncedLyrics: '[00:01.00]first longer phrase\n[00:05.00]ending\n[00:12.00]next sentence\n[00:20.00]last sentence', plainLyrics: null, source: '网易云音乐', confidence: 90 }
    const base: LyricsResult = { ...owner, syncedLyrics: '[00:03.00]first longer phrase ending\n[00:14.00]next sentence\n[00:22.00]last sentence', source: 'LRCLIB' }
    const translated = { language: 'zh-Hans', label: '中文', kind: 'translation' as const, source: owner.source, syncedLyrics: '[00:01.00]第一句上半\n[00:05.00]第一句结尾\n[00:12.00]下一句' }
    expect(alignSupplementalTimeline(translated, owner, base).syncedLyrics).toBe('[00:03.00]第一句上半\n[00:07.00]第一句结尾\n[00:14.00]下一句')
  })

  it('maps a merged provider sentence onto proven split base phrases without a majority-sized anchor', () => {
    const owner: LyricsResult = { syncedLyrics: '[00:01.00]first phrase second phrase\n[00:12.00]next sentence\n[00:20.00]last sentence', plainLyrics: null, source: '网易云音乐', confidence: 90 }
    const base: LyricsResult = { ...owner, syncedLyrics: '[00:03.00]first phrase\n[00:07.00]second phrase\n[00:14.00]next sentence\n[00:22.00]last sentence', source: 'LRCLIB' }
    const translated = { language: 'zh-Hans', label: '中文', kind: 'translation' as const, source: owner.source, syncedLyrics: '[00:01.00]第一句完整翻译\n[00:12.00]下一句' }
    expect(alignSupplementalTimeline(translated, owner, base).syncedLyrics).toBe('[00:03.00]第一句完整翻译\n[00:07.00]第一句完整翻译\n[00:14.00]下一句')
    const splitTranslation = { ...translated, syncedLyrics: '[00:01.00]上半译文\n[00:05.00]下半译文\n[00:12.00]下一句' }
    expect(alignSupplementalTimeline(splitTranslation, owner, base).syncedLyrics).toBe('[00:03.00]上半译文\n[00:07.00]下半译文\n[00:14.00]下一句')
  })

  it('does not guess which repeated split chorus owns a translation without surrounding anchors', () => {
    const owner: LyricsResult = { syncedLyrics: '[00:01.00]first phrase second phrase', plainLyrics: null, source: '网易云音乐', confidence: 90 }
    const base: LyricsResult = { ...owner, syncedLyrics: '[00:03.00]first phrase\n[00:07.00]second phrase\n[00:14.00]first phrase\n[00:18.00]second phrase', source: 'LRCLIB' }
    const translated = { language: 'zh-Hans', label: '中文', kind: 'translation' as const, source: owner.source, syncedLyrics: '[00:01.00]不能猜是哪一遍' }
    expect(alignSupplementalTimeline(translated, owner, base).syncedLyrics).toBe('')
  })

  it('prefers NetEase when multiple synchronized Chinese translations exist', () => {
    const primary = {
      syncedLyrics: '[00:01.00]夏の匂い', plainLyrics: null, source: 'LRCLIB', confidence: 95,
      additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation' as const, syncedLyrics: '[00:01.00]社区翻译', source: 'LRCLIB · 内嵌双语拆分' }]
    }
    const netease = {
      syncedLyrics: '[00:01.00]夏の匂い', plainLyrics: null, source: '网易云音乐', confidence: 92,
      additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation' as const, syncedLyrics: '[00:01.00]网易云翻译', source: '网易云音乐 · 翻译' }]
    }
    const result = mergeProviderResults(primary, netease)
    expect(result?.additionalTracks?.find(track => track.language === 'zh-Hans')?.syncedLyrics).toContain('网易云翻译')
  })

  it('does not let lower-identity line fragmentation displace a complete stronger original', () => {
    const strong: LyricsResult = { source: 'LRCLIB · 搜索匹配 95%', confidence: 95, plainLyrics: null, matchedDurationMs: 40000,
      syncedLyrics: '[00:01.00]first phrase ending one\n[00:11.00]second phrase ending two\n[00:21.00]third phrase ending three\n[00:31.00]fourth phrase ending four' }
    const fragmented: LyricsResult = { ...strong, source: '网易云音乐 · 搜索匹配 78%', confidence: 78,
      syncedLyrics: '[00:01.00]first phrase\n[00:06.00]ending one\n[00:11.00]second phrase\n[00:16.00]ending two\n[00:21.00]third phrase\n[00:26.00]ending three\n[00:31.00]fourth phrase\n[00:36.00]ending' }
    expect(mergeProviderSet([strong, fragmented], 40000)?.source).toBe(strong.source)
  })

  it('keeps translations anchored to short sung words instead of merging them into the previous sentence', () => {
    const primary: LyricsResult = { source: 'Spotify · Musixmatch', confidence: 100, plainLyrics: null,
      syncedLyrics: '[00:01.00]君に会いたい\n[00:06.00]ああ\n[00:09.00]ね\n[00:12.00]空を見上げる\n[00:20.00]明日へ歩こう' }
    const translated: LyricsResult = { ...primary, source: '网易云音乐', confidence: 95,
      additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', source: '网易云音乐 · 翻译',
        syncedLyrics: '[00:01.00]想见你\n[00:06.00]啊啊\n[00:09.00]呐\n[00:12.00]仰望天空\n[00:20.00]走向明天' }] }
    const result = mergeProviderSet([primary, translated], 25_000)
    expect(result?.additionalTracks?.find(track => track.language === 'zh-Hans')?.syncedLyrics).toBe(translated.additionalTracks![0].syncedLyrics)
    const denseOriginal = primary.syncedLyrics!.replace('[00:09.00]', '[00:06.50]')
    const denseTranslation = translated.additionalTracks![0].syncedLyrics.replace('[00:09.00]', '[00:06.50]')
    const dense = mergeProviderSet([{ ...primary, syncedLyrics: denseOriginal, additionalTracks: [{ ...translated.additionalTracks![0], syncedLyrics: denseTranslation }] }], 25_000)
    expect(dense?.additionalTracks?.find(track => track.language === 'zh-Hans')?.syncedLyrics).toBe(denseTranslation)
    const rapidOriginal = primary.syncedLyrics!.replace('[00:09.00]', '[00:06.10]')
    const rapidTranslation = translated.additionalTracks![0].syncedLyrics.replace('[00:09.00]', '[00:06.10]')
    const owner = { ...translated, syncedLyrics: rapidOriginal }
    const base = { ...primary, syncedLyrics: rapidOriginal.replace('[00:06.00]', '[00:08.00]').replace('[00:06.10]', '[00:08.50]') }
    expect(alignSupplementalTimeline({ ...translated.additionalTracks![0], syncedLyrics: rapidTranslation }, owner, base).syncedLyrics)
      .toBe(rapidTranslation.replace('[00:06.00]', '[00:08.00]').replace('[00:06.10]', '[00:08.50]'))
  })

  it('chooses the most complete human romanization instead of the first sparse track', () => {
    const original = '[00:01.00]日本語の歌詞一\n[00:06.00]日本語の歌詞二\n[00:11.00]日本語の歌詞三\n[00:16.00]日本語の歌詞四'
    const sparse: LyricsResult = {
      syncedLyrics: original, plainLyrics: null, source: 'LRCLIB', confidence: 96,
      additionalTracks: [{ language: 'romaji', label: 'Romaji', kind: 'romanization', syncedLyrics: '[00:01.00]nihongo ichi', source: 'LRCLIB · 内嵌罗马音' }]
    }
    const complete: LyricsResult = {
      syncedLyrics: original, plainLyrics: null, source: '网易云音乐', confidence: 94,
      additionalTracks: [{ language: 'romaji', label: 'Romaji', kind: 'romanization', syncedLyrics: '[00:01.00]nihongo ichi\n[00:06.00]nihongo ni\n[00:11.00]nihongo san\n[00:16.00]nihongo yon', source: '网易云音乐 · 罗马音' }]
    }
    const romanization = mergeProviderSet([sparse, complete], 22_000, 'ja')?.additionalTracks?.find(track => track.kind === 'romanization')
    expect(romanization?.source).toContain('网易云')
    expect(parseTimedRows(romanization?.syncedLyrics)).toHaveLength(4)
  })

  it('does not mistake plain text stored in syncedLyrics for a timeline', () => {
    const mislabeled = { syncedLyrics: 'line one\nline two', plainLyrics: null, source: 'plain', confidence: 100 }
    expect(isTimedLyrics(mislabeled.syncedLyrics)).toBe(false)
    expect(mergeProviderResults(mislabeled, timed)?.source).toBe('timed')
  })

  it('prefers the provider that covers the complete song over a short exact match', () => {
    const short = { syncedLyrics: '[00:05.00]one\n[00:20.00]two\n[00:40.00]three', plainLyrics: null, source: 'short exact', confidence: 100 }
    const complete = { syncedLyrics: Array.from({ length: 24 }, (_, index) => `[${String(Math.floor(index * 8 / 60)).padStart(2, '0')}:${String(index * 8 % 60).padStart(2, '0')}.00]line ${index}`).join('\n'), plainLyrics: null, source: 'complete', confidence: 82 }
    expect(mergeProviderResults(short, complete, 200_000)?.source).toBe('complete')
  })

  it('never stretches lyric timestamps to fit a shortened Spotify Mix transport duration', () => {
    const originalTimeline = [
      '[00:10.00]first verse',
      '[00:55.00]second verse',
      '[01:40.00]last chorus',
      '[03:20.10]outro'
    ].join('\n')
    const release: LyricsResult = {
      syncedLyrics: originalTimeline,
      plainLyrics: null,
      source: 'community release timeline',
      confidence: 95,
      matchedDurationMs: 203_976
    }
    const result = mergeProviderSet([release], 192_053)
    expect(result?.syncedLyrics).toBe(originalTimeline)
    expect(parseTimedRows(result?.syncedLyrics).map(row => row.timeMs)).toEqual([10_000, 55_000, 100_000, 200_100])
  })

  it('does not let a merely similar-duration song beat a healthy exact identity', () => {
    const exact: LyricsResult = {
      syncedLyrics: Array.from({ length: 10 }, (_, index) => `[00:${String(index * 10).padStart(2, '0')}.00]anthem exact ${index}`).join('\n'),
      plainLyrics: null, source: 'exact identity', confidence: 99, matchedDurationMs: 100_000
    }
    const wrong: LyricsResult = {
      syncedLyrics: Array.from({ length: 30 }, (_, index) => `[00:${String(index * 3).padStart(2, '0')}.00]different song ${index}`).join('\n'),
      plainLyrics: null, source: 'same artist wrong song', confidence: 91, matchedDurationMs: 100_000
    }
    expect(mergeProviderSet([wrong, exact], 100_000)?.source).toBe('exact identity')
  })

  it('rejects an impossible recording duration even when search metadata confidence is high', () => {
    const wrongEdit: LyricsResult = {
      syncedLyrics: Array.from({ length: 19 }, (_, index) => `[00:${String(index * 3).padStart(2, '0')}.00]wrong extended edit ${index}`).join('\n'),
      plainLyrics: null, source: '网易云音乐 · 搜索匹配 92%', confidence: 92, matchedDurationMs: 376_693
    }
    expect(durationPlausibleForPlayback(wrongEdit, 207_744)).toBe(false)
    expect(mergeProviderSet([wrongEdit], 207_744)).toBeNull()
    expect(durationPlausibleForPlayback({ ...wrongEdit, matchedDurationMs: 190_000 }, 207_744)).toBe(true)
  })

  it('uses cross-provider anchors to reject a two-line bounded hole invisible to gap heuristics', () => {
    const rows = Array.from({ length: 10 }, (_, index) => `[${index ? `0${Math.floor(index / 6)}` : '00'}:${String(index * 10 % 60).padStart(2, '0')}.00]shared lyric ${index}`)
    const complete: LyricsResult = { syncedLyrics: rows.join('\n'), plainLyrics: null, source: 'complete anchors', confidence: 84, matchedDurationMs: 100_000 }
    const truncated: LyricsResult = { syncedLyrics: rows.filter((_, index) => index !== 4 && index !== 5).join('\n'), plainLyrics: null, source: 'truncated high confidence', confidence: 100, matchedDurationMs: 100_000 }
    expect(timedLyricsStats(truncated.syncedLyrics, 100_000).excessiveGapMs).toBe(0)
    expect(mergeProviderSet([truncated, complete], 100_000)?.source).toBe('complete anchors')
  })

  it('rejects an otherwise healthy exact match that omits a proven opening verse', () => {
    const shared = Array.from({ length: 6 }, (_, index) => `[00:${String(20 + index * 10).padStart(2, '0')}.00]shared opening anchor ${index}`)
    const complete: LyricsResult = {
      syncedLyrics: ['[00:00.00]missing opening line one', '[00:10.00]missing opening line two', ...shared].join('\n'),
      plainLyrics: null, source: 'complete opening', confidence: 84, matchedDurationMs: 80_000
    }
    const truncated: LyricsResult = {
      syncedLyrics: shared.join('\n'), plainLyrics: null, source: 'exact missing opening', confidence: 100, matchedDurationMs: 80_000
    }
    expect(mergeProviderSet([truncated, complete], 80_000)?.source).toBe('complete opening')
  })

  it('rejects an otherwise healthy exact match that omits a proven closing verse', () => {
    const shared = Array.from({ length: 6 }, (_, index) => `[00:${String(index * 8).padStart(2, '0')}.00]shared closing anchor ${index}`)
    const complete: LyricsResult = {
      syncedLyrics: [...shared, '[00:50.00]missing closing line one', '[01:00.00]missing closing line two'].join('\n'),
      plainLyrics: null, source: 'complete closing', confidence: 84, matchedDurationMs: 70_000
    }
    const truncated: LyricsResult = {
      syncedLyrics: shared.join('\n'), plainLyrics: null, source: 'exact missing closing', confidence: 100, matchedDurationMs: 70_000
    }
    expect(mergeProviderSet([truncated, complete], 70_000)?.source).toBe('complete closing')
  })

  it('keeps short repeated outro refrains instead of truncating them from an exact timeline', () => {
    const shared = Array.from({ length: 8 }, (_, index) => `[00:${String(10 + index * 10).padStart(2, '0')}.00]共通の歌詞${index}`)
    const exact: LyricsResult = {
      syncedLyrics: [...shared, '[01:30.00]やれるわ'].join('\n'),
      plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 110_000
    }
    const complete: LyricsResult = {
      syncedLyrics: [...shared, '[01:30.00]やれるわ', '[01:40.00]やれるわ', '[01:50.00]やれるわ'].join('\n'),
      plainLyrics: null, source: '网易云音乐 · 搜索匹配 100%', confidence: 100, matchedDurationMs: 110_000
    }
    const result = mergeProviderSet([exact, complete], 110_000)
    expect(result?.source).toBe('网易云音乐 · 搜索匹配 100%')
    expect(parseTimedRows(result?.syncedLyrics).slice(-3).map(row => row.text)).toEqual(['やれるわ', 'やれるわ', 'やれるわ'])
  })

  it('preserves punctuation and repeated chorus rows when repairing a bounded hole', () => {
    const complete: LyricsResult = {
      syncedLyrics: [
        '[00:00.00]同じ歌を、歌う',
        '[00:10.00]朝の光を見た',
        '[00:20.00]君の声を聞く',
        '[00:30.00]同じ歌を、歌う',
        '[00:40.00]空へ — 行こう',
        '[00:50.00]夜の風が吹く',
        '[01:00.00]手をつないで',
        '[01:10.00]明日へ歩こう'
      ].join('\n'),
      plainLyrics: null, source: 'complete formatting', confidence: 90
    }
    const missing: LyricsResult = {
      syncedLyrics: [
        '[00:00.00]同じ歌を、歌う',
        '[00:10.00]朝の光を見た',
        '[00:20.00]君の声を聞く',
        '[00:50.00]夜の風が吹く',
        '[01:00.00]手をつないで',
        '[01:10.00]明日へ歩こう'
      ].join('\n'),
      plainLyrics: null, source: 'missing formatting', confidence: 100
    }
    const repaired = repairBoundedGaps(missing, [missing, complete])
    expect(repaired.syncedLyrics).toContain('[00:30.00]同じ歌を、歌う')
    expect(repaired.syncedLyrics).toContain('[00:40.00]空へ — 行こう')
  })

  it('prefers a more precisely timed equivalent whose provider split merged lyric rows', () => {
    const coarse: LyricsResult = {
      syncedLyrics: '[00:00.00]alpha one beta two\n[00:20.00]gamma three delta four\n[00:40.00]epsilon five zeta six\n[01:00.00]eta seven theta eight',
      plainLyrics: null, source: 'coarse exact', confidence: 100, matchedDurationMs: 100_000
    }
    const detailed: LyricsResult = {
      syncedLyrics: '[00:00.00]alpha one\n[00:10.00]beta two\n[00:20.00]gamma three\n[00:30.00]delta four\n[00:40.00]epsilon five\n[00:50.00]zeta six\n[01:00.00]eta seven\n[01:10.00]theta eight',
      plainLyrics: null, source: 'detailed equivalent', confidence: 84, matchedDurationMs: 100_000
    }
    expect(mergeProviderSet([coarse, detailed], 100_000)?.source).toBe('detailed equivalent')
  })

  it('does not treat mildly fragmented search lyrics as more complete than an exact metadata match', () => {
    const exact: LyricsResult = {
      syncedLyrics: '[00:05.00]alpha one beta two\n[00:20.00]gamma three delta four\n[00:35.00]epsilon five zeta six\n[00:50.00]eta seven theta eight',
      plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 65_000
    }
    const fragmented: LyricsResult = {
      syncedLyrics: '[00:05.00]alpha one\n[00:10.00]beta two\n[00:20.00]gamma three\n[00:25.00]delta four\n[00:35.00]epsilon five\n[00:40.00]zeta six\n[00:50.00]eta seven\n[00:55.00]theta eight',
      plainLyrics: null, source: '酷狗音乐 · 搜索匹配 100%', confidence: 100, matchedDurationMs: 65_000
    }
    expect(mergeProviderSet([fragmented, exact], 65_000)?.source).toBe('LRCLIB · 精确匹配')
  })

  it('does not promote a translated rewrite over a healthy exact original merely because it has twice as many rows', () => {
    const exact: LyricsResult = {
      syncedLyrics: [
        '[00:10.00]闇に光を 罪に罰を',
        '[00:25.00]I will chase where you are looking at',
        '[00:40.00]手を取り合って重ねる strength',
        '[00:55.00]Never be afraid of your weakness',
        '[01:10.00]未来へ進むために',
        '[01:25.00]We will fight until the end'
      ].join('\n'),
      plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 100_000
    }
    const translatedRewrite: LyricsResult = {
      syncedLyrics: [
        '[00:10.00]Shine a light into the dark', '[00:15.00]Punishment for the sin',
        '[00:25.00]I will chase', '[00:30.00]Where you are looking at',
        '[00:40.00]When our hands touch', '[00:45.00]We combine our strength',
        '[00:55.00]Never be afraid', '[01:00.00]Of your weakness',
        '[01:10.00]To move toward our future', '[01:20.00]We stand together',
        '[01:25.00]We will fight', '[01:30.00]Until the end'
      ].join('\n'),
      plainLyrics: null, source: '网易云音乐 · 搜索匹配 100%', confidence: 100, matchedDurationMs: 100_000
    }
    expect(mergeProviderSet([translatedRewrite, exact], 100_000)?.source).toBe('LRCLIB · 精确匹配')
  })

  it('still rejects an exact metadata result when cross-provider anchors prove a real missing block', () => {
    const completeRows = Array.from({ length: 9 }, (_, index) => `[00:${String(index * 8).padStart(2, '0')}.00]shared exact lyric ${index}`)
    const exactMissing: LyricsResult = {
      syncedLyrics: completeRows.filter((_, index) => index !== 4 && index !== 5).join('\n'),
      plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 72_000
    }
    const complete: LyricsResult = {
      syncedLyrics: completeRows.join('\n'), plainLyrics: null,
      source: '酷狗音乐 · 搜索匹配 84%', confidence: 84, matchedDurationMs: 72_000
    }
    expect(mergeProviderSet([exactMissing, complete], 72_000)?.source).toBe('酷狗音乐 · 搜索匹配 84%')
  })

  it('does not let a low-confidence cover win only because it has more lyric rows', () => {
    const release = { syncedLyrics: Array.from({ length: 32 }, (_, index) => `[00:${String(index * 3).padStart(2, '0')}.00]official ${index}`).join('\n'), plainLyrics: null, source: 'exact release', confidence: 80 }
    const cover = { syncedLyrics: Array.from({ length: 55 }, (_, index) => `[00:${String(index * 2).padStart(2, '0')}.00]cover ${index}`).join('\n'), plainLyrics: null, source: 'unrelated cover', confidence: 57 }
    expect(mergeProviderResults(release, cover, 120_000)?.source).toBe('exact release')
  })

  it('keeps a localized identity six points above a denser same-artist song', () => {
    const localized: LyricsResult = {
      syncedLyrics: Array.from({ length: 27 }, (_, index) => `[00:${String(index * 4).padStart(2, '0')}.00]localized lyric ${index}`).join('\n'),
      plainLyrics: null, source: 'localized exact-duration release', confidence: 67, matchedDurationMs: 112_000
    }
    const differentSong: LyricsResult = {
      syncedLyrics: Array.from({ length: 55 }, (_, index) => `[00:${String(index * 2).padStart(2, '0')}.00]different lyric ${index}`).join('\n'),
      plainLyrics: null, source: 'similar-duration different song', confidence: 61, matchedDurationMs: 111_100
    }
    expect(mergeProviderSet([localized, differentSong], 112_000)?.source).toBe('localized exact-duration release')
  })

  it('uses three-source timestamp consensus to reject a globally shifted timeline', () => {
    const makeTimeline = (source: string, shiftMs: number, confidence: number): LyricsResult => ({
      syncedLyrics: Array.from({ length: 12 }, (_, index) => {
        const totalMs = 5_000 + index * 6_000 + shiftMs
        const minute = Math.floor(totalMs / 60_000)
        const second = Math.floor(totalMs % 60_000 / 1000)
        return `[${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.00]same lyric ${index}`
      }).join('\n'),
      plainLyrics: null, source, confidence
    })
    const result = mergeProviderSet([
      makeTimeline('consensus-a', 0, 85),
      makeTimeline('consensus-b', 100, 85),
      makeTimeline('shifted-outlier', 10_000, 100)
    ], 90_000)
    expect(result?.source).not.toBe('shifted-outlier')
  })

  it('does not force a globally shifted LRCLIB exact timeline over two agreeing sources', () => {
    const makeTimeline = (source: string, shiftMs: number, confidence: number): LyricsResult => ({
      syncedLyrics: Array.from({ length: 14 }, (_, index) => {
        const totalMs = 4_000 + index * 6_000 + shiftMs
        const minute = Math.floor(totalMs / 60_000)
        const second = Math.floor(totalMs % 60_000 / 1000)
        return `[${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.00]shared lyric ${index}`
      }).join('\n'),
      plainLyrics: null, source, confidence, matchedDurationMs: 100_000
    })
    const result = mergeProviderSet([
      makeTimeline('LRCLIB · 精确匹配', 8_000, 100),
      makeTimeline('网易云音乐 · 搜索匹配 88%', 0, 88),
      makeTimeline('酷狗音乐 · 搜索匹配 88%', 120, 88)
    ], 100_000)
    expect(result?.source).not.toBe('LRCLIB · 精确匹配')
  })

  it('keeps an LRCLIB exact timeline when only one other source claims an offset', () => {
    const makeTimeline = (source: string, shiftMs: number, confidence: number): LyricsResult => ({
      syncedLyrics: Array.from({ length: 14 }, (_, index) => {
        const totalMs = 4_000 + index * 6_000 + shiftMs
        const minute = Math.floor(totalMs / 60_000)
        const second = Math.floor(totalMs % 60_000 / 1000)
        return `[${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.00]shared lyric ${index}`
      }).join('\n'),
      plainLyrics: null, source, confidence, matchedDurationMs: 100_000
    })
    const result = mergeProviderSet([
      makeTimeline('LRCLIB · 精确匹配', 0, 100),
      makeTimeline('single shifted community source', 8_000, 95)
    ], 100_000)
    expect(result?.source).toBe('LRCLIB · 精确匹配')
  })

  it('does not overrule exact metadata from only three repeated timing anchors', () => {
    const exactRows = Array.from({ length: 14 }, (_, index) => `[00:${String(4 + index * 6).padStart(2, '0')}.00]exact verse ${index}`)
    const sparseShifted = (source: string, shiftMs: number): LyricsResult => ({
      syncedLyrics: exactRows.map((row, index) => {
        const totalMs = 4_000 + index * 6_000 + shiftMs
        const stamp = `[${String(Math.floor(totalMs / 60_000)).padStart(2, '0')}:${String(Math.floor(totalMs % 60_000 / 1000)).padStart(2, '0')}.00]`
        return `${stamp}${index < 3 ? `exact verse ${index}` : `${source} unrelated ${index}`}`
      }).join('\n'),
      plainLyrics: null, source, confidence: 95, matchedDurationMs: 100_000
    })
    const exact: LyricsResult = {
      syncedLyrics: exactRows.join('\n'), plainLyrics: null,
      source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 100_000
    }
    expect(mergeProviderSet([
      exact,
      sparseShifted('community-a', 8_000),
      sparseShifted('community-b', 8_100)
    ], 100_000)?.source).toBe('LRCLIB · 精确匹配')
  })

  it('prefers a complete Spotify timeline over a denser shifted community timeline', () => {
    const makeTimeline = (source: string, count: number, shiftMs: number): LyricsResult => ({
      syncedLyrics: Array.from({ length: count }, (_, index) => {
        const totalMs = 4_000 + index * Math.floor(82_000 / Math.max(1, count - 1)) + shiftMs
        return `[${String(Math.floor(totalMs / 60_000)).padStart(2, '0')}:${String(Math.floor(totalMs % 60_000 / 1000)).padStart(2, '0')}.00]lyric ${index}`
      }).join('\n'),
      plainLyrics: null, source, confidence: 100, matchedDurationMs: 100_000
    })
    const spotify = makeTimeline('Spotify · Musixmatch', 16, 0)
    const community = makeTimeline('community', 36, 5_000)
    expect(mergeProviderSet([community, spotify], 100_000)?.source).toBe('Spotify · Musixmatch')
  })

  it('falls back when the Spotify timeline has a large missing middle section', () => {
    const spotify: LyricsResult = {
      syncedLyrics: '[00:04.00]one\n[00:08.00]two\n[01:20.00]three\n[01:25.00]four',
      plainLyrics: null, source: 'Spotify · incomplete', confidence: 100, matchedDurationMs: 100_000
    }
    const complete: LyricsResult = {
      syncedLyrics: Array.from({ length: 25 }, (_, index) => `[00:${String(index * 4).padStart(2, '0')}.00]line ${index}`).join('\n'),
      plainLyrics: null, source: 'complete community', confidence: 90, matchedDurationMs: 100_000
    }
    expect(mergeProviderSet([spotify, complete], 100_000)?.source).toBe('complete community')
  })

  it('reports meaningful line and tail coverage', () => {
    expect(timedLyricsStats('[00:10.00]one\n[01:30.00]two', 100_000)).toMatchObject({ lineCount: 2, firstMs: 10_000, lastMs: 90_000, tailCoverage: .9, maxGapMs: 80_000 })
  })

  it('does not let a decorative music marker fake lyric tail coverage', () => {
    expect(timedLyricsStats('[00:01.00]one real line\n[01:59.00]♪', 120_000)).toMatchObject({ lineCount: 1, lastMs: 1000 })
  })

  it('expands every timestamp on a repeated physical LRC row', () => {
    const lyrics = '[00:05.00][01:05.00]same chorus\n[00:10.00]other line'
    expect(parseTimedRows(lyrics).map(row => row.timeMs)).toEqual([5_000, 10_000, 65_000])
    expect(timedLyricsStats(lyrics, 90_000)).toMatchObject({ lineCount: 3, lastMs: 65_000 })
  })

  it('rejects a sparse NetEase translation when another source covers most base rows', () => {
    const original = Array.from({ length: 10 }, (_, index) => `[00:${String(index * 5 + 1).padStart(2, '0')}.00]日本語の歌詞${index}`).join('\n')
    const translations = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `[00:${String(index * 5 + 1).padStart(2, '0')}.00]${prefix}${index}`).join('\n')
    const community: LyricsResult = { syncedLyrics: original, plainLyrics: null, source: 'LRCLIB', confidence: 96, additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: translations('社区', 9), source: 'LRCLIB · 翻译' }] }
    const netease: LyricsResult = { syncedLyrics: original, plainLyrics: null, source: '网易云音乐', confidence: 94, additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: translations('网易云', 2), source: '网易云音乐 · 翻译' }] }
    const chinese = mergeProviderSet([community, netease], 50_000)?.additionalTracks?.find(track => track.language === 'zh-Hans')
    expect(chinese?.source).toContain('LRCLIB')
    expect(parseTimedRows(chinese?.syncedLyrics).length).toBe(9)
  })

  it('keeps a nearly complete NetEase translation and fills only its missing rows', () => {
    const original = Array.from({ length: 10 }, (_, index) => `[00:${String(index * 5 + 1).padStart(2, '0')}.00]日本語の歌詞${index}`).join('\n')
    const translations = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `[00:${String(index * 5 + 1).padStart(2, '0')}.00]${prefix}${index}`).join('\n')
    const community: LyricsResult = { syncedLyrics: original, plainLyrics: null, source: 'LRCLIB', confidence: 96, additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: translations('社区', 10), source: 'LRCLIB · 翻译' }] }
    const netease: LyricsResult = { syncedLyrics: original, plainLyrics: null, source: '网易云音乐', confidence: 94, additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: translations('网易云', 8), source: '网易云音乐 · 翻译' }] }
    const chinese = mergeProviderSet([community, netease], 50_000)?.additionalTracks?.find(track => track.language === 'zh-Hans')
    expect(chinese?.source).toContain('网易云')
    expect(chinese?.syncedLyrics).toContain('网易云7')
    expect(chinese?.syncedLyrics).toContain('社区9')
    expect(parseTimedRows(chinese?.syncedLyrics).length).toBe(10)
  })

  it('keeps every delayed Chinese phrase that belongs to one original-line interval', () => {
    const netease: LyricsResult = {
      syncedLyrics: '[00:01.00]日本語の長い一行\n[00:10.00]次の日本語歌詞\n[00:20.00]最後の日本語歌詞',
      plainLyrics: null, source: '网易云音乐', confidence: 96,
      additionalTracks: [{
        language: 'zh-Hans', label: '中文', kind: 'translation', source: '网易云音乐 · 翻译',
        syncedLyrics: '[00:01.10]第一句\n[00:04.00]第二句\n[00:10.10]下一行\n[00:20.10]最后一行'
      }]
    }
    const chinese = mergeProviderSet([netease], 30_000, 'ja')?.additionalTracks?.find(track => track.language === 'zh-Hans')
    expect(chinese?.syncedLyrics).toContain('[00:01.00]第一句　第二句')
    expect(chinese?.syncedLyrics).toContain('[00:10.00]下一行')
  })

  it('rejects a high-confidence timeline with a large missing middle section', () => {
    const complete = { syncedLyrics: Array.from({ length: 30 }, (_, index) => `[00:${String(index * 3).padStart(2, '0')}.00]line ${index}`).join('\n'), plainLyrics: null, source: 'complete', confidence: 80 }
    const missingMiddle = { syncedLyrics: Array.from({ length: 20 }, (_, index) => {
      const second = index < 10 ? index * 3 : 60 + (index - 10) * 3
      return `[${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}.00]line ${index}`
    }).join('\n'), plainLyrics: null, source: 'missing middle', confidence: 100 }
    expect(timedLyricsStats(missingMiddle.syncedLyrics, 100_000).excessiveGapMs).toBeGreaterThan(0)
    expect(mergeProviderResults(missingMiddle, complete, 100_000)?.source).toBe('complete')
  })
})

describe('Spotify metadata cleanup', () => {
  it('removes a timed artist-title header without removing a real title refrain', () => {
    const raw = '[00:00.21]ヨルシカ - 言って。\n[00:02.51]言って\n[00:24.05]あのね私実は気付いてるの'
    const cleaned = stripTimedTrackMetadata(raw, { name: '言って。', artist: 'ヨルシカ' })
    expect(cleaned).not.toContain('ヨルシカ - 言って。')
    expect(cleaned).toContain('[00:02.51]言って')
  })

  it('does not confuse UNSYNCED lyrics with a synchronized timeline', () => {
    expect(isSpotifySyncedLyricsType('LINE_SYNCED')).toBe(true)
    expect(isSpotifySyncedLyricsType('SYLLABLE_SYNCED')).toBe(true)
    expect(isSpotifySyncedLyricsType('UNSYNCED')).toBe(false)
  })

  it('converts Spotify millisecond line starts without changing their timeline', () => {
    expect(spotifyLinesToLrc([
      { startTimeMs: '9090', words: 'first line' },
      { startTimeMs: '69123', words: 'second line' }
    ])).toBe('[00:09.09]first line\n[01:09.12]second line')
  })

  it('removes release suffixes that prevent exact lyric matches', () => {
    expect(cleanTrackTitle('Song Name - 2024 Remastered')).toBe('Song Name')
    expect(cleanTrackTitle('Song Name (feat. Guest)')).toBe('Song Name')
    expect(cleanTrackTitle('Song Name - From THE FIRST TAKE')).toBe('Song Name')
  })

  it('uses the primary artist for fallback searches', () => {
    expect(primaryArtist('Artist, Guest')).toBe('Artist')
    expect(primaryArtist('Artist feat. Guest')).toBe('Artist')
  })

  it('does not promote a different same-artist song to near-exact identity from duration alone', () => {
    const wrong = weightedScore('廻廻奇譚', 'Eve', 214_200, { track: '風のアンセム', artist: 'Eve', durationMs: 214_237 }, true)
    const exact = weightedScore('風のアンセム', 'Eve', 220_000, { track: '風のアンセム', artist: 'Eve', durationMs: 214_237 }, true)
    expect(wrong).toBeLessThan(82)
    expect(exact).toBeGreaterThan(wrong + 10)
  })

  it('uses katakana artist identity plus exact duration to bridge a localized title', () => {
    const query = { track: 'Fading Sparks and Summer Sky', artist: 'HIBANA', album: 'Fading Sparks and Summer Sky', durationMs: 223_604 }
    const exactDuration = weightedScore('消えゆく火花と夏の空', 'ヒバナ', 223_604, query, true, '消えゆく火花と夏の空')
    const nearbyDifferentSong = weightedScore('星になった日', 'ヒバナ', 222_684, query, true, '星になった日')
    expect(exactDuration).toBeGreaterThanOrEqual(65)
    expect(exactDuration).toBeGreaterThan(nearbyDifferentSong + 4)
  })

  it('keeps an original-artist localized result above a same-title cover album', () => {
    const query = { track: 'Suzume', artist: 'RADWIMPS', album: 'Suzume', durationMs: 238_560 }
    const original = weightedScore('すずめ feat.十明', 'RADWIMPS / 十明', 238_560, query, true, 'すずめの戸締まり')
    const cover = weightedScore('Suzume', 'IN0RI', 235_384, query, true, 'Suzume')
    const closeDurationCover = weightedScore('Suzume (Russian ver.)', 'Sati Akura / Billy Raven', 240_000, query, true, 'Suzume (Russian ver.)')
    expect(cleanTrackTitle('すずめ feat.十明')).toBe('すずめ')
    expect(cover).toBeLessThan(80)
    expect(closeDurationCover).toBeLessThan(80)
    expect(original).toBeGreaterThan(cover + 15)
    expect(original).toBeGreaterThan(closeDurationCover + 15)
  })

  it('keeps the exact album release when a Spotify Mix endpoint is twenty seconds longer', () => {
    const query = { track: 'Tokimeki', artist: 'Vaundy', album: 'replica', durationMs: 233_081 }
    const release = weightedScore('Tokimeki', 'Vaundy', 212_000, query, true, 'replica')
    const closerAlternate = weightedScore('Tokimeki', 'Vaundy', 223_590, query, true, 'unrelated compilation')
    expect(release).toBeGreaterThan(closerAlternate + 10)
  })

  it('uses exact playback duration only to break an otherwise equal release tie', () => {
    const syncedLyrics = '[00:10.00]first sung line\n[00:30.00]second sung line\n[01:00.00]third sung line\n[02:00.00]fourth sung line\n[03:30.00]last sung line'
    const single: LyricsResult = { source: '网易云音乐 · 单曲', confidence: 97, matchedDurationMs: 236_390, syncedLyrics, plainLyrics: null }
    const soundtrack: LyricsResult = { source: '网易云音乐 · 原声带', confidence: 97, matchedDurationMs: 238_560, syncedLyrics, plainLyrics: null }
    expect(mergeProviderSet([single, soundtrack], 238_560)?.matchedDurationMs).toBe(238_560)
  })

  it('uses a collaboration album alias to bridge producer and vocalist credits', () => {
    const score = weightedScore(
      '君とコーヒー',
      'Sando Aoi / Islet 1st Vocal Collab EP',
      241_557,
      { track: 'Kimi To Coffee', artist: 'Islet', album: 'CYANIDE', durationMs: 241_500 },
      true,
      'CYANIDE'
    )
    expect(score).toBeGreaterThanOrEqual(80)
  })
})
