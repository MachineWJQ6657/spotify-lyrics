import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage, t } from './i18n'
import { localizeLabel, referenceLabel, sourceLabel } from './source-label'

afterEach(() => setLanguage('zh'))

describe('stored labels in English', () => {
  it('translates whole labels and labels joined by · and +', () => {
    setLanguage('en')
    expect(localizeLabel('中文原文')).toBe('Chinese original')
    expect(localizeLabel('LRCLIB · 精确匹配')).toBe('LRCLIB · Exact match')
    expect(localizeLabel('网易云音乐 · 翻译 + 缺行补全')).toBe('NetEase Cloud Music · Translation + Missing lines filled in')
    expect(localizeLabel('Kuroshiro · Kuromoji')).toBe('Kuroshiro · Kuromoji')
  })

  it('translates parts with a value inside', () => {
    setLanguage('en')
    // Another area's dictionary may word 搜索候选 differently; one text has one translation.
    expect(localizeLabel('酷狗音乐 · 搜索匹配 85%')).toBe('Kugou Music · Search match 85%')
    expect(localizeLabel('网易云音乐 · 翻译 · 对齐主歌词时轴')).toBe('NetEase Cloud Music · Translation · Aligned to main lyrics timeline')
    expect(localizeLabel('网易云音乐 · 搜索候选 + LRCLIB · 精确匹配 / 酷狗音乐 · 搜索候选 补全'))
      .toBe(`NetEase Cloud Music · ${t('搜索候选')} + LRCLIB · Exact match / Kugou Music · ${t('搜索候选')} (filled in)`)
  })

  it('keeps the label itself in Chinese', () => {
    expect(localizeLabel('酷狗音乐 · 搜索匹配 85%')).toBe('酷狗音乐 · 搜索匹配 85%')
    expect(sourceLabel('酷狗音乐 · 搜索匹配 98%')).toBe('酷狗音乐 · 搜索候选')
  })

  it('answers sourceLabel and referenceLabel in English', () => {
    setLanguage('en')
    expect(sourceLabel('酷狗音乐 · 搜索匹配 98%')).toBe(`Kugou Music · ${t('搜索候选')}`)
    expect(sourceLabel('LRCLIB · 精确匹配')).toBe('LRCLIB · Metadata match')
    expect(sourceLabel('LRCLIB · 97%')).toBe('LRCLIB · Picked by hand')
    expect(referenceLabel()).toBe('No Spotify original to compare with yet')
    expect(referenceLabel({ referenceSource: 'Spotify', status: 'partial', matchedLines: 12, referenceLines: 20 }))
      .toBe('Spotify original: partly matches (12/20 lines)')
  })
})
