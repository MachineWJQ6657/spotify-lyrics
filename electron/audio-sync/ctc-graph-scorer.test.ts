import { describe, expect, it } from 'vitest'
import { prepareCtcGraphScorer, type CtcGraphScoreOptions, type CtcPhoneGraph } from './ctc-graph-scorer'
import { prepareCtcPhraseScorer } from './ctc-phrase-scorer'
import type { CtcOutput } from './ctc-tokens'

function sample(): CtcOutput {
  const value: CtcOutput = { vocabulary: ['<blank>', 'a', 'ka', 'N', '<unk>', 'sa'], blankId: 0,
    geometry: { sampleRate: 16000, sampleCount: 96000, strideSamples: 320, receptiveFieldSamples: 400 },
    logits: new Float32Array(299 * 6).fill(-8) }
  for (let frame = 0; frame < 299; frame++) value.logits[frame * 6] = 8
  return value
}
function label(value: CtcOutput, frame: number, id: number) {
  value.logits[frame * value.vocabulary.length] = -8
  value.logits[frame * value.vocabulary.length + id] = 8
}
function linear(ids: number[]): CtcPhoneGraph {
  return { nodes: ids.map((phoneId, index) => ({ phoneId, previous: index ? [index - 1] : [] })), finalNodes: [ids.length - 1] }
}
function prepare(value: CtcOutput) {
  const result = prepareCtcGraphScorer(value)
  if (result.reason !== 'ready') throw Error(result.reason)
  return result.scorer
}
function score(value: CtcOutput, graph: CtcPhoneGraph) {
  const result = prepare(value).score(graph)
  if (result.reason !== 'scored') throw Error(result.reason)
  return result
}
function enumerate(graph: CtcPhoneGraph): number[][] {
  const visit = (id: number): number[][] => !graph.nodes[id].previous.length ? [[graph.nodes[id].phoneId]]
    : graph.nodes[id].previous.flatMap(parent => visit(parent).map(path => [...path, graph.nodes[id].phoneId]))
  return graph.finalNodes.flatMap(visit)
}

