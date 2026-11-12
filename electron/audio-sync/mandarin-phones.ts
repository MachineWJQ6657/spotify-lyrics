/**
 * Mandarin syllables approximated with RomajiASR (Japanese mora) labels, for
 * listening calibration only. The acoustic model knows Japanese morae; sung
 * Mandarin syllables are close enough to CV(N) morae that forced alignment of
 * KNOWN text can find where a line starts. Each phone is a set of acceptable
 * labels joined with "|"; a leading "?" marks a phone the singer may not
 * articulate as its own mora (diphthong tails, nasal codas).
 */

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'] as const
type Initial = typeof INITIALS[number] | ''

/** Romaji consonants a Japanese ear (and the model) hears for each initial. */
const CONSONANTS: Record<Exclude<Initial, ''>, string[]> = {
  b: ['b', 'p'], p: ['p'], m: ['m'], f: ['f', 'h'], d: ['d', 't'], t: ['t'], n: ['n'], l: ['r'],
  g: ['g', 'k'], k: ['k'], h: ['h', 'f'], j: ['j', 'ch'], q: ['ch'], x: ['sh'],
  zh: ['j', 'ch'], ch: ['ch'], sh: ['sh'], r: ['r', 'j'], z: ['z', 'ts'], c: ['ts', 'ch'], s: ['s', 'sh'],
}
const PALATAL = new Set<Initial>(['j', 'q', 'x'])
const RETROFLEX = new Set<Initial>(['zh', 'ch', 'sh', 'r'])
const DENTAL = new Set<Initial>(['z', 'c', 's'])

const FINALS = new Set(['a', 'o', 'e', 'i', 'u', 'v', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'er',
  'ia', 'ie', 'iao', 'iou', 'ian', 'in', 'iang', 'ing', 'iong', 'ua', 'uo', 'uai', 'uei', 'uan', 'uen', 'uang', 'ueng',
  've', 'van', 'vn', 'ê', 'io', 'n'])

/** Split a toneless pinyin syllable into initial and canonical final (iu->iou, ui->uei, un->uen, ju->jv). */
export function splitPinyin(raw: string): { initial: Initial; final: string } | null {
  let value = raw.toLowerCase().normalize('NFD').replace(/[̀-̄̌]/g, '').normalize('NFC')
    .replace(/u:|ü/g, 'v').replace(/[1-5]$/, '')
  if (!/^[a-zê]+$/.test(value)) return null
  // Interjections sung as a hum (嗯 n/ng, 呣 m, 哼 hm/hng).
  if (value === 'm' || value === 'n' || value === 'ng' || value === 'hm' || value === 'hng') return { initial: '', final: 'n' }
  let initial: Initial = ''
  let final: string
  if (value.startsWith('y')) {
    const rest = value.slice(1)
    final = rest.startsWith('u') ? `v${rest.slice(1)}` : rest.startsWith('i') ? rest : `i${rest}`
  } else if (value.startsWith('w')) {
    const rest = value.slice(1)
    final = rest.startsWith('u') ? rest : `u${rest}`
  } else {
    initial = INITIALS.find(item => value.startsWith(item)) ?? ''
    final = value.slice(initial.length)
    if (PALATAL.has(initial) && final.startsWith('u')) final = `v${final.slice(1)}`
  }
  if (final === 'iu') final = 'iou'
  else if (final === 'ui') final = 'uei'
  else if (final === 'un') final = 'uen'
  if (final === 'ue') final = 've'
  if (!FINALS.has(final)) return null
  return { initial, final }
}

