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
})
