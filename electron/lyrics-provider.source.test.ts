import { describe, expect, it } from 'vitest'
import { isLyricsSourceId, lyricsSourceId, mergeProviderSet, type LyricsResult } from './lyrics-provider'

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
})
