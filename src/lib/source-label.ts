import { currentLanguage, t, tk } from './i18n'

/**
 * Every label and label part that is stored with a song (a track's `label`, a
 * track's `source`, joined by " · ", " + " or " / ") or handed to the helpers
 * below for display. Listed so that each has an English entry; the stored
 * value itself always stays Chinese.
 */
export const STORED_LABELS = [
  // Track labels
  tk('中文原文'), tk('日本語'), tk('中文'), tk('自定义'), tk('自定义翻译'),
  // Providers
  tk('网易云音乐'), tk('酷狗音乐'),
  // How a provider's lyrics were found or made
  tk('精确匹配'), tk('元数据匹配'), tk('搜索候选'), tk('手动选择'), tk('歌词匹配'),
  tk('翻译'), tk('罗马音'), tk('翻译（按歌词匹配）'), tk('罗马音（按歌词匹配）'), tk('翻译（同曲其他条目）'),
  tk('交错双语拆分'), tk('内嵌双语拆分'), tk('内嵌罗马音拆分'),
  tk('重复词补全'), tk('缺行补全'), tk('自动补全'), tk('主歌词'),
  // Local lyrics
  tk('本地'), tk('本地编辑'), tk('粘贴的翻译'),
  // Whole-song states shown in place of a source
  tk('纯音乐'), tk('歌词源暂时不可用'), tk('未找到歌词'), tk('正在搜索歌词…'), tk('未选择轨道')
] as const

/** Parts with a value inside them, written by the provider ("搜索匹配 85%", "对齐Spotify时轴", "… 补全"). */
function localizePattern(part: string): string {
  const search = /^搜索匹配\s*(\d+)%$/.exec(part)
  if (search) return t('搜索匹配 {percent}%', { percent: search[1] })
  const aligned = /^对齐(.+)时轴$/.exec(part)
  if (aligned) return t('对齐{target}时轴', { target: t(aligned[1]) })
  const filled = /^(.+) 补全$/.exec(part)
  if (filled) return t('{source} 补全', { source: localizePart(filled[1]) })
  return part
}

function localizePart(part: string): string {
  const whole = t(part)
  return whole !== part ? whole : localizePattern(part)
}

/**
 * A label that is stored as data (a provider's name in a saved song, a track's
 * label such as 中文原文) in the interface language. What is stored, compared
 * and exported stays as it is; only what is shown goes through here. Parts
 * joined by " · ", " + " or " / " are looked up one by one. In Chinese the
 * result is always the label itself.
 */
export function localizeLabel(label: string | undefined | null): string {
  if (!label) return ''
  if (currentLanguage() === 'zh') return label
  const whole = t(label)
  if (whole !== label) return whole
  return label.split(/( · | \+ | \/ )/).map(part => part === ' · ' || part === ' + ' || part === ' / ' ? part : localizePart(part)).join('')
}

/** Metadata rank is not lyric accuracy. Includes legacy persisted labels. Answers in the interface language. */
export function sourceLabel(source: string) {
  return localizeLabel(source.replace(/搜索匹配\s*\d+%/g, '搜索候选') // i18n-ignore: rewrites the stored Chinese label before it is localized
    .replace(/精确匹配/g, '元数据匹配').replace(/ · \d+%/g, ' · 手动选择')) // i18n-ignore: rewrites the stored Chinese label before it is localized
}

export function referenceLabel(reference?: import('../types').LyricsDocument['textReference']) {
  if (!reference) return t('尚未取得 Spotify 原文对照')
  const state = reference.status === 'consistent' ? t('内容相符') : reference.status === 'partial' ? t('部分相符') : t('内容不符，未采用')
  return t('{source} 原文：{state}（{matched}/{total} 行）', { source: localizeLabel(reference.referenceSource), state, matched: reference.matchedLines, total: reference.referenceLines })
}
