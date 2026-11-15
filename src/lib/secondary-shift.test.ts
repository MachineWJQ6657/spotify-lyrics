import { describe, expect, it } from 'vitest'
import { alignSecondaryTrack } from './lyrics'
import { isLyricCredit } from './lyric-metadata'
import { secondaryTrackShift } from './secondary-shift'

// Regressions found by the review of 0.4.71-0.4.73 (fixed in 0.4.74). Synthetic text only.

const rows = (gaps: number[], count: number) => { let at = 10_000; return Array.from({ length: count }, (_, index) => { const line = { startMs: at, text: `o${index}` }; at += gaps[index % gaps.length]; return line }) }
const shifted = (base: Array<{ startMs: number }>, by: number) => base.map((line, index) => ({ startMs: line.startMs + by, text: `t${index}` }))
const placed = (base: ReturnType<typeof rows>, secondary: ReturnType<typeof shifted>) => alignSecondaryTrack(base, secondary).filter((line, index) => line?.text === `t${index}`).length

describe('a secondary track that is early or late as a whole', () => {
  it('finds the amount, and none when the stamps sit on their rows', () => {
    const base = rows([1600], 40)
    expect(secondaryTrackShift(base.map(line => line.startMs), shifted(base, -900).map(line => line.startMs))).toBe(-900)
    expect(secondaryTrackShift(base.map(line => line.startMs), shifted(base, 400).map(line => line.startMs))).toBe(400)
    expect(secondaryTrackShift(base.map(line => line.startMs), shifted(base, 0).map(line => line.startMs))).toBe(0)
    expect(secondaryTrackShift(base.map(line => line.startMs), shifted(base, 10).map(line => line.startMs))).toBe(0)
  })

  it('keeps every row on its own line, early or late, where rows are short', () => {
    // 0.4.72 took the nearer row start: 900 ms early on 1.6 s rows put all 40 rows one row early.
    expect(placed(rows([1600], 40), shifted(rows([1600], 40), -900))).toBe(40)
    expect(placed(rows([2000, 1000, 3000], 40), shifted(rows([2000, 1000, 3000], 40), -600))).toBe(40)
    // Before 0.4.72 a fixed 1.2 s look-ahead put late rows one row late.
    expect(placed(rows([1600], 40), shifted(rows([1600], 40), 400))).toBe(40)
    expect(placed(rows([1000], 40), shifted(rows([1000], 40), 100))).toBe(40)
  })

  it('does not move a track because a few of its rows are off', () => {
    const base = rows([4000, 5000, 3000], 30)
    const secondary = shifted(base, 0).map((line, index) => index % 7 === 3 ? { ...line, startMs: line.startMs - 700 } : line)
    expect(secondaryTrackShift(base.map(line => line.startMs), secondary.map(line => line.startMs))).toBe(0)
    expect(placed(base, secondary)).toBe(30)
  })
})

describe('part labels inside the lyrics', () => {
  it.each(['和声：啦啦啦啦', '和音: oh oh oh', 'Bass: how low can you go', 'Vocal: la la la la'])('keeps the sung row %s', text => {
    expect(isLyricCredit(text)).toBe(false)
  })
  it.each(['和声：陈某', 'Bass：Takeo', 'Guitar: raku', '和声编写：某人', 'Vocal: suis'])('still drops the credit %s', text => {
    expect(isLyricCredit(text)).toBe(true)
  })
})
