import type { PlaybackSnapshot } from './spotify'

export interface SupplementalLyrics {
  language: string
  label: string
  kind: 'translation' | 'romanization'
  syncedLyrics: string
  source: string
}

export interface LyricsResult {
  syncedLyrics: string | null
  plainLyrics: string | null
  source: string
  confidence: number
  matchedDurationMs?: number
  additionalTracks?: SupplementalLyrics[]
  /** At least one community provider failed or exceeded this request budget. */
  transient?: boolean
}

export interface LyricsCandidate {
  id: number; trackName: string; artistName: string; albumName: string; durationMs: number
  instrumental: boolean; syncedLyrics: string | null; plainLyrics: string | null; provider: string; score: number
}

const LRC_TIMESTAMP = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?]/g
const CREDIT_LINE = /^(?:作词|作詞|作曲|编曲|編曲|制作人|製作人|混音|母带|母帶|录音|錄音|composer|lyricist|lyrics?|arrang(?:er|ed by)|produ(?:cer|ced by)|mix(?:er|ed by)|master(?:ing|ed by))\s*[:：]/i
const KANA = /[\u3040-\u30ff]/
const HAN = /[\u3400-\u9fff]/
const LATIN = /[a-z]/i
const isRomanizedText = (value: string) => LATIN.test(value) && !KANA.test(value) && !HAN.test(value)

function timestampMs(timestamp: string) {
  const match = timestamp.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]/)
  return match
    ? Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number(`0.${match[3] ?? 0}`) * 1000
    : Number.NaN
}

export interface TimedLyricsRow {
  timeMs: number
  text: string
  normalizedText: string
}

/** Expand every timestamp on a physical LRC row into its own logical row. */
export function parseTimedRows(value: string | null | undefined): TimedLyricsRow[] {
  return (value?.split(/\r?\n/) ?? []).flatMap(raw => {
    const timestamps = raw.match(LRC_TIMESTAMP) ?? []
    const text = raw.replace(LRC_TIMESTAMP, '').trim()
    if (!timestamps.length || !text || CREDIT_LINE.test(text)) return []
    const normalizedText = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    return timestamps.flatMap(timestamp => {
      const timeMs = timestampMs(timestamp)
      return Number.isFinite(timeMs) ? [{ timeMs, text, normalizedText }] : []
    })
  }).sort((left, right) => left.timeMs - right.timeMs)
}

/** Split community LRC files that embed Japanese and Chinese at one timestamp. */
export function splitEmbeddedTranslation(result: LyricsResult): LyricsResult {
  if (!result.syncedLyrics) return result
  // NetEase occasionally publishes two representations of the same
  // translation at once: Chinese rows are interleaved into `lrc`, while the
  // same rows also exist in the dedicated `tlyric` track. Those interleaved
  // rows may be several seconds after their Japanese source, so the usual
  // same-timestamp bilingual splitter cannot identify them. Use the dedicated
  // translation timestamps as strong evidence, but only after at least three
  // Han-only rows next to Japanese rows agree. This avoids treating a genuine
  // multilingual song as provider noise.
  const knownChineseTimes = (result.additionalTracks ?? [])
    .filter(track => track.language === 'zh-Hans' && track.kind === 'translation')
    .flatMap(track => parseTimedRows(track.syncedLyrics).map(row => row.timeMs))
  const sourcePhysicalRows = result.syncedLyrics.replace(/\r/g, '').split('\n')
  const sourceTimedRows = sourcePhysicalRows.flatMap((raw, physicalIndex) => {
    const timestamp = raw.match(LRC_TIMESTAMP)?.[0]
    const content = raw.replace(LRC_TIMESTAMP, '').trim()
    const timeMs = timestamp ? timestampMs(timestamp) : Number.NaN
    return timestamp && content && Number.isFinite(timeMs) ? [{ physicalIndex, timeMs, content, prefix: timestamp }] : []
  })
  const knownTranslationRows = new Set<number>()
  if (knownChineseTimes.length >= 3) {
    for (let index = 0; index < sourceTimedRows.length; index += 1) {
      const row = sourceTimedRows[index]
      if (!HAN.test(row.content) || KANA.test(row.content)) continue
      const nearestDistance = knownChineseTimes.reduce((best, timeMs) => Math.min(best, Math.abs(timeMs - row.timeMs)), Infinity)
      if (nearestDistance > 250) continue
      const neighboringJapanese = [sourceTimedRows[index - 1], sourceTimedRows[index + 1]].some(neighbor =>
        Boolean(neighbor && KANA.test(neighbor.content) && Math.abs(neighbor.timeMs - row.timeMs) <= 12_000))
      if (neighboringJapanese) knownTranslationRows.add(row.physicalIndex)
    }
  }
  const hasKnownEmbeddedTranslation = knownTranslationRows.size >= 3
    && knownTranslationRows.size / Math.max(1, knownChineseTimes.length) >= .3
  // Some providers expose only the interleaved LRC. Four or more repeated
  // Japanese -> Han-only adjacent pairs establish the same export layout even
  // when each translated line uses a variable reading-duration offset. Real
  // bilingual performances can still be represented more usefully as two
  // selectable tracks, while three isolated pairs remain untouched.
  const alternatingPairs = sourceTimedRows.slice(0, -1).flatMap((original, index) => {
    const translation = sourceTimedRows[index + 1]
    const gapMs = translation.timeMs - original.timeMs
    return KANA.test(original.content) && HAN.test(translation.content) && !KANA.test(translation.content)
      && gapMs >= 180 && gapMs <= 8500
      ? [{ original, translation }]
      : []
  })
  const japaneseRowCount = sourceTimedRows.filter(row => KANA.test(row.content)).length
  const hanOnlyRowCount = sourceTimedRows.filter(row => HAN.test(row.content) && !KANA.test(row.content) && !CREDIT_LINE.test(row.content)).length
  const hasAlternatingEmbeddedTranslation = alternatingPairs.length >= 4
    && alternatingPairs.length / Math.max(1, Math.min(japaneseRowCount, hanOnlyRowCount)) >= .55
  const alternatingTranslationRows = new Set(hasAlternatingEmbeddedTranslation ? alternatingPairs.map(pair => pair.translation.physicalIndex) : [])
  const strippedRows = new Set([...knownTranslationRows, ...alternatingTranslationRows])
  const primaryLyrics = (hasKnownEmbeddedTranslation || hasAlternatingEmbeddedTranslation)
    ? sourcePhysicalRows.filter((_, index) => !strippedRows.has(index)).join('\n')
    : result.syncedLyrics
  const inferredTracks: SupplementalLyrics[] = hasAlternatingEmbeddedTranslation
    && !(result.additionalTracks ?? []).some(track => track.language === 'zh-Hans' && track.kind === 'translation')
    ? [{
        language: 'zh-Hans', label: '中文', kind: 'translation',
        syncedLyrics: alternatingPairs.map(pair => `${pair.original.prefix}${pair.translation.content}`).join('\n'),
        source: `${result.source} · 交错双语拆分`
      }]
    : []
  const initialAdditionalTracks = [...(result.additionalTracks ?? []), ...inferredTracks]
  type Entry = { raw: string; prefix: string; content: string; index: number }
  type Group = { prefix: string; startMs: number; order: number; entries: Entry[] }
  const groups: Group[] = []
  const exactGroups = new Map<string, Group>()
  const metadata: string[] = []
  let order = 0
  const physicalRows = primaryLyrics.replace(/\r/g, '').split('\n')
  const timedPhysicalRows = physicalRows.flatMap(raw => {
    const timestamp = raw.match(LRC_TIMESTAMP)?.[0]
    const content = raw.replace(LRC_TIMESTAMP, '').trim()
    const startMs = timestamp ? timestampMs(timestamp) : Number.NaN
    return timestamp && content && Number.isFinite(startMs) ? [{ startMs, content }] : []
  })
  const translationOffsets = timedPhysicalRows.slice(1).flatMap((row, index) => {
    const previous = timedPhysicalRows[index]
    const offset = row.startMs - previous.startMs
    return KANA.test(previous.content) && HAN.test(row.content) && !KANA.test(row.content) && offset > 220 && offset <= 1200
      ? [offset]
      : []
  }).sort((left, right) => left - right)
  const medianOffset = translationOffsets[Math.floor(translationOffsets.length / 2)]
  const offsetDeviations = Number.isFinite(medianOffset)
    ? translationOffsets.map(value => Math.abs(value - medianOffset)).sort((left, right) => left - right)
    : []
  const offsetMad = offsetDeviations[Math.floor(offsetDeviations.length / 2)] ?? Infinity
  // A repeated stable sub-second offset is a bilingual export convention. A
  // single nearby Chinese row can instead be a real alternating lyric, so it
  // intentionally does not teach the splitter a wider tolerance.
  const stableTranslationOffsetMs = translationOffsets.length >= 3 && offsetMad <= 150 ? medianOffset : undefined

  for (const raw of physicalRows) {
    const timestamps = raw.match(LRC_TIMESTAMP) ?? []
    const content = raw.replace(LRC_TIMESTAMP, '').trim()
    if (!timestamps.length || !content) {
      // A few community files put an untimed Chinese translation immediately
      // below its timed Japanese row. Adopt it only when the shape is clear;
      // ordinary LRC metadata stays untouched.
      const previous = groups.at(-1)
      if (content && !raw.trimStart().startsWith('[') && previous?.entries.length === 1 && KANA.test(previous.entries[0].content) && HAN.test(content) && !KANA.test(content)) {
        previous.entries.push({ raw: `${previous.prefix}${content}`, prefix: previous.prefix, content, index: 1 })
      } else if (raw) metadata.push(raw)
      order++
      continue
    }
    const prefix = timestamps.join('')
    const startMs = timestampMs(timestamps[0]!)
    const pieces = content.split(/(?:\s*\/{2,}\s*|\s+[\/]\s+|\s*[|｜]\s*)/).filter(Boolean)
    const inlinePair = pieces.length >= 2 && pieces.some(piece => KANA.test(piece)) && pieces.some(piece => !KANA.test(piece) && HAN.test(piece))
    let group = exactGroups.get(prefix)
    if (!group) {
      const previous = groups.at(-1)
      // Translation and romanization timestamps from different tools are
      // often rounded by 10–200 ms. Cluster only adjacent rows that appear to
      // use different scripts; the repeated-pair gate below prevents this
      // from altering an ordinary monolingual file.
      const previousHasJapanese = Boolean(previous?.entries.some(entry => KANA.test(entry.content)))
      const previousHasChinese = Boolean(previous?.entries.some(entry => HAN.test(entry.content) && !KANA.test(entry.content)))
      const previousHasRomanized = Boolean(previous?.entries.some(entry => isRomanizedText(entry.content)))
      const stableTranslationPair = Boolean(previous && stableTranslationOffsetMs != null
        && previousHasJapanese && HAN.test(content) && !KANA.test(content)
        && Math.abs(startMs - previous.startMs - stableTranslationOffsetMs) <= 150)
      const complementaryScript = Boolean(previous && previous.entries.length < 4 && (Math.abs(previous.startMs - startMs) <= 220 || stableTranslationPair) && (
        (previousHasJapanese && ((HAN.test(content) && !KANA.test(content)) || isRomanizedText(content)))
        || (KANA.test(content) && (previousHasChinese || previousHasRomanized))
      ))
      const resolvedGroup: Group = complementaryScript && previous ? previous : { prefix, startMs, order, entries: [] }
      group = resolvedGroup
      if (!(complementaryScript && previous)) groups.push(resolvedGroup)
      exactGroups.set(prefix, resolvedGroup)
    }
    for (const piece of inlinePair ? pieces : [content]) group!.entries.push({ raw: inlinePair ? `${prefix}${piece}` : raw, prefix, content: piece, index: group!.entries.length })
    order++
  }

  const explicitPairs = groups.flatMap(group => {
    const original = group.entries.find(entry => KANA.test(entry.content))
    const translation = group.entries.find(entry => !KANA.test(entry.content) && HAN.test(entry.content))
    return original && translation ? [{ original, translation }] : []
  })
  const explicitRomanizations = groups.flatMap(group => {
    const original = group.entries.find(entry => KANA.test(entry.content))
    const romanization = group.entries.find(entry => isRomanizedText(entry.content))
    return original && romanization ? [{ original, romanization }] : []
  })
  // One duplicated timestamp can be an annotation; two establish a bilingual
  // layout and also teach us the row order for kanji-only Japanese lines.
  const hasTranslation = explicitPairs.length >= 2
  const hasRomanization = explicitRomanizations.length >= 2
  if (!hasTranslation && !hasRomanization) return primaryLyrics === result.syncedLyrics && !inferredTracks.length
    ? result
    : { ...result, syncedLyrics: primaryLyrics, additionalTracks: initialAdditionalTracks }
  const modeIndex = (values: number[]) => [...new Set(values)].sort((a, b) => values.filter(value => value === b).length - values.filter(value => value === a).length)[0] ?? 0
  const originalIndex = modeIndex([...explicitPairs.map(pair => pair.original.index), ...explicitRomanizations.map(pair => pair.original.index)])
  const translationIndex = modeIndex(explicitPairs.map(pair => pair.translation.index))
  const romanizationIndex = modeIndex(explicitRomanizations.map(pair => pair.romanization.index))
  const originalLines = [...metadata]
  const translationLines: string[] = []
  const romanizationLines: string[] = []

  for (const group of groups.sort((a, b) => a.order - b.order)) {
    if (group.entries.length < 2) { if (group.entries[0]) originalLines.push(group.entries[0].raw); continue }
    const original = group.entries.find(entry => KANA.test(entry.content)) ?? group.entries[originalIndex] ?? group.entries[0]
    const translation = hasTranslation ? group.entries.find(entry => entry !== original && !KANA.test(entry.content) && HAN.test(entry.content)) ?? group.entries[translationIndex] : undefined
    const romanization = hasRomanization ? group.entries.find(entry => entry !== original && isRomanizedText(entry.content)) ?? group.entries[romanizationIndex] : undefined
    originalLines.push(`${original.prefix}${original.content}`)
    if (translation && translation !== original) translationLines.push(`${original.prefix}${translation.content}`)
    if (romanization && romanization !== original) romanizationLines.push(`${original.prefix}${romanization.content}`)
  }
  const existing = initialAdditionalTracks
  const embedded: SupplementalLyrics[] = []
  if (translationLines.length >= 2 && !existing.some(track => track.language === 'zh-Hans' && track.kind === 'translation')) embedded.push({
    language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: translationLines.join('\n'), source: `${result.source} · 内嵌双语拆分`
  })
  if (romanizationLines.length >= 2 && !existing.some(track => track.language === 'romaji' && track.kind === 'romanization')) embedded.push({
    language: 'romaji', label: 'Romaji', kind: 'romanization', syncedLyrics: romanizationLines.join('\n'), source: `${result.source} · 内嵌罗马音拆分`
  })
  if (!embedded.length && !translationLines.length && !romanizationLines.length) return result
  return {
    ...result,
    syncedLyrics: originalLines.filter(Boolean).join('\n'),
    additionalTracks: [...existing, ...embedded]
  }
}

