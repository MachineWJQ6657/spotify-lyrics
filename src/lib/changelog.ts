import { currentLanguage } from './i18n'
import { CHANGELOG_EN } from '../i18n/en/changelog'

/**
 * What changed for the user, newest first, shown on the help page. One entry
 * per release with something visible; internal work stays in CONTINUATION.md.
 */
export interface ChangelogEntry { version: string; date: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '0.4.81', date: '2026-11-22', items: [
    '听音校准测出 1.5 秒以上的偏移时，先照常使用，下一次播放这首歌时再测一次：两次一致才长期保留，不一致就以新的为准。这样某一次播放本身出了偏差（比如播放中途切换 Spotify 的淡入淡出）时，错误的偏移不会一直留着'
  ] },
  { version: '0.4.80', date: '2026-11-22', items: [
    '开着 Spotify 的淡入淡出时歌词匹配不再受影响：Spotify 会把每首歌的时长报短（淡入淡出几秒就短几秒），以前会因此匹配到别的版本，同一首歌播到几秒时还会重新匹配一次，开关淡入淡出或直接点播后已有的校准也可能对不上；现在始终按歌曲的真实时长匹配',
    '帮助页会显示检测到的淡入淡出秒数'
  ] },
  { version: '0.4.79', date: '2026-11-20', items: [
    '界面可以切换成英文：在「偏好设置」页的「界面语言 · Language」里选择中文、English 或跟随系统；主窗口、桌面歌词、托盘菜单和提示信息都会跟着切换',
    '系统语言不是中文时，默认显示英文界面'
  ] },
  { version: '0.4.78', date: '2026-11-20', items: [
    '新增「查歌词」页：不用播放也能看歌词。输入歌名或艺人搜索，点开就是和播放时一样的歌词，带翻译和罗马音；右键可以复制，Ctrl+F 可以在歌词里查找',
    '歌词资料库里的歌可以直接点开阅读（每首歌右边的「查看歌词」按钮，或在「查歌词」页里输入歌名）',
    'Spotify 没在播放时，「正在播放」页右上角多了一个「查歌词」入口'
  ] },
  { version: '0.4.77', date: '2026-11-16', items: [
    '桌面悬浮窗更省资源：逐字变色和换句时的淡入改成分几步完成，看起来几乎一样，绘制的画面少了九成；播放逐字歌词时悬浮窗占用的 CPU 从约 28% 降到约 4%（单核）',
    '悬浮窗工具栏不再一碰就弹出：鼠标在歌词上停稳约半秒才出现；鼠标只是路过不会出现，停在歌词上不动 2.5 秒后会自动收起，动一下鼠标再停住又会出现',
    '主窗口更省资源：换句时的滚动和进度条只在画面真的要变时才重绘，两个窗口都开着时整体占用约少三成'
  ] },
  { version: '0.4.76', date: '2026-11-15', items: [
    '收紧上两版放得过宽的几条规则：只有几句歌词的短轨道不再被整体挪一行；歌词里夹着的汉字词（永遠、運命）不再被当成中文翻译；“编曲：fox capture plan”这类小写名字的制作名单照常隐藏；暂停较久后再播放时位置照常以 Spotify 报告的为准'
  ] },
  { version: '0.4.75', date: '2026-11-15', items: [
    '悬浮窗拖到屏幕下方（压在任务栏上）之后，解锁电脑、从睡眠恢复或重启时不再被自动挪回上面',
    '资料库：连续移除几首歌后可以一次全部撤销；导出歌词时文件名里的特殊符号（/ : ? 等）会被替换，不再导出失败'
  ] },
  { version: '0.4.74', date: '2026-11-15', items: [
    '修复前几版带来的问题：整轨翻译比歌词早 0.6–1.2 秒时，快节奏段落里会错到上一行（现在先估出整轨偏了多少再归行，偏早偏晚都能放对）；主唱和和声写在同一时间时，主唱那句的译文会出现在后面的和声行上；只翻译了一部分歌词的内嵌译文没有被拆成翻译轨',
    '歌词里的声部标注（“和声：啦啦啦”这类）不再被当成制作名单去掉',
    '暂停后马上继续播放时歌词不再慢半拍；打开主窗口时歌词列表不再先滑动半屏'
  ] },
  { version: '0.4.73', date: '2026-11-15', items: [
    '更多歌词行有中文翻译：副歌只翻译了一遍时，其余几遍也会显示；翻译所在条目的分行方式不同时不再丢行（《猫日》原来 38 行只有 18 行有翻译）；两边写法略有不同的同一句（想って / 思って）也能配上',
    '歌曲开头的制作名单（Guitar：、贝斯：、Lyrics by： 等）不再当作歌词显示',
    '同步：切歌后的位置修正不再等 5 秒才生效；暂停的瞬间不再闪回前面的歌词；暂停时切歌后歌词不再停住 5 秒；连续点同一句歌词跳转，歌词不再提前',
    '导入 LRC：没有时间轴的文件不再导入成空轨道；能读 GBK、Shift_JIS、UTF-16 编码；与歌曲同语言的文件算作原文而不是翻译；没有同步歌词的歌拖入 LRC 后直接作为歌词显示',
    '编辑歌词：微调时间或改字之后，听音校准和“跟歌声校准”不再失效（以前歌词会整体跳回去）；逐字歌词改字后画面随之更新；自动搜索还没结束时也能应用候选歌词',
    '恢复备份时优先保留你编辑过的歌词和手动偏移，而不是之后自动重新获取的版本'
  ] },
  { version: '0.4.72', date: '2026-11-15', items: [
    '主窗口歌词换到下一句时平滑滚动到位（以前每一句都是直接跳过去）',
    '歌词文字可以用鼠标选中，右键菜单里可以复制选中的部分',
    '修复：快节奏段落里，时间轴差一点的翻译和罗马音会整体错到下一行（把某一轨微调 100 毫秒、或导入别处的翻译后最明显）',
    '修复：右键歌词后列表不再跟随播放；查找栏打开时 Esc 有时关不掉；查找不到带弯引号或重音符号的词（don’t、café）',
    '修复：逐字歌词每行第一个词有时不显示；同一时间的两句歌词在悬浮窗里只显示后一句；Spotify 关闭后悬浮窗有时还停在上一首歌的第一句',
    '翻译对齐：与歌词行文字完全相同的翻译不再因为相邻的相似句而漏掉'
  ] },
  { version: '0.4.71', date: '2026-11-15', items: [
    '翻译对得更准：很短的歌词行（Yeah、ねえ 这类）不再同时挂上前后两句的译文；一句被拆成两行时，后半句的译文不再跑到下一行；间隔不到 1.2 秒的连续短句，译文不再晚一行',
    '选歌词更稳：带一段长间奏的歌不再被同一歌手歌名相近的另一首歌顶替；网易云的同一个版本不再被算两次而压过正在播放的版本；副歌里反复出现的纯汉字歌词行不再被当成中文翻译拿走',
    '歌词源回应到一半卡住时不再一直停在“正在搜索”；网易云没查完的结果会稍后自动重查（以前这样的歌会一直没有翻译，直到重启）',
    '已保存的歌曲在下次播放时按新规则重新匹配一次'
  ] },
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

/** The items of an entry in the interface language; the Chinese items when no English version with the same count exists. */
export function localizedItems(entry: ChangelogEntry): string[] {
  const english = currentLanguage() === 'en' ? CHANGELOG_EN[entry.version] : undefined
  return english && english.length === entry.items.length ? english : entry.items
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
