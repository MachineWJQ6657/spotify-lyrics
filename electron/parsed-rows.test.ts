import { describe, expect, it } from 'vitest'
import { parseTimedRows } from './lyrics-provider'

const LRC = ['[00:10.00]first line', '[00:05.50]earlier line', '[00:20.00][00:40.00]twice', '[00:30.00]作词 : someone'].join('\n')

describe('parsed lyric rows are kept between calls', () => {
  it('gives every call the same rows in its own array', () => {
    const first = parseTimedRows(LRC)
    expect(first.map(row => row.timeMs)).toEqual([5500, 10_000, 20_000, 40_000])
    // A caller may sort, cut or extend what it got.
    first.reverse()
    first.length = 1
    const second = parseTimedRows(LRC)
    expect(second.map(row => row.text)).toEqual(['earlier line', 'first line', 'twice', 'twice'])
    expect(second).not.toBe(first)
  })

  it('does not let a caller change a kept row', () => {
    const [row] = parseTimedRows(LRC)
    expect(() => { (row as { timeMs: number }).timeMs = 0 }).toThrow(TypeError)
    expect(parseTimedRows(LRC)[0].timeMs).toBe(5500)
  })

  it('answers for nothing and keeps working past its limit', () => {
    expect(parseTimedRows(null)).toEqual([])
    expect(parseTimedRows('')).toEqual([])
    for (let index = 0; index < 200; index++) expect(parseTimedRows(`[00:01.00]line ${index}`)).toHaveLength(1)
    expect(parseTimedRows(LRC)).toHaveLength(4)
  })
})
