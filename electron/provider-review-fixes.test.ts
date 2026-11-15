import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLyrics, mergeProviderSet, parseTimedRows, splitEmbeddedTranslation, type LyricsResult } from './lyrics-provider'

// Regressions from the fifth review (0.4.71). Every case is synthetic text.

const stamp = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor(ms % 60_000 / 1000)
  const centiseconds = Math.floor(ms % 1000 / 10)
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`
}
const lrc = (rows: Array<[number, string]>) => rows.map(([ms, text]) => stamp(ms) + text).join('\n')

type OwnerRow = [number, string, string, string]
const tail: OwnerRow[] = [
  [25_000, '明日はきっと晴れるから', '因为明天一定会放晴', 'ashita wa kitto hareru kara'],
  [30_000, '涙はもういらないよ', '已经不需要眼泪了', 'namida wa mou iranai yo'],
  [35_000, '遠い空に手を伸ばして', '向遥远的天空伸出手', 'tooi sora ni te wo nobashite'],
  [40_000, '届かなくても笑っていよう', '即使够不到也要笑着', 'todokanakutemo waratte iyou'],
  [45_000, 'さよならまた会う日まで', '再见直到重逢之日', 'sayonara mata au hi made']
]

/** The LRCLIB timeline as the original, NetEase supplying Chinese and romaji for its own rows. */
const merge = (baseRows: Array<[number, string]>, ownerRows: OwnerRow[]) => {
  const lrclib: LyricsResult = { syncedLyrics: lrc(baseRows), plainLyrics: baseRows.map(row => row[1]).join('\n'), source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 60_000 }
  const netease: LyricsResult = {
    syncedLyrics: lrc(ownerRows.map(row => [row[0], row[1]])), plainLyrics: null, source: '网易云音乐 · 搜索候选', confidence: 95, matchedDurationMs: 60_000,
    additionalTracks: [
      { language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: lrc(ownerRows.map(row => [row[0], row[2]])), source: '网易云音乐 · 翻译' },
      { language: 'romaji', label: 'Romaji', kind: 'romanization', syncedLyrics: lrc(ownerRows.map(row => [row[0], row[3]])), source: '网易云音乐 · 罗马音' }
    ]
  }
  const merged = mergeProviderSet([null, lrclib, netease, null], 60_000, 'ja')
  const track = (language: string) => parseTimedRows(merged?.additionalTracks?.find(item => item.language === language)?.syncedLyrics)
  const at = (language: string, ms: number) => track(language).filter(row => row.timeMs === ms).map(row => row.text).join('　')
  return { merged, at }
}

describe('translations on rows the two timelines divide differently', () => {
  const long = '君の声が聞こえた気がした夜のこと'
  const after = '振り返れば誰もいない街の中でひとり'
  const longRow: OwnerRow = [10_000, long, '那个仿佛听见你声音的夜晚', 'kimi no koe ga kikoeta ki ga shita yoru no koto']
  const afterRow: OwnerRow = [20_000, after, '回过头在空无一人的街上独自一人', 'furikaereba dare mo inai machi no naka de hitori']

  it('leaves a short row that only one timeline has without its neighbours\' translations', () => {
    // "long + Yeah" is still 90 % similar to "long": the grouping used to take
    // the short row although the long one already matched exactly.
    const { merged, at } = merge(
      [[10_000, long], [15_000, 'Yeah'], [20_000, after], ...tail.map(row => [row[0], row[1]] as [number, string])],
      [longRow, afterRow, ...tail])
    expect(merged?.source).toBe('LRCLIB · 精确匹配')
    expect(at('zh-Hans', 15_000)).toBe('')
    expect(at('romaji', 15_000)).toBe('')
    expect(at('zh-Hans', 10_000)).toBe('那个仿佛听见你声音的夜晚')
    expect(at('zh-Hans', 20_000)).toBe('回过头在空无一人的街上独自一人')
  })

  it('keeps both halves of a row the provider split, after a long row', () => {
    const { at } = merge(
      [[10_000, long], [15_000, 'ほら 愛しい人よ'], [20_000, after], ...tail.map(row => [row[0], row[1]] as [number, string])],
      [longRow, [15_000, 'ほら', '你看', 'hora'], [17_000, '愛しい人よ', '亲爱的人啊', 'itoshii hito yo'], afterRow, ...tail])
    expect(at('zh-Hans', 10_000)).toBe('那个仿佛听见你声音的夜晚')
    expect(at('zh-Hans', 15_000)).toBe('你看　亲爱的人啊')
    expect(at('zh-Hans', 20_000)).toBe('回过头在空无一人的街上独自一人')
  })

  it('shows a merged provider row on both rows it covers, and only there', () => {
    const { at } = merge(
      [[10_000, long], [18_000, 'ねえ'], [20_000, after], ...tail.map(row => [row[0], row[1]] as [number, string])],
      [longRow, [18_000, `ねえ ${after}`, '喂 回过头在空无一人的街上独自一人', 'nee furikaereba'], ...tail])
    expect(at('zh-Hans', 18_000)).toBe('喂 回过头在空无一人的街上独自一人')
    expect(at('zh-Hans', 20_000)).toBe('喂 回过头在空无一人的街上独自一人')
  })

  it('keeps the later half of a split row off the next row when it starts within 1.2 s of it', () => {
    const base: Array<[number, string]> = [[10_000, '夜の街を歩いていた'], [15_000, '君の声が聞こえた気がした ただそれだけ'], [20_000, '振り返れば誰もいない'],
      ...tail.map(row => [row[0], row[1]] as [number, string])]
    const owner: OwnerRow[] = [[10_000, '夜の街を歩いていた', '走在夜晚的街道上', 'yoru no machi wo aruite ita'],
      [15_000, '君の声が聞こえた気がした', '好像听见了你的声音', 'kimi no koe ga kikoeta ki ga shita'],
      [19_000, 'ただそれだけ', '仅此而已', 'tada sore dake'],
      [20_000, '振り返れば誰もいない', '回过头却空无一人', 'furikaereba dare mo inai'], ...tail]
    const { at } = merge(base, owner)
    expect(at('zh-Hans', 15_000)).toBe('好像听见了你的声音　仅此而已')
    expect(at('zh-Hans', 20_000)).toBe('回过头却空无一人')
  })
})

describe('translations where the two timelines cut a sentence at different places', () => {
  it('keeps a provider row that is the tail of the displayed row before it', () => {
    // Displayed 「A」「B C」, provider 「A B」「C」: 「C」 used to be taken for a part of the next row.
    const base: Array<[number, string]> = [[8000, '確かにそうでしょ？'], [10_000, '夕暮れの中で泣いた後 君は笑ってた'], [15_000, '「私もそうだよ。」って 偽りの気持ち合わせて'],
      [20_000, '吐いて 黙って ずっと溜まってく'], ...tail.map(row => [row[0], row[1]] as [number, string])]
    const owner: OwnerRow[] = [[8000, '確かにそうでしょ？ 夕暮れの中で泣いた後', '确实如此吧？在黄昏中哭过之后', 'tashika ni sou desho'],
      [12_000, '君は笑ってた', '你笑了', 'kimi wa waratteta'],
      [15_000, '「私もそうだよ。」って 偽りの気持ち合わせて', '说着我也是 把虚假的心情合在一起', 'watashi mo sou da yo tte'],
      [20_000, '吐いて 黙って ずっと溜まってく', '吐露 沉默 一直积存', 'haite damatte zutto tamatteku'], ...tail]
    const { at } = merge(base, owner)
    expect(at('zh-Hans', 10_000)).toBe('确实如此吧？在黄昏中哭过之后　你笑了')
    expect(at('zh-Hans', 15_000)).toBe('说着我也是 把虚假的心情合在一起')
  })

  it('follows the rows that spell a provider sentence out exactly, not an earlier row that only resembles it', () => {
    const base: Array<[number, string]> = [[10_000, '何もかも無くした後に見える夜は'], [13_000, '本当に綺麗だろうから'], [17_000, '本当に本当に'], [23_000, '綺麗だろうから'],
      [26_000, '僕は歩いた'], ...tail.map(row => [row[0] + 5000, row[1]] as [number, string])]
    const owner: OwnerRow[] = [[10_000, '何もかも無くした後に見える夜は本当に綺麗だろうから', '失去一切之后看见的夜晚一定很美', 'nanimokamo nakushita ato ni'],
      [17_000, '本当に、本当に綺麗だろうから', '真的 真的会很美吧', 'hontou ni hontou ni kirei darou kara'],
      [26_000, '僕は歩いた', '所以我走了', 'boku wa aruita'], ...tail.map(row => [row[0] + 5000, row[1], row[2], row[3]] as OwnerRow)]
    const { at } = merge(base, owner)
    expect(at('zh-Hans', 17_000)).toBe('真的 真的会很美吧')
    expect(at('zh-Hans', 23_000)).toBe('真的 真的会很美吧')
    expect(at('zh-Hans', 13_000)).not.toBe('真的 真的会很美吧')
  })
})

describe('a short row both timelines have, written differently', () => {
  const long = '君の声が聞こえた気がした夜のこと'
  const after = '振り返れば誰もいない街の中でひとり'
  const rest = tail.map(row => [row[0], row[1]] as [number, string])
  it('keeps its translation when it sits in the same place on both', () => {
    const { at } = merge(
      [[10_000, long], [15_000, 'You and I'], [20_000, after], ...rest],
      [[10_000, long, '那个仿佛听见你声音的夜晚', 'kimi no koe'], [15_400, 'U&I', '我与你', 'you and i'], [20_000, after, '回过头在空无一人的街上独自一人', 'furikaereba'], ...tail])
    expect(at('zh-Hans', 15_000)).toBe('我与你')
    expect(at('zh-Hans', 10_000)).toBe('那个仿佛听见你声音的夜晚')
  })

  it('stays without one when the provider row is sung somewhere else between the two', () => {
    const { at } = merge(
      [[10_000, long], [12_000, 'You and I'], [20_000, after], ...rest],
      [[10_000, long, '那个仿佛听见你声音的夜晚', 'kimi no koe'], [17_000, 'ねえ', '喂', 'nee'], [20_000, after, '回过头在空无一人的街上独自一人', 'furikaereba'], ...tail])
    expect(at('zh-Hans', 12_000)).toBe('')
  })
})

describe('kanji-only sung rows', () => {
  it('stay in the original when they only follow a kana row in each chorus', () => {
    const verse = (n: number) => [`夜の街を歩いていた${n}`, `君の声が聞こえた気がした${n}`, `振り返れば誰もいない${n}`, `明日はきっと晴れるから${n}`,
      `涙はもういらないよ${n}`, `遠い空に手を伸ばして${n}`, 'ずっと叫んでいる', '東京 東京', '眠らない街で']
    const texts = [1, 2, 3, 4].flatMap(verse)
    const result: LyricsResult = { syncedLyrics: lrc(texts.map((text, index) => [10_000 + index * 5000, text])), plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 200_000 }
    const split = splitEmbeddedTranslation(result)
    expect(parseTimedRows(split.syncedLyrics).filter(row => row.text === '東京 東京')).toHaveLength(4)
    expect(split.additionalTracks ?? []).toEqual([])
  })
})

describe('one long interlude in the best-identified lyrics', () => {
  it('does not let another song by the artist win on its row count', () => {
    for (const interludeMs of [0, 12_000, 20_000, 30_000]) {
      let time = 10_000
      const right = Array.from({ length: 34 }, (_, index) => {
        const row: [number, string] = [time, `正しい曲の歌詞その${index}行目です`]
        time += 5000 + (index === 16 ? interludeMs : 0)
        return row
      })
      const durationMs = 200_000 + interludeMs
      const exactTitle: LyricsResult = { syncedLyrics: lrc(right), plainLyrics: null, source: '网易云音乐 · 搜索候选', confidence: 100, matchedDurationMs: durationMs }
      // Another title that contains the played one (花 / 花に亡霊) scores 89.
      const containing: LyricsResult = { syncedLyrics: lrc(Array.from({ length: 44 }, (_, index) => [8000 + index * 4300, `別の曲のことばその${index}`] as [number, string])),
        plainLyrics: null, source: '酷狗音乐 · 搜索候选', confidence: 89, matchedDurationMs: durationMs + 5000 }
      expect(mergeProviderSet([null, null, exactTitle, containing], durationMs)?.syncedLyrics, `interlude ${interludeMs}`).toBe(exactTitle.syncedLyrics)
    }
  })
})

describe('NetEase lookups', () => {
  afterEach(() => vi.unstubAllGlobals())
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const words = Array.from({ length: 36 }, (_, index) => ['夜の街を歩いていた', '君の声が聞こえた気がした', '振り返れば誰もいない', '明日はきっと晴れるから', '涙はもういらないよ', '遠い空に手を伸ばして'][index % 6] + `第${index}行`)
  const timeline = (shiftMs: number) => lrc(words.map((text, index) => [12_000 + index * 6000 + shiftMs, text]))
  const otherCut = { id: 1, name: '夜の街', duration: 243_000, artists: [{ name: 'テスト歌手' }], album: { name: '夜の街' } }
  const playing = { id: 2, name: '夜の街', duration: 240_000, artists: [{ name: 'テスト歌手' }], album: { name: '夜の街' } }

  it('do not count an entry twice when the artist page lists it again', async () => {
    const lyricRequests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('lrclib.net/api/get')) return json({}, 404)
      if (url.includes('lrclib.net')) return json([])
      if (url.includes('kugou.com')) return json({ candidates: [], data: { lists: [] } })
      if (url.includes('/search/get')) {
        const search = new URLSearchParams(String(init?.body ?? '')).get('s') ?? ''
        return json({ result: { songs: search === 'テスト歌手' ? [otherCut, playing] : search.includes('夜の街') ? [otherCut] : [] } })
      }
      if (url.includes('/song/lyric')) {
        const id = new URL(url).searchParams.get('id')!
        lyricRequests.push(id)
        return json({ lrc: { lyric: id === '1' ? timeline(-2000) : timeline(0) } })
      }
      return json({}, 404)
    }))
    const result = await fetchLyrics({ id: 'qa-review5-duplicate', name: '夜の街', artist: 'テスト歌手', album: '夜の街', coverUrl: '', durationMs: 240_000 }, null, true)
    // The other cut, fetched twice, used to be two timelines agreeing against the right one.
    expect(result?.matchedDurationMs).toBe(240_000)
    expect(parseTimedRows(result?.syncedLyrics)[0]?.timeMs).toBe(12_000)
    expect(lyricRequests.filter(id => id === '1')).toHaveLength(1)
  })

  it('are not final when one of the lyric requests failed', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      calls += 1
      if (url.includes('lrclib.net/api/get')) return json({}, 404)
      if (url.includes('lrclib.net')) return json([])
      if (url.includes('kugou.com')) return json({ candidates: [], data: { lists: [] } })
      if (url.includes('/search/get')) return json({ result: { songs: [{ ...playing, name: '朝の街', album: { name: '朝の街' } }, { ...otherCut, name: '朝の街', album: { name: '朝の街' }, duration: 240_400 }] } })
      if (url.includes('/song/lyric')) {
        // One entry answers; the other sends a body that is not JSON.
        return new URL(url).searchParams.get('id') === '2' ? json({ lrc: { lyric: timeline(0) } }) : new Response('<html>busy</html>', { status: 200 })
      }
      return json({}, 404)
    }))
    // Another title than the case above: the lookup cache is keyed by title, artist, album and length.
    const track = { id: 'qa-review5-partial', name: '朝の街', artist: 'テスト歌手', album: '朝の街', coverUrl: '', durationMs: 240_000 }
    const first = await fetchLyrics(track)
    expect(first?.syncedLyrics).toBe(timeline(0))
    expect(first?.transient).toBe(true)
    // Not kept as the song's answer: asking again reaches the network again.
    const before = calls
    await fetchLyrics(track)
    expect(calls).toBeGreaterThan(before)
  })
})
