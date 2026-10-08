/** Text-only evidence. Line breaks and punctuation differ between providers;
 * playback seconds and timestamps must never enter this comparison. */
export interface TextReferenceCheck {
  referenceSource: string
  status: 'consistent' | 'partial' | 'conflict'
  matchedLines: number
  referenceLines: number
}
export function normalizeLyricText(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}
export function compareOriginalText(candidate: string, reference: string, referenceSource: string): TextReferenceCheck | null {
  if (candidate.length > 60000 || reference.length > 60000) return null
  const lines = reference.split(/\r?\n/).map(normalizeLyricText).filter(line => line.length >= 2)
  if (lines.filter(line => line.length >= 5).length < 4 || lines.join('').length < 40 || lines.length > 400) return null
  const joined = normalizeLyricText(candidate)
  let cursor = 0, matchedLines = 0
  for (const line of lines) {
    const start = joined.indexOf(line, cursor)
    if (start < 0) continue
    cursor = start + line.length; matchedLines++
  }
  const fraction = matchedLines / lines.length
  // Missing even one short phrase remains visible as partial evidence. Extra
  // unrelated verses must not turn one-way containment into full agreement.
  const comparableLength = joined.length <= lines.join('').length * 1.1
  return { referenceSource, status: fraction === 1 && comparableLength ? 'consistent' : fraction >= .3 ? 'partial' : 'conflict',
    matchedLines, referenceLines: lines.length }
}
