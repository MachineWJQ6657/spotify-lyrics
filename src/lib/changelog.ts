/**
 * What changed for the user, newest first, shown on the help page. One entry
 * per release with something visible; internal work stays in CONTINUATION.md.
 */
export interface ChangelogEntry { version: string; date: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '0.4.70', date: '2026-11-15', items: [
    '听音校准更稳：听到的句子太少时不再判为“各句偏差不一致”（以前这样判的歌会重新测量）；整段重复的副歌不会把偏移算到错误的那一遍上；拖动进度不再浪费一次校准机会',
    '主窗口歌词可以居中显示（设置 → 歌词 → 主窗口歌词对齐）',
    '帮助页列出主窗口的播放快捷键：空格播放 / 暂停，← → 快退 / 快进 5 秒'
  ] },
  { version: '0.4.69', date: '2026-11-15', items: [
    '主窗口新增专注模式（F11 或歌名右侧的按钮）：只留歌名、歌词和播放条',
    '悬浮窗设置里的「文字透明度」「背景透明度」改名为「不透明度」：100% 是完全不透明，数值越小越淡（原来的名字容易让人往反方向调）'
  ] },
  { version: '0.4.68', date: '2026-11-15', items: [
    '更多歌曲能配上中文翻译：Spotify 播放的是 MV 版等长度不同的版本时，也会用同一首歌的翻译并按歌词逐句对齐',
    '悬浮窗新增「暂停时隐藏」：锁定的悬浮窗在暂停 10 秒后淡出，继续播放时自动出现（设置 → 悬浮窗）',
    '歌词开头的制作信息（歌唱：、作詞/作曲/編曲： 等）不再当作歌词显示',
    '修复：歌词搜索结果在切歌后会被应用到下一首歌；从资料库移除正在播放的歌曲后又自己回来；重新匹配失败时留下空白条目'
  ] },
  { version: '0.4.67', date: '2026-11-15', items: [
    '修复：在桌面歌词上按 Alt+F4 或 Ctrl+W 会把歌词窗口关掉，要重启才能恢复',
    '拖动歌词后鼠标仍停在歌词上时，控制条会自己回来',
    '从托盘或快捷键打开客户端时保持上次的位置和最大化状态',
    '帮助页新增「最近更新」，有新内容时侧栏出现一个小绿点；资料库没有封面的歌曲显示彩色首字'
  ] },
  { version: '0.4.66', date: '2026-11-15', items: [
    '资料库可以导出和导入备份，包含歌词、手动校准和听音校准结果',
    '「同步」页会列出听音校准比较过的歌词来源',
    '来源菜单标出内容与自动选择不同的来源；修复菜单说明文字溢出和歌名被挤短'
  ] },
  { version: '0.4.65', date: '2026-11-15', items: [
    '右键歌词：复制这一句或整首（可带罗马音和翻译）、从这一句播放',
    '托盘图标的提示显示正在播放的歌曲',
    '听音校准换来源更可靠：量不出结果的来源会跳过，只换到歌词内容一致的来源，以前判为不一致的歌也会处理',
    '修复第一次点「立即重新校准」变成“已经试过两次”'
  ] },
  { version: '0.4.64', date: '2026-11-15', items: [
    '悬浮窗可以显示下一句预告（设置 → 悬浮窗 → 显示下一句）',
    'Ctrl+F 在歌词里查找，原文、罗马音和翻译都能搜',
    '资料库显示每首歌的歌词来源'
  ] },
  { version: '0.4.63', date: '2026-11-15', items: [
    '听音校准发现当前来源各句偏差不一致时，自动换另一个来源重新测量'
  ] },
  { version: '0.4.62', date: '2026-11-15', items: [
    '翻译和罗马音的字号随歌词字号等比例变化',
    '帮助页显示最近的程序错误'
  ] },
  { version: '0.4.61', date: '2026-11-15', items: [
    '主窗口字体优化，记住窗口大小和位置，可以设置开机启动'
  ] },
  { version: '0.4.60', date: '2026-11-15', items: [
    '歌名旁的来源标签可以切换歌词来源',
    '「同步」页可以立即重新进行听音校准'
  ] }
]

/** Negative when `left` is older than `right`. Compares dotted numbers; anything else counts as 0. */
export function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split('.').map(part => Number.parseInt(part, 10) || 0)
  const a = parts(left), b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

/** Entries for releases up to the running version (a newer entry may exist while a release is being prepared). */
export function releasedEntries(running: string, entries: ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  return entries.filter(entry => compareVersions(entry.version, running) <= 0)
}

/** Whether a release newer than the one the user last read about has an entry. Nothing read yet counts as news. */
export function hasUnseenNews(seen: string | null | undefined, running: string, entries: ChangelogEntry[] = CHANGELOG): boolean {
  const newest = releasedEntries(running, entries)[0]
  return Boolean(newest) && (!seen || compareVersions(newest.version, seen) > 0)
}

const SEEN_KEY = 'syllable-ui-news-seen'
export function readSeenVersion(): string | null {
  try { return localStorage.getItem(SEEN_KEY) } catch { return null }
}
export function markNewsSeen(running: string) {
  try { localStorage.setItem(SEEN_KEY, running) } catch { /* view-only preference */ }
}
