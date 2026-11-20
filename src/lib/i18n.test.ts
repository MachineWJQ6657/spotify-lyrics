import { afterEach, describe, expect, it } from 'vitest'
import { currentLanguage, resolveLanguage, setLanguage, t, tk } from './i18n'
import { localizeLabel } from './source-label'

afterEach(() => setLanguage('zh'))

describe('which language the interface uses', () => {
  it('follows an explicit choice', () => {
    expect(resolveLanguage('en', 'zh-CN')).toBe('en')
    expect(resolveLanguage('zh', 'en-US')).toBe('zh')
  })

  it('follows the system otherwise: Chinese systems Chinese, all others English', () => {
    expect(resolveLanguage('auto', 'zh-CN')).toBe('zh')
    expect(resolveLanguage(undefined, 'zh-TW')).toBe('zh')
    expect(resolveLanguage(undefined, 'zh')).toBe('zh')
    expect(resolveLanguage('auto', 'en-US')).toBe('en')
    expect(resolveLanguage('auto', 'ja-JP')).toBe('en')
    expect(resolveLanguage('auto', undefined)).toBe('en')
  })
})

describe('reading a text', () => {
  it('is the source text in Chinese, the entry in English', () => {
    expect(t('退出')).toBe('退出')
    setLanguage('en')
    expect(currentLanguage()).toBe('en')
    expect(t('退出')).toBe('Quit')
  })

  it('shows the Chinese text rather than nothing when an entry is missing', () => {
    setLanguage('en')
    expect(t('这句话没有英文条目')).toBe('这句话没有英文条目')
  })

  it('fills placeholders in either language and leaves unknown ones alone', () => {
    expect(t('共 {count} 首，{other}', { count: 3 })).toBe('共 3 首，{other}')
  })

  it('marks a text for later without changing it', () => {
    expect(tk('歌词资料库')).toBe('歌词资料库')
  })
})

describe('a stored label on screen', () => {
  it('is unchanged in Chinese and for labels without entries', () => {
    expect(localizeLabel('LRCLIB · 精确匹配')).toBe('LRCLIB · 精确匹配')
    expect(localizeLabel(undefined)).toBe('')
    setLanguage('en')
    expect(localizeLabel('LRCLIB')).toBe('LRCLIB')
  })
})

describe('one Chinese text with two meanings', () => {
  it('is the same text in Chinese and picks the entry of its context in English', async () => {
    const { tc } = await import('./i18n')
    expect(tc('关闭', 'toggle')).toBe('关闭')
    setLanguage('en')
    expect(tc('关闭', 'toggle')).toBe('Turn off')
    expect(t('关闭')).toBe('Close')
    // No entry for the context: the plain entry.
    expect(tc('退出', 'nothing')).toBe('Quit')
  })
})