export function isTimedLyrics(value: string | null | undefined) {
  return Boolean(value && /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?]/.test(value))
}

export function timedLyricsStats(value: string | null | undefined, durationMs = 0) {
  // Decorative ♪ / separator rows may legitimately render during an
  // instrumental break, but they are not evidence that a provider covers the
  // missing verse or the end of a song.
  const timestamps = parseTimedRows(value).filter(row => row.normalizedText.length > 0).map(row => row.timeMs)
  const unique = [...new Set(timestamps)].sort((a, b) => a - b)
  const firstMs = unique[0] ?? 0
  const lastMs = unique.at(-1) ?? 0
  const tailCoverage = durationMs > 0 ? Math.min(1, lastMs / durationMs) : 1
  const gaps = unique.slice(1).map((stamp, index) => stamp - unique[index]).filter(gap => gap > 0)
  const orderedGaps = [...gaps].sort((a, b) => a - b)
  const medianGapMs = orderedGaps.length ? orderedGaps[Math.floor(orderedGaps.length / 2)] : 0
  // A normal instrumental break should not count as missing lyrics. Penalize
  // only the portion of unusually large internal holes beyond four cadences.
  const gapAllowanceMs = Math.max(18_000, medianGapMs * 4)
  const excessiveGapMs = gaps.reduce((total, gap) => total + Math.max(0, gap - gapAllowanceMs), 0)
  const maxGapMs = gaps.length ? Math.max(...gaps) : 0
  const continuity = durationMs > 0 ? Math.max(0, 1 - excessiveGapMs / durationMs) : 1
  return { lineCount: unique.length, firstMs, lastMs, tailCoverage, maxGapMs, excessiveGapMs, continuity }
}

function lyricQuality(result: LyricsResult, durationMs = 0) {
  const stats = timedLyricsStats(result.syncedLyrics, durationMs)
  const tailPenalty = durationMs > 0 && stats.lastMs < durationMs * .58 ? 55 : 0
  const durationDelta = durationMs > 0 && result.matchedDurationMs ? Math.abs(durationMs - result.matchedDurationMs) : 0
  // A custom transition can shorten the media-session endpoint by several
  // seconds. Duration remains useful for rejecting a different edit, but it
  // must not overwhelm exact title/artist identity or full-text evidence.
  const durationPenalty = Math.min(30, Math.max(0, durationDelta - 8000) / 750)
  const trustedTimelineBonus = result.source.startsWith('Spotify') ? 20 : 0
  // An LRCLIB /get response has already matched title, artist and (when
  // available) album. When two providers contain the same lyric text, a
  // search result must not win merely because it split five sentences into
  // ten shorter display rows. Proven missing blocks are removed separately by
  // isProvenIncomplete, so this authority bonus cannot preserve a genuinely
  // truncated exact result.
  const exactMetadataBonus = result.source.startsWith('LRCLIB · 精确匹配') ? 12 : 0
  return Math.min(stats.lineCount, 70) * 1.65 + stats.tailCoverage * 42 + stats.continuity * 35 + result.confidence * .22 + trustedTimelineBonus + exactMetadataBonus - tailPenalty - durationPenalty
}

function timelineRows(value: string | null | undefined) {
  return parseTimedRows(value).flatMap(row => row.normalizedText.length >= 3
    ? [{ timeMs: row.timeMs, text: row.normalizedText, rawText: row.text }]
    : [])
}

function timelineDistance(left: LyricsResult, right: LyricsResult) {
  const leftRows = timelineRows(left.syncedLyrics)
  const rightRows = timelineRows(right.syncedLyrics)
  const directionalDifferences = (from: typeof leftRows, to: typeof rightRows) => from.flatMap(row => {
    const matches = to.filter(other => row.text === other.text || (Math.min(row.text.length, other.text.length) >= 4 && (row.text.includes(other.text) || other.text.includes(row.text))))
    return matches.length ? [Math.min(...matches.map(other => Math.abs(row.timeMs - other.timeMs)))] : []
  })
  // Combining both directions keeps the score symmetric when one provider
  // splits a sentence that another provider stores as a single timed row.
  const differences = [...directionalDifferences(leftRows, rightRows), ...directionalDifferences(rightRows, leftRows)]
  if (differences.length < 3) return null
  differences.sort((a, b) => a - b)
  return differences[Math.floor(differences.length / 2)]
}

function rowsCompatible(left: ReturnType<typeof timelineRows>[number], right: ReturnType<typeof timelineRows>[number]) {
  if (left.text === right.text) return true
  const shortest = Math.min(left.text.length, right.text.length)
  const longest = Math.max(left.text.length, right.text.length)
  return shortest >= 5 && shortest / longest >= .55 && (left.text.includes(right.text) || right.text.includes(left.text))
}

function median(values: number[]) {
  if (!values.length) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)]
}

type TimelineAnchor = { subjectIndex: number; referenceIndex: number }
type MissingBlock = {
  before: TimelineAnchor
  after: TimelineAnchor
  referenceRows: ReturnType<typeof timelineRows>
}

function lcsTimelineAnchors(subjectRows: ReturnType<typeof timelineRows>, referenceRows: ReturnType<typeof timelineRows>) {
  const table = Array.from({ length: subjectRows.length + 1 }, () => new Uint16Array(referenceRows.length + 1))
  for (let subjectIndex = subjectRows.length - 1; subjectIndex >= 0; subjectIndex -= 1) {
    for (let referenceIndex = referenceRows.length - 1; referenceIndex >= 0; referenceIndex -= 1) {
      table[subjectIndex][referenceIndex] = rowsCompatible(subjectRows[subjectIndex], referenceRows[referenceIndex])
        ? table[subjectIndex + 1][referenceIndex + 1] + 1
        : Math.max(table[subjectIndex + 1][referenceIndex], table[subjectIndex][referenceIndex + 1])
    }
  }
  const anchors: TimelineAnchor[] = []
  let subjectIndex = 0
  let referenceIndex = 0
  while (subjectIndex < subjectRows.length && referenceIndex < referenceRows.length) {
    if (rowsCompatible(subjectRows[subjectIndex], referenceRows[referenceIndex])
      && table[subjectIndex][referenceIndex] === table[subjectIndex + 1][referenceIndex + 1] + 1) {
      anchors.push({ subjectIndex, referenceIndex })
      subjectIndex += 1
      referenceIndex += 1
    } else if (table[subjectIndex + 1][referenceIndex] >= table[subjectIndex][referenceIndex + 1]) subjectIndex += 1
    else referenceIndex += 1
  }
  return anchors
}

function durationCompatible(left: LyricsResult, right: LyricsResult) {
  return !left.matchedDurationMs || !right.matchedDurationMs || Math.abs(left.matchedDurationMs - right.matchedDurationMs) <= 10_000
}

/**
 * A strong title/artist score is not enough to identify the recording. Search
 * providers can return a different song with the same English title, a live
 * medley, or an extended edit. Mapping a 376-second result onto a 208-second
 * Spotify item makes every line appear catastrophically early even though the
 * metadata confidence looks high. Use a conservative 0.82–1.18 identity range
 * (not a playback-speed estimate), with a 12-second absolute allowance for
 * short tracks and provider duration rounding. Candidates without duration
 * metadata remain eligible and must be judged by identity/text evidence.
 */
