import { describe, expect, it } from 'vitest'
import { prepareCtcPhraseScorer } from './ctc-phrase-scorer'
import type { CtcOutput } from './ctc-tokens'

function sample() {
  const value: CtcOutput = { vocabulary: ['<blank>', 'a', 'ka', 'N', '<unk>', 'sa'], blankId: 0,
    geometry: { sampleRate: 16000, sampleCount: 96000, strideSamples: 320, receptiveFieldSamples: 400 },
    logits: new Float32Array(299 * 6).fill(-8) }
  for (let frame = 0; frame < 299; frame++) value.logits[frame * 6] = 8
  return value
}
function label(value: CtcOutput, frame: number, id: number) {
  value.logits[frame * 6] = -8; value.logits[frame * 6 + id] = 8
}
function prepare(value: CtcOutput) {
  const result = prepareCtcPhraseScorer(value)
  if (result.reason !== 'ready') throw Error(result.reason)
  return result.scorer
}
function score(value: CtcOutput, ids: number[]) {
  const result = prepare(value).score(ids)
  if (result.reason !== 'scored') throw Error(result.reason)
  return result
}

describe('CTC constrained-phrase acoustic diagnostics', () => {
  it('fits a complete phrase against its actual frame peaks with free speech outside it', () => {
    const value = sample()
    label(value, 4, 5); label(value, 50, 1); label(value, 70, 2); label(value, 90, 3); label(value, 180, 5)
    const result = score(value, [1, 2, 3])
    expect(result.regret).toBe(0)
    expect(result.firstFrame).toBe(50); expect(result.lastFrameExclusive).toBe(91)
    expect(result.labels.map(t => [t.phone, t.frameStartMs, t.frameEndMs])).toEqual([
      ['a', 1000, 1025], ['ka', 1400, 1425], ['N', 1800, 1825],
    ])
    expect(result.activeMismatchFrames).toBe(0)
    expect(result).not.toHaveProperty('accepted')
    expect(result).not.toHaveProperty('rate')
  })
  it('cannot skip unrelated high-probability speech BETWEEN expected labels', () => {
    const value = sample(); label(value, 50, 1); label(value, 70, 5); label(value, 90, 2)
    const result = score(value, [1, 2])
    expect(result.regret).toBeGreaterThanOrEqual(16)
    expect(result.regretPerLabel).toBeGreaterThanOrEqual(8)
    // A forced alternative may be shorter; it must still expose a low-p label
    // or a disagreement with the independent greedy decoding, never accepted.
    expect(result.labels.some(t => t.peakPosterior < .01) || result.activeMismatchFrames > 0).toBe(true)
  })
  it('requires blank separation for two equal consecutive labels', () => {
    const good = sample(); label(good, 50, 1); label(good, 52, 1)
    const goodScore = score(good, [1, 1])
    expect(goodScore.regret).toBe(0)
    expect(goodScore.labels.map(t => t.firstFrame)).toEqual([50, 52])
    const continuous = sample(); label(continuous, 50, 1); label(continuous, 51, 1)
    expect(score(continuous, [1, 1]).regret).toBeGreaterThan(0)
    const three = sample(); label(three, 50, 1); label(three, 52, 1); label(three, 54, 1)
    expect(score(three, [1, 1, 1]).regret).toBe(0)
    expect(score(continuous, [1, 1, 1]).regret).toBeGreaterThan(0)
  })
  it('retains real audio edges, adjacent different labels, and receptive-field coverage', () => {
    const value = sample(); label(value, 0, 1); label(value, 1, 2)
    const initial = score(value, [1, 2])
    expect(initial.labels.map(t => t.firstFrame)).toEqual([0, 1])
    expect(initial.regret).toBe(0)
    const tail = sample(); label(tail, 298, 1)
    const final = score(tail, [1])
    expect(final.firstFrame).toBe(298)
    expect(final.lastFrameExclusive).toBe(299)
    expect(final.peakDistanceMs).toBe(0)
    expect(final.frameCoverageMs).toBe(25)
    expect(final.labels[0].frameEndMs).toBe(5985)
  })
  it('returns a mathematical low-p fit on all-blank audio, not acoustic acceptance', () => {
    const result = score(sample(), [1, 2, 3])
    expect(result.reason).toBe('scored')
    expect(result.regretPerLabel).toBe(16)
    expect(result.labels.every(t => t.peakPosterior < .001 && t.greedyFrames === 0)).toBe(true)
  })
  it('exposes repeated phrase endings rather than claiming the best one is unique', () => {
    const value = sample()
    for (const shift of [0, 100]) { label(value, 50 + shift, 1); label(value, 70 + shift, 2) }
    const result = score(value, [1, 2])
    expect(result.endRegrets[70]).toBe(0); expect(result.endRegrets[170]).toBe(0)
    expect(result).not.toHaveProperty('unique')
  })
  it('reports the actual constrained label frames even when target labels were not greedy', () => {
    const value = sample(); label(value, 50, 1); label(value, 90, 3)
    value.logits[90 * 6 + 2] = 7
    const result = score(value, [1, 2])
    expect(result.labels[1].firstFrame).toBe(90)
    expect(result.labels[1].phone).toBe('ka')
    expect(result.labels[1].greedyFrames).toBe(0)
    expect(result.labels[1].substitutionRegret).toBe(1)
    expect(result.regret).toBe(1)
    expect(result.maxLabelRegret).toBe(1)
    expect(result.blankRegret).toBe(0)
  })
  it('retains immutable input snapshots between independent candidate comparisons', () => {
    const value = sample(); label(value, 50, 1)
    const scorer = prepare(value)
    value.logits.fill(0); value.vocabulary[1] = 'changed'; value.geometry.strideSamples = 999
    const result = scorer.score([1])
    expect(result.reason === 'scored' && result.labels[0]).toMatchObject({ phone: 'a', firstFrame: 50, frameStartMs: 1000 })
  })
  it('rejects malformed and special targets and bounds the lattice work', () => {
    const scorer = prepare(sample())
    for (const target of [[], [0], [4], [99], [-1], [NaN], [1.5], new Array(1)]) expect(scorer.score(target).reason).toBe('invalid-target')
    expect(scorer.score(Array.from({ length: 129 }, () => 1)).reason).toBe('work-budget')
    const value = sample(); value.logits[1] = NaN
    expect(prepareCtcPhraseScorer(value).reason).toBe('invalid-input')
    const special = sample(); label(special, 50, 4)
    expect(prepareCtcPhraseScorer(special).reason).toBe('unsupported-label')
  })
})
