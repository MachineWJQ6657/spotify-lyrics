import type {
  JapanesePhone, JapanesePhoneMapping, JapanesePhoneVariant, JapanesePhoneWord, UnsupportedJapaneseSpan,
} from './japanese-phonemes'

export const JAPANESE_PHONE_GRAPH_MAX_NODES = 256
export const JAPANESE_PHONE_GRAPH_MAX_EDGES = 1024

export interface JapanesePhoneGraphNode extends JapanesePhone {
  /** Node indices in this same topologically ordered array. [] is a root. */
  previous: number[]
  variantIndex: number
  variantSource: JapanesePhoneVariant['source']
  variantPhoneIndex: number
}
export interface JapanesePhoneGraph {
  reason: 'ready' | 'invalid-input' | 'unsupported' | 'work-budget' | 'empty-prefix'
  nodes: JapanesePhoneGraphNode[]
  finalNodes: number[]
  wordIndexInclusive: number
  sourceEnd: number
  /** Original prefix word mapping, including non-sounding punctuation.
   * Its phoneStart/End still refer to the frontend primary phone sequence,
   * NOT this graph's node indices. Nodes retain word/variant indices. */
  words: JapanesePhoneWord[]
  gaps: JapanesePhoneMapping['gaps']
  /** Unknown words INSIDE the requested prefix prohibit any usable graph. */
  unsupported: UnsupportedJapaneseSpan[]
  /** Unknown words AFTER the requested prefix remain whole-song competitors.
   * A ready prefix does not claim the rest of its source is readable. */
  remainingUnsupported: UnsupportedJapaneseSpan[]
}

const integer = (value: number) => Number.isInteger(value) && value >= 0
const samePhone = (left: JapanesePhone, right: JapanesePhone) => left.phone === right.phone
  && left.wordIndex === right.wordIndex && left.sourceStart === right.sourceStart && left.sourceEnd === right.sourceEnd
  && left.readingStart === right.readingStart && left.readingEnd === right.readingEnd
const cloneWord = (word: JapanesePhoneWord): JapanesePhoneWord => ({ ...word,
  variants: word.variants.map(variant => ({ ...variant, phones: variant.phones.map(phone => ({ ...phone })) })) })

/** Check the frontend's coverage and word ownership instead of accepting a
 * forged partial mapping as a complete source. No model vocabulary is used. */
function validMapping(mapping: JapanesePhoneMapping) {
  if (!mapping || !['mapped', 'unsupported'].includes(mapping.reason)
    || typeof mapping.complete !== 'boolean' || !Array.isArray(mapping.words) || mapping.words.length > 1200
    || !Array.isArray(mapping.phones) || mapping.phones.length > 160000
    || !Array.isArray(mapping.gaps) || mapping.gaps.length > 1201
    || !Array.isArray(mapping.unsupported) || mapping.unsupported.length > mapping.words.length
    || mapping.complete !== (mapping.unsupported.length === 0)
    || (mapping.reason === 'mapped') !== mapping.complete) return false
  const spans: Array<{ sourceStart: number; sourceEnd: number }> = []
  const unsupportedWords: JapanesePhoneWord[] = []
  let primary = 0, previousEnd = 0, readingBudget = 0
  for (const [index, word] of mapping.words.entries()) {
    if (!word || word.wordIndex !== index || typeof word.surface !== 'string' || !word.surface.length
      || !integer(word.sourceStart) || !integer(word.sourceEnd) || word.sourceStart < previousEnd
      || word.sourceEnd - word.sourceStart !== word.surface.length || word.sourceEnd > 4000
      || word.phoneStart !== primary || !integer(word.phoneEnd)
      || !Array.isArray(word.variants) || word.variants.length > 256
      || !['supported', 'punctuation', 'unsupported'].includes(word.status)) return false
    previousEnd = word.sourceEnd
    spans.push(word)
    if (word.status !== 'supported') {
      if (word.variants.length || word.phoneEnd !== primary
        || (word.status === 'punctuation' && !/^[\p{P}\s]+$/u.test(word.surface))) return false
      if (word.status === 'unsupported') unsupportedWords.push(word)
      continue
    }
    if (!word.variants.length) return false
    for (const variant of word.variants) {
      if (!variant || !['pronunciation', 'reading', 'surface'].includes(variant.source)
        || typeof variant.reading !== 'string' || !variant.reading || variant.reading.length > 1000
        || typeof variant.normalizedReading !== 'string' || !variant.normalizedReading || variant.normalizedReading.length > 1000
        || !Array.isArray(variant.phones) || !variant.phones.length || variant.phones.length > 1000) return false
      readingBudget += variant.normalizedReading.length
      // NFKC can expand compact katakana compatibility characters. The
      // frontend's input-character cap must not become a smaller post-NFKC
      // cap that rejects a valid short prefix because of its later words.
      if (readingBudget > 160000) return false
      let readingEnd = 0
      for (const phone of variant.phones) {
        if (!phone || typeof phone.phone !== 'string' || !/^(?:[a-z]{1,4}|N|I|U)$/.test(phone.phone)
          || phone.wordIndex !== index || phone.sourceStart !== word.sourceStart || phone.sourceEnd !== word.sourceEnd
          || phone.readingStart !== readingEnd || !integer(phone.readingEnd)
          || phone.readingEnd <= readingEnd || phone.readingEnd > variant.normalizedReading.length) return false
        readingEnd = phone.readingEnd
      }
      if (readingEnd !== variant.normalizedReading.length) return false
    }
    for (const phone of word.variants[0].phones) {
      if (!mapping.phones[primary] || !samePhone(phone, mapping.phones[primary])) return false
      primary++
    }
    if (word.phoneEnd !== primary) return false
  }
  if (primary !== mapping.phones.length || unsupportedWords.length !== mapping.unsupported.length) return false
  for (const [index, span] of mapping.unsupported.entries()) {
    const word = unsupportedWords[index]
    if (!span || span.wordIndex !== word.wordIndex || span.sourceStart !== word.sourceStart
      || span.sourceEnd !== word.sourceEnd || span.surface !== word.surface
      || !['number', 'latin', 'unknown-reading', 'unsupported-reading', 'symbol'].includes(span.reason)) return false
  }
  for (const gap of mapping.gaps) {
    if (!gap || typeof gap.text !== 'string' || !gap.text || /\S/u.test(gap.text)
      || !integer(gap.sourceStart) || !integer(gap.sourceEnd) || gap.sourceEnd > 4000
      || gap.sourceEnd - gap.sourceStart !== gap.text.length) return false
    spans.push(gap)
  }
  spans.sort((left, right) => left.sourceStart - right.sourceStart)
  let cursor = 0
  for (const span of spans) {
    if (span.sourceStart !== cursor) return false
    cursor = span.sourceEnd
  }
  return true
}

