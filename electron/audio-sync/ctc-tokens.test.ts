import { describe, expect, it } from 'vitest'
import { decodeCtcFrames, type CtcOutput } from './ctc-tokens'

function sample(): CtcOutput {
  const vocabulary = ['<blank>', 'kyo', 'N', 'cl', '<unk>', 'SOS', 'EOS', 'u']
  const frames = 599, logits = new Float32Array(frames * vocabulary.length).fill(-8)
  for (let frame = 0; frame < frames; frame++) logits[frame * vocabulary.length] = 8
  return { geometry: { sampleRate: 16000, sampleCount: 192000, strideSamples: 320, receptiveFieldSamples: 400 }, vocabulary, blankId: 0, logits }
}
function label(value: CtcOutput, frame: number, id: number, score = 8) {
  value.logits[frame * value.vocabulary.length] = -8
  value.logits[frame * value.vocabulary.length + id] = score
}

describe('independent CTC probability-frame evidence', () => {
  it('keeps actual frame geometry instead of dividing 12 seconds into 599 invented cells', () => {
    const value = sample(); label(value, 100, 1); label(value, 101, 1); label(value, 598, 7)
    const result = decodeCtcFrames(value)
    expect(result.reason).toBe('decoded')
    expect(result.tokens.map(token => [token.phone, token.frameStartMs, token.frameEndMs])).toEqual([
      ['kyo', 2000, 2045], ['u', 11960, 11985],
    ])
    expect(result.tokens[0]).toMatchObject({ firstFrame: 100, lastFrameExclusive: 102 })
    expect(result.tokens[0]).not.toHaveProperty('timing')
    expect(result.tokens[0]).not.toHaveProperty('startMs')
  })
  it('merges consecutive runs only, preserves repeated labels separated by blank, N and cl', () => {
    const value = sample()
    for (const [frame, id] of [[20, 1], [21, 1], [23, 1], [24, 2], [25, 3]]) label(value, frame, id)
    expect(decodeCtcFrames(value).tokens.map(token => token.phone)).toEqual(['kyo', 'kyo', 'N', 'cl'])
  })
  it('uses stable softmax and retains the weakest constituent posterior', () => {
    const value = sample(); label(value, 20, 1, 10000); label(value, 21, 1, -6)
    const token = decodeCtcFrames(value).tokens[0]
    expect(token.maxPosterior).toBe(1)
    expect(token.minPosterior).toBeCloseTo(1 / (1 + 7 * Math.exp(-2)))
    expect(token.meanPosterior).toBeCloseTo((1 + token.minPosterior) / 2)
  })
  it('returns blank without inventing lexical evidence', () => {
    expect(decodeCtcFrames(sample())).toEqual({ reason: 'blank', tokens: [] })
  })
  it.each([4, 5, 6])('rejects unknown or special winning label %i instead of hiding it', id => {
    const value = sample(); label(value, 20, 1); label(value, 21, id)
    expect(decodeCtcFrames(value)).toEqual({ reason: 'unsupported-label', tokens: [] })
  })
  it.each([NaN, Infinity, -Infinity])('rejects non-finite logits %s even on a losing label', score => {
    const value = sample(); value.logits[10] = score
    expect(decodeCtcFrames(value).reason).toBe('invalid-input')
  })
  it('requires model argmax equivalence when original IDs are supplied', () => {
    const value = sample(); label(value, 100, 1)
    value.predictedIds = new BigInt64Array(599); value.predictedIds[100] = 1n
    expect(decodeCtcFrames(value).reason).toBe('decoded')
    value.predictedIds[100] = 2n
    expect(decodeCtcFrames(value).reason).toBe('invalid-input')
    value.predictedIds = new Int32Array(1)
    expect(decodeCtcFrames(value).reason).toBe('invalid-input')
  })
  it('rejects truncated, padded, oversized or argmax-only tensors', () => {
    const value = sample()
    for (const logits of [new Float32Array(0), value.logits.slice(0, -1), new Float32Array(600 * 8), new Float32Array(1_000_001)]) {
      expect(decodeCtcFrames({ ...value, logits }).reason).toBe('invalid-input')
    }
  })
  it('rejects mismatched sampling geometry or a duplicated vocabulary', () => {
    const value = sample()
    for (const patch of [{ sampleRate: 48000 }, { sampleCount: NaN }, { sampleCount: 480001 }, { strideSamples: 0 }, { receptiveFieldSamples: 1 }]) {
      expect(decodeCtcFrames({ ...value, geometry: { ...value.geometry, ...patch } }).reason).toBe('invalid-input')
    }
    expect(decodeCtcFrames({ ...value, vocabulary: ['<blank>', 'kyo', 'N', 'cl', '<unk>', 'SOS', 'EOS', 'N'] }).reason).toBe('invalid-input')
    expect(decodeCtcFrames({ ...value, blankId: 100 }).reason).toBe('invalid-input')
    const sparse = [...value.vocabulary]; delete sparse[4]
    expect(decodeCtcFrames({ ...value, vocabulary: sparse }).reason).toBe('invalid-input')
  })
})
