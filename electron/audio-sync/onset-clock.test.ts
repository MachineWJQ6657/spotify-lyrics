import { describe, expect, it } from 'vitest'
import type { PlaybackSnapshot } from '../../src/types'
import { OnsetClock, type OnsetObservation } from './onset-clock'

const playback: PlaybackSnapshot = { track: { id: 'song', name: '', artist: '', album: '', durationMs: 300000, coverUrl: '' },
  isPlaying: true, positionMs: 160000, observedAtMs: 100000 }
function setup() { const clock = new OnsetClock(); clock.observePlayback(playback, 100000); return clock }
function block(end: number, line: number, rate = 1, heardMs = 8000): OnsetObservation {
  const observedAt = end - 12000 + heardMs
  return { trackId: 'song', lyricTimingKey: 'lyrics-a', capturedAtMs: end, captureDurationMs: 12000,
    reason: 'matched', points: [{ lineIndex: line, heardMs, sourceMs: 50000 + (observedAt - 108000) * rate, score: .96 }] }
}
const missing = (end: number): OnsetObservation => ({ ...block(end, 0), reason: 'insufficient-words', points: [] })
function lock(clock: OnsetClock) {
  expect(clock.accept(block(112000, 0), 112100)).toBe('confirming')
  expect(clock.accept(block(124000, 1), 124100)).toBe('confirming')
  expect(clock.accept(block(136000, 2), 136100)).toBe('locked')
}

