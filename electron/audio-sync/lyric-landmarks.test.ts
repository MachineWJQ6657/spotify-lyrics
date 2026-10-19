import { describe, expect, it } from 'vitest'
import { extractLyricLandmarks } from './lyric-landmarks'
import type { HeardToken } from './lyric-aligner'

// Original test sentences; no captured or third-party lyrics are embedded.
const first = 'あおぞらを見ながら歩いていたよ'
const second = 'みどりの窓辺に新しい光が差した'
const tokenise = (text: string, startMs = 1000): HeardToken[] => [...text].map((text, index) => ({
  text, startMs: startMs + index * 120, endMs: startMs + (index + 1) * 120,
  probability: .96, timing: 'dtw', endIsUpperBound: true,
}))
const source = [{ text: first, startMs: 60000 }]

describe('unique lyric line-start landmarks', () => {
  it('retains a reliable prefix of a long combined line when the rest was transcribed incorrectly', () => {
    // Mirrors the saved long-line failure shape: 12 reliable leading characters
    // at 5.88 s followed by wrong text; does not assert exact sung onset timing.
    const prefix = first.slice(0, 12)
    const result = extractLyricLandmarks([...tokenise(prefix, 5880), ...tokenise('知らない言葉が続いた', 8500)],
      [{ text: first + second, startMs: 170052 }], 12000)
    expect(result).toEqual({ reason: 'matched', points: [{ lineIndex: 0, sourceMs: 170052, heardMs: 5880, score: 1 }] })
  })
  it('does not turn an internal phrase into the source line start', () => {
    expect(extractLyricLandmarks(tokenise(first.slice(4)), source, 12000).points).toEqual([])
  })
  it.each(['identical', 'similar', 'inside-other-line', 'inside-same-line'] as const)('rejects whole-source competition: %s', kind => {
    const other = kind === 'identical' ? first : kind === 'similar' ? first.slice(0, -1) + 'ね' : 'ゆめの' + first
    const lines = kind === 'inside-same-line'
      ? [{ text: first + 'ゆめの' + first, startMs: 60000 }]
      : [...source, { text: other, startMs: 150000 }]
    expect(extractLyricLandmarks(tokenise(first), lines, 12000)).toEqual({ reason: 'ambiguous', points: [] })
  })
  it('can distinguish a shared short prefix using enough reliable later words', () => {
    const lines = [...source, { text: first.slice(0, 12) + '夕暮れの街へ', startMs: 150000 }]
    expect(extractLyricLandmarks(tokenise(first), lines, 12000).points).toHaveLength(1)
    expect(extractLyricLandmarks(tokenise(first.slice(0, 12)), lines, 12000).reason).toBe('ambiguous')
  })
  it('rejects a competing line start with a changed first character and otherwise identical twelve-character prefix', () => {
    const prefix = first.slice(0, 12)
    expect(extractLyricLandmarks(tokenise(prefix), [
      { text: prefix + second, startMs: 60000 },
      { text: 'う' + prefix.slice(1) + second, startMs: 150000 },
    ], 12000)).toEqual({ reason: 'ambiguous', points: [] })
  })
  it('does not pick between repeated heard occurrences of one source start', () => {
    expect(extractLyricLandmarks([...tokenise(first), ...tokenise(first, 6000)], source, 12000).reason).toBe('ambiguous')
  })
  it('retains separate unique lines without estimating a rate or a block-end position', () => {
    const result = extractLyricLandmarks([...tokenise(first), ...tokenise(second, 6000)],
      [...source, { text: second, startMs: 65000 }], 12000)
    expect(result.points).toEqual([{ lineIndex: 0, heardMs: 1000, sourceMs: 60000, score: 1 },
      { lineIndex: 1, heardMs: 6000, sourceMs: 65000, score: 1 }])
  })
  it.each(['clipped-left', 'clipped-right', 'weak-first', 'weak-middle', 'weak-end', 'offsets-only', 'one-token', 'short-span'] as const)(
    'abstains with unreliable timing or words: %s', kind => {
      let tokens = tokenise(first)
      if (kind === 'clipped-left') tokens = tokenise(first, 0)
      if (kind === 'clipped-right') tokens = tokenise(first.slice(0, 12), 11000)
      if (kind === 'weak-first') tokens[0].probability = .1
      if (kind === 'weak-middle') tokens[5].probability = .1
      if (kind === 'weak-end') tokens = tokens.map((token, index) => ({ ...token, probability: index >= 11 ? .1 : .96 }))
      if (kind === 'offsets-only') tokens = tokens.map(({ timing: _timing, endIsUpperBound: _bound, ...token }) => token)
      if (kind === 'one-token') tokens = [{ ...tokens[0], text: first, endMs: 9000 }]
      if (kind === 'short-span') tokens = tokens.map((token, index) => ({ ...token, startMs: 1000 + index * 10 }))
      expect(extractLyricLandmarks(tokens, source, 12000).points).toEqual([])
    },
  )
  it('rejects malformed and oversized inputs', () => {
    for (const tokens of [tokenise(first).map(token => ({ ...token, probability: NaN })),
      tokenise(first).reverse(), Array(601).fill(tokenise(first)[0])]) {
      expect(extractLyricLandmarks(tokens, source, 12000).points).toEqual([])
    }
    expect(extractLyricLandmarks(tokenise(first), Array(401).fill(source[0]), 12000).points).toEqual([])
  })
})

