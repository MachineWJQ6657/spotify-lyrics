// English words reduced to a common form, for comparing a translation's words with dictionary
// glosses. Plain JavaScript because the build script (scripts/build-lexicon.mjs) and the app share it.

/** Words too common to say which line is which. */
export const STOPWORDS = new Set(('a an and are as at be been but by can could did do does for from had has have he her him his how i if in into is it its just me my no nor not of on or our out she so some than that the their them then there these they this those to too up us very was we were what when where which who whom why will with would you your yours '
  + 'am being both each few more most other own same such only once here again further over under about above after before below between during through until while off down all any also may might must shall should something someone one ones thing things etc esp usu e.g. i.e. oneself').split(/\s+/))

/**
 * A crude stem: enough for "running", "runs", "ran"-less cases to meet "run", and for both sides
 * to be cut the same way. Not a linguistic stemmer.
 */
export function stemOf(word) {
  let stem = word.toLowerCase().replace(/[^a-z]/g, '')
  if (stem.length > 5 && stem.endsWith('ness')) stem = stem.slice(0, -4)
  if (stem.length > 4 && stem.endsWith('ly')) stem = stem.slice(0, -2)
  if (stem.length > 5 && stem.endsWith('ing')) stem = stem.slice(0, -3)
  else if (stem.length > 4 && stem.endsWith('ied')) stem = `${stem.slice(0, -3)}y`
  else if (stem.length > 4 && stem.endsWith('ed')) stem = stem.slice(0, -2)
  else if (stem.length > 4 && stem.endsWith('ies')) stem = `${stem.slice(0, -3)}y`
  else if (stem.length > 4 && stem.endsWith('es') && /(?:s|x|z|ch|sh)es$/.test(stem)) stem = stem.slice(0, -2)
  else if (stem.length > 3 && stem.endsWith('s') && !stem.endsWith('ss')) stem = stem.slice(0, -1)
  // "running" -> "runn" -> "run"; "hoped" -> "hop", "hope" -> "hop".
  if (stem.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(stem) && !/(?:ll|ss|ff)$/.test(stem)) stem = stem.slice(0, -1)
  if (stem.length > 3 && stem.endsWith('e')) stem = stem.slice(0, -1)
  return stem
}

/** The stems of the words of a line that carry meaning. */
export function stemsOf(text) {
  const stems = new Set()
  for (const token of String(text ?? '').toLowerCase().replace(/[’']/g, ' ').split(/[^a-z]+/)) {
    if (token.length < 3 || STOPWORDS.has(token)) continue
    stems.add(stemOf(token))
  }
  return stems
}
