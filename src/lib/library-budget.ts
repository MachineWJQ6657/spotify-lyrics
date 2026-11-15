import type { LyricsDocument } from '../types'

/**
 * The saved lyrics library is one localStorage value, rewritten in full on
 * every change. This Electron accepts a value of 40 million characters and
 * refuses 80 million (measured 2026-11-15, Electron 44); past that nothing,
 * settings included, could be saved. A song with three tracks takes about
 * 8,000 characters. The library keeps to 12 million (about 1,400 songs), which
 * stays far from the quota and bounds the cost of a write (storing 20 million
 * characters took 56 ms in the same measurement).
 */
export const LIBRARY_BUDGET_CHARS = 12_000_000

const sizes = new WeakMap<LyricsDocument, number>()

/** Characters a document takes in the saved library. Cached per object: documents are replaced, never mutated. */
export function documentChars(document: LyricsDocument): number {
  let size = sizes.get(document)
  if (size === undefined) {
    size = JSON.stringify(document).length + (document.trackId?.length ?? 0) + 4
    sizes.set(document, size)
  }
  return size
}

/**
 * How reluctantly a document is dropped: 0 for lyrics that were looked up
 * automatically (they are simply looked up again), 1 for a song with a manual
 * offset, 2 for lyrics the user imported or edited (never dropped).
 */
export function keepRank(document: LyricsDocument): 0 | 1 | 2 {
  if (document.userEditedTrackIds?.length) return 2
  return document.offsetMs ? 1 : 0
}

/**
 * Keeps the library inside its budget. `entries` are newest first. The oldest
 * automatically fetched songs go first, then the oldest songs that only carry
 * a manual offset; imported and edited lyrics and the song in `protect` stay.
 */
export function pruneLibrary(entries: Array<[string, LyricsDocument]>, budget = LIBRARY_BUDGET_CHARS, protect?: string): Array<[string, LyricsDocument]> {
  let total = 0
  for (const [, document] of entries) total += documentChars(document)
  if (total <= budget) return entries
  const dropped = new Set<string>()
  for (const rank of [0, 1] as const) {
    for (let index = entries.length - 1; index >= 0 && total > budget; index--) {
      const [id, document] = entries[index]
      if (id === protect || dropped.has(id) || keepRank(document) !== rank) continue
      dropped.add(id)
      total -= documentChars(document)
    }
  }
  return dropped.size ? entries.filter(([id]) => !dropped.has(id)) : entries
}
