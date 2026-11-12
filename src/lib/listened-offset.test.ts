import { describe, expect, it, vi } from 'vitest'
import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { displayLyricsOffset, listenedLyricsOffset, listenLines, listenTimingKey } from './listened-offset'
import { lyricTimingKey } from './lyric-timing-key'

vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => ({}), subscribe: () => () => {} } }))
vi.mock('./acoustic-controller', () => ({ acousticController: { snapshot: () => ({}), subscribe: () => () => {} } }))
const { listenTarget } = await import('./listen-controller')

const lines = Array.from({ length: 10 }, (_, index) => ({ text: index === 3 ? ' ' : `歌詞${index}`, startMs: 1000 + index * 3000 }))
const original = { id: 'o', kind: 'original' as const, language: 'ja', label: '日本語', source: 'LRCLIB', lines }
const key = lyricTimingKey(listenLines(lines))
const doc = (extra: Partial<LyricsDocument> = {}): LyricsDocument => ({ trackId: 'song', tracks: [original], ...extra })
const listened = (extra = {}) => ({ timingKey: key, state: 'decided' as const, offsetMs: 900, measuredDeltaMs: 1050, lines: 8, measuredAt: 1, ...extra })

describe('listened offset selection', () => {
  it('uses a decided offset only for the exact timing it was measured on', () => {
    expect(listenTimingKey(original)).toBe(key)
    expect(listenedLyricsOffset(doc({ listenedOffset: listened() }))).toBe(900)
    expect(listenedLyricsOffset(doc({ listenedOffset: listened({ timingKey: 'other' }) }))).toBe(0)
    expect(listenedLyricsOffset(doc({ listenedOffset: listened({ state: 'inconsistent' }) }))).toBe(0)
    expect(listenedLyricsOffset(doc({ listenedOffset: listened({ state: 'dismissed' }) }))).toBe(0)
    expect(listenedLyricsOffset(doc({ listenedOffset: listened(), untimedOriginal: { text: 'x', language: 'ja', source: 's' } }))).toBe(0)
    // Shifted provider lines are a different file: the old measurement must not apply.
    const shifted = { ...original, lines: lines.map(line => ({ ...line, startMs: line.startMs + 900 })) }
    expect(listenedLyricsOffset({ trackId: 'song', tracks: [shifted], listenedOffset: listened() })).toBe(0)
  })

  it('lets a manual offset win, the setting turn it off, and falls back otherwise', () => {
    expect(displayLyricsOffset(doc({ listenedOffset: listened(), offsetMs: -250 }), 0)).toBe(-250)
    expect(displayLyricsOffset(doc({ listenedOffset: listened(), offsetMs: 0 }), 0)).toBe(900)
    expect(displayLyricsOffset(doc({ listenedOffset: listened() }), 0, false)).toBe(0)
    expect(displayLyricsOffset(null, 400)).toBe(400)
    expect(displayLyricsOffset(doc(), 400)).toBe(400)
    expect(displayLyricsOffset(doc({ offsetMs: 0 }), 400)).toBe(0)
  })
})

describe('listenTarget', () => {
  const playing = (id = 'song', isPlaying = true) => ({ track: { id, name: 'x', artist: 'y', album: 'z', coverUrl: '', durationMs: 200_000 }, isPlaying, positionMs: 0, observedAtMs: 0, sampleId: 1, playbackSource: 'local' }) as PlaybackSnapshot
  const input = (extra = {}) => ({ playback: playing(), lyrics: doc(), enabled: true, demoMode: false, manualActive: false, ...extra })

  it('listens to a playing Japanese song whose timing was not measured yet', () => {
    const result = listenTarget(input())
    expect('target' in result && result.target).toMatchObject({ trackId: 'song', timingKey: key })
    expect('target' in result && result.target.lines).toHaveLength(9)
  })

  it('explains every reason not to listen', () => {
    // Chinese (either script) and English lyrics are listened to through their pronunciations.
    for (const [language, expected] of [['zh-Hans', 'zh'], ['zh-Hant', 'zh'], ['en', 'en'], ['ja', 'ja']] as const) {
      const result = listenTarget(input({ lyrics: doc({ tracks: [{ ...original, language }] }) }))
      expect('target' in result && result.target.language).toBe(expected)
    }
    const reason = (extra: object) => { const result = listenTarget(input(extra)); return 'reason' in result ? result.reason : 'target' }
    expect(reason({ enabled: false })).toBe('disabled')
    expect(reason({ demoMode: true })).toBe('demo')
    expect(reason({ manualActive: true })).toBe('manual-audio-sync')
    expect(reason({ playback: playing('song', false) })).toBe('not-playing')
    expect(reason({ playback: playing('other') })).toBe('no-lyrics')
    expect(reason({ lyrics: doc({ offsetMs: 500 }) })).toBe('manual-offset')
    expect(reason({ lyrics: doc({ tracks: [{ ...original, language: 'ko' }] }) })).toBe('unsupported-language')
    expect(reason({ lyrics: doc({ tracks: [{ ...original, language: 'original' }] }) })).toBe('unsupported-language')
    expect(reason({ lyrics: doc({ tracks: [{ ...original, lines: lines.slice(0, 5) }] }) })).toBe('too-few-lines')
    expect(reason({ lyrics: doc({ listenedOffset: listened({ state: 'inconsistent' }) }) })).toBe('already-measured')
    expect(reason({ lyrics: doc({ listenedOffset: listened({ timingKey: 'old' }) }) })).toBe('target')
  })
})
