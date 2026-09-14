import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LyricsStage } from './LyricsStage'
import { completeRomanization, mergeUserEditedTracks } from '../hooks/usePlayback'
import type { LyricTrack } from '../types'

afterEach(() => vi.unstubAllGlobals())

it('renders full generated romaji without stale word fragments in a romanization-only document', async () => {
  const original: LyricTrack = { id: 'original', kind: 'original', language: 'ja', label: 'Japanese', source: 'test',
    lines: [{ startMs: 1000, text: '喜んで会いに行くから', words: [{ startMs: 1000, text: '喜んで' }, { startMs: 2000, text: '会いに行くから' }] }] }
  vi.stubGlobal('window', { syllable: { lyrics: { romanize: async () => ['yorokonde ai ni iku kara'] } } })
  const tracks = await completeRomanization(original, [original])
  // Normal documents deliberately retain the original as their alignment anchor.
  // A romaji-only document exercises the primary line's word-aware renderer.
  const romanizedTracks = tracks.filter(track => track.kind === 'romanization')
  expect(romanizedTracks).toHaveLength(1)
  const markup = renderToStaticMarkup(<LyricsStage document={{ trackId: 'song', tracks: romanizedTracks }} positionMs={3000} enabled={['romaji']} romanization />)
  expect(markup).toContain('yorokonde ai ni iku kara')
  expect(markup).not.toMatch(/喜|会|行/)
})

it('preserves explicitly edited romaji word timing through a provider refresh', () => {
  const user: LyricTrack = { id: 'edited-romaji', kind: 'romanization', language: 'romaji', label: 'Romaji', source: 'User',
    lines: [{ startMs: 1200, text: 'my reading', words: [{ startMs: 1300, text: 'my ' }, { startMs: 1600, text: 'reading' }] }] }
  const generated = { ...user, id: 'auto-romaji', source: 'Kuroshiro', lines: [{ startMs: 1000, text: 'different reading' }] }
  const tracks = mergeUserEditedTracks([generated], { trackId: 'song', tracks: [user], userEditedTrackIds: [user.id] })
  expect(tracks).toEqual([user])
  expect(tracks[0]).toBe(user)
})
