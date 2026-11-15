import { describe, expect, it, vi } from 'vitest'
import type { LyricsDocument } from '../types'
import { documentChars, LIBRARY_BUDGET_CHARS } from '../lib/library-budget'
import { tolerateWriteFailures, useAppStore } from './useAppStore'

/** A document of about `chars` characters. */
const bulky = (id: string, updatedAt: number, chars: number, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({
  trackId: id, updatedAt,
  tracks: [{ id: `${id}-o`, language: 'ja', label: '日本語', kind: 'original', source: 'LRCLIB',
    lines: Array.from({ length: Math.ceil(chars / 100) }, (_, index) => ({ startMs: index * 1000, text: '歌'.repeat(70) })) }],
  ...extra
})

describe('saved library stays inside its storage budget', () => {
  it('drops the oldest fetched songs when a new one would overflow, and keeps edited lyrics', () => {
    const before = useAppStore.getState()
    try {
      const size = Math.floor(LIBRARY_BUDGET_CHARS / 10)
      const library: Record<string, LyricsDocument> = {}
      // Nine fetched songs and one edited one, the edited one the oldest.
      library.edited = bulky('edited', 1, size * .9, { userEditedTrackIds: ['edited-o'] })
      for (let index = 0; index < 9; index++) library[`song-${index}`] = bulky(`song-${index}`, 10 + index, size * .9)
      useAppStore.setState({ library, lyrics: null })
      const total = () => Object.values(useAppStore.getState().library).reduce((sum, item) => sum + documentChars(item), 0)
      expect(total()).toBeLessThanOrEqual(LIBRARY_BUDGET_CHARS)

      useAppStore.getState().setLyrics(bulky('new-a', 100, size * .9))
      useAppStore.getState().setLyrics(bulky('new-b', 101, size * .9))
      const kept = Object.keys(useAppStore.getState().library)
      expect(total()).toBeLessThanOrEqual(LIBRARY_BUDGET_CHARS)
      expect(kept).toContain('new-a')
      expect(kept).toContain('new-b')
      expect(kept).toContain('edited')
      // The oldest fetched song went first; the newest fetched ones are still there.
      expect(kept).not.toContain('song-0')
      expect(kept).toContain('song-8')
      // Newest first, as the library view lists them.
      expect(kept[0]).toBe('new-b')
    } finally { useAppStore.setState(before) }
  })

  it('does not touch a library that fits', () => {
    const before = useAppStore.getState()
    try {
      useAppStore.setState({ library: { a: bulky('a', 1, 2000), b: bulky('b', 2, 2000) }, lyrics: null })
      useAppStore.getState().setLyrics(bulky('c', 3, 2000))
      expect(Object.keys(useAppStore.getState().library)).toEqual(['c', 'b', 'a'])
    } finally { useAppStore.setState(before) }
  })
})

describe('a failed save does not break the action that changed the state', () => {
  it('swallows the failure, reports it once per run of failures, and retries on the next change', () => {
    let fail = true
    const writes: string[] = []
    const report = vi.fn()
    const storage = tolerateWriteFailures({
      getItem: () => null,
      removeItem: () => undefined,
      setItem: (name: string) => { if (fail) throw new Error('QuotaExceededError'); writes.push(name) }
    }, report)
    const value = { state: { settings: useAppStore.getState().settings, library: {} }, version: 9 }
    expect(() => storage.setItem('preferences', value)).not.toThrow()
    expect(() => storage.setItem('preferences', value)).not.toThrow()
    expect(report).toHaveBeenCalledTimes(1)
    fail = false
    storage.setItem('preferences', value)
    expect(writes).toEqual(['preferences'])
    fail = true
    storage.setItem('preferences', value)
    expect(report).toHaveBeenCalledTimes(2)
  })
})
