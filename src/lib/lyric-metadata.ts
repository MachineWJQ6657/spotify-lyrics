// Shared by provider scoring and renderer/import parsing. Credit labels can
// appear at either end of a track; their timestamp is not evidence of singing.
// One credit role. Kept precise: a role must be followed by a colon and a name,
// so sung lines that merely begin with one of these words are untouched.
const CREDIT_ROLE = String.raw`(?:作词|作詞|词|詞|曲|作曲|编曲|編曲|歌唱|演唱|原唱|唄|制作人|製作人|(?:混音|母带|母帶|录音|錄音)(?:工程师|工程師)?|composer|lyricist|lyrics?|vocals?|arrang(?:er|ed by)|produ(?:cer|ced by)|mix(?:er|ed by|ing(?: engineer)?)|master(?:ing(?: engineer)?|ed by)|recording engineer|マスタリング|ミキシング)`
// Roles are often combined on one row: "作詞/作曲/編曲：MIMI", "Lyrics & Music: ...".
const CREDIT_LABEL = new RegExp(String.raw`^${CREDIT_ROLE}(?:\s*[/・&、,]\s*(?:${CREDIT_ROLE}|music))*\s*[:：]\s*\S`, 'i')

export function isLyricCredit(text: string) {
  return CREDIT_LABEL.test(text.trim().normalize('NFKC'))
}
