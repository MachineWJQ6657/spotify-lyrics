import { toRomaji } from 'wanakana'
import type { LyricLine, LyricsDocument, LyricTrack } from '../types'

const TIME = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const WORD_TIME = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g
const CREDIT_LINE = /^(?:作词|作詞|作曲|编曲|編曲|制作人|製作人|混音|母带|母帶|录音|錄音|composer|lyricist|lyrics?|arrang(?:er|ed by)|produ(?:cer|ced by)|mix(?:er|ed by)|master(?:ing|ed by))\s*[:：]/i

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
    for (const stamp of timestamps) {
      const startMs = Math.max(0, milliseconds(stamp[1], stamp[2], stamp[3]) + offset)
      const words = wordMatches.map((match, index) => {
        const textStart = (match.index ?? 0) + match[0].length
        const textEnd = wordMatches[index + 1]?.index ?? content.length
        return { text: content.slice(textStart, textEnd), startMs: milliseconds(match[1], match[2], match[3]) + offset }
      }).filter(word => word.text)
      lines.push({ startMs, text: plain, words: words.length ? words : undefined })
    }
  }
  lines.sort((a, b) => a.startMs - b.startMs)
  // Empty timestamp markers are commonly appended at the end of provider LRC
  // files. Keeping them makes the active line become a zero-size element, so a
  // transparent overlay appears to vanish and can no longer be dragged.
  const cleaned = lines.filter(line => line.text.trim() && !(line.startMs < 30_000 && CREDIT_LINE.test(line.text)))
  return cleaned.map((line, index) => ({ ...line, endMs: cleaned[index + 1]?.startMs }))
}

export function makeTrack(id: string, language: string, label: string, kind: LyricTrack['kind'], source: string, origin = '本地'): LyricTrack {
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

/**
 * Align a supplemental provider timeline to the source-language rows. Some
 * providers split one Japanese sentence into two translated phrases while
 * LRCLIB keeps it as one row. Bucketing by the source interval preserves both
 * translated phrases instead of dropping one through nearest-line matching.
 */
export function alignSecondaryTrack(baseLines: LyricLine[], secondaryLines: LyricLine[], leadToleranceMs = 1200): Array<LyricLine | undefined> {
  const buckets: LyricLine[][] = Array.from({ length: baseLines.length }, () => [])
  const placedAt = new Map<LyricLine, number>()
  if (!baseLines.length) return []
  for (const line of secondaryLines) {
    let index = activeLineIndex(baseLines, line.startMs + leadToleranceMs)
    if (index < 0 && Math.abs(line.startMs - baseLines[0].startMs) <= 2200) index = 0
    if (index < 0) continue
    const base = baseLines[index]
    const naturalEnd = baseLines[index + 1]?.startMs ?? base.endMs ?? base.startMs + 12_000
    if (line.startMs < base.startMs - leadToleranceMs || line.startMs > naturalEnd + 2200) continue
    buckets[index].push(line)
    placedAt.set(line, index)
  }
  const aligned = buckets.map((bucket, index) => {
    if (!bucket.length) return undefined
    const texts = [...new Set(bucket.map(line => line.text.trim()).filter(Boolean))]
    if (!texts.length) return undefined
    return { startMs: baseLines[index].startMs, endMs: baseLines[index].endMs, text: texts.join('　') }
  })
  // A translation provider may keep a sentence as one row while the selected
  // source timeline splits it into two short phrases. Preserve that sentence
  // across at most two nearby continuation rows until the translation's next
  // timestamp. The tight time/gap bounds prevent a sparse translation from
  // lingering through an instrumental section or unrelated missing lines.
  for (let index = 1; index < baseLines.length; index += 1) {
    if (aligned[index]) continue
    const base = baseLines[index]
    const secondaryIndex = activeLineIndex(secondaryLines, base.startMs + 200)
    const candidate = secondaryLines[secondaryIndex]
    const originIndex = candidate ? placedAt.get(candidate) : undefined
    if (!candidate || originIndex == null || originIndex >= index || index - originIndex > 2) continue
    const ageMs = base.startMs - candidate.startMs
    const precedingGapMs = base.startMs - baseLines[index - 1].startMs
    const candidateEndMs = candidate.endMs ?? secondaryLines[secondaryIndex + 1]?.startMs
    if (ageMs < 0 || ageMs > 8000 || precedingGapMs > 5000 || candidateEndMs == null || base.startMs >= candidateEndMs - 300) continue
    aligned[index] = { startMs: base.startMs, endMs: base.endMs, text: candidate.text }
  }
  return aligned
}

export function visibleTracks(document: LyricsDocument | null, enabled: string[], romanization: boolean) {
  if (!document) return []
  return document.tracks
    // The source-language track is the alignment anchor and must never be
    // replaced by a selected translation merely because its language toggle is
    // off. Language switches control supplemental tracks around that anchor.
    .filter(track => (track.kind === 'original' || enabled.includes(track.language)) && (track.kind !== 'romanization' || romanization))
    .map(track => {
      // Also sanitize already-persisted tracks created by older versions.
      const lines = track.lines.filter(line => line.text.trim() && !(line.startMs < 30_000 && CREDIT_LINE.test(line.text)))
      const normalizedLines: LyricLine[] = lines.map((line, index) => ({ ...line, endMs: lines[index + 1]?.startMs }))
      return { ...track, lines: normalizedLines }
    })
}

export function detectLyricsLanguage(text: string) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[\u3400-\u9fff]/.test(text)) return 'zh-Hans'
  if (/[A-Za-z]/.test(text)) return 'en'
  return 'original'
}

export function languageFromFilename(name: string): { code: string; label: string; kind: LyricTrack['kind'] } {
  const normalized = name.toLowerCase()
  if (/\.(zh|zho|cn|chs|zh-hans)\./.test(normalized)) return { code: 'zh-Hans', label: '中文', kind: 'translation' }
  if (/\.(en|eng)\./.test(normalized)) return { code: 'en', label: 'English', kind: 'translation' }
  if (/\.(romaji|roma|rōmaji)\./.test(normalized)) return { code: 'romaji', label: 'Romaji', kind: 'romanization' }
  if (/\.(ja|jpn|jp)\./.test(normalized)) return { code: 'ja', label: '日本語', kind: 'original' }
  return { code: 'custom', label: '自定义', kind: 'translation' }
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
  const shifted = lines.map(line => ({ ...line, startMs: Math.max(0, line.startMs + deltaMs) })).sort((a, b) => a.startMs - b.startMs)
  return shifted.map((line, index) => ({ ...line, endMs: shifted[index + 1]?.startMs }))
}
