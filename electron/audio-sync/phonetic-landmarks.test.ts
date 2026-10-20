import { describe, expect, it } from 'vitest'
import type { HeardToken } from './lyric-aligner'
import { extractPhoneticLandmarks, type JapaneseWord } from './phonetic-landmarks'

const word = (surface_form: string, reading?: string, pronunciation?: string): JapaneseWord => ({ surface_form, reading, pronunciation })
const source = [word('想い出', 'オモイデ'), word('を', 'ヲ'), word('運ん', 'ハコン'), word('だ', 'ダ'),
  word('青い', 'アオイ'), word('空', 'ソラ'), word('を', 'ヲ'), word('見上げ', 'ミアゲ'), word('た', 'タ')]
const heard = [word('思い出', 'オモイデ'), ...source.slice(1)]
const text = (words: JapaneseWord[]) => words.map(item => item.surface_form).join('')
const tokens = (parts: string[], probability = .96): HeardToken[] => parts.map((text, index) => ({ text,
  startMs: 1000 + index * 400, endMs: index === parts.length - 1 ? 12000 : 1400 + index * 400,
  probability, timing: 'dtw', endIsUpperBound: true }))
const original = tokens(['思い', '出', 'を', '運ん', 'だ', '青い', '空', 'を', '見上げ', 'た'])
const match = (audio = original, heardWords = heard, sources = [source]) => extractPhoneticLandmarks(audio,
  sources.map((words, index) => ({ text: text(words), startMs: 30000 + index * 60000 })), 12000, heardWords, sources)

