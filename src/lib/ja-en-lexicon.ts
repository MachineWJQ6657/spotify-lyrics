import { stemsOf } from './english-stems.mjs'

/**
 * Japanese words and the stems of the English words a dictionary glosses them
 * with (src/data/ja-en-lexicon.json, built from JMdict by
 * scripts/build-lexicon.mjs). It tells which English line speaks of the same
 * things as a Japanese one, which is what lets a pasted translation be lined
 * up when its lines are broken differently from the song's.
 */
export type Lexicon = Record<string, string>

let loading: Promise<Lexicon> | null = null
/** Loaded on first use: two megabytes nobody needs until a translation is pasted. */
export function loadLexicon(): Promise<Lexicon> {
  loading ??= import('../data/ja-en-lexicon.json').then(module => (module.default as { words: Lexicon }).words)
  return loading
}

const LONGEST_KEY = 8
const KANJI = /[㐀-鿿]/

/**
 * The English stems the words of a Japanese line are glossed with. The line is
 * not parsed: at each place the longest dictionary word that starts there is
 * taken (a single letter only when it is a kanji), which also finds the stem
 * of an inflected verb or adjective.
 */
export function glossStems(text: string, lexicon: Lexicon): Set<string> {
  const line = text.normalize('NFKC')
  const stems = new Set<string>()
  for (let at = 0; at < line.length;) {
    let taken = 0
    for (let length = Math.min(LONGEST_KEY, line.length - at); length >= 1; length--) {
      const piece = line.slice(at, at + length)
      if (length === 1 && !KANJI.test(piece)) break
      const glosses = lexicon[piece]
      if (glosses === undefined) continue
      for (const stem of glosses.split(' ')) stems.add(stem)
      taken = length
      break
    }
    at += taken || 1
  }
  return stems
}

/** What the aligner asks about each text. */
export function lexicalReader(lexicon: Lexicon) {
  return { ofRow: (text: string) => glossStems(text, lexicon), ofLine: (text: string) => stemsOf(text) }
}