export function durationPlausibleForPlayback(result: LyricsResult, durationMs = 0) {
  if (!durationMs || durationMs <= 0 || !result.matchedDurationMs || result.matchedDurationMs <= 0) return true
  const deltaMs = Math.abs(result.matchedDurationMs - durationMs)
  const ratio = result.matchedDurationMs / durationMs
  return deltaMs <= 12_000 || (ratio >= .82 && ratio <= 1.18)
}

function timelineTextSimilarity(left: LyricsResult, right: LyricsResult) {
  const text = (result: LyricsResult) => timelineRows(result.syncedLyrics).map(row => row.text).join('')
  return normalizedTextSimilarity(text(left), text(right))
}

function normalizedTextSimilarity(leftText: string, rightText: string) {
  if (!leftText || !rightText) return 0
  if (leftText === rightText) return 1
  const bigrams = (value: string) => {
    const counts = new Map<string, number>()
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
    return counts
  }
  const leftBigrams = bigrams(leftText)
  const rightBigrams = bigrams(rightText)
  let intersection = 0
  for (const [gram, count] of leftBigrams) intersection += Math.min(count, rightBigrams.get(gram) ?? 0)
  const total = Math.max(1, leftText.length - 1) + Math.max(1, rightText.length - 1)
  return 2 * intersection / total
}

function timelineRelation(subject: LyricsResult, reference: LyricsResult) {
  if (!durationCompatible(subject, reference)) return null
  const subjectRows = timelineRows(subject.syncedLyrics)
  const referenceRows = timelineRows(reference.syncedLyrics)
  const anchors = lcsTimelineAnchors(subjectRows, referenceRows)
  if (anchors.length < 4 || anchors.length / Math.max(1, Math.min(subjectRows.length, referenceRows.length)) < .3) return null
  const first = anchors[0]
  const last = anchors.at(-1)!
  const spanMs = Math.max(
    subjectRows[last.subjectIndex].timeMs - subjectRows[first.subjectIndex].timeMs,
    referenceRows[last.referenceIndex].timeMs - referenceRows[first.referenceIndex].timeMs
  )
  if (spanMs < 30_000) return null
  const deltas = anchors.map(anchor => subjectRows[anchor.subjectIndex].timeMs - referenceRows[anchor.referenceIndex].timeMs)
  const medianDeltaMs = median(deltas)
  const madMs = median(deltas.map(delta => Math.abs(delta - medianDeltaMs)))
  if (madMs > 900) return null

  const missingBlocks: MissingBlock[] = []
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const before = anchors[index]
    const after = anchors[index + 1]
    if (after.subjectIndex - before.subjectIndex !== 1 || after.referenceIndex - before.referenceIndex < 3) continue
    const inside = referenceRows.slice(before.referenceIndex + 1, after.referenceIndex)
    const intervalMs = referenceRows[after.referenceIndex].timeMs - referenceRows[before.referenceIndex].timeMs
    const contentLength = inside.reduce((total, row) => total + row.text.length, 0)
    const subjectSpan = subjectRows[after.subjectIndex].timeMs - subjectRows[before.subjectIndex].timeMs
    const slope = intervalMs > 0 ? subjectSpan / intervalMs : 0
    if (inside.length >= 2 && contentLength >= 10 && intervalMs >= 8000 && slope >= .94 && slope <= 1.06) {
      missingBlocks.push({ before, after, referenceRows: inside })
    }
  }
  const subjectPrefixRows = first.subjectIndex
  const referencePrefixRows = first.referenceIndex
  const referencePrefix = referenceRows.slice(0, first.referenceIndex)
  const missingPrefix = subjectPrefixRows <= 1 && referencePrefixRows >= subjectPrefixRows + 2
    && referenceRows[first.referenceIndex].timeMs - (referencePrefix[0]?.timeMs ?? referenceRows[first.referenceIndex].timeMs) >= 8000
    && referencePrefix.reduce((total, row) => total + row.text.length, 0) >= 10
  const subjectSuffixRows = subjectRows.length - 1 - last.subjectIndex
  const referenceSuffixRows = referenceRows.length - 1 - last.referenceIndex
  const referenceSuffix = referenceRows.slice(last.referenceIndex + 1)
  const missingSuffix = subjectSuffixRows <= 1 && referenceSuffixRows >= subjectSuffixRows + 2
    && (referenceSuffix.at(-1)?.timeMs ?? referenceRows[last.referenceIndex].timeMs) - referenceRows[last.referenceIndex].timeMs >= 8000
    // Repeated outro refrains are often only three or four characters long
    // (for example two additional 「やれるわ」 rows). Requiring ten
    // novel characters treated those real timed repetitions as decoration and
    // let an otherwise exact provider silently truncate the sung ending. Two
    // rows spanning at least eight seconds plus the stable preceding anchors
    // are sufficient evidence; timelineRows has already removed separators.
    && referenceSuffix.reduce((total, row) => total + row.text.length, 0) >= 6
  return { subjectRows, referenceRows, anchors, medianDeltaMs, madMs, missingBlocks, missingPrefix, missingSuffix }
}

/** Restore omitted tandem repetitions without replacing an authoritative clock. */
export function repairRepeatedWords(base: LyricsResult, candidates: LyricsResult[]) {
  if (base.source.startsWith('Spotify')) return base
  const rows = parseTimedRows(base.syncedLyrics)
  const baseText = rows.map(row => row.normalizedText).join('')
  const proposals = new Map<number, Map<string, string>>()
  for (const reference of candidates) {
    if (reference === base || reference.confidence < base.confidence - 20
      || !base.matchedDurationMs || !reference.matchedDurationMs
      || Math.abs(base.matchedDurationMs - reference.matchedDurationMs) > 2000) continue
    const otherRows = parseTimedRows(reference.syncedLyrics)
    const otherText = otherRows.map(row => row.normalizedText).join('')
    const relation = timelineRelation(base, reference)
    if (!relation || Math.abs(relation.medianDeltaMs) > 700
      || normalizedTextSimilarity(baseText, otherText) < .97) continue
    const changes: Array<{ index: number; text: string; normalized: string }> = []
    rows.forEach((row, index) => {
      const nearby = otherRows.filter(other => Math.abs(other.timeMs - row.timeMs) <= 700)
      if (nearby.length !== 1) return
      const other = nearby[0]
      if (other.normalizedText.length > 240 || other.normalizedText.length <= row.normalizedText.length) return
      // Only an exact one-row expansion of an existing 1–4-character word
      // into at least three consecutive repetitions qualifies. New phrases,
      // punctuation, row splitting and spelling differences are not repairs.
      for (const match of other.normalizedText.matchAll(/(.{1,4})\1{2,}/gu)) {
        const unit = match[1]
        for (let count = 1; count < match[0].length / unit.length; count++) {
          const reduced = other.normalizedText.slice(0, match.index) + unit.repeat(count)
            + other.normalizedText.slice(match.index! + match[0].length)
          if (reduced === row.normalizedText) {
            changes.push({ index, text: other.text, normalized: other.normalizedText })
            return
          }
        }
      }
    })
    // A lone disagreement is insufficient evidence to rewrite provider text.
    if (changes.length < 2) continue
    for (const change of changes) {
      const variants = proposals.get(change.index) ?? new Map<string, string>()
      variants.set(change.normalized, change.text)
      proposals.set(change.index, variants)
    }
  }
  const replacements = new Map([...proposals].flatMap(([index, variants]) => variants.size === 1
    ? [[index, [...variants.values()][0]] as const] : []))
  if (!replacements.size) return base
  const byRow = new Map([...replacements].map(([index, text]) => [`${rows[index].timeMs}\0${rows[index].text}`, text]))
  return { ...base, source: `${base.source} + 重复词补全`,
    syncedLyrics: base.syncedLyrics!.split('\n').map(raw => {
      const timestamps = raw.match(LRC_TIMESTAMP) ?? []
      const text = raw.replace(LRC_TIMESTAMP, '').trim()
      if (!timestamps.some(stamp => byRow.has(`${timestampMs(stamp)}\0${text}`))) return raw
      return timestamps.map(stamp => `${stamp}${byRow.get(`${timestampMs(stamp)}\0${text}`) ?? text}`).join('\n')
    }).join('\n') }
}

function isProvenIncomplete(subject: LyricsResult, candidates: LyricsResult[]) {
  return candidates.some(reference => {
    if (reference === subject || reference.confidence < subject.confidence - 20) return false
    const forward = timelineRelation(subject, reference)
    const reverse = timelineRelation(reference, subject)
    const forwardMissing = Boolean(forward && (forward.missingBlocks.length || forward.missingPrefix || forward.missingSuffix))
    const reverseMissing = Boolean(reverse && (reverse.missingBlocks.length || reverse.missingPrefix || reverse.missingSuffix))
    return forwardMissing && !reverseMissing
  })
}

function timelineConsensusScore(result: LyricsResult, candidates: LyricsResult[]) {
  const distances = candidates.filter(other => other !== result).map(other => timelineDistance(result, other)).filter((value): value is number => value != null)
  // With two sources the comparison is symmetric and ordinary quality remains
  // decisive. With three, an offset outlier disagrees twice while the two
  // agreeing timelines reinforce each other.
  return distances.reduce((score, distance) => score + Math.max(-32, 18 - distance / 300), 0)
}

/**
 * Treat a timeline as a global-offset outlier only with a real three-source
 * quorum: it must disagree with two comparable timelines while those two
 * agree with each other. One community file can be wrong or derived from a
 * different release, so a lone disagreement must never defeat exact metadata.
 */
function isTimelineConsensusOutlier(result: LyricsResult, candidates: LyricsResult[]) {
  const others = candidates.filter(candidate => candidate !== result)
  if (others.length < 2) return false
  // timelineRelation supplies ordered LCS anchors spanning at least 30 seconds
  // and rejects unstable deltas (MAD > 900 ms). This is deliberately stricter
  // than the broad quality score: three repeated/common phrases are not enough
  // evidence to overrule an exact metadata match.
  const offsetDistance = (left: LyricsResult, right: LyricsResult) => {
    const relation = timelineRelation(left, right)
    return relation ? Math.abs(relation.medianDeltaMs) : null
  }
  const disagreesWithTwo = others
    .map(candidate => offsetDistance(result, candidate))
    .filter((distance): distance is number => distance != null && distance >= 2500)
    .length >= 2
  if (!disagreesWithTwo) return false
  return others.some((left, index) => others.slice(index + 1)
    .some(right => (offsetDistance(left, right) ?? Infinity) <= 1200))
}

function lrcTimeMs(timestamp: string) {
  return timestampMs(timestamp)
}

