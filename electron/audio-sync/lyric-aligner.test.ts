import { describe, expect, it } from 'vitest'
import { alignHeardLyrics, parseWhisperTokens, type HeardToken } from './lyric-aligner'

// Synthetic, original sentences. These verify logic, NOT recognition of music.
const text = ['あおぞらを見ながら歩いていた', 'みどりの道をゆっくり進んだ', 'あたらしい窓を開いてみよう']
const lines = text.map((text, i) => ({ text, startMs: 61000 + i * 4000 }))
const tokens = (rate = 1): HeardToken[] => text.flatMap((line, i) => [...line].map((letter, j) => ({ text: letter,
  startMs: (1000 + i * 4000 + j * 120) / rate, endMs: (1100 + i * 4000 + j * 120) / rate, probability: .95 })))

describe('audio words to original lyric alignment', () => {
  it('locates a passage without any Spotify position or reference audio', () => {
    const match = alignHeardLyrics(tokens(), lines, 12000)
    expect(match.accepted).toBe(true)
    expect(match.sourceEndMs).toBeCloseTo(72000)
    expect(match.rate).toBeCloseTo(1)
    expect(match.lineIndices).toEqual([0, 1, 2])
  })
  it('estimates tempo from heard line onsets, not song durations', () => {
    const match = alignHeardLyrics(tokens(1.05), lines, 12000)
    expect(match.accepted).toBe(true)
    expect(match.rate).toBeCloseTo(1.05)
    expect(match.sourceEndMs).toBeCloseTo(72600)
  })
  it('rejects identical chorus sections instead of resolving them using Spotify', () => {
    expect(alignHeardLyrics(tokens(), [...lines, ...lines.map(line => ({ ...line, startMs: line.startMs + 90000 }))], 12000).reason).toBe('ambiguous')
  })
  it('allows small spelling differences without loosening time evidence', () => {
    const heard = tokens(); heard[6] = { ...heard[6], text: 'み' }
    expect(alignHeardLyrics(heard, lines, 12000).accepted).toBe(true)
  })
  it.each(['silence', 'hallucination', 'weak-probability', 'segment-only', 'wrong-language', 'bad-clock'] as const)('abstains for %s', kind => {
    const heard = kind === 'silence' ? [] : kind === 'hallucination'
      ? [{ text: 'ご視聴ありがとうございました', startMs: 1000, endMs: 2000, probability: .99 }]
      : kind === 'weak-probability' ? tokens().map(token => ({ ...token, probability: .2 }))
      : kind === 'segment-only' ? [{ text: text.join(''), startMs: 0, endMs: 12000, probability: .99 }]
      : kind === 'wrong-language' ? [{ text: '한국어 발음과 다른 내용을 노래하고 있어요', startMs: 1000, endMs: 2000, probability: .99 }]
      : tokens(.5)
    expect(alignHeardLyrics(heard, lines, 12000).accepted).toBe(false)
  })
  it('bounds malformed lyric and transcription workloads', () => {
    expect(alignHeardLyrics(tokens(), Array(401).fill(lines[0]), 12000).accepted).toBe(false)
    expect(alignHeardLyrics([{ text: 'あ'.repeat(801), startMs: 10, endMs: 50, probability: 1 }], lines, 12000).accepted).toBe(false)
  })
  it('uses real token offsets and rejects missing, backwards or out-of-range offsets', () => {
    const item = { text: 'あおぞら', offsets: { from: 1000, to: 1300 }, p: .9 }
    expect(parseWhisperTokens({ transcription: [{ tokens: [item] }] }, 12000)).toEqual([{ text: item.text, startMs: 1000, endMs: 1300, probability: .9 }])
    for (const bad of [{ ...item, offsets: undefined }, { ...item, offsets: { from: 1500, to: 1300 } }, { ...item, p: NaN }]) {
      expect(parseWhisperTokens({ transcription: [{ tokens: [bad] }] }, 12000)).toEqual([])
    }
    expect(parseWhisperTokens({ transcription: [{ text: 'segment only', offsets: { from: 0, to: 12000 } }] }, 12000)).toEqual([])
  })
  it('uses requested DTW localization instead of stretched offsets and keeps end bounds explicit', () => {
    const heard = [{ text: '今日', t_dtw: 756, p: .9, offsets: { from: 10, to: 2490 } },
      { text: 'も', t_dtw: 824, p: .95, offsets: { from: 2490, to: 3750 } }]
    expect(parseWhisperTokens({ transcription: [{ tokens: heard }] }, 12000, { timing: 'dtw' })).toEqual([
      { text: '今日', startMs: 7560, endMs: 8240, probability: .9, timing: 'dtw', endIsUpperBound: true },
      { text: 'も', startMs: 8240, endMs: 12000, probability: .95, timing: 'dtw', endIsUpperBound: true },
    ])
  })
  it('keeps same-frame subword characters together without manufacturing time or confidence', () => {
    const heard = [{ text: 'あ', t_dtw: 100, p: .9 }, { text: 'お', t_dtw: 100, p: .7 }, { text: 'ぞら', t_dtw: 130, p: .95 }]
    const result = parseWhisperTokens({ transcription: [{ tokens: heard }] }, 12000, { timing: 'dtw' })
    expect(result.map(token => token.text).join('')).toBe('あおぞら')
    expect(result[0]).toMatchObject({ text: 'あお', startMs: 1000, endMs: 1300, probability: .7 })
  })
  it('rejects missing, invalid, backwards and constant DTW instead of falling back to plausible offsets', () => {
    const item = { text: 'あおぞら', t_dtw: 100, offsets: { from: 1000, to: 1300 }, p: .9 }
    for (const t_dtw of [undefined, null, -1, NaN, Infinity, 1200, 100.5, 99, 100, 101]) {
      const heard = [item, { ...item, t_dtw }]
      expect(parseWhisperTokens({ transcription: [{ tokens: heard }] }, 12000, { timing: 'dtw' })).toEqual([])
    }
  })
  it('preserves existing lyric confidence and ambiguity gates with DTW timing', () => {
    const heard = tokens().map(token => ({ text: token.text, p: token.probability, t_dtw: token.startMs / 10 }))
    const parsed = parseWhisperTokens({ transcription: [{ tokens: heard }] }, 12000, { timing: 'dtw' })
    expect(alignHeardLyrics(parsed, lines, 12000).accepted).toBe(true)
    expect(alignHeardLyrics(parsed.map(token => ({ ...token, probability: .2 })), lines, 12000).accepted).toBe(false)
    expect(alignHeardLyrics(parsed, [...lines, ...lines.map(line => ({ ...line, startMs: line.startMs + 90000 }))], 12000).reason).toBe('ambiguous')
  })
  it('accepts two complete DTW phrases ending before the audio boundary without an unrelated trailing token', () => {
    const source = lines.slice(0, 2)
    const heard = tokens().slice(0, text[0].length + text[1].length)
      .map(token => ({ text: token.text, p: token.probability, t_dtw: token.startMs / 10 }))
    const parse = (items: typeof heard) => parseWhisperTokens({ transcription: [{ tokens: items }] }, 10000, { timing: 'dtw' })
    expect(parse(heard).at(-1)?.endMs).toBe(10000)
    const match = alignHeardLyrics(parse(heard), source, 10000)
    expect(match.accepted).toBe(true)
    expect(match.lineIndices).toEqual([0, 1])
    expect(alignHeardLyrics(parse([...heard, { text: '次', p: .95, t_dtw: 900 }]), source, 10000)).toEqual(match)
  })
  it('does not mistake a long gap to the next DTW point for the first token duration', () => {
    const source = lines.slice(0, 2)
    const heard = source.flatMap((line, i) => [...line.text].map((letter, j) => ({ text: letter, p: .95,
      t_dtw: (1000 + i * 4000 + (j === 0 ? 0 : 1500 + j * 100)) / 10 })))
    const parsed = parseWhisperTokens({ transcription: [{ tokens: heard }] }, 10000, { timing: 'dtw' })
    expect(parsed[0].endMs - parsed[0].startMs).toBeGreaterThan(1200)
    expect(alignHeardLyrics(parsed, source, 10000).accepted).toBe(true)
  })
  it.each(['missing-ending', 'touching-audio-edge', 'whole-line-token', 'low-confidence', 'unrelated-text'] as const)(
    'still rejects incomplete or unreliable DTW phrases: %s', kind => {
      const source = lines.slice(0, 2)
      let heard = tokens().slice(0, text[0].length + text[1].length)
        .map(token => ({ text: token.text, p: token.probability, t_dtw: token.startMs / 10 }))
      if (kind === 'missing-ending') heard = heard.slice(0, -1)
      if (kind === 'touching-audio-edge') heard[heard.length - 1].t_dtw = 980
      if (kind === 'whole-line-token') heard = source.map((line, i) => ({ text: line.text, p: .95, t_dtw: 100 + i * 400 }))
      if (kind === 'low-confidence') heard = heard.map(token => ({ ...token, p: .2 }))
      if (kind === 'unrelated-text') heard = heard.map(token => ({ ...token, text: '音' }))
      const parsed = parseWhisperTokens({ transcription: [{ tokens: heard }] }, 10000, { timing: 'dtw' })
      expect(alignHeardLyrics(parsed, source, 10000).accepted).toBe(false)
    },
  )
})
