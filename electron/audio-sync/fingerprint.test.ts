import { describe, expect, it } from 'vitest'
import { fingerprint, matchFingerprint } from './fingerprint'

const sr = 8000
// Reproducible changing harmonics; no Spotify position information is provided.
function music(seconds: number, seed = 41) {
  let random = seed
  const notes = Array.from({ length: Math.ceil(seconds * 4) + 1 }, () => {
    random = (random * 1664525 + 1013904223) >>> 0
    return 140 * 2 ** ((random % 28) / 12)
  })
  return Float32Array.from({ length: seconds * sr }, (_, i) => {
    const t = i / sr, frequency = notes[Math.floor(t * 4)]
    return .2 * (Math.sin(2 * Math.PI * frequency * t) + .5 * Math.sin(2 * Math.PI * frequency * 2 * t)
      + .3 * Math.sin(2 * Math.PI * (frequency + 170) * t))
  })
}

describe('independent acoustic alignment', () => {
  const recording = music(36)
  const reference = fingerprint(recording, sr)
  it('finds an unknown offset despite volume and fade changes', () => {
    const start = 13.35
    const query = recording.slice(start * sr, (start + 8) * sr)
    for (let i = 0; i < query.length; i++) query[i] *= .1 + .4 * i / query.length
    const result = matchFingerprint(reference, fingerprint(query, sr))
    expect(result.accepted).toBe(true)
    expect(Math.abs(result.sourceStartMs - start * 1000)).toBeLessThan(100)
    expect(Math.abs(result.rate - 1)).toBeLessThan(.01)
  })
  it('does not invent a position for silence or an unrelated song', () => {
    expect(matchFingerprint(reference, fingerprint(new Float32Array(sr * 8), sr)).reason).toBe('silence')
    expect(matchFingerprint(reference, fingerprint(music(8, 876), sr)).accepted).toBe(false)
  })
  it('rejects indistinguishable repeated choruses instead of following a time prior', () => {
    const twice = new Float32Array(recording.length * 2)
    twice.set(recording); twice.set(recording, recording.length)
    expect(matchFingerprint(fingerprint(twice, sr), fingerprint(recording.slice(sr * 10, sr * 18), sr))).toMatchObject({ accepted: false, reason: 'ambiguous' })
  })
  it('rejects insufficient audio', () => {
    expect(matchFingerprint(reference, fingerprint(recording.slice(0, sr * 3), sr)).reason).toBe('too-short')
  })
  it('rejects a sustained tone even when a short reference has no competing peak', () => {
    const tone = fingerprint(Float32Array.from({ length: sr * 12 }, (_, i) => .2 * Math.sin(2 * Math.PI * 440 * i / sr)), sr)
    expect(matchFingerprint(tone, tone)).toMatchObject({ accepted: false, reason: 'ambiguous' })
  })
  it('handles a query reaching the final reference frame without non-finite scores', () => {
    const result = matchFingerprint(reference, fingerprint(recording.slice(-sr * 8), sr))
    expect(result.accepted).toBe(true)
    expect(Number.isFinite(result.score)).toBe(true)
    expect(Math.abs(result.sourceEndMs - 36000)).toBeLessThan(100)
  })
})