/** A prefix always begins at original source word zero. Explicit variants
 * branch within a word and rejoin at the next word, preserving all products
 * without enumerating them. Unknown words are never epsilon bridges. This
 * graph is a text hypothesis only; it does not establish acoustic evidence. */
export function buildJapanesePhoneGraph(mapping: JapanesePhoneMapping, wordIndexInclusive: number): JapanesePhoneGraph {
  const empty = (reason: JapanesePhoneGraph['reason']): JapanesePhoneGraph => ({ reason, nodes: [], finalNodes: [],
    wordIndexInclusive, sourceEnd: 0, words: [], gaps: [], unsupported: [], remainingUnsupported: [] })
  if (!validMapping(mapping) || !integer(wordIndexInclusive) || wordIndexInclusive >= mapping.words.length) return empty('invalid-input')
  const words = mapping.words.slice(0, wordIndexInclusive + 1).map(cloneWord)
  // A complete-word prefix ends at that word, not at a following punctuation
  // word. A full-source prefix additionally retains its trailing whitespace.
  const sourceEnd = wordIndexInclusive === mapping.words.length - 1
    ? Math.max(words.at(-1)!.sourceEnd, ...mapping.gaps.map(gap => gap.sourceEnd)) : words.at(-1)!.sourceEnd
  const metadata = { wordIndexInclusive, sourceEnd, words,
    gaps: mapping.gaps.filter(gap => gap.sourceEnd <= sourceEnd).map(gap => ({ ...gap })),
    unsupported: mapping.unsupported.filter(span => span.wordIndex <= wordIndexInclusive).map(span => ({ ...span })),
    remainingUnsupported: mapping.unsupported.filter(span => span.wordIndex > wordIndexInclusive).map(span => ({ ...span })) }
  const reject = (reason: JapanesePhoneGraph['reason']): JapanesePhoneGraph => ({ reason, nodes: [], finalNodes: [], ...metadata })
  if (metadata.unsupported.length) return reject('unsupported')

  // Preflight counts BEFORE constructing any graph: never return a truncated
  // branch set, which could make an incomplete reading look uniquely likely.
  let nodeCount = 0, edgeCount = 0, frontierCount = 0
  for (const word of words) {
    if (word.status === 'punctuation') continue
    for (const variant of word.variants) {
      nodeCount += variant.phones.length
      edgeCount += frontierCount + variant.phones.length - 1
    }
    frontierCount = word.variants.length
    if (nodeCount > JAPANESE_PHONE_GRAPH_MAX_NODES || edgeCount > JAPANESE_PHONE_GRAPH_MAX_EDGES) return reject('work-budget')
  }
  if (!nodeCount) return reject('empty-prefix')
  const nodes: JapanesePhoneGraphNode[] = []
  let frontier: number[] = []
  for (const word of words) {
    if (word.status === 'punctuation') continue
    const next: number[] = []
    for (const [variantIndex, variant] of word.variants.entries()) {
      let previous = frontier.slice()
      for (const [variantPhoneIndex, phone] of variant.phones.entries()) {
        const index = nodes.length
        nodes.push({ ...phone, previous, variantIndex, variantSource: variant.source, variantPhoneIndex })
        previous = [index]
      }
      next.push(previous[0])
    }
    frontier = next
  }
  return { reason: 'ready', nodes, finalNodes: frontier, ...metadata }
}
