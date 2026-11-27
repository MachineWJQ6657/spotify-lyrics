import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LanguageSwitches, rangeFill, SettingsPanel } from './SettingsPanel'
import type { LyricsDocument } from '../types'

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

  it('offers to run listening calibration from the timing tab copy without disclaimers', () => {
    const html = renderToStaticMarkup(<SettingsPanel />)
    expect(html).not.toMatch(/不保存|不上传|不代表|未验证/)
  })

  it('says what each language switch can do for the song on screen', () => {
    const lines = [{ startMs: 0, text: 'a' }, { startMs: 1000, text: 'b' }]
    const lyrics = { trackId: 't', tracks: [
      { id: 'o', language: 'ja', label: '日本語', kind: 'original', source: 's', lines },
      { id: 'z', language: 'zh-Hans', label: '中文', kind: 'translation', source: 's', lines }
    ] } as LyricsDocument
    const html = renderToStaticMarkup(<LanguageSwitches document={lyrics} enabled={['ja', 'zh-Hans', 'en']} onToggle={() => {}} />)
    // The song's own language is shown whatever the switch says; English is on, and this song has none.
    expect(html).toMatch(/class="selected original"[^>]*title="这首歌的原文，始终显示"/)
    expect(html).toMatch(/class="selected missing"[^>]*title="这首歌没有这种语言的歌词：English"/)
    expect(html).toContain('<em>这首没有</em>')
    expect(html).toContain('class="language-note">这首歌没有这些语言的歌词：English。')
    // Chinese is there and switched on: an ordinary switch.
    expect(html).toContain('<button class="selected" aria-pressed="true"><i></i>中文<svg')
    // English switched off: still marked, but nothing is said below.
    const off = renderToStaticMarkup(<LanguageSwitches document={lyrics} enabled={['ja', 'zh-Hans']} onToggle={() => {}} />)
    expect(off).toMatch(/class="missing" aria-pressed="false"/)
    expect(off).not.toContain('language-note')
    // No song: plain switches.
    const idle = renderToStaticMarkup(<LanguageSwitches document={null} enabled={['ja', 'en']} onToggle={() => {}} />)
    expect(idle).not.toContain('这首没有')
    expect(idle).not.toContain('language-note')
  })

  it('fills range tracks up to the thumb', () => {
    expect(rangeFill(52, 34, 88)).toBe('33.33333333333333%')
    expect(rangeFill(0, -30000, 30000)).toBe('50%')
    expect(rangeFill(5, 0, 0)).toBe('0%')
    expect(rangeFill(999, 0, 100)).toBe('100%')
  })
})
