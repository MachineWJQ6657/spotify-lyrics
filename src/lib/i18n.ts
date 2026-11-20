import { EN } from '../i18n/en'

/**
 * The interface language. The source text of the interface is Chinese: code
 * writes `t('歌词资料库')`, and in English the same call answers with the entry
 * of `src/i18n/en`. A text without an entry is shown in Chinese, never blank;
 * `src/i18n/coverage.test.ts` keeps every text wrapped and every entry present.
 *
 * Each window (and the main process) holds its own copy of the current
 * language: the windows set it from the saved setting before they render
 * (`src/main.tsx`), the main process is told over `app:set-language`.
 */
export type Language = 'zh' | 'en'
export type LanguageSetting = 'auto' | Language

let activeLanguage: Language = 'zh'

/** An explicit choice, else the system's language: Chinese on a Chinese system, English everywhere else. */
export function resolveLanguage(setting: LanguageSetting | undefined, systemLocale: string | undefined): Language {
  if (setting === 'zh' || setting === 'en') return setting
  return /^zh(?:[-_]|$)/i.test(systemLocale ?? '') ? 'zh' : 'en'
}

export function setLanguage(language: Language) { activeLanguage = language === 'en' ? 'en' : 'zh' }
export function currentLanguage(): Language { return activeLanguage }

/** Chinese source text in, the current language out. `{name}` placeholders are filled from `values`. */
export function t(text: string, values?: Record<string, string | number>): string {
  const template = activeLanguage === 'en' ? EN[text] ?? text : text
  return values ? template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match) : template
}

/**
 * A text whose Chinese serves two meanings (关闭: close a window, turn a switch
 * off): `context` picks the English entry `text@@context` (an ASCII word such as `toggle`). Chinese is unchanged.
 */
export function tc(text: string, context: string, values?: Record<string, string | number>): string {
  if (activeLanguage !== 'en') return t(text, values)
  const template = EN[`${text}@@${context}`] ?? EN[text] ?? text
  return values ? template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match) : template
}

/**
 * Marks a text that is translated later, where it is shown, with `t(value)`:
 * module-level tables are built once, before the language is known.
 */
export const tk = (text: string) => text
