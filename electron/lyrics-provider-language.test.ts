import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLyrics, languageEdition, lyricHeaderCompatible, mergeProviderSet, weightedScore, type LyricsResult } from './lyrics-provider'
import { compareOriginalText } from './lyrics-text-reference'

// Synthetic lyrics only: these fixtures exercise identity, not copyrighted text.
const phrases = Array.from({ length: 12 }, (_, index) => `テストの原文を歌っている番号${index}`)
const timed = (texts: string[]) => texts.map((text, index) => {
  const seconds = index * 10 + 2
  return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00]${text}`
}).join('\n')
const japanese = timed(phrases)
const translated = timed(phrases.map((_, index) => `Only a translated sentence number ${index}`))

afterEach(() => vi.unstubAllGlobals())

describe('independent recording language and edition identity', () => {
  it.each(['English Ver.', 'English Version', '英文版', '韓語版'])('rejects unbracketed version suffix %s', suffix => {
    expect(weightedScore(`星図 ${suffix}`, 'Example Artist', 120000,
      { track: '星図', artist: 'Example Artist', durationMs: 120000 }, true)).toBe(0)
    expect(lyricHeaderCompatible(`[ti:星図 ${suffix}]\n${translated}`, '星図')).toBe(false)
  })

  it('preserves live and studio distinctions when both recordings name the same language', () => {
    expect(weightedScore('Star Map (English ver.) (Live)', 'Example Artist', 120000,
      { track: 'Star Map (English ver.)', artist: 'Example Artist', durationMs: 120000 }, true)).toBe(0)
    expect(lyricHeaderCompatible('[ti:Star Map (English ver.) (Live)]', 'Star Map (English ver.)')).toBe(false)
  })

  it('does not infer a language edition from an ordinary song title or lyric body', () => {
    expect(languageEdition('English Rose')).toBeNull()
    expect(languageEdition('Korean Dream')).toBeNull()
    expect(lyricHeaderCompatible('[00:10.00]This verse contains English words', '星図')).toBe(true)
  })
})

describe('provider language reference integration', () => {
  it('uses untimed Spotify Japanese text to reject a metadata-exact translation without copying its zero timestamps', async () => {
    const track = { id: 'qa-official-text-reference', spotifyId: '1234567890123456789012', name: '星図',
      artist: 'Example Artist', album: 'Fixture Album', durationMs: 120000, coverUrl: '' }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'spclient.wg.spotify.com') return new Response(JSON.stringify({ lyrics: {
        provider: 'Musixmatch', language: 'ja', syncType: 'UNSYNCED',
        lines: phrases.map(words => ({ startTimeMs: '0', words }))
      } }))
      if (url.hostname === 'lrclib.net') return new Response(JSON.stringify(url.pathname.endsWith('/get')
        ? { id: 701, trackName: track.name, artistName: track.artist, albumName: track.album, duration: 120, syncedLyrics: translated }
        : []))
      if (url.hostname === 'music.163.com') return new Response(JSON.stringify(url.pathname.endsWith('/song/lyric')
        ? { lrc: { lyric: japanese } }
        : { result: { songs: [{ id: 702, name: track.name, artists: [{ name: track.artist }], album: { name: track.album }, duration: 120000 }] } }))
      if (url.hostname === 'songsearch.kugou.com') return new Response('{"data":{"lists":[]}}')
      throw new Error(`Unexpected test URL: ${url.origin}${url.pathname}`)
    }))
    const result = await fetchLyrics(track, 'test-only-token', true)
    expect(result?.syncedLyrics).toBe(japanese)
    expect(result?.syncedLyrics).not.toContain('Only a translated')
    expect(result?.syncedLyrics).not.toContain('[00:00.00]')
    expect(result?.textReference).toEqual({ referenceSource: 'Spotify · Musixmatch', status: 'consistent', matchedLines: 12, referenceLines: 12 })
  })

  it('continues to a genuine Japanese Kugou file when the first downloaded file reveals an English edition', async () => {
    const track = { id: 'qa-kugou-header-fallback', name: '星図', artist: 'Example Artist', album: 'Fixture Album', durationMs: 120000, coverUrl: '' }
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'lrclib.net') return new Response(url.pathname.endsWith('/get') ? '{}' : '[]', { status: url.pathname.endsWith('/get') ? 404 : 200 })
      if (url.hostname === 'music.163.com') return new Response('{"result":{"songs":[]}}')
      if (url.hostname === 'songsearch.kugou.com') return new Response(JSON.stringify({ data: { lists: [{ FileHash: 'fixture-hash', SongName: track.name, SingerName: track.artist, Duration: 120 }] } }))
      if (url.hostname === 'lyrics.kugou.com' && url.pathname === '/search') return new Response(JSON.stringify({ candidates: [
        { id: '801', accesskey: 'fixture-key', duration: 120000, song: track.name },
        { id: '802', accesskey: 'fixture-key', duration: 120001, song: track.name }
      ] }))
      if (url.hostname === 'lyrics.kugou.com' && url.pathname === '/download') return new Response(JSON.stringify({
        content: Buffer.from(url.searchParams.get('id') === '801' ? `[ti:星図 (English ver.)]\n${translated}` : japanese).toString('base64')
      }))
      throw new Error(`Unexpected test URL: ${url.origin}${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchLyrics(track, null, true)
    expect(result?.syncedLyrics).toBe(japanese)
    expect(result?.source).not.toMatch(/\d+%/)
    expect(fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/download')).toHaveLength(2)
  })
})