function lrcTimestamp(milliseconds: number) {
  const safe = Math.max(0, Math.round(milliseconds / 10) * 10)
  const minutes = Math.floor(safe / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1000)
  const centiseconds = Math.floor((safe % 1000) / 10)
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`
}

/**
 * A translation inherits its provider's original-language timestamps. When a
 * different provider wins as the primary timeline, remap the translation via
 * matching original-language rows. This keeps NetEase Chinese attached to the
 * Spotify/LRCLIB line instead of dropping it outside the renderer's tolerance.
 */
export function alignSupplementalTimeline(track: SupplementalLyrics, owner: LyricsResult, base: LyricsResult): SupplementalLyrics {
  if (owner === base || !owner.syncedLyrics || !base.syncedLyrics) return track
  const ownerRows = timelineRows(owner.syncedLyrics)
  const baseRows = timelineRows(base.syncedLyrics)
  // Repeated choruses require a globally monotonic alignment. The previous
  // greedy matcher fell back to an earlier target when a unique verse appeared
  // after an extra repeated line, producing a backwards translation timeline.
  const anchors = lcsTimelineAnchors(ownerRows, baseRows).map(anchor => ({
    sourceMs: ownerRows[anchor.subjectIndex].timeMs,
    targetMs: baseRows[anchor.referenceIndex].timeMs
  }))
  if (anchors.length < 3) return track
  const deltas = anchors.map(anchor => anchor.targetMs - anchor.sourceMs).sort((left, right) => left - right)
  const medianDelta = deltas[Math.floor(deltas.length / 2)] ?? 0
  const remap = (sourceMs: number) => {
    const nearest = anchors.reduce((best, anchor) => Math.abs(anchor.sourceMs - sourceMs) < Math.abs(best.sourceMs - sourceMs) ? anchor : best)
    // Translation timestamps normally equal their owner's original row. Use
    // that line-level anchor when close, retaining a tiny provider sub-offset.
    return Math.abs(nearest.sourceMs - sourceMs) <= 2500
      ? nearest.targetMs + sourceMs - nearest.sourceMs
      : sourceMs + medianDelta
  }
  const syncedLyrics = track.syncedLyrics.split(/\r?\n/).map(line => line.replace(LRC_TIMESTAMP, timestamp => {
    const sourceMs = lrcTimeMs(timestamp)
    return Number.isFinite(sourceMs) ? lrcTimestamp(remap(sourceMs)) : timestamp
  })).join('\n')
  const alignedTo = base.source.startsWith('Spotify') ? 'Spotify' : '主歌词'
  return { ...track, syncedLyrics, source: `${track.source} · 对齐${alignedTo}时轴` }
}

function dominantLyricScript(rows: TimedLyricsRow[]) {
  const joined = rows.map(row => row.text).join('')
  const kana = [...joined].filter(character => KANA.test(character)).length
  const han = [...joined].filter(character => HAN.test(character)).length
  const latin = [...joined].filter(character => LATIN.test(character)).length
  if (kana >= 3) return 'ja'
  if (han > latin) return 'han'
  return latin ? 'latin' : 'other'
}

/**
 * Conservatively fill only a bounded hole proven by two stable shared anchors.
 * No beginning/end extrapolation is allowed, and a different script/version is
 * never mixed into the selected original track.
 */
export function repairBoundedGaps(base: LyricsResult, candidates: LyricsResult[]) {
  if (!base.syncedLyrics) return base
  const basePhysicalRows = parseTimedRows(base.syncedLyrics)
  const baseScript = dominantLyricScript(basePhysicalRows)
  const additions: TimedLyricsRow[] = []
  const sources = new Set<string>()
  const maximumAdditions = Math.max(2, Math.floor(basePhysicalRows.length * .35))

  for (const rawReference of candidates) {
    if (rawReference === base || rawReference.confidence < base.confidence - 20 || additions.length >= maximumAdditions) continue
    const reference = splitEmbeddedTranslation(rawReference)
    if (!reference.syncedLyrics || dominantLyricScript(parseTimedRows(reference.syncedLyrics)) !== baseScript) continue
    const relation = timelineRelation(base, reference)
    if (!relation?.missingBlocks.length) continue
    for (const block of relation.missingBlocks) {
      const beforeSubject = relation.subjectRows[block.before.subjectIndex]
      const afterSubject = relation.subjectRows[block.after.subjectIndex]
      const beforeReference = relation.referenceRows[block.before.referenceIndex]
      const afterReference = relation.referenceRows[block.after.referenceIndex]
      const referenceSpan = afterReference.timeMs - beforeReference.timeMs
      if (referenceSpan <= 0) continue
      for (const row of block.referenceRows) {
        if (additions.length >= maximumAdditions) break
        const ratio = (row.timeMs - beforeReference.timeMs) / referenceSpan
        const timeMs = beforeSubject.timeMs + ratio * (afterSubject.timeMs - beforeSubject.timeMs)
        // Repeated choruses are valid at different positions, so de-duplicate
        // only the same text near the mapped timestamp. Keep the reference's
        // original spacing and punctuation in the rendered LRC.
        const duplicate = [...basePhysicalRows, ...additions].some(existing =>
          Math.abs(existing.timeMs - timeMs) <= 900 && existing.normalizedText === row.text)
        if (!duplicate) additions.push({ timeMs, text: row.rawText, normalizedText: row.text })
      }
      if (additions.length) sources.add(reference.source)
    }
  }
  if (!additions.length) return base
  const syncedLyrics = [...basePhysicalRows, ...additions]
    .sort((left, right) => left.timeMs - right.timeMs)
    .map(row => `${lrcTimestamp(row.timeMs)}${row.text}`)
    .join('\n')
  return { ...base, syncedLyrics, source: `${base.source} + ${[...sources].join(' / ')} 补全` }
}

type OwnedSupplemental = { owner: LyricsResult; track: SupplementalLyrics }

function supplementalOwnerCompatible(owner: LyricsResult, base: LyricsResult) {
  if (owner === base || timelineRelation(owner, base)) return true
  if (durationCompatible(owner, base) && timelineTextSimilarity(owner, base) >= .68) return true
  const ownerRows = timelineRows(owner.syncedLyrics)
  const baseRows = timelineRows(base.syncedLyrics)
  if (!ownerRows.length || !baseRows.length || Math.min(ownerRows.length, baseRows.length) > 3) return false
  const anchors = lcsTimelineAnchors(ownerRows, baseRows)
  const needed = Math.min(ownerRows.length, baseRows.length)
  return anchors.length === needed && anchors.every(anchor => Math.abs(ownerRows[anchor.subjectIndex].timeMs - baseRows[anchor.referenceIndex].timeMs) <= 5000)
}

function supplementalBuckets(track: SupplementalLyrics, base: LyricsResult) {
  const baseRows = timelineRows(base.syncedLyrics)
  const buckets = new Map<number, string>()
  for (const row of parseTimedRows(track.syncedLyrics)) {
    // Assign by the source-line interval, not only by the nearest timestamp.
    // Providers sometimes split one translated sentence into two delayed
    // phrases; both legitimately belong to the same original row and must not
    // overwrite one another in a Map<number, string>.
    let index = -1
    const lookupMs = row.timeMs + 1200
    for (let candidate = 0; candidate < baseRows.length; candidate += 1) {
      if (baseRows[candidate].timeMs <= lookupMs) index = candidate
      else break
    }
    if (index < 0) continue
    const startMs = baseRows[index].timeMs
    const endMs = baseRows[index + 1]?.timeMs ?? startMs + 12_000
    if (row.timeMs < startMs - 1200 || row.timeMs > endMs + 2200) continue
    const existing = buckets.get(index)?.split('　').filter(Boolean) ?? []
    if (!existing.includes(row.text)) buckets.set(index, [...existing, row.text].join('　'))
  }
  return { baseRows, buckets, coverage: baseRows.length ? buckets.size / baseRows.length : 0 }
}

function mergeChineseSupplementals(items: OwnedSupplemental[], base: LyricsResult) {
  if (!items.length) return null
  const scored = items.map(item => ({ ...item, ...supplementalBuckets(item.track, base) }))
    .filter(item => item.buckets.size > 0)
    .sort((left, right) => right.coverage - left.coverage)
  if (!scored.length) return null
  const best = scored[0]
  const bestNetease = scored.filter(item => item.track.source.includes('网易云')).sort((left, right) => right.coverage - left.coverage)[0]
  // Prefer NetEase wording when it is nearly as complete, but never trade a
  // mostly populated translation for a sparse 2-line tlyric.
  const selected = bestNetease && bestNetease.coverage + .2001 >= best.coverage ? bestNetease : best
  const merged = new Map(selected.buckets)
  const usedSources = new Set([selected.track.source])
  for (const fallback of scored) {
    if (fallback === selected) continue
    for (const [index, text] of fallback.buckets) {
      if (!merged.has(index)) { merged.set(index, text); usedSources.add(fallback.track.source) }
    }
  }
  const syncedLyrics = [...merged.entries()].sort(([left], [right]) => left - right)
    .map(([index, text]) => `${lrcTimestamp(selected.baseRows[index].timeMs)}${text}`)
    .join('\n')
  return {
    ...selected.track,
    syncedLyrics,
    source: usedSources.size > 1 ? `${selected.track.source} + 缺行补全` : selected.track.source
  }
}

function bestLyricsCandidate(candidates: LyricsResult[], durationMs = 0) {
  // Filter before choosing a winner inside each provider as well as in the
  // final cross-provider merge. Otherwise an impossible high-score search hit
  // can hide a lower-ranked correct-duration candidate, then be rejected only
  // after the provider has already discarded that usable alternative.
  const durationMatched = candidates.filter(item => durationPlausibleForPlayback(item, durationMs))
  if (!durationMatched.length) return null
  const prepared = durationMatched.map(splitEmbeddedTranslation)
  const strongestIdentity = Math.max(...prepared.map(item => item.confidence))
  const wide = prepared.filter(item => item.confidence >= strongestIdentity - 20)
  // Six identity points is enough for an unrelated same-artist song with a
  // coincidentally close duration to enter the quality race and beat a
  // localized-title match simply by having more short lyric rows. Keep the
  // healthy top tier within five points; a demonstrably incomplete leader
  // still reopens the full 20-point pool below.
  const topTier = wide.filter(item => item.confidence >= strongestIdentity - 5)
  const topLooksTruncated = topTier.every(item => {
    const stats = timedLyricsStats(item.syncedLyrics, durationMs)
    return stats.lineCount < 4 || stats.excessiveGapMs > 0 || stats.continuity < .82 || (durationMs > 0 && stats.tailCoverage < .55)
  })
  const topHasProvenHole = topTier.some(item => isProvenIncomplete(item, wide))
  const topHasDetailedEquivalent = topTier.some(item => wide.some(reference => reference !== item
    && durationCompatible(item, reference) && timelineTextSimilarity(item, reference) >= .72
    && timelineRows(reference.syncedLyrics).length >= timelineRows(item.syncedLyrics).length * 1.25))
  const topIsTimelineOutlier = wide.length >= 3 && topTier.some(item => isTimelineConsensusOutlier(item, wide))
  // Identity is a hard gate while the strongest exact result is healthy. A
  // wider pool is considered only when independent timeline evidence proves a
  // hole/outlier, or simple coverage metrics show clear truncation.
  const plausible = topLooksTruncated || topHasProvenHole || topHasDetailedEquivalent || topIsTimelineOutlier ? wide : topTier
  const undominated = plausible.filter(item => !isProvenIncomplete(item, plausible))
  const viable = undominated.length ? undominated : plausible
  // A provider-side translation can masquerade as the original and win the
  // numeric score simply by splitting each sung line into two shorter rows.
  // LRCLIB /get has matched the requested title + artist directly, so retain a
  // healthy exact timeline unless another source can *prove* that it omits a
  // real block or two independent timelines prove that its entire clock is
  // shifted. Supplemental translations are still merged independently.
  const trustedExact = viable.filter(item => {
    if (!item.source.startsWith('LRCLIB · 精确匹配') || isProvenIncomplete(item, wide) || isTimelineConsensusOutlier(item, wide)) return false
    const stats = timedLyricsStats(item.syncedLyrics, durationMs)
    return stats.lineCount >= 4 && stats.continuity >= .82 && (!durationMs || stats.tailCoverage >= .55)
  })
  if (trustedExact.length) {
    return [...trustedExact].sort((a, b) => {
      const qualityDelta = lyricQuality(b, durationMs) - lyricQuality(a, durationMs)
      if (Math.abs(qualityDelta) > .01) return qualityDelta
      const aDistance = durationMs && a.matchedDurationMs ? Math.abs(a.matchedDurationMs - durationMs) : Number.MAX_SAFE_INTEGER
      const bDistance = durationMs && b.matchedDurationMs ? Math.abs(b.matchedDurationMs - durationMs) : Number.MAX_SAFE_INTEGER
      return aDistance - bDistance
    })[0] ?? null
  }
  return [...viable].sort((a, b) => {
    const qualityDelta = lyricQuality(b, durationMs) + timelineConsensusScore(b, plausible)
      - lyricQuality(a, durationMs) - timelineConsensusScore(a, plausible)
    if (Math.abs(qualityDelta) > .01) return qualityDelta
    // Equal-quality releases are common when a provider republishes the same
    // LRC under both a single and soundtrack entry. Prefer the media session's
    // exact duration only as a final tie-breaker, never over stronger identity
    // or completeness evidence.
    const aDistance = durationMs && a.matchedDurationMs ? Math.abs(a.matchedDurationMs - durationMs) : Number.MAX_SAFE_INTEGER
    const bDistance = durationMs && b.matchedDurationMs ? Math.abs(b.matchedDurationMs - durationMs) : Number.MAX_SAFE_INTEGER
    return aDistance - bDistance
  })[0] ?? null
}

export function mergeProviderSet(results: Array<LyricsResult | null>, durationMs = 0, preferredScript?: 'ja' | 'han' | 'latin'): LyricsResult | null {
  const normalized = results.flatMap(result => result ? [splitEmbeddedTranslation(result)] : [])
  const authoritativePlain = normalized.filter(item => item.source.startsWith('LRCLIB · 精确匹配')
    && (item.plainLyrics?.replace(/\s+/g, '').length ?? 0) >= 40)
  const timed = normalized.filter(item => {
    if (!isTimedLyrics(item.syncedLyrics)) return false
    if (!durationPlausibleForPlayback(item, durationMs)) return false
    if (item.confidence >= 78 || !authoritativePlain.length) return true
    const candidateText = timelineRows(item.syncedLyrics).map(row => row.text).join('')
    // A low-identity fallback must at least resemble the exact provider's
    // untimed lyric body. This rejects unrelated same-query search results
    // without blocking a high-confidence cross-script/credit match.
    return authoritativePlain.some(reference => normalizedTextSimilarity(
      normalize(reference.plainLyrics ?? '').replace(/\s+/g, ''),
      candidateText
    ) >= .25)
  })
  const preferredTimed = preferredScript ? timed.filter(item => dominantLyricScript(parseTimedRows(item.syncedLyrics)) === preferredScript) : []
  const strongestIdentity = Math.max(0, ...timed.map(item => item.confidence))
  // A title written in kana is direct evidence that a Han-only LRC is a
  // translation, not a denser Japanese original. Keep the fallback when no
  // plausible Japanese source exists so rare community-only songs still show.
  const selectionPool = preferredTimed.some(item => item.confidence >= strongestIdentity - 20) ? preferredTimed : timed
  const qualityBase = bestLyricsCandidate(selectionPool, durationMs)
  const spotifyBase = bestLyricsCandidate(timed.filter(item => item.source.startsWith('Spotify')), durationMs)
  const spotifyStats = timedLyricsStats(spotifyBase?.syncedLyrics, durationMs)
  // A complete Spotify-provided timeline is the closest available reference
  // to what its client renders. Prefer it over a denser community LRC, but do
  // not let a genuinely truncated Spotify payload hide a better full source.
  const trustedSpotifyBase = spotifyBase && spotifyStats.lineCount >= 4 && spotifyStats.continuity >= .82
    && (!durationMs || spotifyStats.tailCoverage >= .55)
    && !isProvenIncomplete(spotifyBase, timed)
    ? spotifyBase
    : null
  // Untimed plain text is useful search metadata but cannot drive the desktop
  // lyric clock. Returning it as a successful fetch used to poison the
  // in-memory cache after a temporary outage and suppress later provider
  // retries for the rest of the process lifetime.
  const selectedBase = trustedSpotifyBase ?? qualityBase ?? timed[0]
  if (!selectedBase) return null
  const timedBase = repairRepeatedWords(repairBoundedGaps(selectedBase, timed), timed)
  const compatibleSupplementalOwners = normalized.filter(owner => supplementalOwnerCompatible(owner, selectedBase))
  const supplementalCandidates: OwnedSupplemental[] = compatibleSupplementalOwners.flatMap(owner => (owner.additionalTracks ?? []).map(track => ({ owner, track: alignSupplementalTimeline(track, owner, timedBase) })))
  const chinese = mergeChineseSupplementals(supplementalCandidates.filter(item => item.track.language === 'zh-Hans' && item.track.kind === 'translation'), timedBase)
  const supplementalSlots = new Map<string, OwnedSupplemental[]>()
  for (const item of supplementalCandidates) {
    if (item.track.language === 'zh-Hans') continue
    const slot = `${item.track.language}\0${item.track.kind}`
    supplementalSlots.set(slot, [...(supplementalSlots.get(slot) ?? []), item])
  }
  // Provider order is not a completeness signal. In particular, a sparse
  // embedded romaji track from the first result used to hide a complete human
  // NetEase track and force a slow generated replacement in the renderer.
  const additionalTracks = [...supplementalSlots.values()].flatMap(items => {
    const scored = items.map((item, order) => ({ item, order, coverage: supplementalBuckets(item.track, timedBase).coverage }))
      .filter(item => item.coverage > 0)
      .sort((left, right) => right.coverage - left.coverage || left.order - right.order)
    return scored[0] ? [scored[0].item.track] : []
  })
  if (chinese) additionalTracks.push(chinese)
  return { ...timedBase, additionalTracks }
}

export function mergeProviderResults(primary: LyricsResult | null, supplemental: LyricsResult | null, durationMs = 0): LyricsResult | null {
  return mergeProviderSet([primary, supplemental], durationMs)
}

interface LrcLibRecord {
  id: number; trackName: string; artistName: string; albumName: string; duration: number
  instrumental: boolean; syncedLyrics: string | null; plainLyrics: string | null
}

interface NeteaseSong {
  id: number; name: string; duration?: number; dt?: number
  artists?: Array<{ name: string; alias?: string[] }>; ar?: Array<{ name: string; alias?: string[] }>
  album?: { name: string; alia?: string[] }; al?: { name: string; alia?: string[] }
}

interface NeteaseLyrics {
  lrc?: { lyric?: string }; tlyric?: { lyric?: string }; romalrc?: { lyric?: string }
}

interface KugouSong {
  FileHash: string; AlbumID?: string; Duration?: number; SongName: string; SingerName: string
}

interface KugouLyricCandidate {
  id: string; accesskey: string; duration?: number; singer?: string; song?: string
}

const LRCLIB_API = 'https://lrclib.net/api'
const NETEASE_API = 'https://music.163.com/api'
const KUGOU_SEARCH_API = 'https://songsearch.kugou.com/song_search_v2'
const KUGOU_LYRICS_API = 'https://lyrics.kugou.com'
const headers = { 'User-Agent': 'Syllable/0.4.17 (desktop lyrics client)' }
const cache = new Map<string, LyricsResult>()
const inflight = new Map<string, Promise<LyricsResult | null>>()
const providerGenerations = new Map<string, number>()
const MAX_CACHE_ENTRIES = 80

function referenceDurationMs(track: NonNullable<PlaybackSnapshot['track']>) {
  return track.sourceDurationMs && track.sourceDurationMs > 0 ? track.sourceDurationMs : track.durationMs
}

function remember(key: string, result: LyricsResult) {
  cache.delete(key)
  cache.set(key, result)
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
}

function normalize(value: string) {
  return value.toLowerCase().normalize('NFKC').replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）|【[^】]*】/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function cleanTrackTitle(value: string) {
  return value.normalize('NFKC')
    .replace(/\s*[（([]\s*(?:feat(?:uring)?\.?|with|remaster(?:ed)?|live|acoustic|instrumental|version|edit|mix|from\b)[^)\]）]*[)\]）]/giu, '')
    .replace(/\s*[-–—]\s*(?:\d{4}\s+)?(?:remaster(?:ed)?|live|acoustic|instrumental|radio edit|single version|from\b).*$/giu, '')
    .replace(/\s+(?:feat(?:uring)?\.?|ft\.?)\s*.+$/giu, '')
    .replace(/\s+/g, ' ').trim()
}

export function primaryArtist(value: string) {
  return value.normalize('NFKC').split(/\s+(?:feat(?:uring)?\.?|ft\.?)\s+|\s*[,&;／/]\s*|\s+[x×]\s+/iu)[0]?.trim() || value.trim()
}

/**
 * Remove timed provider header rows such as
 * `[00:00.20]Artist - Track`, while retaining a real title refrain such as
 * `[00:02.00]言って`. The artist+title requirement makes this deliberately
 * narrower than a generic dash-row filter.
 */
export function stripTimedTrackMetadata(value: string | null | undefined, track: Pick<NonNullable<PlaybackSnapshot['track']>, 'name' | 'artist'>) {
  if (!value) return value ?? ''
  const titleVariants = [...new Set([track.name, cleanTrackTitle(track.name)].map(normalize).filter(item => item.length >= 2))]
  const artistVariants = [...new Set([track.artist, primaryArtist(track.artist)].map(normalize).filter(item => item.length >= 2))]
  const labelledMetadata = /^(?:title|track|song|artist|歌名|歌曲|曲名|歌手|艺人|藝人|演唱)\s*[:：]/i
  return value.replace(/\r/g, '').split('\n').filter(raw => {
    const timestamps = raw.match(LRC_TIMESTAMP) ?? []
    if (!timestamps.length) return true
    const timeMs = timestampMs(timestamps[0]!)
    if (!Number.isFinite(timeMs) || timeMs > 15_000) return true
    const text = raw.replace(LRC_TIMESTAMP, '').trim()
    if (labelledMetadata.test(text) || CREDIT_LINE.test(text) || /^(?:词|詞|曲)\s*[:：]/.test(text)) return false
    const normalizedText = normalize(text)
    const containsTitle = titleVariants.some(title => normalizedText.includes(title))
    const containsArtist = artistVariants.some(artist => normalizedText.includes(artist))
    return !(containsTitle && containsArtist)
  }).join('\n')
}

function similarity(left: string, right: string) {
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  if (!normalizedLeft || !normalizedRight) return 0
  if (normalizedLeft === normalizedRight) return 1
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return .86
  const a = new Set(normalizedLeft.split(' ').filter(Boolean))
  const b = new Set(normalizedRight.split(' ').filter(Boolean))
  const intersection = [...a].filter(token => b.has(token)).length
  return (2 * intersection) / (a.size + b.size)
}

const BASIC_KANA_ROMAJI: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'wo', ん: 'n',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゔ: 'vu'
}
const COMPOUND_KANA_ROMAJI: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo'
}

/** Small allocation-free kana fold used only for provider identity scoring. */
function romanizeKanaIdentity(value: string) {
  const characters = [...value.normalize('NFKC')].map(character => {
    const code = character.codePointAt(0) ?? 0
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : character
  })
  let result = ''
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    if (character === 'っ') {
      const next = COMPOUND_KANA_ROMAJI[`${characters[index + 1] ?? ''}${characters[index + 2] ?? ''}`]
        ?? BASIC_KANA_ROMAJI[characters[index + 1] ?? ''] ?? ''
      result += next[0] && !'aeioun'.includes(next[0]) ? next[0] : ''
      continue
    }
    if (character === 'ー') {
      const vowel = result.match(/[aeiou](?!.*[aeiou])/i)?.[0]
      if (vowel) result += vowel
      continue
    }
    const pair = `${character}${characters[index + 1] ?? ''}`
    if (COMPOUND_KANA_ROMAJI[pair]) { result += COMPOUND_KANA_ROMAJI[pair]; index += 1; continue }
    result += BASIC_KANA_ROMAJI[character] ?? character
  }
  return result
}

function scriptAwareSimilarity(left: string, right: string) {
  const direct = similarity(left, right)
  // Spotify often localizes Japanese metadata to Latin script while Asian
  // providers retain a katakana artist/title. Kana has an unambiguous local
  // transliteration, so use it as identity evidence without attempting a
  // lossy machine translation of kanji lyric content.
  const romanizedLeft = KANA.test(left) ? romanizeKanaIdentity(left) : left
  const romanizedRight = KANA.test(right) ? romanizeKanaIdentity(right) : right
  return Math.max(direct, similarity(romanizedLeft, right), similarity(left, romanizedRight), similarity(romanizedLeft, romanizedRight))
}

export function recordingEdition(value: string) {
  const normalized = value.normalize('NFKC').toLowerCase()
  // Look for edition descriptors, not words in titles such as "Live Forever".
  const descriptors = [...normalized.matchAll(/[([]([^\])]+)[)\]]/g)].map(match => match[1])
  descriptors.push(...normalized.split(/\s+[-–—]\s+/).slice(1))
  if (/\blive\s+(?:at|from|in)\b/.test(normalized)) descriptors.push('live')
  const text = descriptors.join(' ')
  if (/\blive\b|ライブ|现场|現場/.test(text)) return 'live'
  if (/\binstrumental\b|\bkaraoke\b|伴奏|カラオケ/.test(text)) return 'instrumental'
  if (/\bacoustic\b|アコースティック/.test(text)) return 'acoustic'
  if (/\bremix\b|リミックス/.test(text)) return 'remix'
  return 'unspecified'
}

export function weightedScore(candidateTrack: string, candidateArtist: string, candidateDurationMs: number, query: { track: string; artist: string; album?: string; durationMs?: number }, synced: boolean, candidateAlbum = '') {
  if (recordingEdition(`${candidateTrack} ${candidateAlbum}`) !== recordingEdition(`${query.track} ${query.album ?? ''}`)) return 0
  let track = Math.max(scriptAwareSimilarity(candidateTrack, query.track), scriptAwareSimilarity(cleanTrackTitle(candidateTrack), cleanTrackTitle(query.track)))
  const directArtist = Math.max(similarity(candidateArtist, query.artist), similarity(primaryArtist(candidateArtist), primaryArtist(query.artist)))
  let artist = Math.max(scriptAwareSimilarity(candidateArtist, query.artist), scriptAwareSimilarity(primaryArtist(candidateArtist), primaryArtist(query.artist)))
  const hasAlbumEvidence = Boolean(query.album && candidateAlbum)
  const album = hasAlbumEvidence ? scriptAwareSimilarity(candidateAlbum, query.album!) : 0
  const durationDelta = query.durationMs && candidateDurationMs ? Math.abs(candidateDurationMs - query.durationMs) : 0
  // A mixed-script brand may localize just its Han characters. Require the
  // same substantial Latin skeleton, a shared Han character, exact title and
  // album, and a close recording duration; never use this as an alias table.
  const latinSkeleton = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^a-z]/g, '')
  const queryLatin = latinSkeleton(query.artist)
  const sharedHan = [...query.artist].some(character => HAN.test(character) && candidateArtist.includes(character))
  if (artist < .78 && track >= .98 && album >= .98 && query.durationMs && candidateDurationMs
    && durationDelta <= 1500 && queryLatin.length >= 8 && HAN.test(query.artist) && HAN.test(candidateArtist)
    && queryLatin === latinSkeleton(candidateArtist) && sharedHan) artist = .78
  // Spotify can localize a Japanese title while Asian providers keep its
  // native script. Artist+duration is useful retrieval evidence, but never a
  // near-exact identity: the same artist commonly has unrelated songs of
  // similar length. A matching album makes the cross-script inference safer.
  if (track < .3 && artist >= .86 && query.durationMs && candidateDurationMs && durationDelta <= 2500) {
    // If the artist match exists only after kana transliteration, the exact
    // millisecond duration is a useful release fingerprint. Degrade rapidly as
    // the delta grows so another same-artist song of merely similar length does
    // not become a false near-exact match.
    const transliteratedArtist = artist > directArtist + .15
    const durationFingerprint = Math.max(0, 1 - durationDelta / 2500)
    track = album >= .72 ? .74 : transliteratedArtist ? .42 + .30 * durationFingerprint : .58
  }
  // Spotify can expose localized/romanized artist names and, with crossfade,
  // a shortened SMTC duration. An exact title+album pair is strong enough to
  // recognize that same release without trusting either noisy field.
  // A cover can reuse both the translated title and a single-title album. Do
  // not manufacture artist identity from that pair when its recording length
  // is already several seconds away from Spotify's item. Kana folding above
  // handles ordinary Japanese/Latin artist localization directly.
  // Never synthesize an artist match from title+album alone. Covers routinely
  // reuse both fields (and can even land within a second of the original), so
  // require at least some independent artist-token evidence before promoting
  // a partially localized credit.
  if (track >= .98 && album >= .86 && artist >= .30 && artist < .75
    && (!query.durationMs || !candidateDurationMs || durationDelta <= 1500)) artist = .78
  const duration = query.durationMs && candidateDurationMs ? Math.max(0, 1 - durationDelta / 15_000) : .62
  // Custom Spotify transitions can make SMTC's endpoint differ from the
  // released recording by tens of seconds. Duration is therefore only a
  // tie-breaker after title/artist/album identity; allowing it to carry 16–23%
  // previously selected a closer-duration alternate over the exact release.
  return Math.round((hasAlbumEvidence
    ? track * .48 + artist * .22 + album * .20 + duration * .03 + (synced ? .07 : 0)
    : track * .58 + artist * .25 + duration * .10 + (synced ? .07 : 0)) * 100)
}

function score(record: LrcLibRecord, query: { track: string; artist: string; album?: string; durationMs?: number }) {
  return weightedScore(record.trackName, record.artistName, record.duration * 1000, query, Boolean(record.syncedLyrics), record.albumName)
}

function candidate(record: LrcLibRecord, query: { track: string; artist: string; album?: string; durationMs?: number }): LyricsCandidate {
  return {
    id: record.id, trackName: record.trackName, artistName: record.artistName, albumName: record.albumName,
    durationMs: Math.round(record.duration * 1000), instrumental: record.instrumental,
    syncedLyrics: record.syncedLyrics, plainLyrics: record.plainLyrics, provider: 'LRCLIB', score: score(record, query)
  }
}

function providerAbortError() {
  const error = new Error('歌词源请求超过本轮等待上限')
  error.name = 'AbortError'
  return error
}

const isTransientProviderStatus = (status: number) => [429, 502, 503, 504].includes(status)

function waitWithSignal(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(providerAbortError())
    const timer = setTimeout(() => { cleanup(); resolve() }, milliseconds)
    const abort = () => { cleanup(); reject(providerAbortError()) }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 4200, retries = 2, parentSignal?: AbortSignal) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (parentSignal?.aborted) throw providerAbortError()
    const controller = new AbortController()
    const abortFromParent = () => controller.abort()
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (!isTransientProviderStatus(response.status) || attempt === retries) return response
      const retryAfter = Number(response.headers.get('retry-after')) * 1000
      await waitWithSignal(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 1800) : 300 * (attempt + 1), parentSignal)
    } catch (error) {
      lastError = error
      if (parentSignal?.aborted) throw providerAbortError()
      if (attempt === retries) throw error
      await waitWithSignal(300 * (attempt + 1), parentSignal)
    } finally {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
  throw lastError
}

export async function searchLyrics(query: { track: string; artist: string; album?: string; durationMs?: number }, signal?: AbortSignal): Promise<LyricsCandidate[]> {
  const cleanedTrack = cleanTrackTitle(query.track)
  const cleanedArtist = primaryArtist(query.artist)
  const variants = [
    new URLSearchParams({ track_name: query.track, artist_name: query.artist, ...(query.album ? { album_name: query.album } : {}) }),
    new URLSearchParams({ track_name: query.track, artist_name: query.artist }),
    new URLSearchParams({ track_name: cleanedTrack, artist_name: cleanedArtist }),
    new URLSearchParams({ q: `${cleanedTrack} ${cleanedArtist}` })
  ]
  // Mixed-script localized artist names can hide the exact release entirely.
  // Title-only retrieval still passes the strict identity/edition scorer.
  if (HAN.test(cleanedArtist) && /[a-z]{3}/i.test(cleanedArtist)) variants.push(new URLSearchParams({ track_name: query.track }))
  const uniqueVariants = [...new Map(variants.map(params => [params.toString(), params])).values()]
  const settled = await Promise.allSettled(uniqueVariants.map(async params => {
    const response = await fetchWithTimeout(`${LRCLIB_API}/search?${params}`, { headers }, 4200, 2, signal)
    if (!response.ok) throw new Error(`歌词搜索暂时不可用 (${response.status})`)
    return await response.json() as LrcLibRecord[]
  }))
  const records = new Map<number, LrcLibRecord>()
  for (const result of settled) if (result.status === 'fulfilled') for (const item of result.value) records.set(item.id, item)
  if (!records.size) {
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  return [...records.values()].map(item => candidate(item, query)).sort((a, b) => b.score - a.score).slice(0, 16)
}

async function fetchLrcLib(track: NonNullable<PlaybackSnapshot['track']>, signal?: AbortSignal): Promise<LyricsResult | null> {
  const durationMs = referenceDurationMs(track)
  const candidates: LyricsResult[] = []
  let searchError: unknown
  const exactQueries = [
    new URLSearchParams({ artist_name: track.artist, track_name: track.name, album_name: track.album, duration: String(Math.round(durationMs / 1000)) }),
    new URLSearchParams({ artist_name: track.artist, track_name: track.name, duration: String(Math.round(durationMs / 1000)) }),
    new URLSearchParams({ artist_name: primaryArtist(track.artist), track_name: cleanTrackTitle(track.name), duration: String(Math.round(durationMs / 1000)) }),
    // Automix duration_override is a hand-off point rather than the release
    // length. Duration-free exact queries prevent that private transition
    // value from hiding an otherwise exact LRCLIB record.
    new URLSearchParams({ artist_name: track.artist, track_name: track.name, ...(track.album ? { album_name: track.album } : {}) }),
    new URLSearchParams({ artist_name: primaryArtist(track.artist), track_name: cleanTrackTitle(track.name) })
  ]
  const [exactResults, searched] = await Promise.all([
    Promise.allSettled([...new Map(exactQueries.map(query => [query.toString(), query])).values()].map(async query => {
      const response = await fetchWithTimeout(`${LRCLIB_API}/get?${query}`, { headers }, 4200, 2, signal)
      if (response.ok) {
        const data = await response.json() as LrcLibRecord
        // Cleaned /get variants may strip "Live" or "Acoustic". An HTTP
        // exact hit does not override a contradictory recording edition.
        if (recordingEdition(`${data.trackName ?? ''} ${data.albumName ?? ''}`)
          !== recordingEdition(`${track.name} ${track.album}`)) return null
        if (data.syncedLyrics || data.plainLyrics) return { syncedLyrics: isTimedLyrics(data.syncedLyrics) ? data.syncedLyrics : null, plainLyrics: data.plainLyrics || data.syncedLyrics, source: 'LRCLIB · 精确匹配', confidence: 100, matchedDurationMs: Math.round(data.duration * 1000) } satisfies LyricsResult
      }
      if (response.status !== 404) throw new Error(`LRCLIB 暂时不可用 (${response.status})`)
      return null
    })),
    searchLyrics({ track: track.name, artist: track.artist, album: track.album, durationMs }, signal).catch(error => { searchError = error; return [] })
  ])
  for (const result of exactResults) if (result.status === 'fulfilled' && result.value) candidates.push(result.value)
  const fallback = searched
    .filter(item => isTimedLyrics(item.syncedLyrics) && item.score >= 55)
    .map(item => ({ syncedLyrics: item.syncedLyrics, plainLyrics: item.plainLyrics, source: `LRCLIB · 搜索匹配 ${item.score}%`, confidence: item.score, matchedDurationMs: item.durationMs } satisfies LyricsResult))
  candidates.push(...fallback)
  if (!candidates.length) {
    const exactFailure = exactResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (searchError || exactFailure) throw searchError ?? exactFailure!.reason
  }
  return bestLyricsCandidate(candidates, durationMs)
}

function neteaseDuration(song: NeteaseSong) { return song.duration ?? song.dt ?? 0 }
function neteaseAlbum(song: NeteaseSong) { return (song.album ?? song.al)?.name ?? '' }
function neteaseAttribution(song: NeteaseSong) {
  const artists = song.artists ?? song.ar ?? []
  const album = song.album ?? song.al
  // Vocal-collaboration releases are frequently credited to the singer in
  // NetEase but to the producer in Spotify. NetEase's artist/album aliases
  // retain that missing producer credit (for example "Islet 1st Vocal Collab
  // EP"), providing much stronger evidence than a same-duration coincidence.
  return [...artists.map(item => item.name), ...artists.flatMap(item => item.alias ?? []), ...(album?.alia ?? [])]
    .filter(Boolean).join(' / ')
}

async function fetchNetease(track: NonNullable<PlaybackSnapshot['track']>, signal?: AbortSignal): Promise<LyricsResult | null> {
  const durationMs = referenceDurationMs(track)
  const collect = async (searches: string[], limit: number) => {
    const settled = await Promise.allSettled([...new Set(searches)].map(async search => {
      const form = new URLSearchParams({ s: search, type: '1', limit: String(limit), offset: '0' })
      const response = await fetchWithTimeout(`${NETEASE_API}/search/get`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' }, body: form
      }, 4200, 2, signal)
      if (!response.ok) throw new Error(`网易云歌词搜索暂时不可用 (${response.status})`)
      const payload = await response.json() as { result?: { songs?: NeteaseSong[] } }
      return payload.result?.songs ?? []
    }))
    const songs = new Map<number, NeteaseSong>()
    for (const result of settled) if (result.status === 'fulfilled') for (const song of result.value) songs.set(song.id, song)
    if (!songs.size) {
      const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    }
    const ranked = [...songs.values()].map(song => ({
      song,
      score: weightedScore(song.name, neteaseAttribution(song), neteaseDuration(song), { track: track.name, artist: track.artist, album: track.album, durationMs }, true, neteaseAlbum(song))
    })).sort((a, b) => b.score - a.score)
    const detailResults = await Promise.allSettled(ranked.filter(item => item.score >= 55).slice(0, 8).map(async match => {
      const lyricsResponse = await fetchWithTimeout(`${NETEASE_API}/song/lyric?id=${match.song.id}&lv=-1&tv=-1&rv=-1`, { headers: { ...headers, Referer: 'https://music.163.com/' } }, 4200, 2, signal)
      if (!lyricsResponse.ok) {
        if (isTransientProviderStatus(lyricsResponse.status)) throw new Error(`网易云歌词暂时不可用 (${lyricsResponse.status})`)
        return null
      }
      const lyrics = await lyricsResponse.json() as NeteaseLyrics
      const originalValue = lyrics.lrc?.lyric?.trim() || null
      const original = isTimedLyrics(originalValue) ? originalValue : null
      if (!original) return null
      const additionalTracks: SupplementalLyrics[] = []
      if (isTimedLyrics(lyrics.romalrc?.lyric)) additionalTracks.push({ language: 'romaji', label: 'Romaji', kind: 'romanization', syncedLyrics: lyrics.romalrc!.lyric!, source: '网易云音乐 · 罗马音' })
      if (isTimedLyrics(lyrics.tlyric?.lyric)) additionalTracks.push({ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: lyrics.tlyric!.lyric!, source: '网易云音乐 · 翻译' })
      return { syncedLyrics: original, plainLyrics: null, source: `网易云音乐 · 搜索匹配 ${match.score}%`, confidence: match.score, matchedDurationMs: neteaseDuration(match.song), additionalTracks } satisfies LyricsResult
    }))
    const details = detailResults.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
    if (!details.length) {
      const failure = detailResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    }
    return details
  }
  const primarySearches = [`${track.name} ${track.artist}`, `${cleanTrackTitle(track.name)} ${primaryArtist(track.artist)}`, cleanTrackTitle(track.name)]
  const primaryCandidates = await collect(primarySearches, 12)
  const primary = bestLyricsCandidate(primaryCandidates, durationMs)
  const primaryDurationDelta = primary?.matchedDurationMs && durationMs
    ? Math.abs(primary.matchedDurationMs - durationMs)
    : 0
  // A localized-title query can find a convincing single/cover first while
  // the exact soundtrack recording is reachable only from the artist page.
  // Search that bounded page when the otherwise-strong hit misses the media
  // endpoint by more than ordinary provider rounding. This costs one request
  // only on ambiguous releases and avoids baking a 2s version offset into the
  // lyric clock before cross-provider alignment even begins.
  if (primary && primary.confidence >= 88 && primaryDurationDelta <= 1200) return primary
  // Localized titles can share no text at all (for example an English Spotify
  // title versus a Japanese provider title). A weak normal-query result can
  // also be an unrelated exact-Latin cover whose album contains the query.
  // Only when normal identity is absent/ambiguous, inspect a wider artist page.
  // Script-aware identity plus the duration fingerprint keeps this bounded.
  const artistSearches = [track.artist, primaryArtist(track.artist)].filter(Boolean)
  try {
    return bestLyricsCandidate([...primaryCandidates, ...await collect(artistSearches, 50)], durationMs) ?? primary
  } catch (error) {
    // The first-stage result is already useful. If the shared provider budget
    // expires during the optional ambiguity search, preserve it instead of
    // turning a completed NetEase timeline into a total provider failure.
    if (signal?.aborted) return primary
    throw error
  }
}

async function fetchKugou(track: NonNullable<PlaybackSnapshot['track']>, signal?: AbortSignal): Promise<LyricsResult | null> {
  const durationMs = referenceDurationMs(track)
  const searches = [...new Set([`${track.name} ${track.artist}`, `${cleanTrackTitle(track.name)} ${primaryArtist(track.artist)}`])]
  const settled = await Promise.allSettled(searches.map(async keyword => {
    const query = new URLSearchParams({ keyword, page: '1', pagesize: '12', platform: 'WebFilter' })
    const response = await fetchWithTimeout(`${KUGOU_SEARCH_API}?${query}`, { headers: { ...headers, Referer: 'https://www.kugou.com/' } }, 4200, 2, signal)
    if (!response.ok) throw new Error(`酷狗歌词搜索暂时不可用 (${response.status})`)
    const payload = await response.json() as { data?: { lists?: KugouSong[] } }
    return payload.data?.lists ?? []
  }))
  const songs = new Map<string, KugouSong>()
  for (const result of settled) if (result.status === 'fulfilled') for (const song of result.value) if (song.FileHash) songs.set(song.FileHash, song)
  if (!songs.size) {
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  const ranked = [...songs.values()].map(song => ({
    song,
    score: weightedScore(song.SongName, song.SingerName, (song.Duration ?? 0) * 1000, { track: track.name, artist: track.artist, durationMs }, true)
  })).sort((a, b) => b.score - a.score)
  const detailResults = await Promise.allSettled(ranked.filter(item => item.score >= 58).slice(0, 5).map(async match => {
      const search = new URLSearchParams({ ver: '1', man: 'yes', client: 'pc', hash: match.song.FileHash })
      const lyricResponse = await fetchWithTimeout(`${KUGOU_LYRICS_API}/search?${search}`, { headers }, 4200, 2, signal)
      if (!lyricResponse.ok) {
        if (isTransientProviderStatus(lyricResponse.status)) throw new Error(`酷狗歌词搜索暂时不可用 (${lyricResponse.status})`)
        return null
      }
      const lyricPayload = await lyricResponse.json() as { candidates?: KugouLyricCandidate[] }
      const lyricCandidate = (lyricPayload.candidates ?? []).sort((a, b) => {
        const left = Math.abs((a.duration ?? 0) - durationMs)
        const right = Math.abs((b.duration ?? 0) - durationMs)
        return left - right
      })[0]
      if (!lyricCandidate?.id || !lyricCandidate.accesskey) return null
      const download = new URLSearchParams({ ver: '1', client: 'pc', id: String(lyricCandidate.id), accesskey: lyricCandidate.accesskey, fmt: 'lrc', charset: 'utf8' })
      const downloadResponse = await fetchWithTimeout(`${KUGOU_LYRICS_API}/download?${download}`, { headers }, 4200, 2, signal)
      if (!downloadResponse.ok) {
        if (isTransientProviderStatus(downloadResponse.status)) throw new Error(`酷狗歌词下载暂时不可用 (${downloadResponse.status})`)
        return null
      }
      const downloadPayload = await downloadResponse.json() as { content?: string }
      const syncedLyrics = downloadPayload.content ? Buffer.from(downloadPayload.content, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim() : null
      if (!isTimedLyrics(syncedLyrics)) return null
      // Some search hits omit the edition while the downloaded file names it.
      // Only early track-header evidence qualifies; ordinary sung lyrics do not.
      const headerEdition = parseTimedRows(syncedLyrics).filter(row => row.timeMs <= 5000
        && (row.text.includes(' - ') || /^\s*(?:title|曲名|歌曲)\s*[:：]/i.test(row.text)))
        .map(row => recordingEdition(row.text)).find(edition => edition !== 'unspecified')
      if (headerEdition && headerEdition !== recordingEdition(`${track.name} ${track.album}`)) return null
      return {
        syncedLyrics: stripTimedTrackMetadata(syncedLyrics, { name: match.song.SongName, artist: match.song.SingerName }),
        plainLyrics: null, source: `酷狗音乐 · 搜索匹配 ${match.score}%`, confidence: match.score,
        matchedDurationMs: lyricCandidate.duration || (match.song.Duration ?? 0) * 1000
      } satisfies LyricsResult
  }))
  const results = detailResults.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
  if (!results.length) {
    const failure = detailResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  return bestLyricsCandidate(results, durationMs)
}

interface SpotifyLyricsPayload {
  lyrics?: {
    syncType?: string
    language?: string
    provider?: string
    lines?: Array<{ startTimeMs?: string; words?: string }>
  }
}

export function isSpotifySyncedLyricsType(value: string | null | undefined) {
  return value === 'LINE_SYNCED' || value === 'SYLLABLE_SYNCED'
}

export function spotifyLinesToLrc(lines: NonNullable<NonNullable<SpotifyLyricsPayload['lyrics']>['lines']>) {
  return lines.flatMap(line => {
    const startMs = Number(line.startTimeMs)
    const words = line.words?.trim()
    if (!Number.isFinite(startMs) || !words) return []
    const minutes = Math.floor(startMs / 60_000)
    const seconds = Math.floor((startMs % 60_000) / 1000)
    const centiseconds = Math.floor((startMs % 1000) / 10)
    return [`[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]${words}`]
  }).join('\n')
}

async function fetchSpotifyLyrics(track: NonNullable<PlaybackSnapshot['track']>, accessToken?: string | null, signal?: AbortSignal): Promise<LyricsResult | null> {
  const spotifyId = track.spotifyId || (!track.id.startsWith('local-') && /^[A-Za-z0-9]{22}$/.test(track.id) ? track.id : '')
  if (!spotifyId) return null
  // Do not scrape the Web Player's private anonymous-token endpoint: it now
  // rejects third-party clients and only adds a failed request to first-load
  // latency. Spotify lyrics remain an optional reference for an explicit OAuth
  // session; the three independent providers do not require Spotify login.
  if (!accessToken) return null
  const query = new URLSearchParams({ format: 'json', vocalRemoval: 'false', market: 'from_token' })
  const response = await fetchWithTimeout(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${spotifyId}?${query}`, {
    headers: { ...headers, Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'App-Platform': 'WebPlayer' }
  }, 3500, 0, signal)
  if (!response.ok) return null
  const payload = await response.json() as SpotifyLyricsPayload
  if (!isSpotifySyncedLyricsType(payload.lyrics?.syncType) || !payload.lyrics?.lines?.length) return null
  const syncedLyrics = spotifyLinesToLrc(payload.lyrics.lines)
  if (!isTimedLyrics(syncedLyrics)) return null
  return {
    syncedLyrics,
    plainLyrics: payload.lyrics.lines.map(line => line.words ?? '').filter(Boolean).join('\n'),
    source: `Spotify${payload.lyrics.provider ? ` · ${payload.lyrics.provider}` : ''}`,
    confidence: 100,
    matchedDurationMs: referenceDurationMs(track)
  }
}