/** Vowel options per mora for a rhyme, after the medial is removed. */
function rhymeMorae(rhyme: string, initial: Initial, medial: string): { vowels: string[][]; nasal: boolean } | null {
  const plainE = medial === 'i' || medial === 'v' ? ['e'] : ['e', 'a', 'o']
  switch (rhyme) {
    case 'a': return { vowels: [['a']], nasal: false }
    case 'o': return { vowels: [['o']], nasal: false }
    case 'e': case 'ê': return { vowels: [plainE], nasal: false }
    case 'i':
      if (DENTAL.has(initial)) return { vowels: [['u', 'i']], nasal: false }
      if (RETROFLEX.has(initial)) return { vowels: [['i', 'u']], nasal: false }
      return { vowels: [['i']], nasal: false }
    case 'u': return { vowels: [['u', 'o']], nasal: false }
    case 'v': return { vowels: [['yu', 'i', 'u']], nasal: false }
    case 'er': return { vowels: [['a', 'o']], nasal: false }
    case 'ai': return { vowels: [['a'], ['i', 'e']], nasal: false }
    case 'ei': return { vowels: [['e'], ['i']], nasal: false }
    case 'ao': return { vowels: [['a'], ['o', 'u']], nasal: false }
    case 'ou': return { vowels: [['o'], ['u', 'o']], nasal: false }
    case 'an': return { vowels: [medial === 'i' || medial === 'v' ? ['e', 'a'] : ['a']], nasal: true }
    case 'en': return { vowels: [medial === 'u' ? ['u', 'o', 'e'] : ['e', 'a', 'o']], nasal: true }
    case 'n': return { vowels: [], nasal: true }
    case 'in': return { vowels: [['i']], nasal: true }
    case 'ang': return { vowels: [['a']], nasal: true }
    case 'eng': return { vowels: [['e', 'o', 'a']], nasal: true }
    case 'ing': return { vowels: [['i']], nasal: true }
    case 'ong': return { vowels: [['o', 'u']], nasal: true }
    default: return null
  }
}

function join(labels: Iterable<string>, vocabulary: ReadonlySet<string>) {
  const kept = [...new Set(labels)].filter(label => vocabulary.has(label))
  return kept.length ? kept.join('|') : null
}

/**
 * Phones for one toneless pinyin syllable, or null when it cannot be mapped.
 * The first phone combines the initial with the first vowel (or the medial
 * glide), e.g. xiang -> sha|shi, ?N ; guo -> gu|go|ku|ko, ?o.
 */
export function pinyinPhones(syllable: string, vocabulary: ReadonlySet<string>): string[] | null {
  const split = splitPinyin(syllable)
  if (!split) return null
  if (split.final === 'n') return vocabulary.has('N') ? ['N'] : null
  const { initial } = split
  let final = split.final
  let medial = ''
  if ((final[0] === 'i' && final !== 'i' && final !== 'in' && final !== 'ing')
    || (final[0] === 'u' && final !== 'u') || (final[0] === 'v' && final !== 'v')) { medial = final[0]; final = final.slice(1) }
  const rhyme = rhymeMorae(final, initial, medial)
  if (!rhyme) return null
  const vowels = rhyme.vowels.map(options => [...options])
  if (medial === 'i' && final === 'ou') vowels[0] = ['o', 'u']
  const consonants = initial ? CONSONANTS[initial] : ['']
  const first = vowels.shift()
  const options: string[] = []
  for (const c of consonants) {
    if (medial === 'i' || medial === 'v') {
      // Glide i/ü: palatalised mora (sha, rya, myo, ju) or a separate i mora.
      const palatal = c === 'sh' || c === 'ch' || c === 'j' ? c : `${c}y`
      for (const v of first ?? []) options.push(`${palatal}${v}`)
      options.push(medial === 'v' ? `${palatal}u` : `${c}i`)
    } else if (medial === 'u') {
      // Glide u: wa/wo, or consonant+vowel, or a separate u mora.
      for (const v of first ?? []) options.push(c ? `${c}${v}` : `w${v}`)
      options.push(`${c}u`, `${c}o`)
    } else {
      for (const v of first ?? []) options.push(`${c}${v}`)
      // The initial alone: devoiced or clipped (s, sh, ch, k ...).
      if (c) options.push(c)
    }
  }
  const head = join(options, vocabulary)
  if (!head) return null
  const phones = [head]
  if (medial && first) { const tail = join(first, vocabulary); if (tail) phones.push(`?${tail}`) }
  for (const item of vowels) { const label = join(item, vocabulary); if (label) phones.push(`?${label}`) }
  if (rhyme.nasal) phones.push('?N')
  return phones
}
