// Shared by provider scoring and renderer/import parsing. Credit labels can
// appear at either end of a track; their timestamp is not evidence of singing.
// One credit role. Kept precise: a role must be followed by a colon and a name,
// so sung lines that merely begin with one of these words are untouched.
const STAFF_ROLE = [
  // Writing, singing, production.
  '作词', '作詞', '词', '詞', '曲', '作曲', '编曲', '編曲', '歌唱', '演唱', '原唱', '唄', '配唱', '制作人', '製作人', '监制', '監製', '出品人?', '发行', '發行', '制作发行',
  '统筹', '統籌', '企划', '企劃', '策划', '策劃', '专辑', '專輯',
  // Players, as provider credit blocks list them.
  '(?:电|電|木|低音|原声|原聲)?吉他手?', '贝斯手?', '貝斯手?', '鼓手?', '钢琴', '鋼琴', '键盘', '鍵盤', '合成器', '手风琴', '手風琴', '打击乐', '打擊樂',
  '弦乐(?:编写|编曲)?', '弦樂(?:編寫|編曲)?', '小提琴', '中提琴', '大提琴', '编程', '編程', '和弦',
  '(?:主人声|人声|人聲|和声|和聲|合声|合聲|和音)(?:编写|編寫|编辑|編輯|录音|錄音)?',
  // Studio.
  '(?:混音|母带|母帶|录音|錄音|音频|音頻)(?:工程师|工程師|工程|助理|混音|棚)?',
  'composer', 'lyricist', '(?:lyrics?|music|words)(?: by)?', 'vocals?', 'arrang(?:er|ed by)', 'produ(?:cer|ced by)', 'sound producer',
  '(?:written|composed|performed) by', 'mix(?:er|ed by|ing(?: engineer)?)', 'master(?:ing(?: engineer)?|ed by)',
  'recording(?: (?:&|and) mixing)? engineer', 'recorded(?: (?:&|and) mixed)? by', 'management',
  'guitars?', 'bass', 'drums?', 'piano', 'keyboards?', 'percussion', 'programming', 'strings(?: direction| arrangement)?', '(?:1st |2nd )?violin', 'viola', 'cello',
  'マスタリング', 'ミキシング', 'ギター', 'ベース', 'ドラムス?', 'ピアノ', 'キーボード', 'ストリングス', 'プログラミング'
]
const CREDIT_ROLE = `(?:${STAFF_ROLE.join('|')})`
// Roles are often combined on one row: "作詞/作曲/編曲：MIMI", "Lyrics & Music: ...", "Vocal/Pf：...".
const CREDIT_LABEL = new RegExp(String.raw`^${CREDIT_ROLE}(?:\s*[/・&、,]\s*(?:${CREDIT_ROLE}|pf|gt|ba|dr|key))*\s*[:：]\s*\S`, 'i')

// What follows a credit label is a name. Sung syllables or a lowercase
// sentence after it make the row a part label inside the lyrics
// ("和声：啦啦啦啦", "Bass: how low can you go"), which stays.
const SUNG_VALUE = /^(?:(?:[啦啊哦噢呜嗚哈嘿喔耶呀哎唉]|la|oh|ah|na|da|yeah|woo|ooh|hey|uh)[\s~～!！,，.。…-]*)+$|^[a-z']+(?:\s+[a-z']+){2,}[.!?]?$/

// Only labels that also name a part of the song are in doubt. After 作词, 编曲 or
// Guitar a lowercase name ("fox capture plan", "nana") is still a name.
const PART_LABEL = /^(?:和声|和聲|合声|合聲|和音|人声|人聲|vocals?|bass|chorus)\s*[:：]/i

export function isLyricCredit(text: string) {
  const normalized = text.trim().normalize('NFKC')
  if (!CREDIT_LABEL.test(normalized)) return false
  if (!PART_LABEL.test(normalized)) return true
  const value = normalized.slice(normalized.search(/[:：]/) + 1).trim()
  return !SUNG_VALUE.test(value)
}