describe('Spotify text evidence is independent from its playback clock', () => {
  const referenceSource = 'Spotify · Musixmatch'
  const originalText = phrases.join('\n')
  const reference: LyricsResult = { syncedLyrics: null, plainLyrics: originalText, source: referenceSource, confidence: 100 }
  const original: LyricsResult = { syncedLyrics: japanese, plainLyrics: originalText, source: '网易云音乐 · 搜索候选', confidence: 95, matchedDurationMs: 120000 }
  const wrong: LyricsResult = { syncedLyrics: translated, plainLyrics: phrases.map((_, i) => `Only a translated sentence number ${i}`).join('\n'),
    source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 120000 }

  it('reports consistent text with explicit matched-line evidence', () => {
    expect(compareOriginalText(japanese, originalText, referenceSource)).toEqual({
      referenceSource, status: 'consistent', matchedLines: 12, referenceLines: 12
    })
  })

  it('reports conflict for a translation with identical timestamps', () => {
    expect(compareOriginalText(translated, originalText, referenceSource)).toEqual({
      referenceSource, status: 'conflict', matchedLines: 0, referenceLines: 12
    })
  })

  it('does not claim a missing four-line verse is fully matched', () => {
    expect(compareOriginalText(timed(phrases.filter((_, i) => i < 4 || i >= 8)), originalText, referenceSource)).toEqual({
      referenceSource, status: 'partial', matchedLines: 8, referenceLines: 12
    })
  })

  it('counts short Japanese phrases as missing once longer lines establish reference identity', () => {
    const referenceWithShortLine = [...phrases.slice(0, 4), '君へ', ...phrases.slice(4)].join('\n')
    expect(compareOriginalText(japanese, referenceWithShortLine, referenceSource)).toEqual({
      referenceSource, status: 'partial', matchedLines: 12, referenceLines: 13
    })
  })

  it('reports partial when just one of twelve reference lines is missing', () => {
    expect(compareOriginalText(timed(phrases.filter((_, i) => i !== 5)), originalText, referenceSource)).toEqual({
      referenceSource, status: 'partial', matchedLines: 11, referenceLines: 12
    })
  })

  it('does not verify an entire source merely because the reference is embedded inside unrelated lyrics', () => {
    const contaminated = phrases.flatMap((phrase, i) => [phrase, `全く別の歌から混入した関係ない長い文章番号${i}`])
    expect(compareOriginalText(timed(contaminated), originalText, referenceSource)).toEqual({
      referenceSource, status: 'partial', matchedLines: 12, referenceLines: 12
    })
  })

  it('accepts equivalent line wrapping and punctuation without borrowing reference timestamps', () => {
    const differentlyWrapped = phrases.flatMap(phrase => [phrase.slice(0, 7), phrase.slice(7)]).join('\n')
    expect(compareOriginalText(differentlyWrapped, originalText, referenceSource)?.status).toBe('consistent')
    const differentlyWrappedReference = phrases.flatMap(phrase => [phrase.slice(0, 7), phrase.slice(7)]).join('\n')
    expect(compareOriginalText(japanese, differentlyWrappedReference, referenceSource)).toMatchObject({
      status: 'consistent', matchedLines: 24, referenceLines: 24
    })
    const shiftedTimes = japanese.replace(/\[\d+:\d+\.\d+]/g, '[03:50.00]')
    expect(compareOriginalText(shiftedTimes, `${originalText.replaceAll('番号', '番号、')}`, referenceSource)?.status).toBe('consistent')
  })

  it('does not reuse one chorus occurrence as evidence for two reference occurrences', () => {
    const six = phrases.slice(0, 6)
    expect(compareOriginalText(timed(six), [...six, ...six].join('\n'), referenceSource)).toMatchObject({
      status: 'partial', matchedLines: 6, referenceLines: 12
    })
  })

  it('requires ordered text rather than a bag of matching lines', () => {
    expect(compareOriginalText([...phrases].reverse().join('\n'), originalText, referenceSource)).toMatchObject({
      status: 'conflict', matchedLines: 1, referenceLines: 12
    })
  })

  it('does not turn an undersized or oversized reference into a verification claim', () => {
    expect(compareOriginalText(japanese, phrases.slice(0, 3).join('\n'), referenceSource)).toBeNull()
    expect(compareOriginalText('x'.repeat(60001), originalText, referenceSource)).toBeNull()
    expect(compareOriginalText(japanese, 'x'.repeat(60001), referenceSource)).toBeNull()
  })

  it('falls back to untimed Spotify original text instead of displaying a known conflicting translation as original', () => {
    const result = mergeProviderSet([reference, wrong], 120000)
    expect(result?.syncedLyrics).toBeNull()
    expect(result?.plainLyrics).toBe(originalText)
    expect(result?.source).toContain('Spotify')
    expect(result?.textReference).toMatchObject({ status: 'conflict', matchedLines: 0, referenceLines: 12 })
  })

  it('lets complete Spotify text evidence rescue a lower-metadata-score Japanese candidate', () => {
    const result = mergeProviderSet([reference, wrong, { ...original, confidence: 75 }], 120000)
    expect(result?.syncedLyrics).toBe(japanese)
    expect(result?.textReference?.status).toBe('consistent')
  })

  it('prefers an incomplete Japanese original corroborated by Spotify over an unrelated complete translation', () => {
    const missingVerse = japanese.split('\n').filter((_, i) => i < 4 || i >= 8).join('\n')
    const result = mergeProviderSet([reference, wrong, { ...original, syncedLyrics: missingVerse }], 120000)
    expect(result?.syncedLyrics).toBe(missingVerse)
    expect(result?.textReference).toMatchObject({ status: 'partial', matchedLines: 8, referenceLines: 12 })
  })
})
