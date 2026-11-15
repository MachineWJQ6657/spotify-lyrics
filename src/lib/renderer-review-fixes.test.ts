import { describe, expect, it } from 'vitest'
import { activeLineIndex, alignSecondaryTrack, parseLrc, retimeLines } from './lyrics'
import { findLineMatches, foldForFind } from './find-lyrics'

// Regressions from the sixth review (0.4.72). Synthetic text only.

describe('secondary rows in a fast passage', () => {
  const original = parseLrc('[00:10.00]o1\n[00:11.00]o2\n[00:12.00]o3\n[00:13.00]o4\n[00:17.00]o5\n[00:21.00]o6')
  const translation = parseLrc('[00:10.00]t1\n[00:11.00]t2\n[00:12.00]t3\n[00:13.00]t4\n[00:17.00]t5\n[00:21.00]t6')
  const texts = (base: typeof original, secondary: typeof translation) => alignSecondaryTrack(base, secondary).map(line => line?.text ?? null)
  const own = ['t1', 't2', 't3', 't4', 't5', 't6']

  it('stay on their own rows after one track is nudged by 100 ms', () => {
    // Before: a fixed 1.2 s look-ahead gave each line to the row after its own.
    expect(texts(retimeLines(original, 100), translation)).toEqual(own)
    expect(texts(retimeLines(original, -100), translation)).toEqual(own)
    expect(texts(original, retimeLines(translation, 100))).toEqual(own)
    expect(texts(original, retimeLines(translation, -100))).toEqual(own)
    expect(texts(original, retimeLines(translation, 20))).toEqual(own)
  })

  it('stay on their own rows when an imported translation is 60 to 250 ms late', () => {
    const imported = parseLrc('[00:10.08]t1\n[00:11.20]t2\n[00:12.06]t3\n[00:13.25]t4\n[00:17.10]t5\n[00:21.15]t6')
    expect(texts(original, imported)).toEqual(own)
  })

  it('still give a translation stamped shortly before a line to that line', () => {
    // 300 ms before the row at 17 s, four seconds into the row before it.
    const early = parseLrc('[00:10.00]t1\n[00:11.00]t2\n[00:12.00]t3\n[00:13.00]t4\n[00:16.70]t5\n[00:21.00]t6')
    expect(texts(original, early)).toEqual(own)
  })

  it('still keep a late second phrase with the long row it belongs to', () => {
    const base = parseLrc('[00:10.00]a long sung sentence\n[00:20.00]the next sentence')
    const split = parseLrc('[00:10.00]first half\n[00:14.00]second half\n[00:20.00]next')
    expect(alignSecondaryTrack(base, split).map(line => line?.text)).toEqual(['first half　second half', 'next'])
  })
})

describe('word-timed lines', () => {
  it('keep the words before the first word tag', () => {
    const [line] = parseLrc('[00:10.00]alpha <00:10.50>beta <00:11.00>gamma')
    expect(line.text).toBe('alpha beta gamma')
    // Rows render only `words`: the untagged first word used to be missing from the display.
    expect(line.words?.map(word => word.text).join('')).toBe('alpha beta gamma')
    expect(line.words?.[0]).toEqual({ text: 'alpha ', startMs: 10_000 })
  })

  it('are unchanged when the first word is tagged', () => {
    const [line] = parseLrc('[00:10.00]<00:10.00>alpha <00:10.50>beta')
    expect(line.words).toEqual([{ text: 'alpha ', startMs: 10_000 }, { text: 'beta', startMs: 10_500 }])
  })
})

describe('rows with one timestamp', () => {
  it('become one row, so the first of them can be the active line', () => {
    const lines = parseLrc('[00:05.00]before\n[00:10.00]lead line\n[00:10.00](backing vocal line)\n[00:14.00]after')
    expect(lines.map(line => line.text)).toEqual(['before', 'lead line　(backing vocal line)', 'after'])
    expect(lines[activeLineIndex(lines, 11_000)].text).toContain('lead line')
    expect(lines[1].endMs).toBe(14_000)
  })

  it('count the same words once, and leave rows repeated at different times alone', () => {
    expect(parseLrc('[00:10.00]same\n[00:10.00]same\n[00:12.00]other').map(line => line.text)).toEqual(['same', 'other'])
    expect(parseLrc('[00:05.00][01:05.00]chorus\n[00:10.00]other').map(line => line.text)).toEqual(['chorus', 'other', 'chorus'])
  })
})

describe('find in lyrics', () => {
  const rows = [['Don’t look back', '', '不要回头'], ['I’m at the café', '', '我在咖啡馆'], ['がんばれ', 'ganbare', '加油'], ['かんたん', 'kantan', '简单']]

  it('finds typographic apostrophes with the one a keyboard types, and the other way round', () => {
    expect(findLineMatches(rows, "don't")).toEqual([0])
    expect(findLineMatches(rows, 'don’t')).toEqual([0])
    expect(findLineMatches(rows, "i'm")).toEqual([1])
  })

  it('ignores Latin accents', () => {
    expect(findLineMatches(rows, 'cafe')).toEqual([1])
    expect(findLineMatches(rows, 'café')).toEqual([1])
  })

  it('still tells voiced kana from unvoiced', () => {
    expect(foldForFind('が')).not.toBe(foldForFind('か'))
    expect(findLineMatches(rows, 'かん')).toEqual([3])
    expect(findLineMatches(rows, 'がん')).toEqual([2])
  })
})