describe('CTC pronunciation DAG mathematical scoring', () => {
  it('matches every diagnostic of an unbranched phrase and retains real frame geometry', () => {
    const value = sample(); label(value, 4, 5); label(value, 50, 1); label(value, 70, 2); label(value, 90, 3); label(value, 180, 5)
    const phrase = prepareCtcPhraseScorer(value)
    if (phrase.reason !== 'ready') throw Error(phrase.reason)
    const expected = phrase.scorer.score([1, 2, 3])
    if (expected.reason !== 'scored') throw Error(expected.reason)
    const result = score(value, linear([1, 2, 3]))
    expect(result.regret).toBe(expected.regret)
    expect(result.labels.map(({ nodeId: _, ...item }) => item)).toEqual(expected.labels)
    for (const field of ['pathLogProbability', 'firstFrame', 'lastFrameExclusive', 'frameCoverageMs', 'peakDistanceMs',
      'activeMismatchFrames', 'activeMismatchRegret', 'blankRegret', 'maxLabelRegret'] as const) expect(result[field]).toBe(expected[field])
    expect(result.endRegrets).toEqual(expected.endRegrets)
    expect(result.pathNodeIds).toEqual([0, 1, 2])
    expect(result.regret).toBe(result.labelRegret + result.blankRegret)
    expect(result).not.toHaveProperty('accepted'); expect(result).not.toHaveProperty('unique')
    expect(result).not.toHaveProperty('rate'); expect(result).not.toHaveProperty('onset')
  })

  it('covers simultaneous changes in two independent dictionary alternatives', () => {
    const graph: CtcPhoneGraph = { nodes: [
      { phoneId: 1, previous: [] }, { phoneId: 2, previous: [0] }, { phoneId: 3, previous: [0] },
      { phoneId: 5, previous: [1, 2] }, { phoneId: 2, previous: [3] }, { phoneId: 3, previous: [3] },
      { phoneId: 1, previous: [4, 5] },
    ], finalNodes: [6] }
    const value = sample()
    for (const [frame, id] of [[40, 1], [60, 3], [80, 5], [100, 2], [120, 1]]) label(value, frame, id)
    const result = score(value, graph)
    expect(result.regret).toBe(0)
    expect(result.pathNodeIds).toEqual([0, 2, 3, 4, 6])
    expect(result.labels.map(item => item.firstFrame)).toEqual([40, 60, 80, 100, 120])
    expect(enumerate(graph)).toHaveLength(4)
  })

  it('has exactly the best exhaustive linear-path cost at every terminal frame', () => {
    const graph: CtcPhoneGraph = { nodes: [
      { phoneId: 1, previous: [] }, { phoneId: 1, previous: [0] }, { phoneId: 2, previous: [0] },
      { phoneId: 2, previous: [1, 2] }, { phoneId: 3, previous: [1, 2] },
      { phoneId: 5, previous: [3, 4] }, { phoneId: 1, previous: [] }, { phoneId: 3, previous: [6] },
    ], finalNodes: [5, 7] }
    // Multiple deterministic random inputs exercise non-greedy and blank paths,
    // not only an easy hand-selected zero-cost pronunciation.
    let seed = 104729
    for (let trial = 0; trial < 5; trial++) {
      const value = sample()
      for (let i = 0; i < value.logits.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        value.logits[i] = i % 6 === 4 ? -20 : (seed % 4000) / 1000 - 2
      }
      const phrase = prepareCtcPhraseScorer(value)
      if (phrase.reason !== 'ready') throw Error(phrase.reason)
      const alternatives = enumerate(graph).map(ids => phrase.scorer.score(ids))
      if (alternatives.some(item => item.reason !== 'scored')) throw Error('linear scoring failed')
      const scored = alternatives.filter(item => item.reason === 'scored')
      const result = score(value, graph)
      expect(result.regret).toBe(Math.min(...scored.map(item => item.regret)))
      for (let frame = 0; frame < 299; frame++) expect(result.endRegrets[frame]).toBe(Math.min(...scored.map(item => item.endRegrets[frame])))
      expect(result.regret).toBeCloseTo(result.labelRegret + result.blankRegret, 10)
      expect(enumerate(graph)).toContainEqual(result.labels.map(item => item.id))
    }
  })

  it('requires an actual blank between equal labels across a branch join', () => {
    const graph: CtcPhoneGraph = { nodes: [
      { phoneId: 1, previous: [] }, { phoneId: 2, previous: [] }, { phoneId: 1, previous: [0, 1] },
    ], finalNodes: [2] }
    const good = sample(); label(good, 50, 1); label(good, 52, 1)
    expect(score(good, graph)).toMatchObject({ regret: 0, pathNodeIds: [0, 2] })
    const continuous = sample(); label(continuous, 50, 1); label(continuous, 51, 1)
    expect(score(continuous, graph).regret).toBeGreaterThan(0)
    const different = sample(); label(different, 50, 2); label(different, 51, 1)
    expect(score(different, graph)).toMatchObject({ regret: 0, pathNodeIds: [1, 2] })
  })

  it('never returns from a node own blank to emit an unrepresented duplicate', () => {
    const value = sample(); label(value, 50, 1); label(value, 80, 1); label(value, 100, 2)
    const result = score(value, linear([1, 2]))
    // A free root may begin at the second a, but it may not score both separate
    // a runs as one label without paying for the intervening blank frames.
    expect(result.regret).toBe(0)
    expect(result.labels[0]).toMatchObject({ firstFrame: 80, lastFrameExclusive: 81 })
    expect(result.labels[0].greedyFrames).toBe(1)
  })

  it('traces original node identifiers even when nodes are not topologically ordered', () => {
    const graph: CtcPhoneGraph = { nodes: [
      { phoneId: 3, previous: [2] }, { phoneId: 1, previous: [] }, { phoneId: 2, previous: [1] },
    ], finalNodes: [0] }
    const value = sample(); label(value, 0, 1); label(value, 1, 2); label(value, 2, 3)
    expect(score(value, graph)).toMatchObject({ regret: 0, firstFrame: 0, lastFrameExclusive: 3, pathNodeIds: [1, 2, 0] })
    const tail = sample(); label(tail, 298, 1)
    expect(score(tail, linear([1]))).toMatchObject({ firstFrame: 298, lastFrameExclusive: 299, frameCoverageMs: 25 })
  })

  it('does not treat a temporarily unreachable predecessor as a free root', () => {
    const value = sample(); label(value, 50, 2)
    const graph: CtcPhoneGraph = { nodes: [{ phoneId: 1, previous: [] }, { phoneId: 2, previous: [0] }], finalNodes: [1] }
    const result = score(value, graph)
    expect(result.regret).toBeGreaterThan(0)
    expect(result.endRegrets[0]).toBe(Infinity)
    expect(result.endNodeIds[0]).toBe(-1)
    expect(result.labels.map(item => item.id)).toEqual([1, 2])
  })

  it('retains competing terminal frames and the final-phone identity without claiming uniqueness', () => {
    const value = sample(); label(value, 50, 1); label(value, 70, 2); label(value, 150, 1); label(value, 170, 3)
    const result = score(value, { nodes: [{ phoneId: 1, previous: [] }, { phoneId: 2, previous: [0] },
      { phoneId: 3, previous: [0] }], finalNodes: [1, 2] })
    expect(result.endRegrets[70]).toBe(0); expect(result.endNodeIds[70]).toBe(1)
    expect(result.endRegrets[170]).toBe(0); expect(result.endNodeIds[170]).toBe(2)
    expect(result).not.toHaveProperty('unique')
  })

  it('traces separate real occurrences at requested terminal frames without changing terminal costs', () => {
    const value = sample(), graph = linear([1, 2]), scorer = prepare(value)
    // Re-prepare after filling, because scorer inputs intentionally snapshot.
    for (const shift of [0, 100]) { label(value, 50 + shift, 1); label(value, 70 + shift, 2) }
    const repeated = prepare(value)
    const initial = repeated.score(graph), first = repeated.score(graph, { endFrame: 70 }), second = repeated.score(graph, { endFrame: 170 })
    if (initial.reason !== 'scored' || first.reason !== 'scored' || second.reason !== 'scored') throw Error('repeated scoring failed')
    expect(initial).toMatchObject({ regret: 0, firstFrame: 50, lastFrameExclusive: 71 })
    expect(first).toMatchObject({ regret: 0, firstFrame: 50, lastFrameExclusive: 71 })
    expect(second).toMatchObject({ regret: 0, firstFrame: 150, lastFrameExclusive: 171 })
    expect(second.labels.map(item => item.firstFrame)).toEqual([150, 170])
    expect(second.endRegrets).toEqual(initial.endRegrets); expect(second.endNodeIds).toEqual(initial.endNodeIds)
    expect(first.endRegrets).toEqual(initial.endRegrets); expect(first.endNodeIds).toEqual(initial.endNodeIds)
    expect(second).not.toHaveProperty('unique'); expect(second).not.toHaveProperty('accepted')
    // Also exercise a reachable but non-optimal requested ending.
    const forcedEnd = repeated.score(graph, { endFrame: 100 })
    if (forcedEnd.reason !== 'scored') throw Error(forcedEnd.reason)
    expect(forcedEnd.lastFrameExclusive).toBe(101)
    expect(forcedEnd.regret).toBe(initial.endRegrets[100]); expect(forcedEnd.regret).toBeGreaterThan(0)
    expect(forcedEnd.regret).toBeCloseTo(forcedEnd.labelRegret + forcedEnd.blankRegret, 10)
    expect(scorer.score(graph, { endFrame: 0 }).reason).toBe('unreachable')
    expect(repeated.score(graph, {}).reason).toBe('scored')
    expect(repeated.score(graph, undefined)).toEqual(initial)
  })

  it('retains all exact-tie start extrema inside one reading and across reading/final branches', () => {
    const value = sample(); label(value, 50, 1); label(value, 100, 2)
    // a and blank tie at frame 80: an earlier phrase can traverse blank there,
    // or another equally good phrase may begin there. Its end is the SAME ka.
    value.logits[80 * 6 + 1] = 8
    const result = prepare(value).score(linear([1, 2]), { endFrame: 100 })
    if (result.reason !== 'scored') throw Error(result.reason)
    expect(result.regret).toBe(0)
    expect(result.firstFrameRange).toEqual({ earliest: 50, latest: 80 })
    expect(result.firstFrame).toBeGreaterThanOrEqual(result.firstFrameRange.earliest)
    expect(result.firstFrame).toBeLessThanOrEqual(result.firstFrameRange.latest)
    expect(result.endFirstFramesEarliest[0]).toBe(-1); expect(result.endFirstFramesLatest[0]).toBe(-1)
    expect(result.endFirstFramesEarliest[100]).toBe(50); expect(result.endFirstFramesLatest[100]).toBe(80)

    const alternatives = sample(); label(alternatives, 50, 1); label(alternatives, 100, 2)
    alternatives.logits[80 * 6 + 3] = 8
    const branched = prepare(alternatives).score({ nodes: [{ phoneId: 1, previous: [] }, { phoneId: 3, previous: [] },
      { phoneId: 2, previous: [0, 1] }], finalNodes: [2] }, { endFrame: 100 })
    if (branched.reason !== 'scored') throw Error(branched.reason)
    expect(branched.firstFrameRange).toEqual({ earliest: 50, latest: 80 })
    // Distinct final nodes must also contribute equally optimal starts.
    const finals = prepare(alternatives).score({ nodes: [{ phoneId: 1, previous: [] }, { phoneId: 2, previous: [0] },
      { phoneId: 3, previous: [] }, { phoneId: 2, previous: [2] }], finalNodes: [1, 3] }, { endFrame: 100 })
    if (finals.reason !== 'scored') throw Error(finals.reason)
    expect(finals.firstFrameRange).toEqual({ earliest: 50, latest: 80 })
  })

  it('does not silently treat near-cost starts as exact ties', () => {
    const value = sample(); label(value, 50, 1); label(value, 100, 2)
    value.logits[80 * 6 + 1] = 7.9999
    const earlier = prepare(value).score(linear([1, 2]), { endFrame: 100 })
    if (earlier.reason !== 'scored') throw Error(earlier.reason)
    expect(earlier.firstFrameRange).toEqual({ earliest: 50, latest: 50 })
    value.logits[50 * 6] = 8; value.logits[50 * 6 + 1] = 7.9999
    value.logits[80 * 6 + 1] = 8
    const later = prepare(value).score(linear([1, 2]), { endFrame: 100 })
    if (later.reason !== 'scored') throw Error(later.reason)
    expect(later.firstFrameRange).toEqual({ earliest: 80, latest: 80 })
  })

  it('matches independent exhaustive alignment paths for exact-tie first-frame ranges', () => {
    const graphs: CtcPhoneGraph[] = [linear([1, 2]), linear([1, 1]), { nodes: [
      { phoneId: 1, previous: [] }, { phoneId: 1, previous: [0] }, { phoneId: 2, previous: [] },
      { phoneId: 3, previous: [1, 2] },
    ], finalNodes: [1, 3] }]
    let seed = 12345
    for (let trial = 0; trial < 8; trial++) {
      const value = sample(), shortFrames = 7
      for (let frame = 0; frame < shortFrames; frame++) for (let id = 0; id < 6; id++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        value.logits[frame * 6 + id] = id === 4 ? -8 : seed % 3
      }
      for (const graph of graphs) {
        // Enumerate graph paths AND all state histories, not just the one
        // witness returned by a second Viterbi implementation.
        const histories: Array<{ frame: number; cost: number; first: number }> = []
        for (const ids of enumerate(graph)) {
          const walk = (frame: number, state: number, first: number, cost: number) => {
            if (frame >= shortFrames) return
            const next = [state]
            if (state === 0) next.push(1)
            else if (state % 2) {
              if (state < ids.length * 2 - 1) {
                next.push(state + 1)
                if (ids[(state - 1) / 2] !== ids[(state + 1) / 2]) next.push(state + 2)
              }
            } else next.push(state + 1)
            for (const step of next) {
              if (!step) { walk(frame + 1, 0, -1, 0); continue }
              const id = step % 2 ? ids[(step - 1) / 2] : 0
              const maximum = Math.max(...value.logits.slice(frame * 6, frame * 6 + 6))
              const nextCost = cost + maximum - value.logits[frame * 6 + id], nextFirst = first < 0 ? frame : first
              if (step === ids.length * 2 - 1) histories.push({ frame, cost: nextCost, first: nextFirst })
              walk(frame + 1, step, nextFirst, nextCost)
            }
          }
          walk(0, 0, -1, 0)
        }
        const result = prepare(value).score(graph)
        if (result.reason !== 'scored') throw Error(result.reason)
        for (let frame = 0; frame < shortFrames; frame++) {
          const endings = histories.filter(item => item.frame === frame), best = Math.min(...endings.map(item => item.cost))
          const optimal = endings.filter(item => item.cost === best)
          expect(result.endRegrets[frame]).toBe(best)
          expect(result.endFirstFramesEarliest[frame]).toBe(optimal.length ? Math.min(...optimal.map(item => item.first)) : -1)
          expect(result.endFirstFramesLatest[frame]).toBe(optimal.length ? Math.max(...optimal.map(item => item.first)) : -1)
        }
      }
    }
  })

  it('validates requested terminal frames and rejects unknown score options', () => {
    const scorer = prepare(sample()), graph = linear([1])
    const bad: unknown[] = [null, [], 0, '70', { endFrame: -1 }, { endFrame: 299 }, { endFrame: .5 },
      { endFrame: NaN }, { endFrame: Infinity }, { endFrame: undefined }, { endFrame: '70' },
      { endFrame: 70, unknown: true }, { unknown: true }, { [Symbol('hidden')]: true },
      Object.create({ endFrame: 70 }),
    ]
    for (const options of bad) expect(scorer.score(graph, options as CtcGraphScoreOptions).reason).toBe('invalid-target')
    expect(scorer.score(graph, { endFrame: 0 })).toMatchObject({ reason: 'scored', lastFrameExclusive: 1 })
    expect(scorer.score(graph, { endFrame: 298 })).toMatchObject({ reason: 'scored', lastFrameExclusive: 299 })
  })

  it('reports weak forced labels and separate label/blank penalties', () => {
    const value = sample(); label(value, 50, 1); label(value, 51, 5); label(value, 52, 1)
    // A repeated target must emit blank, which disagrees with greedy sa.
    const result = score(value, linear([1, 1]))
    expect(result.regret).toBeGreaterThan(0)
    expect(result.regret).toBe(result.labelRegret + result.blankRegret)
    const silent = score(sample(), linear([1, 2]))
    expect(silent.labelRegret).toBe(32); expect(silent.blankRegret).toBe(0)
    expect(silent.labels.every(item => item.peakPosterior < .001 && item.greedyFrames === 0)).toBe(true)
  })

  it('does not mistake a zero-regret fit on flat logits for acoustic acceptance', () => {
    const value = sample(); value.logits.fill(0)
    const result = score(value, linear([1, 2, 3, 5]))
    // The unconstrained best logit and every forced logit tie. Relative cost
    // is zero even though no phone has independent high-posterior evidence.
    expect(result.regret).toBe(0)
    expect(result.labels.every(item => item.greedyFrames === 0)).toBe(true)
    for (const item of result.labels) expect(item.peakPosterior).toBeCloseTo(1 / value.vocabulary.length)
    expect(result).not.toHaveProperty('accepted'); expect(result).not.toHaveProperty('unique')
    expect(result).not.toHaveProperty('confidence'); expect(result).not.toHaveProperty('onsetMs')
  })

  it('snapshots logits, geometry, vocabulary and produces independent output arrays', () => {
    const value = sample(); label(value, 50, 1)
    const scorer = prepare(value), graph = linear([1])
    value.logits.fill(0); value.vocabulary[1] = 'mutated'; value.geometry.strideSamples = 999
    const first = scorer.score(graph)
    if (first.reason !== 'scored') throw Error(first.reason)
    first.endRegrets.fill(-999); first.endNodeIds.fill(999); first.labels[0].phone = 'changed'; first.pathNodeIds[0] = 999
    first.endFirstFramesEarliest.fill(999); first.endFirstFramesLatest.fill(999); first.firstFrameRange.earliest = 999
    const second = scorer.score(graph)
    if (second.reason !== 'scored') throw Error(second.reason)
    expect(second.labels[0]).toMatchObject({ nodeId: 0, phone: 'a', firstFrame: 50, frameStartMs: 1000 })
    expect(second.endRegrets[50]).toBe(0); expect(second.endNodeIds[50]).toBe(0); expect(second.pathNodeIds).toEqual([0])
    expect(second.firstFrameRange).toEqual({ earliest: 50, latest: 50 })
    expect(second.endFirstFramesEarliest[50]).toBe(50); expect(second.endFirstFramesLatest[50]).toBe(50)
  })

  it('rejects cycles, self/duplicate/bad edges, missing finals, special labels and wildcard nodes', () => {
    const scorer = prepare(sample())
    const bad: unknown[] = [null, {}, { nodes: [], finalNodes: [] },
      { nodes: [{ phoneId: 1, previous: [0] }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [1] }, { phoneId: 2, previous: [0] }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [] }, { phoneId: 2, previous: [0, 0] }], finalNodes: [1] },
      { nodes: [{ phoneId: 1, previous: [99] }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [] }], finalNodes: [] },
      { nodes: [{ phoneId: 1, previous: [] }], finalNodes: [1] },
      { nodes: [{ phoneId: 1, previous: [] }], finalNodes: [0, 0] },
      { nodes: [{ phoneId: 1, previous: new Array(1) }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [] }], finalNodes: new Array(1) },
      { nodes: [{ phoneId: 1, previous: [NaN] }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [Infinity] }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [], kind: 'wildcard' }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [], kind: 'unknown-word' }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [], unknownWord: 'something' }], finalNodes: [0] },
      { nodes: [{ phoneId: 1, previous: [], wildcard: true }], finalNodes: [0] },
    ]
    for (const phoneId of [0, 4, -1, 99, NaN, 1.5]) bad.push({ nodes: [{ phoneId, previous: [] }], finalNodes: [0] })
    for (const graph of bad) expect(scorer.score(graph as CtcPhoneGraph).reason).toBe('invalid-target')
    const nan = sample(); nan.logits[1] = NaN
    expect(prepareCtcGraphScorer(nan).reason).toBe('invalid-input')
    const special = sample(); label(special, 50, 4)
    expect(prepareCtcGraphScorer(special).reason).toBe('unsupported-label')
  })

  it('bounds graph size, edge count and combined lattice work without enumerating paths', () => {
    const scorer = prepare(sample())
    expect(scorer.score(linear(Array.from({ length: 256 }, (_, i) => i % 2 ? 2 : 1))).reason).toBe('scored')
    expect(scorer.score(linear(Array(257).fill(1))).reason).toBe('work-budget')
    const dense: CtcPhoneGraph = { nodes: Array.from({ length: 50 }, (_, i) => ({ phoneId: 1,
      previous: Array.from({ length: i }, (_, j) => j) })), finalNodes: [49] }
    expect(scorer.score(dense).reason).toBe('work-budget')
    const value = sample()
    value.geometry = { sampleRate: 16000, sampleCount: 480000, strideSamples: 80, receptiveFieldSamples: 400 }
    const frames = Math.floor((480000 - 400) / 80) + 1
    value.logits = new Float32Array(frames * 6).fill(-8)
    for (let frame = 0; frame < frames; frame++) value.logits[frame * 6] = 8
    const large = prepare(value)
    expect(large.score(linear(Array(90).fill(1))).reason).toBe('work-budget')
    const manyEdges: CtcPhoneGraph = { nodes: Array.from({ length: 80 }, (_, i) => ({ phoneId: 1,
      previous: Array.from({ length: Math.min(5, i) }, (_, j) => i - j - 1) })), finalNodes: [79] }
    expect(frames * (manyEdges.nodes.length * 2 + 1)).toBeLessThan(1_000_000)
    expect(large.score(manyEdges).reason).toBe('work-budget')
    // 60 independent two-way choices represent 2^60 readings in 181 nodes.
    const nodes: CtcPhoneGraph['nodes'][number][] = [{ phoneId: 1, previous: [] }]
    for (let group = 0; group < 60; group++) {
      const parent = nodes.length - 1, first = nodes.length
      nodes.push({ phoneId: 2, previous: [parent] }, { phoneId: 3, previous: [parent] }, { phoneId: 1, previous: [first, first + 1] })
    }
    expect(scorer.score({ nodes, finalNodes: [nodes.length - 1] }).reason).toBe('scored')
  })

  it('reports unreachable paths requiring more real equal-label blank frames than available', () => {
    expect(prepare(sample()).score(linear(Array(200).fill(1))).reason).toBe('unreachable')
  })
})
