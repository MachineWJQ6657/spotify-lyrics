import { toRomaji } from 'wanakana'
import type { LyricLine, LyricsDocument, LyricTrack } from '../types'
import { isLyricCredit } from './lyric-metadata'
import { secondaryTrackShift } from './secondary-shift'

const TIME = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const WORD_TIME = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g

function milliseconds(minute: string, second: string, fraction = '0') {
  const fractionMs = Number(fraction.padEnd(3, '0').slice(0, 3))
  return Number(minute) * 60_000 + Number(second) * 1000 + fractionMs
}

export function parseLrc(source: string): LyricLine[] {
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0)
  const lines: LyricLine[] = []
  for (const raw of source.replace(/\r/g, '').split('\n')) {
    const timestamps = [...raw.matchAll(TIME)]
    if (!timestamps.length) continue
    const content = raw.replace(TIME, '').trim()
    const wordMatches = [...content.matchAll(WORD_TIME)]
    const plain = content.replace(WORD_TIME, '').trim()
    // Words before the first <mm:ss> tag start with the line. Without an entry
    // of their own they were in no word, and a word-timed row renders only its
    // words: "[00:10.00]alpha <00:10.50>beta" showed as "beta".
    const leading = wordMatches.length ? content.slice(0, wordMatches[0].index ?? 0) : ''
    for (const stamp of timestamps) {
      const startMs = Math.max(0, milliseconds(stamp[1], stamp[2], stamp[3]) + offset)
      const tagged = wordMatches.map((match, index) => {
        const textStart = (match.index ?? 0) + match[0].length
        const textEnd = wordMatches[index + 1]?.index ?? content.length
        return { text: content.slice(textStart, textEnd), startMs: milliseconds(match[1], match[2], match[3]) + offset }
      }).filter(word => word.text)
      const words = leading.trim() && tagged.length ? [{ text: leading, startMs }, ...tagged] : tagged
      lines.push({ startMs, text: plain, words: words.length ? words : undefined })
    }
  }
  lines.sort((a, b) => a.startMs - b.startMs)
  // Empty timestamp markers are commonly appended at the end of provider LRC
  // files. Keeping them makes the active line become a zero-size element, so a
  // transparent overlay appears to vanish and can no longer be dragged.
  const cleaned = lines.filter(line => line.text.trim() && !isLyricCredit(line.text))
  // Rows sharing one timestamp are sung together (a lead and a backing line).
  // Kept apart, only the last of them was ever the active line: the overlay
  // never showed the first, and clicking it in the list lit up the other.
  // They become one row; the same words twice count once.
  const merged: LyricLine[] = []
  for (const line of cleaned) {
    const previous = merged.at(-1)
    if (previous && previous.startMs === line.startMs && !previous.words && !line.words) {
      if (!previous.text.split(JOINED_ROWS).includes(line.text)) previous.text = `${previous.text}${JOINED_ROWS}${line.text}`
    } else merged.push({ ...line })
  }
  return merged.map((line, index) => ({ ...line, endMs: merged[index + 1]?.startMs }))
}

/** Separates rows shown as one (an ideographic space, as between split translation phrases). */
const JOINED_ROWS = '　'

export function makeTrack(id: string, language: string, label: string, kind: LyricTrack['kind'], source: string, origin = '本地'): LyricTrack { // i18n-ignore: stored source label, localized where shown
  return { id, language, label, kind, lines: parseLrc(source), source: origin }
}

export function makeRomanizedTrack(original: LyricTrack): LyricTrack {
  return {
    ...original, id: `${original.id}-romaji`, language: 'romaji', label: 'Romaji', kind: 'romanization', source: 'WanaKana',
    lines: original.lines.map(line => ({ ...line, text: toRomaji(line.text), words: line.words?.map(word => ({ ...word, text: toRomaji(word.text) })) }))
  }
}

export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let low = 0, high = lines.length - 1, result = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (lines[middle].startMs <= positionMs) { result = middle; low = middle + 1 } else high = middle - 1
  }
  return result
}

