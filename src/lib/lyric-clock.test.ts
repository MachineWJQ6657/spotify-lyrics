import { describe, expect, it } from 'vitest'
import { msUntilNextLyricChange, wallDelayMs } from './lyric-clock'

const lines = [
  { startMs: 1000, text: 'one' },
  { startMs: 4000, text: 'two', words: [{ startMs: 4000, text: 'tw' }, { startMs: 4600, text: 'o' }] },
  { startMs: 9000, text: 'three' }
]

describe('next lyric change', () => {
  it('is the next line start', () => {
    expect(msUntilNextLyricChange(lines, 0)).toBe(1000)
    expect(msUntilNextLyricChange(lines, 2500)).toBe(1500)
  })
  it('includes the next word of a word-timed active line', () => {
    expect(msUntilNextLyricChange(lines, 4100)).toBe(500)
    expect(msUntilNextLyricChange(lines, 4700)).toBe(4300)
  })
  it('is undefined after the last line or without lines', () => {
    expect(msUntilNextLyricChange(lines, 9500)).toBeUndefined()
    expect(msUntilNextLyricChange([], 0)).toBeUndefined()
    expect(msUntilNextLyricChange(lines, Number.NaN)).toBeUndefined()
  })
  it('converts to wall time on a scaled clock', () => {
    expect(wallDelayMs(1200, 1.2)).toBe(1000)
    expect(wallDelayMs(1000, 0)).toBe(1000)
    expect(wallDelayMs(undefined)).toBeUndefined()
  })
})
