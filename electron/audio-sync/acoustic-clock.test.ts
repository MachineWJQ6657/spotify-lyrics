import { describe, expect, it } from 'vitest'
import { AcousticClock, type AcousticObservation } from './acoustic-clock'
import type { PlaybackSnapshot } from '../../src/types'

const snapshot = (patch: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  track: { id: 'song', name: 'Song', artist: 'Artist', album: '', coverUrl: '', durationMs: 200000 },
  isPlaying: true, positionMs: 80000, observedAtMs: 100000, ...patch,
})
const observation = (end = 112000, patch: Partial<AcousticObservation> = {}): AcousticObservation => ({
  accepted: true, reason: 'matched', trackId: 'song', capturedAtMs: end, captureDurationMs: 12000,
  sourceStartMs: end - 80000, sourceEndMs: end - 68000, rate: 1,
  score: .95, runnerUpScore: .5, margin: .45, ...patch,
})
function setup() { const clock = new AcousticClock(); clock.observePlayback(snapshot(), 100000); return clock }
function lock(clock: AcousticClock) {
  expect(clock.accept(observation(), 112100)).toBe('confirming')
  expect(clock.accept(observation(124000), 124100)).toBe('locked')
}

describe('acoustic clock safety', () => {
  it('requires two independent blocks and does not use Spotify position as truth', () => {
    const clock = setup()
    lock(clock)
    const result = clock.decorate(snapshot(), 125000)!
    expect(result.positionMs).toBe(80000)
    expect(result.acousticAnchor?.sourcePositionMs).toBe(56000)
    expect(clock.decorate(snapshot(), 144000)?.acousticAnchor).toBeUndefined()
  })
  it('never locks on overlapping windows or a duplicated result', () => {
    const clock = setup()
    expect(clock.accept(observation(), 112100)).toBe('confirming')
    expect(clock.accept(observation(), 112100)).toBe('confirming')
    expect(clock.accept(observation(118000), 118100)).toBe('confirming')
  })
  it.each([
    { score: .7 }, { margin: .01 }, { accepted: false }, { rate: NaN },
    { trackId: 'other' }, { capturedAtMs: 90000 }, { capturedAtMs: 130000 },
    { captureDurationMs: NaN }, { captureDurationMs: 0 }, { sourceEndMs: 90000 },
  ])('rejects unsafe observations: %j', patch => {
    expect(setup().accept(observation(112000, patch), 112100)).toBe('rejected')
  })
  it('clears on seek and rejects a delayed block spanning that seek', () => {
    const clock = setup(); lock(clock)
    clock.observePlayback(snapshot({ positionMs: 5000, observedAtMs: 125000 }), 125000)
    expect(clock.decorate(snapshot(), 126000)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(observation(130000), 130100)).toBe('rejected')
    expect(clock.accept(observation(137000), 137100)).toBe('confirming')
  })
  it('invalidates even a small explicitly requested seek', () => {
    const clock = setup(); lock(clock)
    clock.clear(125000)
    expect(clock.accept(observation(130000), 130100)).toBe('rejected')
  })
  it('clears on pause and change of track', () => {
    const clock = setup(); lock(clock)
    clock.observePlayback(snapshot({ isPlaying: false }), 125000)
    expect(clock.accept(observation(140000), 140100)).toBe('rejected')
    clock.observePlayback(snapshot({ track: { ...snapshot().track!, id: 'other' } }), 141000)
    expect(clock.decorate(snapshot(), 142000)?.acousticAnchor).toBeUndefined()
    expect(clock.accept(observation(155000), 155100)).toBe('rejected')
  })
  it('does not lock when the inferred source location jumps between verses', () => {
    const clock = setup()
    clock.accept(observation(), 112100)
    expect(clock.accept(observation(124000, { sourceStartMs: 74000, sourceEndMs: 86000 }), 124100)).toBe('confirming')
    expect(clock.decorate(snapshot(), 125000)?.acousticAnchor).toBeUndefined()
  })
})
