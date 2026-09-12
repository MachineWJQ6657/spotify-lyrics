import { describe, expect, it } from 'vitest'
import { scriptPresentation } from './script'

describe('metadata script presentation', () => {
  it('uses the Japanese grid for a pure-kanji title when lyrics identify Japanese', () => {
    expect(scriptPresentation('晩餐歌', 'tuki.', 'ja')).toEqual({ className: 'japanese-grid', lang: 'ja' })
  })

  it('keeps a pure-Han title in the Chinese font without Japanese evidence', () => {
    expect(scriptPresentation('晴天', '周杰伦', 'zh-Hans')).toEqual({ className: 'chinese-text', lang: 'zh-CN' })
  })

  it('still detects kana without waiting for lyrics', () => {
    expect(scriptPresentation('だから僕は音楽を辞めた')).toEqual({ className: 'japanese-grid', lang: 'ja' })
  })
})
