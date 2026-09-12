// Shared by provider scoring and renderer/import parsing. Credit labels can
// appear at either end of a track; their timestamp is not evidence of singing.
const CREDIT_LABEL = /^(?:作词|作詞|词|詞|曲|作曲|编曲|編曲|制作人|製作人|(?:混音|母带|母帶|录音|錄音)(?:工程师|工程師)?|composer|lyricist|lyrics?|arrang(?:er|ed by)|produ(?:cer|ced by)|mix(?:er|ed by|ing(?: engineer)?)|master(?:ing(?: engineer)?|ed by)|recording engineer|マスタリング|ミキシング)\s*[:：]\s*\S/i

export function isLyricCredit(text: string) {
  return CREDIT_LABEL.test(text.trim().normalize('NFKC'))
}
