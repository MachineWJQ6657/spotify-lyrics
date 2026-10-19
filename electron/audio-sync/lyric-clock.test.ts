import { describe, expect, it } from 'vitest'
import { LyricClock, type HeardObservation } from './lyric-clock'
import type { PlaybackSnapshot } from '../../src/types'
const snapshot: PlaybackSnapshot = { track: { id: 'song', name: '', artist: '', album: '', durationMs: 300000, coverUrl: '' }, isPlaying: true, positionMs: 160000, observedAtMs: 100000 }
function setup() { const clock = new LyricClock(); clock.observePlayback(snapshot, 100000); return clock }
const observation = (end: number, first: number): HeardObservation => ({ trackId: 'song', capturedAtMs: end, captureDurationMs: 12000,
  accepted: true, reason: 'matched', sourceEndMs: end - 60000, rate: 1, score: .95, residualMs: 100, lineIndices: [first, first + 1, first + 2] })
const missingWords = (end: number): HeardObservation => ({ ...observation(end, 0), accepted: false,
  reason: 'insufficient-words', sourceEndMs: 0, rate: 1, score: 0, residualMs: 0, lineIndices: [] })

describe('independent lyric clock', () => {
  it('binds vocal evidence to one original timeline and keeps recording anchors backward compatible', () => {
    const clock = setup()
    clock.accept({ ...observation(112000, 0), lyricTimingKey: 'original-a' }, 112100)
    expect(clock.accept({ ...observation(124000, 3), lyricTimingKey: 'original-b' }, 124100)).toBe('confirming')
    expect(clock.decorate(snapshot, 124100)?.acousticAnchor).toBeUndefined()
    expect(clock.accept({ ...observation(136000, 6), lyricTimingKey: 'original-b' }, 136100)).toBe('confirming')
    expect(clock.accept({ ...observation(148000, 9), lyricTimingKey: 'original-b' }, 148100)).toBe('locked')
    expect(clock.decorate(snapshot, 148100)?.acousticAnchor).toMatchObject({ coordinate: 'lyrics', lyricTimingKey: 'original-b' })
  })
  it('requires three independent blocks and compensates recognition latency', () => {
    const clock = setup()
    expect(clock.accept(observation(112000, 0), 122000)).toBe('confirming')
    expect(clock.accept(observation(124000, 3), 134000)).toBe('confirming')
    expect(clock.accept(observation(136000, 6), 146000)).toBe('locked')
    const value = clock.decorate(snapshot, 146000)!
    expect(value.positionMs).toBe(160000) // Never changes Spotify transport.
    expect(value.acousticAnchor?.sourcePositionMs).toBe(76000)
    expect(value.acousticAnchor?.observedAtMs).toBe(136000) // NOT completion time.
    expect(clock.decorate(snapshot, 183999)?.acousticAnchor).toBeDefined()
    expect(clock.decorate(snapshot, 184000)?.acousticAnchor).toBeUndefined()
  })
  it('does not confirm duplicate or overlapping blocks or repeated line indices', () => {
    for (const second of [observation(112000, 0), observation(118000, 3), observation(124000, 0)]) {
      const clock = setup(); clock.accept(observation(112000, 0), 112100)
      expect(clock.accept(second, second.capturedAtMs + 100)).not.toBe('locked')
    }
  })
  it('clears after a new ambiguous block but ignores stale replies', () => {
    const clock = setup(); clock.accept(observation(112000, 0), 112100); clock.accept(observation(124000, 3), 124100); clock.accept(observation(136000, 6), 136100)
    clock.accept({ ...observation(124000, 3), accepted: false }, 136200)
    expect(clock.decorate(snapshot, 136200)?.acousticAnchor).toBeDefined()
    expect(clock.accept(observation(148000, 9), 148100)).toBe('locked')
    expect(clock.decorate(snapshot, 148100)?.acousticAnchor?.observedAtMs).toBe(148000)
    clock.accept({ ...observation(160000, 12), accepted: false, reason: 'ambiguous' }, 160100)
    expect(clock.decorate(snapshot, 160100)?.acousticAnchor).toBeUndefined()
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
  it.each([{ rate: 1.25 }, { score: .6 }, { score: 1.1 }, { sourceEndMs: NaN }, { residualMs: 600 }, { residualMs: -1 },
    { lineIndices: [0, 0] }, { lineIndices: [2, 1] }, { lineIndices: [0, NaN] }, { lineIndices: [399, 400] },
    { trackId: 'other' }, { capturedAtMs: 160000 }])('rejects invalid evidence %j', patch => {
    expect(setup().accept({ ...observation(112000, 0), ...patch }, 122000)).toBe('rejected')
  })
  it('rejects over-budget recognition and inconsistent independent estimates', () => {
    expect(setup().accept(observation(112000, 0), 130000)).toBe('rejected')
    const clock = setup(); clock.accept(observation(112000, 0), 112100)
    expect(clock.accept({ ...observation(124000, 3), sourceEndMs: 140000 }, 124100)).toBe('confirming')
  })
  it.each([.96, 1.04])('fits a long-baseline %.2fx clock without accumulating drift', rate => {
    const clock = setup()
    const block = (end: number, first: number): HeardObservation => ({ ...observation(end, first), rate,
      sourceEndMs: 50_000 + (end - 112_000) * rate })
    expect(clock.accept(block(112000, 0), 112100)).toBe('confirming')
    expect(clock.accept(block(124000, 3), 124100)).toBe('confirming')
    expect(clock.accept(block(136000, 6), 136100)).toBe('locked')
    expect(clock.decorate(snapshot, 136100)?.acousticAnchor).toMatchObject({ rate })
    expect(clock.decorate(snapshot, 136100)?.acousticAnchor?.sourcePositionMs).toBeCloseTo(50_000 + 24_000 * rate, 4)
  })
  it('uses endpoint progression instead of averaging noisy short-block slopes', () => {
    const clock = setup()
    expect(clock.accept({ ...observation(112000, 0), rate: .98 }, 112100)).toBe('confirming')
    expect(clock.accept({ ...observation(124000, 3), rate: 1.01 }, 124100)).toBe('confirming')
    expect(clock.accept({ ...observation(136000, 6), rate: .99 }, 136100)).toBe('locked')
    expect(clock.decorate(snapshot, 136100)?.acousticAnchor?.rate).toBe(1)
  })
  it('does not expose a future capture, even within the accepted producer clock tolerance', () => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept(observation(124000, 3), 124100)
    expect(clock.accept(observation(136000, 6), 135900)).toBe('locked')
    expect(clock.decorate(snapshot, 135950)?.acousticAnchor).toBeUndefined()
    expect(clock.decorate(snapshot, 136000)?.acousticAnchor).toBeDefined()
  })
  it('automatically locks shorter valid captures once their endpoints span twenty seconds', () => {
    const clock = setup()
    for (let index = 0; index < 5; index++) {
      const end = 106000 + index * 6000
      expect(clock.accept({ ...observation(end, index * 3), captureDurationMs: 6000 }, end + 100))
        .toBe(index < 4 ? 'confirming' : 'locked')
    }
    expect(clock.decorate(snapshot, 130100)?.acousticAnchor).toMatchObject({ rate: 1, sourcePositionMs: 70000 })
  })
  it('locks automatically when bounded slow inference skips every other twelve-second capture', () => {
    const clock = setup()
    // Fourteen-second inference is still in budget, but the controller drops
    // the next block instead of queuing it. Accepted endpoints are 24s apart.
    expect(clock.accept(observation(112000, 0), 126000)).toBe('confirming')
    expect(clock.accept(observation(136000, 6), 150000)).toBe('confirming')
    expect(clock.accept(observation(160000, 12), 174000)).toBe('locked')
    expect(clock.decorate(snapshot, 174000)?.acousticAnchor).toMatchObject({ rate: 1, sourcePositionMs: 100000 })
    for (let now = 174000; now < 198000; now += 1000) {
      // There must be no periodic fallback while the next in-budget analysis
      // is running: its captured endpoint is 184s, completion is 198s.
      expect(clock.decorate(snapshot, now)?.acousticAnchor).toBeDefined()
    }
    expect(clock.accept(observation(184000, 18), 198000)).toBe('locked')
    expect(clock.decorate(snapshot, 198000)?.acousticAnchor?.sourcePositionMs).toBe(124000)
  })
  it('holds through a short accompaniment without extending the old anchor and recovers on fresh evidence', () => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept(observation(124000, 3), 124100)
    clock.accept(observation(136000, 6), 136100)
    const anchor = clock.decorate(snapshot, 136100)?.acousticAnchor
    expect(clock.accept(missingWords(148000), 148100)).toBe('rejected')
    expect(clock.decorate(snapshot, 159999)?.acousticAnchor).toEqual(anchor)
    expect(clock.accept(observation(160000, 9), 160100)).toBe('locked')
    expect(clock.decorate(snapshot, 160100)?.acousticAnchor?.observedAtMs).toBe(160000)
  })
  it('expires after forty-eight seconds even if empty observations keep arriving', () => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept(observation(124000, 3), 124100)
    clock.accept(observation(136000, 6), 136100)
    for (const end of [148000, 160000, 172000]) {
      expect(clock.accept(missingWords(end), end + 100)).toBe('rejected')
      expect(clock.decorate(snapshot, end + 100)?.acousticAnchor?.expiresAtMs).toBe(184000)
    }
    expect(clock.decorate(snapshot, 184000)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(missingWords(184000), 184100)).toBe('rejected')
    expect(clock.accept(observation(196000, 9), 196100)).toBe('confirming')
    expect(clock.decorate(snapshot, 196100)?.acousticAnchor).toBeUndefined()
  })
  it('shortens holdover when the fit has greater timing uncertainty', () => {
    const clock = setup()
    for (let index = 0; index < 3; index++) {
      clock.accept({ ...observation(112000 + index * 12000, index * 3), residualMs: 300 }, 112100 + index * 12000)
    }
    const anchor = clock.decorate(snapshot, 136100)?.acousticAnchor
    expect(anchor?.expiresAtMs).toBe(164000)
    expect(clock.accept(missingWords(148000), 148100)).toBe('rejected')
    expect(clock.decorate(snapshot, 164000)?.acousticAnchor).toBeUndefined()
    // A result arriving after expiry cannot revive a fit from before the gap.
    expect(clock.accept(observation(160000, 9), 165000)).toBe('confirming')
  })
  it.each(['ambiguous', 'inconsistent-timing'] as const)('immediately revokes holdover on %s evidence', reason => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept(observation(124000, 3), 124100)
    clock.accept(observation(136000, 6), 136100)
    clock.accept(missingWords(148000), 148100)
    expect(clock.accept({ ...missingWords(160000), reason }, 160100)).toBe('rejected')
    expect(clock.decorate(snapshot, 160100)?.acousticAnchor).toBeUndefined()
  })
  it('immediately revokes holdover if confident new words contradict its predicted position', () => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept(observation(124000, 3), 124100)
    clock.accept(observation(136000, 6), 136100)
    clock.accept(missingWords(148000), 148100)
    expect(clock.accept({ ...observation(160000, 9), sourceEndMs: 110000 }, 160100)).toBe('confirming')
    expect(clock.decorate(snapshot, 160100)?.acousticAnchor).toBeUndefined()
  })
  it.each([{ sourceEndMs: NaN }, { sourceEndMs: 1000 }, { lineIndices: [9, 10] }, { score: .99 }, { residualMs: -1 }])
    ('does not let malformed empty observations preserve a lock: %j', patch => {
      const clock = setup()
      clock.accept(observation(112000, 0), 112100)
      clock.accept(observation(124000, 3), 124100)
      clock.accept(observation(136000, 6), 136100)
      expect(clock.accept({ ...missingWords(148000), ...patch }, 148100)).toBe('rejected')
      expect(clock.decorate(snapshot, 148100)?.acousticAnchor).toBeUndefined()
    })
  it('revokes a held anchor when the original timeline changes, even if no new words are recognized', () => {
    const clock = setup()
    for (let index = 0; index < 3; index++) {
      clock.accept({ ...observation(112000 + index * 12000, index * 3), lyricTimingKey: 'original-a' }, 112100 + index * 12000)
    }
    expect(clock.accept({ ...missingWords(148000), lyricTimingKey: 'original-b' }, 148100)).toBe('rejected')
    expect(clock.decorate(snapshot, 148100)?.acousticAnchor).toBeUndefined()
    expect(clock.accept({ ...observation(160000, 9), lyricTimingKey: 'original-b' }, 160100)).toBe('confirming')
  })
  it.each(['pause', 'seek', 'track'] as const)('revokes held evidence immediately on %s', change => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept(observation(124000, 3), 124100)
    clock.accept(observation(136000, 6), 136100)
    clock.accept(missingWords(148000), 148100)
    const changed = change === 'pause' ? { ...snapshot, isPlaying: false }
      : change === 'seek' ? { ...snapshot, positionMs: 5000, observedAtMs: 149000 }
      : { ...snapshot, track: { ...snapshot.track!, id: 'other' } }
    clock.observePlayback(changed, 149000)
    expect(clock.decorate(changed, 149000)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(observation(160000, 9), 160100)).toBe('rejected')
  })
  it.each([.96, 1.04])('keeps %.2fx progress bounded over two minutes of noisy observations', rate => {
    const clock = setup()
    for (let index = 0; index < 11; index++) {
      const end = 112000 + index * 12000
      const noise = [0, 100, -100, 50][index % 4]
      const decision = clock.accept({ ...observation(end, index * 3), rate: rate + [.01, -.01, 0][index % 3],
        sourceEndMs: 50000 + (end - 112000) * rate + noise }, end + 5000)
      if (index < 2) { expect(decision).toBe('confirming'); continue }
      expect(decision).toBe('locked')
      const anchor = clock.decorate(snapshot, end + 10000)?.acousticAnchor
      expect(anchor).toBeDefined()
      const predicted = anchor!.sourcePositionMs + (end + 10000 - anchor!.observedAtMs) * anchor!.rate
      expect(Math.abs(predicted - (50000 + (end + 10000 - 112000) * rate))).toBeLessThan(250)
    }
  })
  it('discards a nonlinear three-block fit and waits for fresh consistent evidence', () => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept({ ...observation(124000, 3), sourceEndMs: 64400 }, 124100)
    expect(clock.accept(observation(136000, 6), 136100)).toBe('confirming')
    expect(clock.decorate(snapshot, 136100)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(observation(148000, 9), 148100)).toBe('confirming')
    expect(clock.accept(observation(160000, 12), 160100)).toBe('locked')
  })
  it('ignores foreign replies and keeps the weakest independent confidence on the current lock', () => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept({ ...observation(124000, 3), score: .9 }, 124100)
    clock.accept(observation(136000, 6), 136100)
    expect(clock.accept({ ...observation(148000, 9), trackId: 'other', accepted: false }, 148100)).toBe('rejected')
    expect(clock.accept(observation(148000, 9), 148200)).toBe('locked')
    expect(clock.decorate(snapshot, 148200)?.acousticAnchor?.score).toBe(.9)
  })
  it('reacquires after a playback discontinuity without reusing pre-seek audio', () => {
    const clock = setup()
    clock.accept(observation(112000, 0), 112100)
    clock.accept(observation(124000, 3), 124100)
    clock.accept(observation(136000, 6), 136100)
    clock.observePlayback({ ...snapshot, positionMs: 5000, observedAtMs: 137000 }, 137000)
    expect(clock.accept(observation(148000, 9), 148100)).toBe('rejected')
    expect(clock.decorate(snapshot, 148100)?.acousticAnchor).toBeUndefined()
    const block = (end: number, first: number) => ({ ...observation(end, first), sourceEndMs: end - 140000 })
    expect(clock.accept(block(149000, 0), 149100)).toBe('confirming')
    expect(clock.accept(block(161000, 3), 161100)).toBe('confirming')
    expect(clock.accept(block(173000, 6), 173100)).toBe('locked')
    expect(clock.decorate(snapshot, 173100)?.acousticAnchor?.sourcePositionMs).toBe(33000)
  })
})
