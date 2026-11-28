export const hasKana = (value: string) => /[\u3040-\u30ff]/.test(value)
export const hasHan = (value: string) => /[\u3400-\u9fff]/.test(value)

export function scriptPresentation(value: string, context = '', knownLanguage?: string) {
  // Pure-kanji Japanese titles are indistinguishable from Chinese by glyphs
  // alone. Once the original lyric language is known, use it as authoritative
  // context for every metadata surface (mini player, header and library).
  const japanese = hasKana(value) || (hasHan(value) && (hasKana(context) || knownLanguage === 'ja'))
  if (japanese) return { className: 'japanese-grid', lang: 'ja' }
  if (hasHan(value)) return { className: 'chinese-text', lang: 'zh-CN' }
  return { className: 'latin-text', lang: 'en' }
}

export function languagePresentation(language: string) {
  // The kana row is Japanese text too.
  if (language === 'ja' || language === 'kana') return { className: 'japanese-grid', lang: 'ja' }
  if (language === 'zh-Hans') return { className: 'chinese-text', lang: 'zh-CN' }
  return { className: 'latin-text', lang: 'en' }
}