export function nearestLine(lines: LyricLine[], targetMs: number, toleranceMs = 2200) {
  const index = activeLineIndex(lines, targetMs)
  const candidates = [lines[index], lines[index + 1]].filter(Boolean)
  const best = candidates.sort((a, b) => Math.abs(a.startMs - targetMs) - Math.abs(b.startMs - targetMs))[0]
  return best && Math.abs(best.startMs - targetMs) <= toleranceMs ? best : undefined
}

/** Timestamps this close are the same line (rounding to 10 ms moves a stamp by up to 5 ms). */
const SAME_STAMP_MS = 15

/**
 * Align a supplemental provider timeline to the source-language rows. Some
 * providers split one Japanese sentence into two translated phrases while
 * LRCLIB keeps it as one row. Bucketing by the source interval preserves both
 * translated phrases instead of dropping one through nearest-line matching.
 */
export function alignSecondaryTrack(baseLines: LyricLine[], secondaryLines: LyricLine[], leadToleranceMs = 1200): Array<LyricLine | undefined> {
  const buckets: LyricLine[][] = Array.from({ length: baseLines.length }, () => [])
  if (!baseLines.length) return []
  // A track that is early or late as a whole is put back first (see
  // secondaryTrackShift); the row rules below then see stamps on their rows.
  const shiftMs = secondaryTrackShift(baseLines.map(line => line.startMs), secondaryLines.map(line => line.startMs), leadToleranceMs)
  for (const stamped of secondaryLines) {
    const line = shiftMs ? { ...stamped, startMs: stamped.startMs - shiftMs } : stamped
    // The same timestamp, give or take rounding: provider tracks re-timed onto
    // the original are written to 10 ms while the original keeps milliseconds
    // (21.457 s against 21.46 s). Demanding equality sent such a row to the
    // lead rule below, which picks the *next* line when lines are under 1.2 s
    // apart: the translation showed one row late.
    const current = activeLineIndex(baseLines, line.startMs + SAME_STAMP_MS)
    const sameStamp = current >= 0 && Math.abs(baseLines[current].startMs - line.startMs) <= SAME_STAMP_MS
    const next = baseLines[current + 1]
    let index = current
    if (!sameStamp && next) {
      // A translation may be stamped a little before its line. It goes to the
      // next row when that row starts within the tolerance and nearer than the
      // row in progress started. Looking a fixed 1.2 s ahead instead gave each
      // line of a fast passage (rows under 1.2 s apart) to the row after its
      // own as soon as its stamp was off by more than rounding: after a
      // 100 ms nudge of one track, or with an imported translation.
      const leadMs = next.startMs - line.startMs
      if (leadMs <= leadToleranceMs && (current < 0 || leadMs < line.startMs - baseLines[current].startMs)) index = current + 1
    }
    if (index < 0 && Math.abs(line.startMs - baseLines[0].startMs) <= 2200) index = 0
    if (index < 0) continue
    const base = baseLines[index]
    const naturalEnd = baseLines[index + 1]?.startMs ?? base.endMs ?? base.startMs + 12_000
    if (line.startMs < base.startMs - leadToleranceMs || line.startMs > naturalEnd + 2200) continue
    buckets[index].push(line)
  }
  const aligned = buckets.map((bucket, index) => {
    if (!bucket.length) return undefined
    const texts = [...new Set(bucket.map(line => line.text.trim()).filter(Boolean))]
    if (!texts.length) return undefined
    return { startMs: baseLines[index].startMs, endMs: baseLines[index].endMs, text: texts.join('　') }
  })
  // An LRC end time is only the next timestamp, not proof that a translation
  // describes intervening original rows. Do not copy it into empty buckets:
  // alternate verses and missing translations can have equally short gaps.
  // Explicit repeated timestamps still work, and split translated phrases
  // remain joined in their owning source interval above.
  return aligned
}

/** Languages the settings can switch on and off. A track in any other one (a custom translation) has no switch and is always shown. */
const SWITCHED_LANGUAGES = new Set(['ja', 'kana', 'romaji', 'zh-Hans', 'en'])

