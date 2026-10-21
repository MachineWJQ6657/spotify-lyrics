import { describe, expect, it } from 'vitest'
import { OnsetHypotheses, type OnsetHypothesisCapture, type OnsetHypothesisChoice } from './onset-hypotheses'

const choice = (lineIndex: number, sourceMs: number, role: 'eligible' | 'veto' = 'eligible', score = .96): OnsetHypothesisChoice =>
  ({ lineIndex, sourceMs, score, role })
function block(end: number, choices: OnsetHypothesisChoice[], heardMs = 8000): OnsetHypothesisCapture {
  return { trackId: 'song', lyricTimingKey: 'source-a', capturedAtMs: end, captureDurationMs: 12000,
    groups: [{ heardMs, choices }] }
}
function setup() { const tracker = new OnsetHypotheses(); tracker.start('song', 'source-a', 100000); return tracker }
function unique(end: number, line: number, rate = 1, heardMs = 8000) {
  return block(end, [choice(line, 50000 + (end - 12000 + heardMs - 108000) * rate)], heardMs)
}
function collect(tracker: OnsetHypotheses, start = 112000, line = 0) {
  expect(tracker.receive(unique(start, line), start + 100).decision).toBe('confirming')
  expect(tracker.receive(unique(start + 12000, line + 1), start + 12100).decision).toBe('confirming')
  return tracker.receive(unique(start + 24000, line + 2), start + 24100)
}
function repeated(end: number, index: number) {
  return block(end, [choice(index, 50000 + index * 12000, 'eligible', 1), choice(index + 10, 150000 + index * 12000, 'eligible', .88)])
}

