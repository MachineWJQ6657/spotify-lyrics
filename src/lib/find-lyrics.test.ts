import { describe, expect, it } from 'vitest'
import { findLineMatches, foldForFind, nearestMatch, stepMatch } from './find-lyrics'

const rows = [
  ['君の声が聞こえる', 'kimi no koe ga kikoeru', '听见了你的声音'],
  ['キミとＬＯＶＥ', 'kimi to love', '和你相爱'],
  ['', '', ''],
  ['Stay with me', '', '留在我身边'],
  ['繕って 繕って', 'tsukurotte tsukurotte', '修补 弥合'],
  ['音楽が何だって言うんだ', 'ongaku ga nan datte iu nda', '音乐究竟是什么']
]

describe('find in lyrics', () => {
  it('folds case, width, repeated spaces and kana type', () => {
    expect(foldForFind('ＬＯＶＥ　 Song ')).toBe('love song')
    expect(foldForFind('キミ')).toBe(foldForFind('きみ'))
    expect(foldForFind('ｷﾐ')).toBe(foldForFind('きみ'))
  })
  it('matches the original, the romaji and the translation', () => {
    expect(findLineMatches(rows, 'kimi')).toEqual([0, 1])
    expect(findLineMatches(rows, 'きみ')).toEqual([1])
    expect(findLineMatches(rows, 'love')).toEqual([1])
    expect(findLineMatches(rows, '你')).toEqual([0, 1])
    expect(findLineMatches(rows, 'STAY  WITH')).toEqual([3])
  })
  it('keeps word boundaries in romaji and English', () => {
    // "ga nan" must not match "ana".
    expect(findLineMatches(rows, 'ana')).toEqual([])
    expect(findLineMatches(rows, 'ga nan')).toEqual([5])
    expect(findLineMatches(rows, 'kimi no')).toEqual([0])
  })
  it('ignores spaces for kana and kanji', () => {
    expect(findLineMatches(rows, '繕って繕って')).toEqual([4])
    expect(findLineMatches(rows, '修补弥合')).toEqual([4])
    expect(findLineMatches(rows, '君の 声')).toEqual([0])
  })
  it('finds nothing for an empty or absent query', () => {
    expect(findLineMatches(rows, '')).toEqual([])
    expect(findLineMatches(rows, '   ')).toEqual([])
    expect(findLineMatches(rows, 'zzz')).toEqual([])
  })
  it('steps through matches and wraps', () => {
    expect(stepMatch(0, 3, 1)).toBe(1)
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
    expect(stepMatch(9, 3, 1)).toBe(0)
    expect(stepMatch(0, 0, 1)).toBe(0)
  })
  it('starts at the first match from the line being sung', () => {
    expect(nearestMatch([2, 8, 20], 5)).toBe(1)
    expect(nearestMatch([2, 8, 20], 8)).toBe(1)
    expect(nearestMatch([2, 8, 20], 30)).toBe(0)
    expect(nearestMatch([2, 8, 20], -1)).toBe(0)
    expect(nearestMatch([], 3)).toBe(0)
  })
})
