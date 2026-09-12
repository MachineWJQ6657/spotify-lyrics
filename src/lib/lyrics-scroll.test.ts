import { describe, expect, it } from 'vitest'
import { lyricScrollTarget } from './lyrics-scroll'
import { activeLineIndex, parseLrc } from './lyrics'

describe('lyrics follow scroll target', () => {
  it('returns to the document top before the first timed lyric', () => {
    const lines = parseLrc('[00:20.58]first line\n[00:24.00]second line')
    expect(activeLineIndex(lines, 14_903)).toBe(-1)
    expect(activeLineIndex(lines, 20_580)).toBe(0)
    expect(lyricScrollTarget(-1, 600)).toBe(0)
  })

  it('centers an active row and clamps early rows to zero', () => {
    expect(lyricScrollTarget(0, 600, { offsetTop: 80, offsetHeight: 100 })).toBe(0)
    expect(lyricScrollTarget(4, 600, { offsetTop: 700, offsetHeight: 120 })).toBe(496)
    expect(lyricScrollTarget(4, 600)).toBeNull()
  })
})
