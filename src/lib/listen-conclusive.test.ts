import { beforeEach, describe, expect, it } from 'vitest'
import type { ListenedOffset, LyricsDocument, PlaybackSnapshot } from '../types'
import { useAppStore } from '../store/useAppStore'
import { adoptEarlierVerdict, listenTarget, resetSourceAdvanceForTests } from './listen-controller'
import { listenStatus } from './listen-status'
import { isConclusiveListen, listenTimingKey } from './listened-offset'

const track = { id: 'song', name: 'ランデブー', artist: 'sumika', album: '', coverUrl: '', durationMs: 200_000 }
const playback = { track, positionMs: 30_000, observedAtMs: Date.now(), isPlaying: true, playbackSource: 'local' } as unknown as PlaybackSnapshot
const original = { id: 'o', language: 'ja', label: '日本語', kind: 'original' as const, source: 'LRCLIB · 精确匹配',
  lines: Array.from({ length: 12 }, (_, index) => ({ startMs: 10_000 + index * 5000, text: `歌詞の行その${index}` })) }
const listened = (state: ListenedOffset['state'], lines: number): ListenedOffset =>
  ({ timingKey: listenTimingKey(original)!, state, offsetMs: 0, lines, measuredAt: 1 })
const document = (value: ListenedOffset): LyricsDocument => ({ trackId: track.id, track, providerRevision: 45, tracks: [original],
  availableSources: [{ id: 'lrclib', lines: 12, agrees: true }, { id: 'netease', lines: 12, agrees: true }], listenedOffset: value })
const decide = (lyrics: LyricsDocument) => listenTarget({ playback, lyrics, enabled: true, demoMode: false, manualActive: false })

beforeEach(() => {
  resetSourceAdvanceForTests()
  useAppStore.setState({ playback, demoMode: false, library: {}, sourceSwitchToken: null, sessionCalibration: null })
})

describe('an "inconsistent" result from too few lines (stored before 0.4.70)', () => {
  it('is not a verdict', () => {
    expect(isConclusiveListen(listened('inconsistent', 4))).toBe(false)
    expect(isConclusiveListen(listened('inconsistent', 5))).toBe(false)
    expect(isConclusiveListen(listened('inconsistent', 7))).toBe(true)
    expect(isConclusiveListen(listened('decided', 6))).toBe(true)
    expect(isConclusiveListen(listened('dismissed', 0))).toBe(true)
    expect(isConclusiveListen(null)).toBe(false)
  })

  it('lets the song be listened to again', () => {
    expect(decide(document(listened('inconsistent', 4)))).toHaveProperty('target')
    expect(decide(document(listened('inconsistent', 7)))).toEqual({ reason: 'already-measured' })
    expect(decide(document(listened('decided', 6)))).toEqual({ reason: 'already-measured' })
  })

  it('does not send listening to another provider', () => {
    useAppStore.setState({ lyrics: document(listened('inconsistent', 5)) })
    adoptEarlierVerdict()
    expect(useAppStore.getState().lyrics?.sourceTrials).toBeUndefined()
    expect(useAppStore.getState().lyrics?.sourcePreference).toBeUndefined()
    // A real verdict still does.
    useAppStore.setState({ lyrics: document(listened('inconsistent', 9)) })
    adoptEarlierVerdict()
    expect(useAppStore.getState().lyrics).toMatchObject({ sourcePreference: 'netease', sourceTrials: { lrclib: 'inconsistent' } })
  })

  it('reads as not calibrated yet', () => {
    const status = listenStatus({ document: document(listened('inconsistent', 4)), listening: false, enabled: true, playing: true })
    expect(status.text).toContain('还没有校准')
    expect(listenStatus({ document: document(listened('inconsistent', 8)), listening: false, enabled: true, playing: true, reason: 'already-measured' }).text).toContain('不一致')
  })
})
