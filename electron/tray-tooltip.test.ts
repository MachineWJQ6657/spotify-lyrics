import { describe, expect, it } from 'vitest'
import { TRAY_TOOLTIP_LIMIT, trayTooltipText } from './tray-tooltip'

describe('tray tooltip', () => {
  it('names the song and the artist above the hint', () => {
    expect(trayTooltipText({ name: '春泥棒', artist: 'ヨルシカ' })).toBe('春泥棒 — ヨルシカ\nSyllable · 单击打开客户端')
    expect(trayTooltipText({ name: ' Stay  With Me ', artist: '' })).toBe('Stay With Me\nSyllable · 单击打开客户端')
  })
  it('is the plain hint with nothing playing', () => {
    expect(trayTooltipText(null)).toBe('Syllable · 单击打开客户端')
    expect(trayTooltipText({ name: '  ' })).toBe('Syllable · 单击打开客户端')
  })
  it('fits the Windows limit and keeps the hint', () => {
    const text = trayTooltipText({ name: '長'.repeat(200), artist: 'Artist' })
    expect(text.length).toBeLessThanOrEqual(TRAY_TOOLTIP_LIMIT)
    expect(text.endsWith('\nSyllable · 单击打开客户端')).toBe(true)
    expect(text.split('\n')[0].endsWith('…')).toBe(true)
  })
  it('counts surrogate pairs as Windows does', () => {
    const text = trayTooltipText({ name: '🎵'.repeat(120) })
    expect(text.length).toBeLessThanOrEqual(TRAY_TOOLTIP_LIMIT)
    // No half of a pair is left behind.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text)).toBe(false)
  })
})
