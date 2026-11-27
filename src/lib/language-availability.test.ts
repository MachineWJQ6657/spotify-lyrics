import { describe, expect, it } from 'vitest'
import { languageAvailability } from './language-availability'
import type { LyricsDocument, LyricTrack } from '../types'

const track = (language: string, kind: LyricTrack['kind'], texts = ['a', 'b']): LyricTrack =>
  ({ id: `${language}-${kind}`, language, label: language, kind, source: 'test', lines: texts.map((text, index) => ({ startMs: index * 1000, text })) })
const song = (...tracks: LyricTrack[]) => ({ trackId: 't', tracks } as LyricsDocument)

describe('what a language switch can do for a song', () => {
  const japanese = song(track('ja', 'original'), track('romaji', 'romanization'), track('zh-Hans', 'translation'))

  it('switches a translation or a reading', () => {
    expect(languageAvailability(japanese, 'zh-Hans')).toBe('switchable')
    expect(languageAvailability(japanese, 'romaji')).toBe('switchable')
  })

  it("names the song's own language, which is shown whatever the switch says", () => {
    expect(languageAvailability(japanese, 'ja')).toBe('original')
    expect(languageAvailability(song(track('en', 'original')), 'en')).toBe('original')
  })

  it('says so when the song has nothing in the language', () => {
    expect(languageAvailability(japanese, 'en')).toBe('missing')
    expect(languageAvailability(song(track('en', 'original')), 'zh-Hans')).toBe('missing')
    expect(languageAvailability(song(track('en', 'original')), 'romaji')).toBe('missing')
    // A track added in the editor and not filled in yet shows nothing.
    expect(languageAvailability(song(track('ja', 'original'), track('en', 'translation', ['', ' '])), 'en')).toBe('missing')
  })

  it('finds an imported English translation', () => {
    expect(languageAvailability(song(track('ja', 'original'), track('en', 'translation')), 'en')).toBe('switchable')
  })

  it('says nothing without a song, and nothing about romaji that is still being made', () => {
    expect(languageAvailability(null, 'en')).toBe('unknown')
    expect(languageAvailability(song(), 'en')).toBe('unknown')
    expect(languageAvailability(song(track('ja', 'original')), 'romaji')).toBe('unknown')
    expect(languageAvailability({ ...japanese, untimedOriginal: { text: 'x', language: 'ja', source: 's' } }, 'en')).toBe('unknown')
  })
})
