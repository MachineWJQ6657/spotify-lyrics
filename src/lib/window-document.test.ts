import { describe, expect, it } from 'vitest'
import { receiveWindowDocument, snapshotOwnsTrack } from './window-document'
import type { LyricsDocument } from '../types'

const document = (trackId: string): LyricsDocument => ({ trackId, tracks: [], updatedAt: 1 })
describe('auxiliary document retention', () => {
  it('accepts an explicit empty view only for the matching playback identity', () => {
    expect(snapshotOwnsTrack('new', 'new', null)).toBe(true)
    expect(snapshotOwnsTrack('new', 'old', null)).toBe(false)
    expect(snapshotOwnsTrack('new', 'new', document('old'))).toBe(false)
    expect(snapshotOwnsTrack(null, 'old', document('old'))).toBe(false)
    expect(snapshotOwnsTrack(null, null, null)).toBe(true)
    expect(snapshotOwnsTrack('new', 'new', undefined)).toBe(false)
  })
  it('keeps only current lyrics across hundreds of incoming library updates', () => {
    const current = document('playing')
    let state = { library: { old: document('old') }, lyrics: current } as { library: Record<string, LyricsDocument>; lyrics: LyricsDocument | null }
    for (let i = 0; i < 500; i++) state = receiveWindowDocument(false, state.library, state.lyrics, document(`other-${i}`), 'playing')
    expect(state.library).toEqual({})
    expect(state.lyrics).toBe(current)
    const replacement = document('playing')
    expect(receiveWindowDocument(false, {}, current, replacement, 'playing').lyrics).toBe(replacement)
  })
  it('preserves the primary library and unrelated user documents', () => {
    const edited = document('user-edited')
    const incoming = document('new')
    expect(receiveWindowDocument(true, { edited }, edited, incoming, 'new')).toEqual({ library: { edited, new: incoming }, lyrics: incoming })
  })
})
