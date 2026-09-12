import { describe, expect, it } from 'vitest'
import { receiveWindowDocument } from './window-document'
import type { LyricsDocument } from '../types'

const document = (trackId: string): LyricsDocument => ({ trackId, tracks: [], updatedAt: 1 })
describe('auxiliary document retention', () => {
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
