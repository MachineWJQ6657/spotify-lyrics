import { expect, it } from 'vitest'
import { sourceLabel } from './source-label'
it('never presents cached metadata rankings as accuracy percentages', () => {
  expect(sourceLabel('酷狗音乐 · 搜索匹配 98%')).toBe('酷狗音乐 · 搜索候选')
  expect(sourceLabel('LRCLIB · 精确匹配')).toBe('LRCLIB · 元数据匹配')
  expect(sourceLabel('Spotify · Musixmatch')).toBe('Spotify · Musixmatch')
})
