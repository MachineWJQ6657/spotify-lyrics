import { describe, expect, it } from 'vitest'
import type { LyricsDocument } from '../types'
import { listenTimingKey } from './listened-offset'
import { shiftAmount, timingStatus } from './timing-status'

const original = { id: 'o', language: 'ja', label: '日本語', kind: 'original' as const, source: 'test',
  lines: Array.from({ length: 10 }, (_, index) => ({ startMs: 10_000 + index * 4000, text: `行${index}` })) }
const base = { trackId: 't', tracks: [original] } satisfies LyricsDocument
const idle = { sessionCalibrated: false, acousticAnchor: false, listening: false, listenEnabled: true }

describe('timing status on the lyrics card', () => {
  it('says the Spotify timeline applies when nothing corrects it', () => {
    expect(timingStatus({ ...idle, document: base })).toMatchObject({ label: 'SPOTIFY TIMELINE', tone: 'neutral' })
    expect(timingStatus({ ...idle, document: null }).tone).toBe('neutral')
  })

  it('names a listened correction with its direction and size', () => {
    const listened = { ...base, listenedOffset: { timingKey: listenTimingKey(original), state: 'decided' as const, offsetMs: 850, measuredDeltaMs: 1000, lines: 6, measuredAt: 1 } }
    expect(timingStatus({ ...idle, document: listened })).toMatchObject({ label: '听音校准 · 歌词延后 0.85 秒', tone: 'calibrated' })
    // Turned off in settings: the listened offset no longer applies.
    expect(timingStatus({ ...idle, listenEnabled: false, document: listened }).tone).toBe('neutral')
    // A measurement of other line timings (the file changed) does not apply either.
    const stale = { ...listened, listenedOffset: { ...listened.listenedOffset, timingKey: 'other' } }
    expect(timingStatus({ ...idle, document: stale }).tone).toBe('neutral')
  })

  it('prefers a manual offset, and shows listening only while nothing applies yet', () => {
    expect(timingStatus({ ...idle, document: { ...base, offsetMs: -250 } }).label).toBe('手动校准 · 歌词提前 0.25 秒')
    expect(timingStatus({ ...idle, listening: true, document: base })).toMatchObject({ label: '正在听音校准…', tone: 'listening' })
    expect(timingStatus({ ...idle, listening: true, document: { ...base, offsetMs: 500 } }).tone).toBe('calibrated')
  })

  it('puts a session calibration and an audio anchor first', () => {
    expect(timingStatus({ ...idle, sessionCalibrated: true, acousticAnchor: true, document: { ...base, offsetMs: 500 } }).label).toBe('本次听感校准')
    expect(timingStatus({ ...idle, acousticAnchor: true, document: { ...base, offsetMs: 500 } }).tone).toBe('experimental')
  })

  it('formats shift sizes in seconds', () => {
    expect(shiftAmount(7120)).toBe('7.12 秒')
    expect(shiftAmount(-250)).toBe('0.25 秒')
  })
})