describe('bounded cross-capture onset hypotheses (not a clock)', () => {
  it('keeps repeated choruses unresolved until a later source interval selects the complete path', () => {
    const tracker = setup()
    expect(tracker.receive(repeated(112000, 0), 112100)).toMatchObject({ decision: 'confirming', reason: 'ambiguous', window: [{ points: [] }] })
    expect(tracker.receive(repeated(124000, 1), 124100)).toMatchObject({ decision: 'confirming', reason: 'ambiguous' })
    // The lower-scoring second-chorus path wins on temporal consistency, not
    // by a score tie-break or by assuming the first source occurrence.
    const result = tracker.receive(block(136000, [choice(12, 174000)]), 136100)
    expect(result.decision).toBe('resolved')
    expect(result.window.map(item => item.points[0].lineIndex)).toEqual([10, 11, 12])
    expect(result.window.map(item => item.points[0].score)).toEqual([.88, .88, .96])
    expect(result.window.map(item => item.receivedAtMs)).toEqual([112100, 124100, 136100])
    expect(result.window.map(item => item.capturedAtMs)).toEqual([112000, 124000, 136000])
    expect(result.window.every(item => item.captureDurationMs === 12000)).toBe(true)
    expect(result).not.toHaveProperty('anchor')
    expect(result).not.toHaveProperty('rate')
  })

  it('never resolves repetitions that remain a consistent translation of the entire sequence', () => {
    const tracker = setup()
    for (let index = 0; index < 6; index++) {
      const end = 112000 + index * 12000
      const result = tracker.receive(repeated(end, index), end + 100)
      expect(result.decision).toBe('confirming')
      expect(result.reason).toBe('ambiguous')
      expect(result.window.every(item => item.points.length === 0)).toBe(true)
    }
  })

  it.each([0, .05, .4, .87999, .88])('retains %.5f-scored veto paths without turning them into eligible evidence', score => {
    const tracker = setup()
    for (let index = 0; index < 3; index++) {
      const end = 112000 + index * 12000
      const result = tracker.receive(block(end, [choice(index, 50000 + index * 12000, 'eligible', 1),
        choice(index + 10, 150000 + index * 12000, 'veto', score)]), end + 100)
      expect(result).toMatchObject({ decision: 'confirming', reason: 'ambiguous' })
      expect(result.window.every(item => item.points.length === 0)).toBe(true)
    }
    const vetoOnly = setup()
    for (let index = 0; index < 3; index++) {
      const end = 112000 + index * 12000
      expect(vetoOnly.receive(block(end, [choice(index, 50000 + index * 12000, 'veto', score)]), end + 100))
        .toMatchObject({ decision: 'confirming', reason: 'ambiguous' })
    }
  })

  it('treats eligible and veto candidates for the very same mapping as unresolved, not a deduplicated vote', () => {
    const tracker = setup()
    for (let index = 0; index < 3; index++) {
      const end = 112000 + index * 12000
      const result = tracker.receive(block(end, [choice(index, 50000 + index * 12000), choice(index, 50000 + index * 12000, 'veto')]), end + 100)
      expect(result.decision).toBe('confirming')
      expect(result.window.every(item => item.points.length === 0)).toBe(true)
    }
  })

  it.each([.85, .9, 1, 1.1, 1.15])('accepts real onset order at %.2fx without outputting a fitted clock', rate => {
    const tracker = setup()
    for (let index = 0; index < 3; index++) {
      const end = 112000 + index * 12000
      expect(tracker.receive(unique(end, index, rate), end + 100).decision).toBe(index < 2 ? 'confirming' : 'resolved')
    }
  })

  it('requires three distinct evidence blocks, not several words in one clip or capture-end spacing', () => {
    const tracker = setup(), value = unique(112000, 0)
    value.groups = [1000, 5000, 9000].map((heardMs, index) => ({ heardMs, choices: [choice(index, 42000 + heardMs)] }))
    expect(tracker.receive(value, 112100).decision).toBe('confirming')
    expect(tracker.receive(block(136000, [choice(3, 74000)]), 136100).decision).toBe('confirming')
    const short = setup()
    short.receive(unique(112000, 0, 1, 11000), 112100)
    short.receive(unique(124000, 1, 1, 7000), 124100)
    expect(short.receive(unique(136000, 2, 1, 1000), 136100).decision).toBe('confirming')
    expect(short.receive(unique(148000, 3, 1, 1000), 148100).decision).toBe('resolved')
  })

  it('intersects every pair interval, including older points rather than only successive observations', () => {
    const tracker = setup()
    // Adjacent deltas each fit the allowed envelope; the cumulative 1.19x
    // delta does not fit the 24 s endpoint pair with its single ±600 ms bound.
    tracker.receive(block(112000, [choice(0, 50000)]), 112100)
    expect(tracker.receive(block(124000, [choice(1, 64280)]), 124100).decision).toBe('confirming')
    expect(tracker.receive(block(136000, [choice(2, 78560)]), 136100))
      .toMatchObject({ decision: 'rejected', reason: 'inconsistent-timing', window: [] })
    expect(tracker.receive(unique(148000, 3), 148100).window).toHaveLength(1)
  })

  it('cannot rescue reversed source or row order by choosing a plausible slope', () => {
    for (const next of [choice(0, 62000), choice(1, 49000)]) {
      const tracker = setup(); tracker.receive(unique(112000, 0), 112100)
      expect(tracker.receive(block(124000, [next]), 124100)).toMatchObject({ decision: 'rejected', reason: 'inconsistent-timing' })
      expect(tracker.receive(unique(136000, 2), 136100).window).toHaveLength(1)
    }
  })

  it('abstains and clears all history on the 129th surviving path rather than keeping a winning beam', () => {
    const tracker = setup(), value = unique(112000, 0)
    value.groups = Array.from({ length: 8 }, (_, index) => ({ heardMs: 1000 + index * 1000,
      choices: [choice(index * 2, 43000 + index * 1000), choice(index * 2 + 1, 43010 + index * 1000)] }))
    expect(tracker.receive(value, 112100)).toMatchObject({ decision: 'rejected', reason: 'path-limit', window: [] })
    expect(tracker.receive(unique(124000, 20), 124100).window).toHaveLength(1)
  })

  it('abstains on computation exhaustion even when all alternatives would remain plausible', () => {
    const tracker = setup()
    const dense = (end: number, offset: number): OnsetHypothesisCapture => ({ ...unique(end, 0),
      groups: Array.from({ length: offset === 0 ? 30 : 40 }, (_, index) => {
        const heardMs = 200 + index * 290, sourceMs = end - 12000 + heardMs - 58000
        return { heardMs, choices: offset === 0 && index < 7
          ? [choice(offset + index * 2, sourceMs), choice(offset + index * 2 + 1, sourceMs + 10)]
          : [choice(offset + index * 2, sourceMs)] }
      }) })
    expect(tracker.receive(dense(112000, 0), 112100).decision).toBe('confirming')
    expect(tracker.receive(dense(124000, 80), 124100)).toMatchObject({ decision: 'rejected', reason: 'work-budget', window: [] })
    expect(tracker.receive(unique(136000, 170), 136100).window).toHaveLength(1)
  })

  it('does not let malformed foreign, duplicate, stale or future replies poison current evidence', () => {
    const tracker = setup()
    tracker.receive(unique(112000, 0), 112100)
    for (const [value, now, reason] of [
      [{ ...unique(124000, 1), trackId: 'other', groups: null }, 124100, 'foreign-input'],
      [{ ...unique(124000, 1), lyricTimingKey: 'source-b', groups: null }, 124100, 'foreign-input'],
      [{ ...unique(112000, 0), groups: null }, 124100, 'stale-input'],
      [{ ...unique(100000, 0), groups: null }, 116000, 'stale-input'],
      [{ ...unique(148000, 0), groups: null }, 124100, 'stale-input'],
    ] as const) expect(tracker.receive(value as unknown as OnsetHypothesisCapture, now)).toMatchObject({ decision: 'rejected', reason })
    tracker.receive(unique(124000, 1), 124100)
    expect(tracker.receive(unique(136000, 2), 136100).decision).toBe('resolved')
  })

  it('keeps the original slow-inference receipt times when an older candidate becomes unique later', () => {
    const tracker = setup()
    tracker.receive(repeated(112000, 0), 126000)
    tracker.receive(repeated(124000, 1), 138000)
    const result = tracker.receive(block(136000, [choice(12, 174000)]), 150000)
    expect(result.decision).toBe('resolved')
    expect(result.window.map(item => item.receivedAtMs)).toEqual([126000, 138000, 150000])
    expect(result.window[0].capturedAtMs).toBe(112000)
    expect(150000 - result.window[0].capturedAtMs).toBeGreaterThan(15000)
  })

  it('permits the exact arrival age and future tolerance, rejecting values outside either bound', () => {
    const tracker = setup()
    expect(tracker.receive(unique(112000, 0), 127000).decision).toBe('confirming')
    expect(tracker.receive(unique(124000, 1), 139001).reason).toBe('stale-input')
    expect(tracker.receive(unique(124000, 1), 123799).reason).toBe('stale-input')
    expect(tracker.receive(unique(124000, 1), 123800).decision).toBe('confirming')
  })

  it('clears evidence on a fresh invalid block, and prevents a corrected retry from reviving that capture', () => {
    const tracker = setup(); tracker.receive(unique(112000, 0), 112100)
    const invalid = unique(124000, 1); invalid.groups[0].choices[0].score = .87999
    expect(tracker.receive(invalid, 124100)).toMatchObject({ decision: 'rejected', reason: 'invalid-input' })
    expect(tracker.receive(unique(124000, 1), 124200).reason).toBe('stale-input')
    expect(tracker.receive(unique(136000, 2), 136100).window).toHaveLength(1)
  })

  it('rejects unresolved internal phrase competitors and does not guess an internal onset', () => {
    const tracker = setup(); tracker.receive(unique(112000, 0), 112100)
    const internal = unique(124000, 1); internal.groups[0].unresolvedInternalCompetitor = true
    expect(tracker.receive(internal, 124100)).toMatchObject({ decision: 'rejected', reason: 'internal-competitor', window: [] })
    expect(tracker.receive(unique(136000, 2), 136100).window).toHaveLength(1)
  })

  it('rejects even a 1 ms overlap and clears supporting history', () => {
    const tracker = setup(); tracker.receive(unique(112000, 0), 112100)
    expect(tracker.receive(unique(123999, 1), 124100)).toMatchObject({ decision: 'rejected', reason: 'overlapping-capture' })
    expect(tracker.receive(unique(135999, 2), 136100).window).toHaveLength(1)
  })

  it('does not renew evidence through empty captures, and resets after a support gap over 36 seconds', () => {
    const tracker = setup(); expect(collect(tracker).decision).toBe('resolved')
    for (const end of [148000, 160000, 172000]) {
      expect(tracker.receive({ ...unique(end, 0), groups: [] }, end + 100).reason).toBe('insufficient-words')
    }
    expect(tracker.receive({ ...unique(184000, 0), groups: [] }, 184100).reason).toBe('evidence-gap')
    expect(tracker.receive(unique(196000, 3), 196100).window).toHaveLength(1)
    const gap = setup(); gap.receive(unique(112000, 0), 112100)
    const resumed = gap.receive(unique(160000, 1), 160100)
    expect(resumed).toMatchObject({ decision: 'confirming', reason: 'evidence-gap' })
    expect(resumed.window).toHaveLength(1)
  })

  it('does not let veto-only captures bridge a gap in positive support or renew old arrival times', () => {
    const tracker = setup(); expect(collect(tracker).decision).toBe('resolved')
    for (let index = 3; index <= 5; index++) {
      const end = 112000 + index * 12000
      const result = tracker.receive(block(end, [choice(index, 50000 + index * 12000, 'veto', 0)]), end + 100)
      // Existing positive evidence still has its original timestamps, and
      // veto-only blocks never acquire a public point of their own.
      expect(result.window.slice(0, 3).map(item => item.receivedAtMs)).toEqual([112100, 124100, 136100])
      expect(result.window.at(-1)?.points).toEqual([])
    }
    // 48 s since the last eligible support, despite an unbroken chain of veto
    // blocks. Only the new negative block can remain in the window.
    const expired = tracker.receive(block(184000, [choice(6, 122000, 'veto', .1)]), 184100)
    expect(expired).toMatchObject({ decision: 'confirming', reason: 'evidence-gap' })
    expect(expired.window).toHaveLength(1)
    const restarted = tracker.receive(unique(196000, 7), 196100)
    expect(restarted.decision).toBe('confirming')
    expect(restarted.window.filter(item => item.points.length > 0)).toHaveLength(1)
  })

  it('accepts exactly 36 seconds between eligible blocks but resets beyond that boundary', () => {
    const tracker = setup(); tracker.receive(unique(112000, 0), 112100)
    expect(tracker.receive(unique(148000, 1), 148100).window).toHaveLength(2)
    const reset = tracker.receive(unique(184001, 2), 184101)
    expect(reset).toMatchObject({ decision: 'confirming', reason: 'evidence-gap' })
    expect(reset.window).toHaveLength(1)
  })

  it('retains at most seven supporting blocks and at most 72 seconds of capture history', () => {
    const tracker = setup()
    for (let index = 0; index < 10; index++) {
      const end = 112000 + index * 12000, result = tracker.receive(unique(end, index), end + 100)
      expect(result.window.length).toBeLessThanOrEqual(7)
      expect(result.window.every(item => end - item.capturedAtMs <= 72000)).toBe(true)
      if (index >= 6) expect(result.window).toHaveLength(7)
    }
    const spaced = setup()
    for (let index = 0; index < 6; index++) {
      const end = 112000 + index * 24000
      const result = spaced.receive(unique(end, index), end + 100)
      expect(result.window.every(item => end - item.capturedAtMs <= 72000)).toBe(true)
    }
  })

  it('clear removes pause ownership, while start requires fresh post-start captures of the current source', () => {
    const tracker = setup(); expect(collect(tracker).decision).toBe('resolved')
    tracker.clear()
    expect(tracker.receive(unique(148000, 3), 148100).reason).toBe('inactive')
    tracker.start('other', 'source-b', 150000)
    expect(tracker.receive(unique(172000, 4), 172100).reason).toBe('foreign-input')
    const beforeStart = { ...unique(156000, 4), trackId: 'other', lyricTimingKey: 'source-b' }
    expect(tracker.receive(beforeStart, 156100).reason).toBe('stale-input')
    const valid = { ...unique(162000, 4), trackId: 'other', lyricTimingKey: 'source-b' }
    expect(tracker.receive(valid, 162100).window).toHaveLength(1)
    tracker.start('', 'source-b', 170000)
    expect(tracker.receive(valid, 170100).reason).toBe('inactive')
  })

  it('does not resurrect expired support after a rejected late arrival or malformed inactive replies', () => {
    const tracker = setup(); expect(collect(tracker).decision).toBe('resolved')
    expect(tracker.receive(unique(148000, 3), 200000)).toMatchObject({ decision: 'rejected', reason: 'stale-input', window: [] })
    const resumed = tracker.receive(unique(212000, 4), 212100)
    expect(resumed).toMatchObject({ decision: 'confirming', reason: 'evidence-gap' })
    expect(resumed.window).toHaveLength(1)
    tracker.clear()
    for (const value of [null, { ...unique(224000, 5), groups: null }, unique(224000, 5)]) {
      expect(tracker.receive(value as unknown as OnsetHypothesisCapture, 224100))
        .toEqual({ decision: 'rejected', reason: 'inactive', window: [] })
    }
  })

  it('snapshots caller input and returned windows so later mutations cannot rewrite accepted evidence', () => {
    const tracker = setup(), first = unique(112000, 0)
    const result = tracker.receive(first, 112100)
    first.groups[0].choices[0].lineIndex = 399
    first.groups[0].choices[0].sourceMs = 590000
    first.groups[0].heardMs = 150
    first.groups.push({ heardMs: 9000, choices: [choice(399, 600000)] })
    result.window[0].receivedAtMs = 999999
    result.window[0].points[0].sourceMs = 1
    tracker.receive(unique(124000, 1), 124100)
    const resolved = tracker.receive(unique(136000, 2), 136100)
    expect(resolved.decision).toBe('resolved')
    expect(resolved.window[0]).toMatchObject({ receivedAtMs: 112100, points: [{ lineIndex: 0, sourceMs: 50000, heardMs: 8000 }] })
  })

  it('retains only schema fields instead of copying arbitrary candidate payloads into history', () => {
    const tracker = setup(), first = unique(112000, 0)
    Object.defineProperty(first.groups[0].choices[0], 'unboundedPayload', { enumerable: true,
      get() { throw new Error('Extraneous input must not be copied or visited') } })
    expect(tracker.receive(first, 112100).decision).toBe('confirming')
    tracker.receive(unique(124000, 1), 124100)
    expect(tracker.receive(unique(136000, 2), 136100).decision).toBe('resolved')
  })

  it.each([
    (value: OnsetHypothesisCapture) => { value.captureDurationMs = 5999 },
    (value: OnsetHypothesisCapture) => { value.captureDurationMs = 15001 },
    (value: OnsetHypothesisCapture) => { value.captureDurationMs = 1000000000 },
    (value: OnsetHypothesisCapture) => { value.captureDurationMs = NaN },
    (value: OnsetHypothesisCapture) => { value.groups = Array.from({ length: 41 }, () => value.groups[0]) },
    (value: OnsetHypothesisCapture) => { value.groups = new Array(1) },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices = new Array(1) },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices = Array.from({ length: 41 }, () => choice(0, 50000)) },
    (value: OnsetHypothesisCapture) => { value.groups = Array.from({ length: 5 }, (_, index) => ({ heardMs: 1000 + index * 1000,
      choices: Array.from({ length: 40 }, () => choice(index, 50000 + index * 1000)) })) },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices = [] },
    (value: OnsetHypothesisCapture) => { value.groups[0].heardMs = 149 },
    (value: OnsetHypothesisCapture) => { value.groups[0].heardMs = 11851 },
    (value: OnsetHypothesisCapture) => { value.groups[0].heardMs = NaN },
    (value: OnsetHypothesisCapture) => { value.groups.push({ ...value.groups[0] }) },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices[0].lineIndex = 400 },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices[0].lineIndex = .5 },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices[0].sourceMs = -1 },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices[0].sourceMs = 600001 },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices[0].score = Infinity },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices[0].score = 1.01 },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices[0] = choice(1, 62000, 'veto', -.001) },
    (value: OnsetHypothesisCapture) => { value.groups[0].choices[0].role = 'unknown' as 'eligible' },
  ])('bounds all fresh candidate schema before enumeration (%#)', mutate => {
    const tracker = setup(); tracker.receive(unique(112000, 0), 112100)
    const value = unique(124000, 1); mutate(value)
    expect(tracker.receive(value, 124100)).toMatchObject({ decision: 'rejected', reason: 'invalid-input', window: [] })
    expect(tracker.receive(unique(136000, 2), 136100).window).toHaveLength(1)
  })
})
