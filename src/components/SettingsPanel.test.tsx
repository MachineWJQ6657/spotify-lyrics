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
    expect(html).toContain('<button class="selected" aria-pressed="true"><i></i><span>中文</span><svg')
    // A name is one element that stays on one line, next to what is said about it.
    expect(html).toContain('<i></i><span>日本語</span><em>原文</em>')
    expect(html).toContain('<i></i><span>English</span><em>这首没有</em>')
    // English switched off: still marked, but nothing is said below.
    const off = renderToStaticMarkup(<LanguageSwitches document={lyrics} enabled={['ja', 'zh-Hans']} onToggle={() => {}} />)
    expect(off).toMatch(/class="missing" aria-pressed="false"/)
    expect(off).not.toContain('language-note')
    // No song: plain switches.
    const idle = renderToStaticMarkup(<LanguageSwitches document={null} enabled={['ja', 'en']} onToggle={() => {}} />)
    expect(idle).not.toContain('这首没有')
    expect(idle).not.toContain('language-note')
  })

  it('has a kana switch, and does not send the listener looking for readings a song cannot have', () => {
    const lines = [{ startMs: 0, text: 'a' }, { startMs: 1000, text: 'b' }]
    const japanese = { trackId: 't', tracks: [{ id: 'o', language: 'ja', label: '日本語', kind: 'original', source: 's', lines }] } as LyricsDocument
    const on = renderToStaticMarkup(<LanguageSwitches document={japanese} enabled={['ja', 'kana']} onToggle={() => {}} onPaste={() => {}} />)
    expect(on).toContain('<button class="selected" aria-pressed="true"><i></i><span>假名</span><svg')
    expect(on).not.toContain('language-note')
    // An English song has neither kana nor romaji: the switches say so, nothing below asks for a translation.
    const english = { trackId: 't', tracks: [{ id: 'o', language: 'en', label: 'English', kind: 'original', source: 's', lines }] } as LyricsDocument
    const other = renderToStaticMarkup(<LanguageSwitches document={english} enabled={['kana', 'romaji']} onToggle={() => {}} onPaste={() => {}} />)
    expect(other).toContain('<span>假名</span><em>这首没有</em>')
    expect(other).toContain('<span>Romaji</span><em>这首没有</em>')
    expect(other).not.toContain('language-note')
    expect(other).not.toContain('language-actions')
  })

  it('offers to bring a missing translation in from a web page, and to paste one again', () => {
    const lines = [{ startMs: 0, text: 'a' }, { startMs: 1000, text: 'b' }]
    const song = (...extra: LyricsDocument['tracks']) => ({ trackId: 't', tracks: [{ id: 'o', language: 'ja', label: '日本語', kind: 'original', source: 's', lines }, ...extra] } as LyricsDocument)
    const render = (document: LyricsDocument, enabled: string[], paste = true) => renderToStaticMarkup(<LanguageSwitches document={document} enabled={enabled} onToggle={() => {}} onPaste={paste ? () => {} : undefined} onSearch={() => {}} />)
    const missing = render(song(), ['ja', 'en'])
    expect(missing).toContain('上网查找English翻译')
    expect(missing).toContain('粘贴翻译')
    // Switched off, or nowhere to paste (the search page): nothing is offered.
    expect(render(song(), ['ja'])).not.toContain('language-actions')
    expect(render(song(), ['ja', 'en'], false)).not.toContain('language-actions')
    // Romaji is generated, not found on a page.
    expect(render({ trackId: 't', tracks: [{ id: 'o', language: 'en', label: 'English', kind: 'original', source: 's', lines }] } as LyricsDocument, ['romaji'])).not.toContain('language-actions')
    const pasted = render(song({ id: 'pasted-en', language: 'en', label: 'English', kind: 'translation', source: '粘贴的翻译', lines }), ['ja', 'en'])
    expect(pasted).toContain('重新粘贴English翻译')
    expect(pasted).not.toContain('上网查找')
    // A translation that came from a provider or a file is not offered for replacement here.
    expect(render(song({ id: 'z', language: 'en', label: 'English', kind: 'translation', source: 's', lines }), ['ja', 'en'])).not.toContain('language-actions')
  })

  it('fills range tracks up to the thumb', () => {
    expect(rangeFill(52, 34, 88)).toBe('33.33333333333333%')
    expect(rangeFill(0, -30000, 30000)).toBe('50%')
    expect(rangeFill(5, 0, 0)).toBe('0%')
    expect(rangeFill(999, 0, 100)).toBe('100%')
  })
})
