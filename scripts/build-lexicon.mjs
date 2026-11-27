// Builds src/data/ja-en-lexicon.json, the word list the app uses to line a pasted English
// translation up with Japanese lyrics (src/lib/pasted-translation.ts): for each Japanese word, the
// stems of the English words its dictionary entry is glossed with.
//
// Source: JMdict (Electronic Dictionary Research and Development Group), as JSON from
// https://github.com/scriptin/jmdict-simplified (file jmdict-eng-common-<version>.json), licensed
// CC BY-SA 4.0. The file built here is a derived work under the same licence (see src/data/README.md).
//
//   node scripts/build-lexicon.mjs <path to jmdict-eng-common-*.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { stemOf, STOPWORDS } from '../src/lib/english-stems.mjs'

const source = process.argv[2]
if (!source) { console.error('usage: node scripts/build-lexicon.mjs <jmdict-eng-common-*.json>'); process.exit(1) }
const dictionary = JSON.parse(readFileSync(source, 'utf8'))

/** Words that carry meaning: nouns, verbs, adjectives, adverbs. Particles, auxiliaries and the like say nothing about a line. */
const CONTENT = /^(?:n|n-.*|v.*|adj-.*|adv|adv-to|vs.*)$/
const SKIP = /^(?:prt|aux.*|conj|cop.*|pref|suf|ctr|unc|pn|int|exp)$/
const HAS_KANJI = /[㐀-鿿]/
const KANA_ONLY = /^[぀-ヿー]+$/
const INFLECTS = /^(?:v1.*|v5.*|vk|adj-i|adj-ix)$/

const entries = new Map()
const add = (key, stems, weak = false) => {
  if (!key) return
  const known = entries.get(key)
  // A stem of an inflected word never displaces the word that is spelled exactly so.
  if (known && weak && !known.weak) return
  const merged = known && known.weak === weak ? new Set([...known.stems, ...stems]) : new Set(stems)
  entries.set(key, { stems: new Set([...merged].slice(0, 7)), weak })
}

for (const word of dictionary.words) {
  const senses = word.sense.filter(sense => sense.partOfSpeech.some(tag => CONTENT.test(tag)) && !sense.partOfSpeech.every(tag => SKIP.test(tag))).slice(0, 3)
  if (!senses.length) continue
  const stems = new Set()
  for (const sense of senses) {
    for (const gloss of sense.gloss) {
      for (const token of gloss.text.replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[^a-z]+/)) {
        if (token.length < 3 || STOPWORDS.has(token)) continue
        stems.add(stemOf(token))
        if (stems.size >= 6) break
      }
    }
  }
  if (!stems.size) continue
  const inflects = senses.some(sense => sense.partOfSpeech.some(tag => INFLECTS.test(tag)))
  const usuallyKana = senses[0].misc?.includes('uk') || !word.kanji.length
  const forms = [...word.kanji.map(form => form.text), ...word.kana.filter(form => usuallyKana || form.text.length >= 3).map(form => form.text)]
  for (const form of forms) {
    // Kana of one or two letters match inside every other word.
    if (KANA_ONLY.test(form) && form.length < 3 && !/^[゠-ヿー]{2}$/.test(form)) continue
    add(form, stems)
    if (inflects && form.length >= 2) {
      // The part of an inflected word that stays: 走る -> 走, 美しい -> 美し, 食べる -> 食べ.
      const stem = form.slice(0, -1)
      if (HAS_KANJI.test(stem) || stem.length >= 3) add(stem, stems, true)
    }
  }
}

const out = {}
for (const [key, value] of [...entries].sort(([left], [right]) => left < right ? -1 : 1)) out[key] = [...value.stems].join(' ')
mkdirSync('src/data', { recursive: true })
const json = JSON.stringify({ source: `JMdict ${dictionary.dictDate} via jmdict-simplified ${dictionary.version}`, licence: 'CC BY-SA 4.0', words: out })
writeFileSync('src/data/ja-en-lexicon.json', json)
console.log(`${Object.keys(out).length} keys from ${dictionary.words.length} entries, ${(json.length / 1048576).toFixed(2)} MB`)
