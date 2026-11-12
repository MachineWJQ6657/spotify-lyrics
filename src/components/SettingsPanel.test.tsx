import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { rangeFill, SettingsPanel } from './SettingsPanel'

describe('settings panel', () => {
  it('groups settings into tabs and keeps the overlay toggle outside them', () => {
    const html = renderToStaticMarkup(<SettingsPanel onCollapse={() => {}} />)
    for (const tab of ['歌词', '同步', '悬浮窗', '连接']) expect(html).toContain(`>${tab}</button>`)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('歌词语言')
    expect(html).not.toContain('窗口大小与位置')
    expect(html).toMatch(/class="panel-footer"><button class="wide-button primary"/)
    expect(html).toContain('收起设置面板')
  })

  it('fills range tracks up to the thumb', () => {
    expect(rangeFill(52, 34, 88)).toBe('33.33333333333333%')
    expect(rangeFill(0, -30000, 30000)).toBe('50%')
    expect(rangeFill(5, 0, 0)).toBe('0%')
    expect(rangeFill(999, 0, 100)).toBe('100%')
  })
})
