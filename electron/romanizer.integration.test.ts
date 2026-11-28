import { describe, expect, it } from 'vitest'
import { clearRomanizedLineCache, kanaLines, romanizeLines } from './romanizer'

const runDictionary = process.env.SYLLABLE_DICTIONARY_QA === '1' ? describe : describe.skip

runDictionary('real Japanese dictionary worker', () => {
  it('produces Latin readings for kanji phrases across queued jobs', async () => {
    const [first, second] = await Promise.all([
      romanizeLines(['喜んで会いに行くから', '情けないなあ 本当に']),
      romanizeLines(['だから僕は音楽を辞めた'])
    ])
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(1)
    for (const line of [...first, ...second]) {
      expect(line).not.toMatch(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u)
      expect(line).toMatch(/[a-z]/i)
    }
    expect(first[0]).toMatch(/yorokonde/i)
    expect(first[0]).toMatch(/iku/i)
    expect(first[1]).toMatch(/nasakenai/i)
    expect(second[0]).toMatch(/ongaku/i)
  }, 60_000)

  it('writes the same lines in kana, from one analysis with the romaji', async () => {
    clearRomanizedLineCache()
    // Sentences written for this test, not lyrics.
    const lines = ['今日は天気がいい', '駅まで歩いて行く Love', 'ねえ ねえ', '一人で映画を見た', '']
    const [kana, romaji] = await Promise.all([kanaLines(lines), romanizeLines(lines)])
    expect(kana).toEqual(['きょうはてんきがいい', 'えきまであるいていく Love', 'ねえ ねえ', 'ひとりでえいがをみた', ''])
    expect(romaji[0]).toMatch(/kyou wa tenki ga ii/i)
    // Both are remembered: asking again starts no dictionary.
    const started = Date.now()
    expect(await kanaLines(lines)).toEqual(kana)
    expect(Date.now() - started).toBeLessThan(50)
  }, 60_000)
})