export async function fetchLyrics(track: NonNullable<PlaybackSnapshot['track']>, spotifyAccessToken?: string | null, bypassCache = false): Promise<LyricsResult | null> {
  const durationMs = referenceDurationMs(track)
  const key = lyricsCacheKey(track, Boolean(spotifyAccessToken))
  // A locally discovered Spotify id only affects the official-lyrics request,
  // which requires OAuth. Community lookups are identical with or without it;
  // omitting it here coalesces the two startup snapshots into one fetch.
  if (bypassCache) {
    cache.delete(key)
    providerGenerations.set(key, (providerGenerations.get(key) ?? 0) + 1)
    if (providerGenerations.size > MAX_CACHE_ENTRIES) {
      const oldest = providerGenerations.keys().next().value
      if (oldest && oldest !== key) providerGenerations.delete(oldest)
    }
  }
  const generation = providerGenerations.get(key) ?? 0
  if (!bypassCache && cache.has(key)) {
    const cached = cache.get(key)!
    remember(key, cached)
    return cached
  }
  const requestKey = bypassCache ? `${key}\0force:${generation}` : key
  const pending = inflight.get(requestKey)
  if (pending) return pending
  const request = (async () => {
    // A single unavailable service must not hold already-complete results from
    // the other providers for three retry cycles. Abort this fetch generation
    // after a shared 5.5-second budget; Promise.allSettled still retains every
    // provider that finished before the deadline.
    const providerController = new AbortController()
    const providerDeadline = setTimeout(() => providerController.abort(), 5500)
    let providerResults: PromiseSettledResult<LyricsResult | null>[]
    try {
      providerResults = await Promise.allSettled([
        fetchSpotifyLyrics(track, spotifyAccessToken, providerController.signal),
        fetchLrcLib(track, providerController.signal),
        fetchNetease(track, providerController.signal),
        fetchKugou(track, providerController.signal)
      ])
    } finally { clearTimeout(providerDeadline) }
    const [spotifyLyricsResult, lrclibResult, neteaseResult, kugouResult] = providerResults
    const transient = [lrclibResult, neteaseResult, kugouResult].some(result => result.status === 'rejected')
    const sanitize = (result: LyricsResult | null) => result?.syncedLyrics
      ? { ...result, syncedLyrics: stripTimedTrackMetadata(result.syncedLyrics, track) }
      : result
    const spotifyLyrics = sanitize(spotifyLyricsResult.status === 'fulfilled' ? spotifyLyricsResult.value : null)
    const primary = sanitize(lrclibResult.status === 'fulfilled' ? lrclibResult.value : null)
    const supplemental = sanitize(neteaseResult.status === 'fulfilled' ? neteaseResult.value : null)
    const fallback = sanitize(kugouResult.status === 'fulfilled' ? kugouResult.value : null)
    if (process.env.SYLLABLE_PROVIDER_DIAGNOSTICS === '1') {
      const available = [spotifyLyrics, primary, supplemental, fallback].filter((item): item is LyricsResult => Boolean(item))
      console.log('provider-content-comparison', JSON.stringify(available.flatMap((left, index) => available.slice(index + 1).map(right => {
        const leftText = parseTimedRows(left.syncedLyrics).map(row => row.normalizedText).join('')
        const rightText = parseTimedRows(right.syncedLyrics).map(row => row.normalizedText).join('')
        // Diagnostics must not allocate an unbounded quadratic table on the
        // Electron main thread, even for a malformed provider response.
        if ((leftText.length + 1) * (rightText.length + 1) > 1_000_000) return {
          left: left.source, right: right.source, leftCharacters: leftText.length,
          rightCharacters: rightText.length, comparisonSkipped: 'diagnostic-cell-budget'
        }
        const table = Array.from({ length: leftText.length + 1 }, () => new Uint16Array(rightText.length + 1))
        for (let a = leftText.length - 1; a >= 0; a--) for (let b = rightText.length - 1; b >= 0; b--) table[a][b] = leftText[a] === rightText[b] ? 1 + table[a + 1][b + 1] : Math.max(table[a + 1][b], table[a][b + 1])
        let a = 0, b = 0, leftOnly = '', rightOnly = ''
        while (a < leftText.length && b < rightText.length) {
          if (leftText[a] === rightText[b]) { a++; b++ }
          else if (table[a + 1][b] >= table[a][b + 1]) leftOnly += leftText[a++]
          else rightOnly += rightText[b++]
        }
        leftOnly += leftText.slice(a); rightOnly += rightText.slice(b)
        return { left: left.source, right: right.source, leftCharacters: leftText.length, rightCharacters: rightText.length,
          identical: leftText === rightText, similarity: normalizedTextSimilarity(leftText, rightText), leftOnly, rightOnly,
          changedRows: parseTimedRows(right.syncedLyrics).flatMap(row => {
            const nearest = parseTimedRows(left.syncedLyrics).reduce<ReturnType<typeof parseTimedRows>[number] | undefined>((best, candidate) =>
              !best || Math.abs(candidate.timeMs - row.timeMs) < Math.abs(best.timeMs - row.timeMs) ? candidate : best, undefined)
            return nearest && Math.abs(nearest.timeMs - row.timeMs) < 700 && !nearest.normalizedText.includes(row.normalizedText)
              ? [{ timeMs: row.timeMs, left: nearest.normalizedText, right: row.normalizedText }] : []
          }),
          leftIncomplete: isProvenIncomplete(left, [right]), rightIncomplete: isProvenIncomplete(right, [left]) }
      }))))
      console.log(JSON.stringify([spotifyLyrics, primary, supplemental, fallback].map(item => item && ({
        source: item.source, confidence: item.confidence, duration: item.matchedDurationMs,
        stats: timedLyricsStats(item.syncedLyrics, durationMs),
        extras: item.additionalTracks?.map(track => `${track.language}:${timedLyricsStats(track.syncedLyrics, durationMs).lineCount}`),
        sample: parseTimedRows(item.syncedLyrics).filter(row => row.timeMs >= 55_000 && row.timeMs <= 85_000),
        shortRows: parseTimedRows(item.syncedLyrics).filter(row => row.normalizedText.length < 3),
        extraSamples: item.additionalTracks?.map(track => ({ language: track.language, rows: parseTimedRows(track.syncedLyrics).filter(row => row.timeMs >= 55_000 && row.timeMs <= 85_000) }))
      })), null, 2))
    }
    const preferredScript = KANA.test(track.name) ? 'ja' : undefined
    const merged = mergeProviderSet([spotifyLyrics, primary, supplemental, fallback], durationMs, preferredScript)
    const result = merged
      ? { ...merged, ...(transient ? { transient: true } : {}) }
      : transient
        ? { syncedLyrics: null, plainLyrics: null, source: '歌词源暂时不可用', confidence: 0, transient: true }
        : null
    // Never let a temporary provider outage permanently cache away a language
    // track or a more reliable timing quorum. The renderer may display this
    // partial generation immediately and schedules one bounded retry.
    // A force-refresh may overtake an older ordinary request. Only the newest
    // generation may repopulate the shared stable cache.
    if (result?.syncedLyrics && isTimedLyrics(result.syncedLyrics) && !transient && (providerGenerations.get(key) ?? 0) === generation) remember(key, result)
    return result
  })()
  inflight.set(requestKey, request)
  try { return await request } finally { if (inflight.get(requestKey) === request) inflight.delete(requestKey) }
}

export function lyricsCacheKey(track: NonNullable<PlaybackSnapshot['track']>, hasSpotifyAccessToken: boolean) {
  const durationBucket = Math.round(referenceDurationMs(track) / 2000) * 2000
  // Album is part of recording identity. Omitting it allowed a studio, live,
  // acoustic, or remastered release with the same title/artist and duration
  // bucket to reuse another edition's cached timeline.
  return `${hasSpotifyAccessToken ? 'spotify-oauth' : 'community'}\0${hasSpotifyAccessToken ? track.spotifyId ?? '' : ''}\0${track.artist}\0${track.name}\0${track.album}\0${durationBucket}`
}
