import { describe, expect, it } from 'vitest'
import { describeAvailableSources, isLyricsSourceId, lyricsSourceId, mergeProviderSet, type LyricsResult } from './lyrics-provider'

const words = ['夜の底で歌う声が', '遠く響いていた', '君の名前を呼んで', '朝を待っていた', '変わらない景色の中', '僕らは歩いていた', '言葉にならないまま', '春が過ぎていった',
  '窓の外に降る雨が', '静かに止んでいた', '忘れかけた約束を', 'まだ覚えていた']
const lrc = (shiftMs: number, texts = words) => texts.map((text, index) => {
  const at = 12_000 + index * 9000 + shiftMs
  return `[${String(Math.floor(at / 60_000)).padStart(2, '0')}:${String(Math.floor(at % 60_000 / 1000)).padStart(2, '0')}.${String(Math.floor(at % 1000 / 10)).padStart(2, '0')}]${text}`
}).join('\n')
const result = (source: string, shiftMs: number, extra: Partial<LyricsResult> = {}): LyricsResult => ({
  syncedLyrics: lrc(shiftMs), plainLyrics: null, source, confidence: 90, matchedDurationMs: 130_000, ...extra })

describe('choosing a lyrics source', () => {
  const lrclib = result('LRCLIB · 精确匹配', 0)
  const netease = result('网易云音乐 · 搜索候选', 300, { additionalTracks: [
    { language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: lrc(300, words.map((_, index) => `译文第${index + 1}句`)), source: '网易云音乐 · 翻译' }] })
  const kugou = result('酷狗音乐 · 搜索候选', -500)

  it('maps provider labels to ids', () => {
    expect(lyricsSourceId('LRCLIB · 搜索候选')).toBe('lrclib')
    expect(lyricsSourceId('网易云音乐 · 歌词匹配 + 重复词补全')).toBe('netease')
    expect(lyricsSourceId('酷狗音乐 · 搜索候选')).toBe('kugou')
    expect(lyricsSourceId('Spotify · Musixmatch')).toBe('spotify')
    expect(lyricsSourceId('歌词源暂时不可用')).toBeUndefined()
    expect(isLyricsSourceId('kugou')).toBe(true)
    expect(isLyricsSourceId('qq')).toBe(false)
    expect(isLyricsSourceId(undefined)).toBe(false)
  })

  it('uses the chosen provider as the timed original, whatever the automatic choice is', () => {
    const automatic = mergeProviderSet([null, lrclib, netease, kugou], 130_000, 'ja')
    for (const [id, chosen] of [['lrclib', lrclib], ['netease', netease], ['kugou', kugou]] as const) {
      const forced = mergeProviderSet([null, lrclib, netease, kugou], 130_000, 'ja', id)
      expect(lyricsSourceId(forced?.source)).toBe(id)
      // The first line keeps that provider's own timestamp.
      expect(forced?.syncedLyrics?.split('\n')[0]).toBe(chosen.syncedLyrics!.split('\n')[0])
    }
    expect(automatic?.syncedLyrics).toBeTruthy()
  })

  it('still attaches the translation from another provider to the chosen timeline', () => {
    const forced = mergeProviderSet([null, lrclib, netease, kugou], 130_000, 'ja', 'kugou')
    const translation = forced?.additionalTracks?.find(track => track.language === 'zh-Hans')
    expect(translation?.syncedLyrics).toContain('译文第1句')
  })

  it('falls back to the automatic choice when the chosen provider has nothing timed', () => {
    const untimed: LyricsResult = { syncedLyrics: null, plainLyrics: words.join('\n'), source: '酷狗音乐 · 搜索候选', confidence: 90 }
    const automatic = mergeProviderSet([null, lrclib, netease, untimed], 130_000, 'ja')
    const forced = mergeProviderSet([null, lrclib, netease, untimed], 130_000, 'ja', 'kugou')
    expect(forced?.source).toBe(automatic?.source)
    expect(mergeProviderSet([null, lrclib, null, null], 130_000, 'ja', 'netease')?.source).toBe(lrclib.source)
  })

  it('says which providers agree with the automatic choice', () => {
    const automatic = mergeProviderSet([null, lrclib, netease, kugou], 130_000, 'ja')
    // Same words, shifted timestamps: every provider is the same song.
    expect(describeAvailableSources({ lrclib, netease, kugou }, automatic, 130_000)).toEqual([
      { id: 'lrclib', lines: 12, agrees: true }, { id: 'netease', lines: 12, agrees: true }, { id: 'kugou', lines: 12, agrees: true }])
  })

  it('marks a provider with other words or another length, and lists nothing untimed', () => {
    const automatic = mergeProviderSet([null, lrclib, null, null], 130_000, 'ja')
    const english = result('酷狗音乐 · 搜索候选', 0, { syncedLyrics: lrc(0, words.map((_, index) => `Another song entirely, line number ${index + 1}`)) })
    const liveVersion = result('网易云音乐 · 搜索候选', 0, { matchedDurationMs: 260_000 })
    const untimed: LyricsResult = { syncedLyrics: null, plainLyrics: words.join('\n'), source: 'Spotify · Musixmatch', confidence: 90 }
    expect(describeAvailableSources({ spotify: untimed, lrclib, netease: liveVersion, kugou: english }, automatic, 130_000)).toEqual([
      { id: 'lrclib', lines: 12, agrees: true }, { id: 'netease', lines: 12, agrees: false }, { id: 'kugou', lines: 12, agrees: false }])
    // Nothing to compare with: nothing agrees.
    expect(describeAvailableSources({ lrclib }, null, 130_000)).toEqual([{ id: 'lrclib', lines: 12, agrees: false }])
  })

  it('takes the translation from an entry of another length when the words are the same', () => {
    // A music-video cut: 15 s longer, every line 15 s later, same words. The
    // translated entry is the album recording.
    const video = result('LRCLIB · 精确匹配', 15_000, { matchedDurationMs: 145_000 })
    const album = result('网易云音乐 · 搜索候选', 0, { matchedDurationMs: 130_000, additionalTracks: [
      { language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: lrc(0, words.map((_, index) => `译文第${index + 1}句`)), source: '网易云音乐 · 翻译' }] })
    const merged = mergeProviderSet([null, video, album, null], 145_000, 'ja')
    expect(merged?.source).toBe(video.source)
    const translation = merged?.additionalTracks?.find(track => track.language === 'zh-Hans')
    const rows = translation?.syncedLyrics?.split('\n') ?? []
    expect(rows).toHaveLength(words.length)
    // Re-timed onto the video's timeline, line by line.
    expect(rows[0]).toBe(`${video.syncedLyrics!.split('\n')[0].slice(0, 10)}译文第1句`)
    expect(rows[11]).toBe(`${video.syncedLyrics!.split('\n')[11].slice(0, 10)}译文第12句`)
  })

  it('does not take it from another song or from an impossible length', () => {
    const video = result('LRCLIB · 精确匹配', 15_000, { matchedDurationMs: 145_000 })
    const translationOf = (texts: string[]) => [{ language: 'zh-Hans', label: '中文', kind: 'translation' as const, syncedLyrics: lrc(0, texts.map((_, index) => `译文第${index + 1}句`)), source: '网易云音乐 · 翻译' }]
    // Half of the lines are other words: similar, not the same.
    const otherWords = words.map((text, index) => index % 2 ? `別の歌の別の言葉が並ぶ行${index}` : text)
    const arrangement = result('网易云音乐 · 搜索候选', 0, { matchedDurationMs: 130_000, syncedLyrics: lrc(0, otherWords), additionalTracks: translationOf(otherWords) })
    expect(mergeProviderSet([null, video, arrangement, null], 145_000, 'ja')?.additionalTracks?.some(track => track.language === 'zh-Hans')).toBeFalsy()
    // The same words in a 45 s clip: not the same song length.
    const clip = result('网易云音乐 · 搜索候选', 0, { matchedDurationMs: 45_000, additionalTracks: translationOf(words) })
    expect(mergeProviderSet([null, video, clip, null], 145_000, 'ja')?.additionalTracks?.some(track => track.language === 'zh-Hans')).toBeFalsy()
  })
})
