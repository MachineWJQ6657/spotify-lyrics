import type { LyricTrack, LyricsDocument, TrackInfo } from '../types'
import { detectLyricsLanguage, languageFromFilename, makeTrack } from './lyrics'

const HIRAGANA = /[ぁ-ん]/g
const COMMON_HAN = /[的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会]/g

/**
 * The text of a lyric file: UTF-8, UTF-16 with a byte-order mark, or one of
 * the legacy encodings LRC files still come in (GB18030 from Chinese sites,
 * Shift_JIS from Japanese ones). `File.text()` reads UTF-8 only: a UTF-16 file
 * parsed to no lines at all and a GBK file imported as "���".
 */
export function decodeLyricFile(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder('utf-16le').decode(view.subarray(2))
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder('utf-16be').decode(view.subarray(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(view) } catch { /* not UTF-8 */ }
  const read = (label: string) => { try { return new TextDecoder(label, { fatal: true }).decode(view) } catch { return null } }
  const japanese = read('shift_jis')
  const chinese = read('gb18030')
  // Both decoders accept most byte strings; the text that reads as its language wins.
  const kana = japanese?.match(HIRAGANA)?.length ?? 0
  const han = chinese?.match(COMMON_HAN)?.length ?? 0
  if (japanese != null && (chinese == null || kana > han)) return japanese
  return chinese ?? new TextDecoder().decode(view)
}

export interface LyricFile { name: string; text: string }

export interface LyricImport {
  /** The song's document with the imported tracks; null when no file had a timed line. */
  document: LyricsDocument | null
  imported: LyricTrack[]
  /** Files without a single timed line (plain text, or nothing readable): not imported. */
  skipped: string[]
}

/**
 * Adds dropped or chosen LRC files to the document of the song that is
 * playing (or to the scratch document "local" when nothing is).
 *
 * - A file with no timed line is skipped. It used to replace the track of its
 *   language with an empty one, and as an empty "original" it then displaced
 *   the provider's lyrics on every later lookup.
 * - A file in the song's own language is its original: "<title>.en.lrc"
 *   exported from an English song and dropped back used to remove the original
 *   and return as a translation.
 * - A file without a language suffix, for a song that has no timed original
 *   (not found, or only untimed text), is the song's lyrics, not a "custom
 *   translation": it is shown instead of the untimed text, later lookups keep
 *   it, and listening can calibrate it.
 */
export function importLyricFiles(current: LyricsDocument | null, track: TrackInfo | undefined, files: LyricFile[], now = Date.now()): LyricImport {
  const trackId = track?.id ?? 'local'
  const base: LyricsDocument = current && current.trackId === trackId ? current : { trackId, track, tracks: [] }
  const existingOriginal = base.tracks.find(item => item.kind === 'original' && item.lines.length > 0)
  const songLanguage = existingOriginal?.language ?? base.untimedOriginal?.language
  const named = files.map(file => languageFromFilename(file.name))
  let needsOriginal = !existingOriginal && !named.some(language => language.kind === 'original' || (language.kind === 'translation' && language.code === songLanguage))
  const imported: LyricTrack[] = []
  const skipped: string[] = []
  files.forEach((file, index) => {
    let { code, label, kind } = named[index]
    if (kind === 'translation' && code === songLanguage) {
      kind = 'original'
      label = existingOriginal?.label ?? label
    } else if (code === 'custom' && needsOriginal) {
      const detected = detectLyricsLanguage(file.text)
      code = detected
      label = detected === 'ja' ? '日本語' : detected === 'zh-Hans' ? '中文原文' : detected === 'en' ? 'English' : 'Original'
      kind = 'original'
    }
    const made = makeTrack(`local-${now}-${index}`, code, label, kind, file.text, file.name)
    if (!made.lines.length) { skipped.push(file.name); return }
    if (kind === 'original') needsOriginal = false
    imported.push(made)
  })
  if (!imported.length) return { document: null, imported, skipped }
  const bringsOriginal = imported.some(item => item.kind === 'original')
  const replaced = (existing: LyricTrack) => imported.some(item => item.language === existing.language || (item.kind === 'original' && existing.kind === 'original'))
  const document: LyricsDocument = {
    ...base,
    // A timed original from the user takes the place of untimed provider text.
    untimedOriginal: bringsOriginal ? undefined : base.untimedOriginal,
    textReference: bringsOriginal ? undefined : base.textReference,
    tracks: [...base.tracks.filter(existing => !replaced(existing)), ...imported],
    userEditedTrackIds: [...new Set([...(base.userEditedTrackIds ?? []).filter(id => base.tracks.some(existing => existing.id === id && !replaced(existing))), ...imported.map(item => item.id)])],
    updatedAt: now
  }
  return { document, imported, skipped }
}

/** What to tell the user after an import. */
export function importMessage(result: LyricImport): string {
  if (!result.document) return '没有导入：文件里没有带时间轴的歌词（需要 [分:秒] 开头的 LRC）'
  const skipped = result.skipped.length ? `，${result.skipped.length} 个文件没有时间轴，未导入` : ''
  return `已导入 ${result.imported.length} 条歌词轨道${skipped}`
}