describe('high-confidence complete short CJK line landmarks', () => {
  const short = '小さな窓を開けよう'
  const lines = [{ text: short, startMs: 90000 }]
  it('accepts an entire nine-character original line with independent strong DTW points', () => {
    expect(extractLyricLandmarks(tokenise(short, 1340), lines, 12000)).toEqual({ reason: 'matched',
      points: [{ lineIndex: 0, sourceMs: 90000, heardMs: 1340, score: 1 }] })
  })
  it.each(['weak-first', 'weak-last', 'weak-middle', 'weak-mean', 'three-points', 'short-span', 'clip-left', 'clip-right',
    'missing-ending', 'changed-text', 'short-latin', 'short-mixed-script', 'prefix-of-long-line'] as const)(
    'rejects unreliable or ineligible short evidence: %s', kind => {
      let tokens = tokenise(short), lyrics = lines
      if (kind === 'weak-first') tokens[0].probability = .84
      if (kind === 'weak-last') tokens[tokens.length - 1].probability = .84
      if (kind === 'weak-middle') tokens[4].probability = .74
      if (kind === 'weak-mean') tokens = tokens.map((token, index) => ({ ...token, probability: index === 0 || index === tokens.length - 1 ? .96 : .85 }))
      if (kind === 'three-points') tokens = tokens.map((token, index) => ({ ...token, startMs: 1000 + Math.floor(index / 3) * 500 }))
      if (kind === 'short-span') tokens = tokens.map((token, index) => ({ ...token, startMs: 1000 + index * 80 }))
      if (kind === 'clip-left') tokens = tokenise(short, 0)
      if (kind === 'clip-right') tokens = tokenise(short, 10900)
      if (kind === 'missing-ending') tokens = tokens.slice(0, -1)
      if (kind === 'changed-text') tokens[4].text = 'が'
      if (kind === 'short-latin') { tokens = tokenise('openwindow'); lyrics = [{ text: 'openwindow', startMs: 90000 }] }
      if (kind === 'short-mixed-script') { tokens = tokenise('小さなwindow'); lyrics = [{ text: '小さなwindow', startMs: 90000 }] }
      if (kind === 'prefix-of-long-line') lyrics = [{ text: short + first, startMs: 90000 }]
      expect(extractLyricLandmarks(tokens, lyrics, 12000).points).toEqual([])
    },
  )
  it.each(['identical', 'changed-first', 'changed-last', 'internal', 'changed-internal'] as const)(
    'rejects short whole-source competition: %s', kind => {
      const competitor = kind === 'identical' ? short : kind === 'changed-first' ? '大' + short.slice(1)
        : kind === 'changed-last' ? short.slice(0, -1) + 'ね' : kind === 'internal' ? 'ゆめの' + short
        : 'ゆめの大' + short.slice(1)
      expect(extractLyricLandmarks(tokenise(short), [...lines, { text: competitor, startMs: 160000 }], 12000))
        .toEqual({ reason: 'ambiguous', points: [] })
    },
  )
})
