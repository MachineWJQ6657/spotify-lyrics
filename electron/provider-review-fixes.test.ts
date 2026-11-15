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

describe('a provider row whose displayed twin went to a longer row first', () => {
  it('still gets the displayed row with exactly its words', () => {
    // 「本当に、本当に綺麗だろうから」 contains 「本当に綺麗だろうから」 and may take that
    // row in the monotonic match before the two rows after it claim it exactly.
    const base: Array<[number, string]> = [[10_000, '何もかも無くした後に'], [12_000, '見える夜は'], [13_000, '本当に綺麗だろうから'], [17_000, '本当に本当に'], [23_000, '綺麗だろうから'],
      [26_000, '僕は歩いた'], ...tail.map(row => [row[0] + 5000, row[1]] as [number, string])]
    const owner: OwnerRow[] = [[10_000, '何もかも無くした後に見える夜は', '失去一切之后看见的夜晚', 'nanimokamo nakushita ato ni mieru yoru wa'],
      [13_000, '本当に綺麗だろうから', '一定会很美吧', 'hontou ni kirei darou kara'],
      [17_000, '本当に、本当に綺麗だろうから', '真的 真的会很美吧', 'hontou ni hontou ni kirei darou kara'],
      [26_000, '僕は歩いた', '所以我走了', 'boku wa aruita'], ...tail.map(row => [row[0] + 5000, row[1], row[2], row[3]] as OwnerRow)]
    const { at } = merge(base, owner)
    expect(at('zh-Hans', 10_000)).toBe('失去一切之后看见的夜晚')
    expect(at('zh-Hans', 12_000)).toBe('失去一切之后看见的夜晚')
    expect(at('zh-Hans', 13_000)).toBe('一定会很美吧')
    expect(at('zh-Hans', 17_000)).toBe('真的 真的会很美吧')
    expect(at('zh-Hans', 23_000)).toBe('真的 真的会很美吧')
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

describe('a translation stamped a little off its rows in a fast passage', () => {
  it('stays on its own rows when the provider result is merged', () => {
    // Rows one second apart, the translation 100 ms late: a fixed 1.2 s
    // look-ahead gave every line to the row after its own (sixth review).
    const rows: Array<[number, string, string]> = [[10_000, '夜の街を歩いていた', '走在夜晚的街道上'], [11_000, '君の声が聞こえた', '听见了你的声音'], [12_000, '振り返れば誰もいない', '回过头却空无一人'],
      [13_000, '明日はきっと晴れる', '明天一定会放晴'], [17_000, '涙はもういらないよ', '已经不需要眼泪了'], [21_000, '遠い空に手を伸ばして', '向遥远的天空伸出手'],
      [25_000, '届かなくても笑っていよう', '即使够不到也要笑着'], [29_000, 'さよならまた会う日まで', '再见直到重逢之日']]
    const netease: LyricsResult = { syncedLyrics: lrc(rows.map(row => [row[0], row[1]])), plainLyrics: null, source: '网易云音乐 · 搜索候选', confidence: 100, matchedDurationMs: 40_000,
      additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: lrc(rows.map(row => [row[0] + 100, row[2]])), source: '网易云音乐 · 翻译' }] }
    const merged = mergeProviderSet([null, null, netease, null], 40_000, 'ja')
    const zh = parseTimedRows(merged?.additionalTracks?.find(track => track.language === 'zh-Hans')?.syncedLyrics)
    expect(zh.map(row => row.text)).toEqual(rows.map(row => row[2]))
    expect(zh.map(row => row.timeMs)).toEqual(rows.map(row => row[0]))
  })
})

describe('rows spelled differently on the two timelines', () => {
  const rest = tail.map(row => [row[0] + 10_000, row[1]] as [number, string])
  const restOwner = tail.map(row => [row[0] + 10_000, row[1], row[2], row[3]] as OwnerRow)
  it('keep their translations when they sit in the same places between matched rows', () => {
    // 想って / 思って, 照れ臭い / 照れくさい, ほしくって / 欲しくて: too different for
    // the row match, clearly the same lines by position and most of their words.
    const base: Array<[number, string]> = [[10_000, '初めまして大好きな音楽へ'], [13_000, 'どうか聞いてほしくって'], [16_000, '（伝えたいことがあるんです）'],
      [19_000, 'ちょっと 照れ臭いけれど'], [22_000, 'ずっと想っていたこと'], [25_000, 'こんなお手紙に込めて'], ...rest]
    const owner: OwnerRow[] = [[10_300, '初めまして大好きな音楽へ', '初次见面 献给我最喜欢的音乐', 'a'], [13_300, 'どうか聞いて欲しくて', '好想说给你听', 'b'],
      [16_300, '(伝えたいことがあるんです)', '（有想要传达给你的事）', 'c'], [19_300, 'ちょっと照れくさいけれど', '虽然稍微有点难为情', 'd'], [22_300, 'ずっと思っていたこと', '但一直想着的事情', 'e'],
      [25_300, 'こんなお手紙に込めて', '倾注在这样一封信里', 'f'], ...restOwner.map(row => [row[0] + 300, row[1], row[2], row[3]] as OwnerRow)]
    const { at } = merge(base, owner)
    expect(at('zh-Hans', 13_000)).toBe('好想说给你听')
    expect(at('zh-Hans', 19_000)).toBe('虽然稍微有点难为情')
    expect(at('zh-Hans', 22_000)).toBe('但一直想着的事情')
  })

  it('stay untranslated when the row in that place has other words', () => {
    const base: Array<[number, string]> = [[10_000, '初めまして大好きな音楽へ'], [13_000, '窓の外では雨が降っている'], [16_000, '（伝えたいことがあるんです）'], ...rest]
    const owner: OwnerRow[] = [[10_300, '初めまして大好きな音楽へ', '初次见面 献给我最喜欢的音乐', 'a'], [13_300, 'どうか聞いて欲しくて', '好想说给你听', 'b'],
      [16_300, '(伝えたいことがあるんです)', '（有想要传达给你的事）', 'c'], ...restOwner.map(row => [row[0] + 300, row[1], row[2], row[3]] as OwnerRow)]
    expect(merge(base, owner).at('zh-Hans', 13_000)).toBe('')
  })
})

describe('a translation of only some lines, interleaved with them', () => {
  it('is still split out when its rows differ from one another', () => {
    // 40 kana rows, 15 of them followed by a Chinese row (regression in 0.4.71: under 40 % was never split).
    const lines: Array<[number, string]> = []
    for (let index = 0; index < 40; index += 1) {
      lines.push([10_000 + index * 5000, `夜の街を歩いていた${index}番目のことば`])
      if (index % 8 < 3) lines.push([10_000 + index * 5000 + 2000, `走在夜晚的街道上第${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'][Math.floor(index / 8) * 3 + index % 8]}句`])
    }
    const split = splitEmbeddedTranslation({ syncedLyrics: lrc(lines), plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 220_000 })
    expect(parseTimedRows(split.syncedLyrics)).toHaveLength(40)
    expect(parseTimedRows(split.additionalTracks?.[0]?.syncedLyrics)).toHaveLength(15)
  })
})

describe('different kanji-only sung rows', () => {
  it('stay in the original (they are not a sparse translation)', () => {
    // 20 kana rows, four of them followed by 永遠 / 運命 / 約束 / 未来 (regression in 0.4.74).
    const sungKanji = ['永遠', '運命', '約束', '未来']
    const lines: Array<[number, string]> = []
    for (let index = 0; index < 20; index += 1) {
      lines.push([10_000 + index * 8000, `夜の街を歩いていた${index}番目のことば`])
      if (index % 5 === 2) lines.push([10_000 + index * 8000 + 4000, sungKanji[Math.floor(index / 5)]])
    }
    const result: LyricsResult = { syncedLyrics: lrc(lines), plainLyrics: null, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: 180_000 }
    const split = splitEmbeddedTranslation(result)
    expect(parseTimedRows(split.syncedLyrics)).toHaveLength(24)
    expect(split.additionalTracks ?? []).toEqual([])
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

describe('rows the translation track leaves empty', () => {
  const chorus = '明日はきっと晴れるから'
  it('take the translation the same words have on another row', () => {
    // The provider translates the chorus line once and leaves its repeat empty.
    const base: Array<[number, string]> = [[10_000, '夜の街を歩いていた'], [15_000, chorus], [20_000, '振り返れば誰もいない'], [25_000, chorus], [30_000, '涙はもういらないよ'],
      [35_000, '遠い空に手を伸ばして'], [40_000, '届かなくても笑っていよう'], [45_000, 'さよならまた会う日まで']]
    const owner: OwnerRow[] = [[10_000, '夜の街を歩いていた', '走在夜晚的街道上', 'a'], [15_000, chorus, '因为明天一定会放晴', 'b'], [20_000, '振り返れば誰もいない', '回过头却空无一人', 'c'],
      [25_000, chorus, '', 'b'], [30_000, '涙はもういらないよ', '已经不需要眼泪了', 'd'], [35_000, '遠い空に手を伸ばして', '向遥远的天空伸出手', 'e'],
      [40_000, '届かなくても笑っていよう', '即使够不到也要笑着', 'f'], [45_000, 'さよならまた会う日まで', '再见直到重逢之日', 'g']]
    const { merged, at } = merge(base, owner)
    expect(at('zh-Hans', 25_000)).toBe('因为明天一定会放晴')
    expect(merged?.additionalTracks?.find(track => track.language === 'zh-Hans')?.source).toContain('缺行补全')
  })

  it('do not take a sentence translation that is spread over several rows', () => {
    // 「说着智慧的话 顺其自然」 is shown on both rows of the sentence; it is not the translation of "ままでいい" alone.
    const base: Array<[number, string]> = [[10_000, '知恵の言葉をささやいて'], [13_000, 'そのままでいいよ'], [20_000, '振り返れば誰もいない'], [25_000, 'そのままでいいよ'],
      ...tail.map(row => [row[0] + 5000, row[1]] as [number, string])]
    const owner: OwnerRow[] = [[10_000, '知恵の言葉をささやいて そのままでいいよ', '说着智慧的话 顺其自然', 'a'], [20_000, '振り返れば誰もいない', '回过头却空无一人', 'c'],
      ...tail.map(row => [row[0] + 5000, row[1], row[2], row[3]] as OwnerRow)]
    const { at } = merge(base, owner)
    expect(at('zh-Hans', 10_000)).toBe('说着智慧的话 顺其自然')
    expect(at('zh-Hans', 13_000)).toBe('说着智慧的话 顺其自然')
    expect(at('zh-Hans', 25_000)).toBe('')
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

  it('translate every row when only another entry of the song divides it like the displayed lyrics', async () => {
    // The displayed timeline (LRCLIB) and entry 12 (another cut, 3 s later) keep
    // whole sentences. Entry 11, the recording playing, has no translation and
    // cuts five sentences in two and three into six pieces. The translation
    // travels from entry 12 through entry 11 and loses the three sentences it
    // cannot follow; entry 12 translates exactly those words.
    const sung = ['夜の街を歩いていた 君の声を探して', '振り返れば誰もいない 風だけが吹いていた', '明日はきっと晴れるから 傘はもういらないよ', '涙はもういらないよ 笑って手を振ろう',
      '遠い空に手を伸ばして 星をひとつ掴んだ', '届かなくても笑っていよう それが約束だから', 'さよならまた会う日まで 元気でいてほしい', '朝の光が差し込んで 新しい日が始まる']
    const chinese = ['走在夜晚的街道上 寻找你的声音', '回过头却空无一人 只有风在吹', '因为明天一定会放晴 已经不需要伞了', '已经不需要眼泪了 笑着挥手吧',
      '向遥远的天空伸出手 抓住了一颗星', '即使够不到也要笑着 因为那是约定', '再见直到重逢之日 希望你保重', '晨光照进来 新的一天开始了']
    const start = (index: number) => 10_000 + index * 20_000
    const whole = lrc(sung.map((text, index) => [start(index), text]))
    const pieces = (text: string, count: number) => { const size = Math.ceil(text.length / count); return Array.from({ length: count }, (_, part) => text.slice(part * size, (part + 1) * size)).filter(Boolean) }
    const cut = lrc(sung.flatMap((text, index) => (index % 3 === 2 ? pieces(text.replace(' ', ''), 6) : text.split(' '))
      .map((piece, part, all) => [start(index) + Math.round(part * 16_000 / all.length), piece] as [number, string])))
    const playingEntry = { id: 11, name: '星の街', duration: 180_000, artists: [{ name: 'テスト歌手' }], album: { name: '星の街' } }
    const otherCutEntry = { id: 12, name: '星の街', duration: 183_000, artists: [{ name: 'テスト歌手' }], album: { name: '星の街' } }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('lrclib.net/api/get')) return json({ id: 1, trackName: '星の街', artistName: 'テスト歌手', albumName: '星の街', duration: 180, instrumental: false, syncedLyrics: whole, plainLyrics: sung.join(String.fromCharCode(10)) })
      if (url.includes('lrclib.net')) return json([])
      if (url.includes('kugou.com')) return json({ candidates: [], data: { lists: [] } })
      if (url.includes('/search/get')) return json({ result: { songs: [playingEntry, otherCutEntry] } })
      if (url.includes('/song/lyric')) {
        return new URL(url).searchParams.get('id') === '11' ? json({ lrc: { lyric: cut } })
          : json({ lrc: { lyric: lrc(sung.map((text, index) => [start(index) + 3000, text])) }, tlyric: { lyric: lrc(chinese.map((text, index) => [start(index) + 3000, text])) } })
      }
      return json({}, 404)
    }))
    const result = await fetchLyrics({ id: 'qa-review-memory', name: '星の街', artist: 'テスト歌手', album: '星の街', coverUrl: '', durationMs: 180_000 }, null, true)
    const zh = parseTimedRows(result?.additionalTracks?.find(track => track.language === 'zh-Hans')?.syncedLyrics)
    expect(result?.source).toBe('LRCLIB · 精确匹配')
    expect(zh.map(row => [row.timeMs, row.text])).toEqual(chinese.map((text, index) => [start(index), text]))
    expect(result).not.toHaveProperty('translationMemory')
  })

  it("do not hand a lead line's translation to the backing line stamped with it", async () => {
    // 「きみがすきだよ」 and 「(Yeah yeah)」 share 00:42.00 and one translation row. A later, untranslated
    // "Yeah yeah" must stay untranslated (regression in 0.4.73: both rows entered the translation memory).
    const sung: Array<[number, string, string]> = [[10_000, '夜の街を歩いていた', '走在夜晚的街道上'], [20_000, '君の声が聞こえた気がした', '好像听见了你的声音'], [30_000, '振り返れば誰もいない', '回过头却空无一人'],
      [42_000, 'きみがすきだよ', '我喜欢你'], [52_000, '明日はきっと晴れるから', '因为明天一定会放晴'], [62_000, '涙はもういらないよ', '已经不需要眼泪了'], [72_000, '遠い空に手を伸ばして', '向遥远的天空伸出手'],
      [82_000, '届かなくても笑っていよう', '即使够不到也要笑着'], [92_000, 'さよならまた会う日まで', '再见直到重逢之日']]
    const displayed = lrc([...sung.map(row => [row[0], row[1]] as [number, string]), [112_000, 'Yeah yeah']])
    const entry = { id: 21, name: '夜明け前', duration: 130_000, artists: [{ name: 'テスト歌手' }], album: { name: '夜明け前' } }
    const entryLrc = lrc([...sung.slice(0, 4).map(row => [row[0], row[1]] as [number, string]), [42_000, '(Yeah yeah)'], ...sung.slice(4).map(row => [row[0], row[1]] as [number, string])])
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('lrclib.net/api/get')) return json({ id: 1, trackName: '夜明け前', artistName: 'テスト歌手', albumName: '夜明け前', duration: 130, instrumental: false, syncedLyrics: displayed, plainLyrics: 'x' })
      if (url.includes('lrclib.net')) return json([])
      if (url.includes('kugou.com')) return json({ candidates: [], data: { lists: [] } })
      if (url.includes('/search/get')) return json({ result: { songs: [entry] } })
      if (url.includes('/song/lyric')) return json({ lrc: { lyric: entryLrc }, tlyric: { lyric: lrc(sung.map(row => [row[0], row[2]])) } })
      return json({}, 404)
    }))
    const result = await fetchLyrics({ id: 'qa-review9-memory', name: '夜明け前', artist: 'テスト歌手', album: '夜明け前', coverUrl: '', durationMs: 130_000 }, null, true)
    const zh = parseTimedRows(result?.additionalTracks?.find(track => track.language === 'zh-Hans')?.syncedLyrics)
    expect(zh.find(row => row.timeMs === 42_000)?.text).toBe('我喜欢你')
    expect(zh.filter(row => row.timeMs === 112_000)).toEqual([])
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
