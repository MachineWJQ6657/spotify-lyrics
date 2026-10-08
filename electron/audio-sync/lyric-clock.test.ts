import { describe, expect, it } from 'vitest'
import { LyricClock, type HeardObservation } from './lyric-clock'
import type { PlaybackSnapshot } from '../../src/types'
const snapshot: PlaybackSnapshot = { track: { id: 'song', name: '', artist: '', album: '', durationMs: 300000, coverUrl: '' }, isPlaying: true, positionMs: 160000, observedAtMs: 100000 }
function setup() { const clock = new LyricClock(); clock.observePlayback(snapshot, 100000); return clock }
const observation = (end: number, first: number): HeardObservation => ({ trackId: 'song', capturedAtMs: end, captureDurationMs: 12000,
  accepted: true, reason: 'matched', sourceEndMs: end - 60000, rate: 1, score: .95, residualMs: 100, lineIndices: [first, first + 1, first + 2] })

describe('independent lyric clock', () => {
  it('requires two independent blocks and compensates recognition latency', () => {
    const clock = setup()
    expect(clock.accept(observation(112000, 0), 122000)).toBe('confirming')
    expect(clock.accept(observation(136000, 3), 146000)).toBe('locked')
    const value = clock.decorate(snapshot, 146000)!
    expect(value.positionMs).toBe(160000) // Never changes Spotify transport.
    expect(value.acousticAnchor?.sourcePositionMs).toBe(76000)
    expect(value.acousticAnchor?.observedAtMs).toBe(136000) // NOT completion time.
    expect(clock.decorate(snapshot, 164000)?.acousticAnchor).toBeUndefined()
  })
  it('does not confirm duplicate or overlapping blocks or repeated line indices', () => {
    for (const second of [observation(112000, 0), observation(118000, 3), observation(124000, 0)]) {
      const clock = setup(); clock.accept(observation(112000, 0), 112100)
      expect(clock.accept(second, second.capturedAtMs + 100)).not.toBe('locked')
    }
  })
  it('clears after a new ambiguous block but ignores stale replies', () => {
    const clock = setup(); clock.accept(observation(112000, 0), 112100); clock.accept(observation(124000, 3), 124100)
    clock.accept({ ...observation(112000, 0), accepted: false }, 125000)
    expect(clock.decorate(snapshot, 125000)?.acousticAnchor).toBeDefined()
    clock.accept({ ...observation(136000, 6), accepted: false, reason: 'ambiguous' }, 136100)
    expect(clock.decorate(snapshot, 136100)?.acousticAnchor).toBeUndefined()
  })
  it.each(['pause', 'seek', 'track'] as const)('invalidates on %s including in-flight recognition', change => {
    const clock = setup(); clock.accept(observation(112000, 0), 112100)
    const changed = change === 'pause' ? { ...snapshot, isPlaying: false }
      : change === 'seek' ? { ...snapshot, positionMs: 5000, observedAtMs: 113000 }
      : { ...snapshot, track: { ...snapshot.track!, id: 'other' } }
    clock.observePlayback(changed, 113000)
    expect(clock.accept(observation(124000, 3), 124100)).toBe('rejected')
    expect(clock.decorate(changed, 124100)?.acousticAnchor).toBeUndefined()
  })
  it.each([{ rate: 1.25 }, { score: .6 }, { sourceEndMs: NaN }, { residualMs: 600 }, { trackId: 'other' }, { capturedAtMs: 160000 }])('rejects invalid evidence %j', patch => {
    expect(setup().accept({ ...observation(112000, 0), ...patch }, 122000)).toBe('rejected')
  })
  it('rejects over-budget recognition and inconsistent independent estimates', () => {
    expect(setup().accept(observation(112000, 0), 130000)).toBe('rejected')
    const clock = setup(); clock.accept(observation(112000, 0), 112100)
    expect(clock.accept({ ...observation(124000, 3), sourceEndMs: 140000 }, 124100)).toBe('confirming')
  })
})
