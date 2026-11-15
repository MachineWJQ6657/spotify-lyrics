import { describe, expect, it } from 'vitest'
import { rowText, songText } from './copy-lyrics'

const rows = [
  ['君の声が聞こえる', 'kimi no koe ga kikoeru', '听见了你的声音'],
  ['', '', ''],
  [' 夜に駆ける ', 'yoru ni kakeru', ''],
  ['Stay with me']
]

describe('copy lyrics', () => {
  it('copies one row with the secondary rows on screen', () => {
    expect(rowText(rows[0])).toBe('君の声が聞こえる\nkimi no koe ga kikoeru\n听见了你的声音')
    expect(rowText(rows[2])).toBe('夜に駆ける\nyoru ni kakeru')
    expect(rowText(rows[1])).toBe('')
  })
  it('copies the original lines of the song without interludes', () => {
    expect(songText(rows, false)).toBe('君の声が聞こえる\n夜に駆ける\nStay with me')
  })
  it('copies the song as blocks when the secondary rows are included', () => {
    expect(songText(rows, true)).toBe('君の声が聞こえる\nkimi no koe ga kikoeru\n听见了你的声音\n\n夜に駆ける\nyoru ni kakeru\n\nStay with me')
  })
  it('is empty for a song without words', () => {
    expect(songText([['', '']], true)).toBe('')
    expect(songText([], false)).toBe('')
  })
})
