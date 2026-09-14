import { describe, expect, it } from 'vitest'
import { romanizeLines } from './romanizer'

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
})