describe('Japanese phonetic landmarks', () => {
  it('joins spelling variants while retaining the first original multi-token DTW onset', () => {
    expect(match()).toEqual({ reason: 'matched', points: [{ lineIndex: 0, heardMs: 1000, sourceMs: 30000, score: 1 }] })
  })

  it('matches kana ASR to dictionary kanji without assigning reading-character times', () => {
    const kanaWords = source.map(item => word(item.reading!.replace(/[\u30a1-\u30f6]/g,
      character => String.fromCharCode(character.charCodeAt(0) - 0x60))))
    const audio = tokens(kanaWords.map(item => item.surface_form))
    expect(match(audio, kanaWords).points[0]).toEqual({ lineIndex: 0, heardMs: 1000, sourceMs: 30000, score: 1 })
  })

  it('rejects an onset inside an original token spanning a previous word', () => {
    const before = [word('海', 'ウミ'), word('で', 'デ'), ...heard]
    const audio = tokens(['海で思', 'い出', ...source.slice(1).map(item => item.surface_form)])
    expect(match(audio, before).points).toEqual([])
  })

  it('permits leading spaces and punctuation but retains the whole original onset token confidence', () => {
    const audio = original.map((item, index) => index === 0 ? { ...item, text: ' 。思い' } : item)
    expect(match(audio).points[0]?.heardMs).toBe(1000)
    expect(match(audio.map((item, index) => index === 1 ? { ...item, probability: .1 } : item)).points).toEqual([])
  })

  it('does not label an internal lyric phrase as that line start', () => {
    const longer = [word('遠い', 'トオイ'), word('町', 'マチ'), word('で', 'デ'), ...source]
    expect(match(original, heard, [longer]).points).toEqual([])
    expect(match(original, heard, [source, longer])).toEqual({ reason: 'ambiguous', points: [] })
  })

  it('does not mistake the middle of its own first reading for a competing onset', () => {
    const longer = [...source, word('遠い', 'トオイ'), word('街', 'マチ'), word('の', 'ノ'), word('光', 'ヒカリ'),
      word('まで', 'マデ'), word('歩いて', 'アルイテ'), word('行った', 'イッタ')]
    expect(match(original, heard, [longer])).toEqual({ reason: 'matched', points: [
      { lineIndex: 0, heardMs: 1000, sourceMs: 30000, score: 1 },
    ] })
  })

  it('rejects full-song repeated homophones and alternatives with different first sounds', () => {
    expect(match(original, heard, [source, heard])).toEqual({ reason: 'ambiguous', points: [] })
    const alternative = [word('あもい出', 'アモイデ'), ...source.slice(1)]
    expect(match(original, heard, [source, alternative])).toEqual({ reason: 'ambiguous', points: [] })
  })

  it('keeps a shorter alternative with an omitted particle ambiguous', () => {
    const a = [word('今日', 'キョウ'), word('も', 'モ'), word('君', 'キミ'), word('を', 'ヲ'), word('想う', 'オモウ')]
    const b = [a[0], a[1], a[2], a[4]]
    const audio = tokens(a.map(item => item.surface_form), .99)
    expect(match(audio, a, [a]).points).toHaveLength(1)
    expect(match(audio, a, [a, b])).toEqual({ reason: 'ambiguous', points: [] })
  })

  it('checks shorter near repetitions at disjoint word starts in the same line', () => {
    const repeated = [...source, word('遠い', 'トオイ'), word('町', 'マチ'), word('で', 'デ'),
      ...source.filter((_item, index) => index !== 1)]
    expect(match(original, heard, [repeated])).toEqual({ reason: 'ambiguous', points: [] })
  })

  it('keeps collisions introduced by prolonged-vowel and kana folds ambiguous', () => {
    const a = [word('今日', 'キョウ'), word('も', 'モ'), word('君', 'キミ'), word('を', 'ヲ'), word('想う', 'オモウ')]
    const b = [word('きょー'), ...a.slice(1)]
    const audio = tokens(a.map(item => item.surface_form))
    expect(match(audio, a, [a]).points).toHaveLength(1)
    expect(match(audio, a, [a, b])).toEqual({ reason: 'ambiguous', points: [] })
  })

  it('requires independent, well-supported original tokens, including a word split across tokens', () => {
    for (const index of [0, 1, 4]) {
      expect(match(original.map((item, order) => order === index ? { ...item, probability: .3 } : item)).points).toEqual([])
    }
    expect(match(original.map(item => ({ ...item, probability: .79 }))).points).toEqual([])
    expect(match(original.map(item => ({ ...item, startMs: 1000 }))).points).toEqual([])
    expect(match(tokens([text(heard)]), heard).points).toEqual([])
  })

  it('can use a complete unique long prefix without claiming an unreliable trailing word was heard', () => {
    expect(match(original.map((item, index) => index === original.length - 1
      ? { ...item, probability: .3 } : item)).points).toHaveLength(1)
  })

  it('rejects missing first sounds, unknown Han, and mismatched analyzer surfaces', () => {
    expect(match(tokens(['い出', ...source.slice(1).map(item => item.surface_form)]),
      [word('い出', 'イデ'), ...source.slice(1)]).points).toEqual([])
    expect(match(original, heard, [[word('想い出'), ...source.slice(1)]]).points).toEqual([])
    expect(match(original, heard, [source, [word('𠮷'), word('の', 'ノ'), word('歌', 'ウタ')]]).points).toEqual([])
    expect(match(original, [word('思い出'), ...heard.slice(1)]).points).toEqual([])
    expect(match(original, [word('違う', 'チガウ'), ...heard.slice(1)]).points).toEqual([])
    expect(match(original, heard, [[word('思い出', 'オモイデ'), ...source.slice(1)]])
      .points).toHaveLength(1)
    expect(extractPhoneticLandmarks(original, [{ text: text(source), startMs: 30000 }], 12000, heard,
      [[word('思い出', 'オモイデ'), ...source.slice(1)]])).toEqual({ reason: 'insufficient-words', points: [] })
  })

  it('normalizes prolonged vowels consistently across different dictionary boundaries', () => {
    const sourceWords = [word('今日', 'キョウ'), word('も', 'モ'), word('君', 'キミ'), word('を', 'ヲ'), word('想う', 'オモウ')]
    const heardWords = [word('きょ'), word('う'), word('も'), word('きみ'), word('を'), word('おも'), word('う')]
    expect(match(tokens(heardWords.map(item => item.surface_form)), heardWords, [sourceWords]).points).toHaveLength(1)
  })

  it('preserves Latin as literal evidence instead of accepting missing or invented English readings', () => {
    const mixed = [source[0], word('Star', 'スター'), ...source.slice(1)]
    const audioWords = [heard[0], word('Star', 'スター'), ...heard.slice(1)]
    const audio = tokens(['思い', '出', 'Star', ...source.slice(1).map(item => item.surface_form)])
    expect(match(audio, audioWords, [mixed]).points).toHaveLength(1)
    expect(match(original, heard, [mixed]).points).toEqual([])
    const replacedWords = [heard[0], word('スター'), ...heard.slice(1)]
    const replaced = tokens(['思い', '出', 'スター', ...source.slice(1).map(item => item.surface_form)])
    expect(match(replaced, replacedWords, [mixed]).points).toEqual([])
  })

  it('requires complete short kana lines with stronger confidence and timing support', () => {
    const short = [word('今日', 'キョウ'), word('も', 'モ'), word('君', 'キミ'), word('を', 'ヲ'), word('想う', 'オモウ')]
    const audio = tokens(short.map(item => item.surface_form))
    expect(match(audio, short, [short]).points).toHaveLength(1)
    expect(match(audio.map(item => ({ ...item, probability: .89 })), short, [short]).points).toEqual([])
    expect(match(audio.slice(0, -1), short.slice(0, -1), [short]).points).toEqual([])
    expect(match(audio.map((item, index) => ({ ...item, startMs: 1000 + index * 100 })), short, [short]).points).toEqual([])
  })

  it('refuses clipped audio edges and repeated ASR occurrences', () => {
    expect(match(original.map((item, index) => index === 0 ? { ...item, startMs: 10 } : item)).points).toEqual([])
    expect(match(original.map((item, index) => index >= original.length - 2
      ? { ...item, startMs: 11900 + index * 5 } : item)).points).toEqual([])
    const repeated = [...original, ...original.map(item => ({ ...item, startMs: item.startMs + 5000, endMs: 12000 }))]
    expect(match(repeated, [...heard, ...heard])).toEqual({ reason: 'ambiguous', points: [] })
  })

  it('does bounded work and abstains on malformed or oversized input', () => {
    expect(match(original, heard, Array(401).fill(source)).points).toEqual([])
    expect(extractPhoneticLandmarks(original, [{ text: text(source), startMs: 1 }], 12000, heard, [])).toEqual({ reason: 'insufficient-words', points: [] })
    expect(match(original.map(item => ({ ...item, timing: undefined }))).points).toEqual([])
    expect(match(original.map(item => ({ ...item, endMs: NaN }))).points).toEqual([])
    expect(match(original, [...heard, word('余計', 'ヨケイ')]).points).toEqual([])
  })
})
