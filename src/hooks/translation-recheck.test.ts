import { describe, expect, it } from 'vitest'
import type { LyricsDocument, LyricTrack } from '../types'
import { needsTranslationRecheck, TRANSLATION_RECHECK_REVISION } from './usePlayback'

const track = (kind: LyricTrack['kind'], language: string, id = `song-${kind}`): LyricTrack =>
  ({ id, kind, language, label: language, source: 'LRCLIB · 精确匹配', lines: [{ startMs: 1000, text: 'a' }] })
const document = (tracks: LyricTrack[], extra: Partial<LyricsDocument> = {}): LyricsDocument => ({ trackId: 'song', tracks, providerRevision: 45, ...extra })

describe('one more lookup for saved songs without a Chinese translation', () => {
  it('asks for a Japanese or English song that has none', () => {
    expect(needsTranslationRecheck(document([track('original', 'ja'), track('romanization', 'romaji')]))).toBe(true)
    expect(needsTranslationRecheck(document([track('original', 'en')]))).toBe(true)
  })
  it('asks once per revision of the matching', () => {
    const looked = document([track('original', 'ja')], { translationRecheck: TRANSLATION_RECHECK_REVISION })
    expect(needsTranslationRecheck(looked)).toBe(false)
    expect(needsTranslationRecheck({ ...looked, translationRecheck: TRANSLATION_RECHECK_REVISION - 1 })).toBe(true)
  })
  it('leaves songs that have a translation, Chinese songs and songs without timed words alone', () => {
    expect(needsTranslationRecheck(document([track('original', 'ja'), track('translation', 'zh-Hans')]))).toBe(false)
    expect(needsTranslationRecheck(document([track('original', 'zh-Hans')]))).toBe(false)
    expect(needsTranslationRecheck(document([], { instrumental: true }))).toBe(false)
    expect(needsTranslationRecheck(document([], { untimedOriginal: { text: 'x', language: 'ja', source: 'Spotify' } }))).toBe(false)
    expect(needsTranslationRecheck(document([]))).toBe(false)
  })
  it("leaves the user's own lyrics alone", () => {
    expect(needsTranslationRecheck(document([track('original', 'ja')], { userEditedTrackIds: ['song-original'] }))).toBe(false)
    expect(needsTranslationRecheck(document([track('original', 'ja', 'local-1700000000-0')]))).toBe(false)
  })
})
