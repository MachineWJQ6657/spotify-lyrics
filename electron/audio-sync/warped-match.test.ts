import { describe, expect, it } from 'vitest'
import type { AudioFingerprint } from './fingerprint'
import { matchWarped } from './warped-match'

// Deterministic feature-space fixtures isolate the path solver from the audio
// frontend. They are not evidence for recognition of time-stretched real music.
function referenceFeatures(): AudioFingerprint {
  const n = 1000, frames = new Float32Array(n * 96)
  let seed = 181
  const vectors = Array.from({ length: 100 }, () => {
    const vector = Float32Array.from({ length: 48 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32 - .5
    })
    return vector
  })
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i / 12), t = (i % 12) / 12
    for (let b = 0; b < 48; b++) frames[i * 96 + b] = vectors[a][b] * (1 - t) + vectors[a + 1][b] * t
  }
  return { version: 1, frames, active: new Uint8Array(n).fill(1), dimensions: 96, stepMs: 50, centerMs: 64, durationMs: 50000 }
}
function queryFeatures(reference: AudioFingerprint, position: (ms: number) => number) {
  const n = 238, frames = new Float32Array(n * 96)
  for (let i = 0; i < n; i++) {
    const index = (position(i * 50 + 64) - 64) / 50
    const left = Math.floor(index), fraction = index - left
    for (let b = 0; b < 96; b++) frames[i * 96 + b] = reference.frames[left * 96 + b] * (1 - fraction) + reference.frames[(left + 1) * 96 + b] * fraction
  }
  return { ...reference, frames, active: new Uint8Array(n).fill(1), durationMs: 12000 }
}

describe('experimental piecewise subsequence path', () => {
  const reference = referenceFeatures()
  it('tracks an offset while keeping rate constant', () => {
    const result = matchWarped(reference, queryFeatures(reference, t => 5000 + t))
    expect(result.accepted).toBe(true)
    expect(Math.abs(result.sourceStartMs - 5000)).toBeLessThan(150)
    expect(Math.abs(result.sourceEndMs - 17000)).toBeLessThan(150)
    expect(Math.abs(result.rate - 1)).toBeLessThan(.03)
  })
  it('separates endpoint speed from average speed across a tempo step', () => {
    const source = (t: number) => 5000 + Math.min(t, 6000) * .9 + Math.max(0, t - 6000) * 1.1
    const result = matchWarped(reference, queryFeatures(reference, source))
    expect(result.accepted).toBe(true)
    expect(Math.abs(result.sourceStartMs - 5000)).toBeLessThan(150)
    expect(Math.abs(result.sourceEndMs - source(12000))).toBeLessThan(150)
    expect(Math.abs(result.rate - 1.1)).toBeLessThan(.03)
    const average = (result.sourceEndMs - result.sourceStartMs) / 12000
    expect(Math.abs(average - result.rate)).toBeGreaterThan(.06)
    for (let i = 1; i < result.path.length; i++) {
      const prior = result.path[i - 1], next = result.path[i]
      const rate = (next.sourcePositionMs - prior.sourcePositionMs) / (next.captureOffsetMs - prior.captureOffsetMs)
      expect(rate).toBeGreaterThanOrEqual(.8 - 1e-8)
      expect(rate).toBeLessThanOrEqual(1.2 + 1e-8)
    }
  })
  it('does not convert silence into a nonlinear alignment', () => {
    const query = queryFeatures(reference, t => 5000 + t)
    query.active.fill(0); query.frames.fill(0)
    expect(matchWarped(reference, query)).toMatchObject({ accepted: false, reason: 'silence' })
  })
  it('rejects an indistinguishable repeated passage', () => {
    const frames = new Float32Array(reference.frames.length * 2)
    frames.set(reference.frames); frames.set(reference.frames, reference.frames.length)
    const repeated = { ...reference, frames, active: new Uint8Array(reference.active.length * 2).fill(1), durationMs: reference.durationMs * 2 }
    expect(matchWarped(repeated, queryFeatures(reference, t => 5000 + t))).toMatchObject({ accepted: false, reason: 'ambiguous' })
  })
  it('rejects a late silent endpoint despite a matching prefix', () => {
    const query = queryFeatures(reference, t => 5000 + t)
    query.active.fill(0, query.active.length - 40)
    query.frames.fill(0, query.frames.length - 40 * 96)
    expect(matchWarped(reference, query).accepted).toBe(false)
  })
  it('rejects malformed feature dimensions before allocating a cost matrix', () => {
    expect(() => matchWarped(reference, { ...reference, frames: new Float32Array(0) })).toThrow('bounds')
  })
  it('rejects non-finite input rather than turning it into a plausible path', () => {
    const query = queryFeatures(reference, t => 5000 + t)
    query.frames[0] = NaN
    expect(() => matchWarped(reference, query)).toThrow('Non-finite')
  })
})