describe('cross-capture lyric onset clock', () => {
  it('reports baseline collection separately from a successful lock and resets its last decision', () => {
    const clock = setup()
    expect(clock.decisionReason).toBe('unavailable')
    expect(clock.accept(block(112000, 0), 126000)).toBe('confirming')
    expect(clock.decisionReason).toBe('insufficient-baseline')
    expect(clock.accept(block(136000, 1), 150000)).toBe('confirming')
    expect(clock.decisionReason).toBe('insufficient-baseline')
    expect(clock.accept(block(160000, 2), 174000)).toBe('locked')
    expect(clock.decisionReason).toBe('matched')
    clock.clear(175000)
    expect(clock.decisionReason).toBe('unavailable')
  })

  it('distinguishes inactive playback, invalid input and stale replies without inheriting an old reason', () => {
    const clock = new OnsetClock()
    expect(clock.accept(block(112000, 0), 112100)).toBe('rejected')
    expect(clock.decisionReason).toBe('inactive')
    clock.observePlayback(playback, 100000)
    expect(clock.accept(block(112000, 0), NaN)).toBe('rejected')
    expect(clock.decisionReason).toBe('invalid-input')
    expect(clock.accept(block(112000, 0), 112100)).toBe('confirming')
    for (const value of [block(112000, 0), { ...block(124000, 1), trackId: 'other' }, block(148000, 2)]) {
      expect(clock.accept(value, 124100)).toBe('rejected')
      expect(clock.decisionReason).toBe('stale-input')
    }
    expect(clock.accept(block(124000, 1), 124100)).toBe('confirming')
    expect(clock.decisionReason).toBe('insufficient-baseline')
    expect(clock.accept(missing(136000), 136100)).toBe('rejected')
    expect(clock.decisionReason).toBe('insufficient-words')
    expect(clock.accept({ ...block(148000, 2), captureDurationMs: NaN }, 148100)).toBe('rejected')
    expect(clock.decisionReason).toBe('invalid-input')
  })

  it.each(['ambiguous', 'inconsistent-timing'] as const)('preserves the extractor rejection reason %s', reason => {
    const clock = setup(); lock(clock)
    expect(clock.accept({ ...missing(148000), reason }, 148100)).toBe('rejected')
    expect(clock.decisionReason).toBe(reason)
    expect(clock.accept(missing(160000), 160100)).toBe('rejected')
    expect(clock.decisionReason).toBe('insufficient-words')
  })

  it('distinguishes overlapping capture, contradictory timing and malformed point data', () => {
    const clock = setup(); lock(clock)
    expect(clock.accept(block(142000, 3), 142100)).toBe('rejected')
    expect(clock.decisionReason).toBe('overlapping-capture')
    clock.accept(block(154000, 3), 154100)
    const contradictory = block(166000, 4); contradictory.points[0].sourceMs += 10000
    expect(clock.accept(contradictory, 166100)).toBe('rejected')
    expect(clock.decisionReason).toBe('inconsistent-timing')
    const malformed = block(178000, 5); malformed.points[0].score = NaN
    expect(clock.accept(malformed, 178100)).toBe('rejected')
    expect(clock.decisionReason).toBe('invalid-input')
  })

  it('reports a source timing change when it invalidates evidence, then collects a new baseline', () => {
    const clock = setup(); lock(clock)
    expect(clock.accept({ ...missing(148000), lyricTimingKey: 'lyrics-b' }, 148100)).toBe('rejected')
    expect(clock.decisionReason).toBe('lyrics-changed')
    expect(clock.accept({ ...block(160000, 3), lyricTimingKey: 'lyrics-b' }, 160100)).toBe('confirming')
    expect(clock.decisionReason).toBe('insufficient-baseline')
  })

  it('reports a genuine evidence gap without treating in-budget slow inference as a gap', () => {
    const clock = setup()
    clock.accept(block(112000, 0), 126000)
    expect(clock.accept(block(160000, 1), 174000)).toBe('confirming')
    expect(clock.decisionReason).toBe('evidence-gap')
    expect(clock.accept(block(184000, 2), 198000)).toBe('confirming')
    expect(clock.decisionReason).toBe('insufficient-baseline')
    expect(clock.accept(block(208000, 3), 222000)).toBe('locked')
    expect(clock.decisionReason).toBe('matched')
  })

  it('reports an expired held anchor when an empty capture reveals expiry', () => {
    const clock = setup(); lock(clock)
    expect(clock.accept(missing(184000), 184100)).toBe('rejected')
    expect(clock.decisionReason).toBe('expired')
    expect(clock.decorate(playback, 184100)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(block(196000, 3), 196100)).toBe('confirming')
    expect(clock.decisionReason).toBe('insufficient-baseline')
  })

  it.each([.9, .96, 1, 1.04, 1.1])('fits one real onset per independent block at %.2fx without inventing block endpoints', rate => {
    const clock = setup()
    for (let index = 0; index < 3; index++) {
      const end = 112000 + index * 12000, heardMs = [2500, 7600, 9000][index]
      expect(clock.accept(block(end, index, rate, heardMs), end + 14000)).toBe(index < 2 ? 'confirming' : 'locked')
    }
    const anchor = clock.decorate(playback, 150000)?.acousticAnchor
    expect(anchor).toMatchObject({ coordinate: 'lyrics', lyricTimingKey: 'lyrics-a', observedAtMs: 133000 })
    expect(anchor?.rate).toBeCloseTo(rate, 10)
    expect(anchor?.sourcePositionMs).toBeCloseTo(50000 + 25000 * rate, 6)
    const future = anchor!.sourcePositionMs + (160000 - anchor!.observedAtMs) * anchor!.rate
    expect(future).toBeCloseTo(50000 + 52000 * rate, 6)
    expect(clock.decorate(playback, 150000)?.positionMs).toBe(playback.positionMs)
  })

  it('cannot lock from many points in one block or from two blocks', () => {
    const clock = setup(), first = block(112000, 0)
    first.points = [1000, 5000, 9000].map((heardMs, lineIndex) => ({ lineIndex, heardMs, sourceMs: 42000 + heardMs, score: .99 }))
    expect(clock.accept(first, 112100)).toBe('confirming')
    expect(clock.accept(block(136000, 3), 136100)).toBe('confirming')
    expect(clock.decorate(playback, 136100)?.acousticAnchor).toBeUndefined()
  })

  it('requires twenty seconds between real onsets, not just capture endpoints', () => {
    const clock = setup()
    expect(clock.accept(block(112000, 0, 1, 11000), 112100)).toBe('confirming')
    expect(clock.accept(block(124000, 1, 1, 7000), 124100)).toBe('confirming')
    expect(clock.accept(block(136000, 2, 1, 1000), 136100)).toBe('confirming')
    expect(clock.decorate(playback, 136100)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(block(148000, 3, 1, 1000), 148100)).toBe('locked')
  })

  it('supports in-budget slow inference and 24-second effective capture cadence without a periodic gap', () => {
    const clock = setup()
    expect(clock.accept(block(112000, 0), 126000)).toBe('confirming')
    expect(clock.accept(block(136000, 1), 150000)).toBe('confirming')
    expect(clock.accept(block(160000, 2), 174000)).toBe('locked')
    for (let now = 174000; now < 198000; now += 1000) expect(clock.decorate(playback, now)?.acousticAnchor).toBeDefined()
    expect(clock.accept(block(184000, 3), 198000)).toBe('locked')
    expect(clock.decorate(playback, 198000)?.acousticAnchor?.observedAtMs).toBe(180000)
  })

  it('does not conceal genuine expiry when old onsets and slow inference exhaust forty-eight seconds', () => {
    const clock = setup()
    clock.accept(block(112000, 0, 1, 150), 126000)
    clock.accept(block(136000, 1, 1, 150), 150000)
    expect(clock.accept(block(160000, 2, 1, 150), 174000)).toBe('locked')
    expect(clock.decorate(playback, 196149)?.acousticAnchor).toBeDefined()
    expect(clock.decorate(playback, 196150)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(block(184000, 3, 1, 150), 198000)).toBe('confirming')
  })

  it('preserves a valid fit across insufficient vocals without changing its timestamp or expiry', () => {
    const clock = setup(); lock(clock)
    const anchor = clock.decorate(playback, 136100)?.acousticAnchor
    expect(clock.accept(missing(148000), 148100)).toBe('rejected')
    expect(clock.decorate(playback, 159000)?.acousticAnchor).toEqual(anchor)
    expect(clock.accept(block(160000, 3), 160100)).toBe('locked')
    expect(clock.decorate(playback, 160100)?.acousticAnchor?.observedAtMs).toBe(156000)
  })

  it('cannot refresh a held anchor by sending repeated empty captures', () => {
    const clock = setup(); lock(clock)
    for (const end of [148000, 160000, 172000]) {
      clock.accept(missing(end), end + 100)
      expect(clock.decorate(playback, end + 100)?.acousticAnchor?.expiresAtMs).toBe(180000)
    }
    expect(clock.decorate(playback, 180000)?.acousticAnchor).toBeUndefined()
    clock.accept(missing(184000), 184100)
    expect(clock.accept(block(196000, 3), 196100)).toBe('confirming')
  })

  it('rejects nonlinear evidence instead of manufacturing an average playback rate', () => {
    const clock = setup()
    clock.accept(block(112000, 0), 112100)
    const second = block(124000, 1); second.points[0].sourceMs += 700
    clock.accept(second, 124100)
    expect(clock.accept(block(136000, 2), 136100)).toBe('rejected')
    expect(clock.decorate(playback, 136100)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(block(148000, 3), 148100)).toBe('confirming')
  })

  it.each([.96, 1.04])('keeps two minutes of noisy %.2fx onsets bounded while capture positions vary', rate => {
    const clock = setup()
    for (let index = 0; index < 11; index++) {
      const end = 112000 + index * 12000
      const value = block(end, index, rate, [3000, 7000, 9000][index % 3])
      value.points[0].sourceMs += [0, 80, -80, 30][index % 4]
      const decision = clock.accept(value, end + 4000)
      if (index < 2) { expect(decision).toBe('confirming'); continue }
      expect(decision).toBe('locked')
      const now = end + 10000, anchor = clock.decorate(playback, now)?.acousticAnchor
      expect(anchor).toBeDefined()
      const projected = anchor!.sourcePositionMs + (now - anchor!.observedAtMs) * anchor!.rate
      expect(Math.abs(projected - (50000 + (now - 108000) * rate))).toBeLessThan(250)
    }
  })

  it.each([.8, 1.2])('rejects a coherent but unsupported %.2fx rate', rate => {
    const clock = setup()
    const decisions = [112000, 124000, 136000].map((end, index) => clock.accept(block(end, index, rate), end + 100))
    expect(decisions).toContain('rejected')
    expect(decisions).not.toContain('locked')
    expect(clock.decorate(playback, 136100)?.acousticAnchor).toBeUndefined()
  })

  it('does not let a dense first capture hide one incorrectly positioned onset', () => {
    const clock = setup(), first = block(112000, 0)
    first.points = [1000, 2500, 4000, 5500, 7000, 8500].map((heardMs, lineIndex) => ({
      lineIndex, heardMs, sourceMs: 42000 + heardMs + (lineIndex === 2 ? 900 : 0), score: .99,
    }))
    expect(clock.accept(first, 112100)).toBe('confirming')
    expect(clock.accept(block(124000, 6), 124100)).toBe('confirming')
    expect(clock.accept(block(136000, 7), 136100)).toBe('rejected')
    expect(clock.decorate(playback, 136100)?.acousticAnchor).toBeUndefined()
  })

  it('immediately revokes a locked fit when a confident new onset contradicts it', () => {
    const clock = setup(); lock(clock)
    const wrong = block(148000, 3); wrong.points[0].sourceMs += 10000
    expect(clock.accept(wrong, 148100)).toBe('rejected')
    expect(clock.decorate(playback, 148100)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(block(160000, 4), 160100)).toBe('confirming')
  })

  it.each(['ambiguous', 'inconsistent-timing'] as const)('immediately clears a held fit for %s', reason => {
    const clock = setup(); lock(clock)
    expect(clock.accept({ ...missing(148000), reason }, 148100)).toBe('rejected')
    expect(clock.decorate(playback, 148100)?.acousticAnchor).toBeUndefined()
  })

  it.each([
    { lineIndex: 1 }, { lineIndex: 2 }, { lineIndex: -1 }, { lineIndex: NaN }, { lineIndex: 400 },
    { heardMs: 0 }, { heardMs: 12000 }, { sourceMs: NaN }, { sourceMs: -1 }, { sourceMs: 600001 },
    { score: .7 }, { score: 1.01 },
  ])('rejects repeated, out-of-order or malformed fresh points and revokes a lock: %j', patch => {
    const clock = setup(); lock(clock)
    const bad = block(148000, 3); Object.assign(bad.points[0], patch)
    expect(clock.accept(bad, 148100)).toBe('rejected')
    expect(clock.decorate(playback, 148100)?.acousticAnchor).toBeUndefined()
  })

  it('rejects an out-of-order group of points inside a block', () => {
    const clock = setup(); lock(clock)
    const bad = block(148000, 3)
    bad.points.push({ ...bad.points[0], lineIndex: 4, heardMs: 7000, sourceMs: bad.points[0].sourceMs + 1000 })
    expect(clock.accept(bad, 148100)).toBe('rejected')
    expect(clock.decorate(playback, 148100)?.acousticAnchor).toBeUndefined()
  })

  it('refuses overlapping captures as independent evidence', () => {
    const clock = setup(); lock(clock)
    expect(clock.accept(block(142000, 3), 142100)).toBe('rejected')
    expect(clock.decorate(playback, 142100)?.acousticAnchor).toBeUndefined()
  })

  it('ignores stale, foreign, duplicate and future replies without poisoning the next genuine block', () => {
    const clock = setup(); lock(clock)
    const anchor = clock.decorate(playback, 136100)?.acousticAnchor
    for (const bad of [missing(124000), missing(136000), { ...missing(148000), trackId: 'other' }, missing(160000)]) {
      expect(clock.accept(bad, 148100)).toBe('rejected')
      expect(clock.decorate(playback, 148100)?.acousticAnchor).toEqual(anchor)
    }
    expect(clock.accept(block(148000, 3), 148100)).toBe('locked')
  })

  it('binds the fit to one lyric version even when the changed version has no recognizable vocals', () => {
    const clock = setup(); lock(clock)
    expect(clock.accept({ ...missing(148000), lyricTimingKey: 'lyrics-b' }, 148100)).toBe('rejected')
    expect(clock.decorate(playback, 148100)?.acousticAnchor).toBeUndefined()
    expect(clock.accept({ ...block(160000, 3), lyricTimingKey: 'lyrics-b' }, 160100)).toBe('confirming')
  })

  it.each([
    { captureDurationMs: NaN }, { captureDurationMs: 3000 }, { lyricTimingKey: '' },
    { reason: 'insufficient-words', points: [{ lineIndex: 3, heardMs: 8000, sourceMs: 86000, score: .99 }] },
    { reason: 'matched', points: [] }, { points: null },
  ])('revokes current evidence for a fresh malformed observation: %j', patch => {
    const clock = setup(); lock(clock)
    expect(clock.accept({ ...block(148000, 3), ...patch } as OnsetObservation, 148100)).toBe('rejected')
    expect(clock.decorate(playback, 148100)?.acousticAnchor).toBeUndefined()
  })

  it('shortens holdover for noisy fits rather than always claiming forty-eight seconds', () => {
    const clock = setup()
    clock.accept(block(112000, 0), 112100)
    const middle = block(124000, 1); middle.points[0].sourceMs += 280
    clock.accept(middle, 124100)
    expect(clock.accept(block(136000, 2), 136100)).toBe('locked')
    const anchor = clock.decorate(playback, 136100)?.acousticAnchor
    expect(anchor?.expiresAtMs).toBeLessThan(180000)
    expect(anchor?.expiresAtMs).toBeGreaterThan(150000)
    expect(clock.decorate(playback, anchor!.expiresAtMs)?.acousticAnchor).toBeUndefined()
  })

  it.each(['pause', 'seek', 'track'] as const)('invalidates playback %s and in-flight onset replies', change => {
    const clock = setup(); lock(clock)
    const next = change === 'pause' ? { ...playback, isPlaying: false }
      : change === 'seek' ? { ...playback, positionMs: 5000, observedAtMs: 137000 }
      : { ...playback, track: { ...playback.track!, id: 'other' } }
    clock.observePlayback(next, 137000)
    expect(clock.decorate(next, 137000)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(block(148000, 3), 148100)).toBe('rejected')
  })
})