export function visibleTracks(document: LyricsDocument | null, enabled: string[], romanization: boolean) {
  if (!document) return []
  if (document.untimedOriginal) return []
  const creditTimes = new Set(document.tracks.filter(track => track.kind === 'original')
    .flatMap(track => track.lines.filter(line => isLyricCredit(line.text)).map(line => line.startMs)))
  // Providers list supplemental tracks in whatever order they answered; show
  // them in one fixed order: original, its readings (kana, then romaji), then translations.
  const rank = (track: LyricTrack) => track.kind === 'original' ? 0 : track.kind === 'kana' ? 1 : track.kind === 'romanization' ? 2 : 3
  return [...document.tracks].sort((left, right) => rank(left) - rank(right))
    // The source-language track is the alignment anchor and must never be
    // replaced by a selected translation merely because its language toggle is
    // off. Language switches control supplemental tracks around that anchor.
    .filter(track => (track.kind === 'original' || enabled.includes(track.language) || !SWITCHED_LANGUAGES.has(track.language)) && (track.kind !== 'romanization' || romanization))
    .map(track => {
      // Also sanitize already-persisted tracks created by older versions.
      const lines = track.lines.filter(line => line.text.trim() && !isLyricCredit(line.text)
        && (track.kind === 'original' || !creditTimes.has(line.startMs)))
      const normalizedLines: LyricLine[] = lines.map((line, index) => ({ ...line, endMs: lines[index + 1]?.startMs }))
      return { ...track, lines: normalizedLines }
    })
}

export function detectLyricsLanguage(text: string) {
  // Lyricist / composer credit lines say nothing about the sung language.
  const sung = text.split(/\r?\n/).map(line => line.replace(TIME, '').replace(WORD_TIME, '').trim()).filter(line => line && !isLyricCredit(line)).join('\n')
  const body = /\p{L}/u.test(sung) ? sung : text
  const hangul = (body.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g) ?? []).length
  // Not the middle dot (U+30FB): Chinese credits use it too.
  const kana = (body.match(/[\u3040-\u30fa\u30fc-\u30ff]/g) ?? []).length
  if (hangul >= 3 && hangul > kana) return 'ko'
  if (kana) return 'ja'
  const han = (body.match(/[\u3400-\u9fff]/g) ?? []).length
  const latinWords = (body.match(/[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g) ?? []).length
  // An English song with a few Chinese characters left (a title, a note) is still English.
  if (han && han * 2 >= latinWords) return 'zh-Hans'
  if (latinWords) return 'en'
  return han ? 'zh-Hans' : 'original'
}

export function languageFromFilename(name: string): { code: string; label: string; kind: LyricTrack['kind'] } {
  const normalized = name.toLowerCase()
  if (/\.(zh|zho|cn|chs|zh-hans)\./.test(normalized)) return { code: 'zh-Hans', label: '中文', kind: 'translation' } // i18n-ignore: stored track label, localized where shown
  if (/\.(en|eng)\./.test(normalized)) return { code: 'en', label: 'English', kind: 'translation' }
  if (/\.(romaji|roma|rōmaji)\./.test(normalized)) return { code: 'romaji', label: 'Romaji', kind: 'romanization' }
  if (/\.(ja|jpn|jp)\./.test(normalized)) return { code: 'ja', label: '日本語', kind: 'original' } // i18n-ignore: stored track label, localized where shown
  return { code: 'custom', label: '自定义', kind: 'translation' } // i18n-ignore: stored track label, localized where shown
}

export function serializeLrc(track: LyricTrack) {
  const stamp = (value: number) => {
    const safe = Math.max(0, Math.round(value))
    const minutes = Math.floor(safe / 60_000)
    const seconds = Math.floor((safe % 60_000) / 1000)
    const centiseconds = Math.floor((safe % 1000) / 10)
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`
  }
  return track.lines.map(line => `${stamp(line.startMs)}${line.text}`).join('\n') + '\n'
}

export function retimeLines(lines: LyricLine[], deltaMs: number) {
  // Word timings move with their line; left behind, the words lit up at the old times.
  const shifted = lines.map(line => ({ ...line, startMs: Math.max(0, line.startMs + deltaMs),
    ...(line.words ? { words: line.words.map(word => ({ ...word, startMs: Math.max(0, word.startMs + deltaMs) })) } : {}) })).sort((a, b) => a.startMs - b.startMs)
  return shifted.map((line, index) => ({ ...line, endMs: shifted[index + 1]?.startMs }))
}
