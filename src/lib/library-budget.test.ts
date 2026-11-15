import { describe, expect, it } from 'vitest'
import type { LyricsDocument } from '../types'
import { documentChars, keepRank, LIBRARY_BUDGET_CHARS, pruneLibrary } from './library-budget'

const document = (id: string, updatedAt: number, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({
  trackId: id, updatedAt,
  tracks: [{ id: `${id}-o`, language: 'ja', label: '日本語', kind: 'original', source: 'LRCLIB', lines: Array.from({ length: 20 }, (_, index) => ({ startMs: index * 1000, text: `歌詞の行その${index}` })) }],
  ...extra
})
/** Newest first, as the store keeps them. */
const entries = (...documents: LyricsDocument[]): Array<[string, LyricsDocument]> =>
  documents.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map(item => [item.trackId, item])
const ids = (list: Array<[string, LyricsDocument]>) => list.map(([id]) => id)

describe('library storage budget', () => {
  const one = documentChars(document('x', 1))

  it('measures a document once', () => {
    const item = document('a', 1)
    expect(documentChars(item)).toBeGreaterThan(JSON.stringify(item).length)
    expect(documentChars(item)).toBe(documentChars(item))
  })
  it('leaves a library that fits alone', () => {
    const list = entries(document('a', 3), document('b', 2), document('c', 1))
    expect(pruneLibrary(list, one * 5)).toBe(list)
  })
  it('drops the oldest automatically fetched songs first', () => {
    const list = entries(document('a', 4), document('b', 3), document('c', 2), document('d', 1))
    expect(ids(pruneLibrary(list, one * 2 + 10))).toEqual(['a', 'b'])
  })
  it('keeps imported and edited lyrics, and gives up a manual offset only after the rest', () => {
    const edited = document('edited', 1, { userEditedTrackIds: ['edited-o'] })
    const tuned = document('tuned', 2, { offsetMs: 300 })
    expect(keepRank(edited)).toBe(2)
    expect(keepRank(tuned)).toBe(1)
    expect(keepRank(document('plain', 1))).toBe(0)
    const list = entries(document('new', 9), document('mid', 5), tuned, edited)
    // Room for three: the plain middle one goes, the tuned and edited stay.
    expect(ids(pruneLibrary(list, documentChars(list[0][1]) + documentChars(tuned) + documentChars(edited) + 10))).toEqual(['new', 'tuned', 'edited'])
    // Room for two: the manual offset goes too, never the edited lyrics.
    expect(ids(pruneLibrary(list, documentChars(list[0][1]) + documentChars(edited) + 10, 'new'))).toEqual(['new', 'edited'])
  })
  it('never drops the song being saved', () => {
    const list = entries(document('old-current', 1), document('b', 5), document('c', 4))
    expect(ids(pruneLibrary(list, one + 10, 'old-current'))).toEqual(['old-current'])
  })
  it('stays as it is when only kept documents remain', () => {
    const list = entries(document('e1', 2, { userEditedTrackIds: ['x'] }), document('e2', 1, { userEditedTrackIds: ['y'] }))
    expect(ids(pruneLibrary(list, 10))).toEqual(['e1', 'e2'])
  })
  it('has a budget well inside the measured localStorage quota', () => {
    // 40 million characters were accepted, 80 million refused.
    expect(LIBRARY_BUDGET_CHARS).toBeLessThanOrEqual(40_000_000 / 2)
    // Room for well over a thousand songs of about 8,000 characters.
    expect(LIBRARY_BUDGET_CHARS / 8000).toBeGreaterThan(1000)
  })
})
