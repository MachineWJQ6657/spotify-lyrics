import { describe, expect, it } from 'vitest'
import type { LyricsDocument } from '../types'
import { parseLibraryBackup, serializeLibraryBackup } from '../lib/library-backup'
import { useAppStore } from './useAppStore'

const document = (id: string, updatedAt: number, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({
  trackId: id, updatedAt,
  tracks: [{ id: `${id}-o`, language: 'ja', label: '日本語', kind: 'original', source: 'LRCLIB · 精确匹配', lines: [{ startMs: 1000, text: '歌詞' }] }],
  ...extra
})

describe('restoring a library backup', () => {
  it('adds new songs, takes newer copies, keeps the rest and never touches the song on screen', () => {
    const before = useAppStore.getState()
    try {
      const playing = document('playing', 10)
      useAppStore.setState({ lyrics: playing, demoMode: false, library: { playing, same: document('same', 10), stale: document('stale', 10) },
        playback: { track: { id: 'playing', name: 'n', artist: 'a', album: '', coverUrl: '', durationMs: 1 }, positionMs: 0, observedAtMs: 0, isPlaying: true } as never })
      const backup = serializeLibraryBackup({
        fresh: document('fresh', 3, { offsetMs: 250 }),
        stale: document('stale', 99, { listenedOffset: { timingKey: 'k', state: 'decided', offsetMs: 300, lines: 6, measuredAt: 1 } }),
        same: document('same', 10),
        playing: document('playing', 99, { offsetMs: 9000 })
      })
      const parsed = parseLibraryBackup(backup)
      if ('error' in parsed) throw new Error(parsed.error)
      expect(useAppStore.getState().importLibrary(parsed.documents)).toEqual({ added: 1, updated: 1, kept: 2 })
      const library = useAppStore.getState().library
      expect(Object.keys(library)).toEqual(['stale', 'playing', 'same', 'fresh'])
      expect(library.fresh.offsetMs).toBe(250)
      expect(library.stale.listenedOffset?.offsetMs).toBe(300)
      expect(library.playing).toBe(playing)
      expect(useAppStore.getState().lyrics).toBe(playing)
    } finally { useAppStore.setState(before) }
  })

  it('changes nothing when the backup holds nothing new', () => {
    const before = useAppStore.getState()
    try {
      const library = { a: document('a', 10) }
      useAppStore.setState({ lyrics: null, library })
      expect(useAppStore.getState().importLibrary([document('a', 5)])).toEqual({ added: 0, updated: 0, kept: 1 })
      expect(useAppStore.getState().library).toBe(library)
    } finally { useAppStore.setState(before) }
  })
})
