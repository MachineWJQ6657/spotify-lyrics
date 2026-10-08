/** Metadata rank is not lyric accuracy. Includes legacy persisted labels. */
export function sourceLabel(source: string) {
  return source.replace(/搜索匹配\s*\d+%/g, '搜索候选')
    .replace(/精确匹配/g, '元数据匹配').replace(/ · \d+%/g, ' · 手动选择')
}

export function referenceLabel(reference?: import('../types').LyricsDocument['textReference']) {
  if (!reference) return '尚未取得 Spotify 原文对照'
  const state = reference.status === 'consistent' ? '参考文本相符' : reference.status === 'partial' ? '部分相符，需核对缺句或差异' : '候选内容冲突，未采用该时间轴'
  return `${reference.referenceSource} 原文：${state}（${reference.matchedLines}/${reference.referenceLines} 行；不代表时间同步）`
}
