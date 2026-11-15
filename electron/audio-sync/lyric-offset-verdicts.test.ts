import { describe, expect, it, vi } from 'vitest'
import { LISTEN_MAX_WINDOWS, LISTEN_MIN_LINES, LyricOffsetEstimator, repeatedLineIndexes, type LineDelta } from './lyric-offset'
import { PhonemeSession } from './phoneme-session'
import { MIN_VERDICT_LINES } from '../../src/lib/listened-offset'

const delta = (index: number, deltaMs: number, score = -0.2): LineDelta => ({ index, lineMs: index * 4000, sungMs: index * 4000 + deltaMs, deltaMs, score, phones: 10 })

describe('a verdict needs evidence', () => {
  it('keeps collecting when too few lines were located, however many windows passed', () => {
    // A long intro and lines cut by block edges: four lines in ten windows.
    const estimator = new LyricOffsetEstimator()
    let last = estimator.add([])
    for (let window = 0; window < LISTEN_MAX_WINDOWS + 2; window += 1) last = estimator.add(window < 4 ? [delta(window, 300)] : [])
    expect(last).toMatchObject({ state: 'collecting', lines: 4 })
  })

  it('still refuses a file whose located lines disagree', () => {
    const estimator = new LyricOffsetEstimator()
    let last = estimator.add([1, 2, 3].map(index => delta(index, index * 900)))
    for (let window = 0; window < LISTEN_MAX_WINDOWS - 1; window += 1) last = estimator.add([delta(10 + window, window % 2 ? -2000 : 3000)])
    expect(last.state).toBe('inconsistent')
    expect(last.lines).toBeGreaterThanOrEqual(LISTEN_MIN_LINES)
  })

  it('uses the same line count in the renderer to tell an old few-line result from a verdict', () => {
    expect(MIN_VERDICT_LINES).toBe(LISTEN_MIN_LINES)
  })
})

describe('where the next window is searched', () => {
  it('stays wide until three located lines agree', () => {
    const estimator = new LyricOffsetEstimator()
    expect(estimator.prior).toBeUndefined()
    // One line, possibly a false match far from the truth: no narrowing.
    estimator.add([delta(1, -24_500)])
    expect(estimator.center).toBe(-24_500)
    expect(estimator.prior).toBeUndefined()
    estimator.add([delta(2, 120)])
    expect(estimator.prior).toBeUndefined()
    // Three more near 100 ms: four of five agree, the false one no longer matters.
    estimator.add([delta(3, 90), delta(4, 150), delta(5, 100)])
    expect(estimator.prior).toBeGreaterThanOrEqual(90)
    expect(estimator.prior).toBeLessThanOrEqual(150)
  })

  it('does not narrow around lines that disagree with each other', () => {
    const estimator = new LyricOffsetEstimator()
    estimator.add([delta(1, -3000), delta(2, 4000), delta(3, 9000)])
    expect(estimator.prior).toBeUndefined()
  })
})

describe('the shared recognizer', () => {
  const engine = () => ({ recognize: vi.fn(), cancel: vi.fn() })
  it('is not cancelled by an idle diagnostic session', () => {
    const recognizer = engine()
    const session = new PhonemeSession(recognizer as never, vi.fn() as never, vi.fn() as never)
    // Seeks and playback jumps clear the diagnostic session even when it is not in use.
    session.clear()
    session.observePlayback(null)
    expect(recognizer.cancel).not.toHaveBeenCalled()
  })
  it('is cancelled by the diagnostic session that owns a run', () => {
    const recognizer = engine()
    const session = new PhonemeSession(recognizer as never, vi.fn() as never, vi.fn() as never)
    session.start('song')
    session.clear()
    expect(recognizer.cancel).toHaveBeenCalledTimes(1)
  })
})

describe('words that are sung more than once', () => {
  const repeatedDelta = (index: number, deltaMs: number): LineDelta => ({ ...delta(index, deltaMs), repeated: true })

  it('are found by their phones: the same line again, or a line that opens another', () => {
    const line = (index: number, phones: string[]) => ({ index, startMs: index * 4000, phones })
    const lines = [line(0, ['ka', 'na', 'shi', 'i']), line(1, ['to', 'mo', 'ru', 'yo']), line(2, ['ka', 'na', 'shi', 'i']),
      line(3, ['to', 'mo', 'ru', 'yo', 'ka']), line(4, ['na', 'ka', 'yo', 'shi']), line(5, ['ka', 'na'])]
    // 0 and 2 are the same; 1 opens 3; 5 opens 0 and 2. Line 4 is sung once.
    expect([...repeatedLineIndexes(lines)].sort()).toEqual([0, 1, 2, 3, 5])
  })

  it('cannot decide an offset on their own: they may all sit on another repetition', () => {
    // A two-line hook sung eight times, the file 2.8 s early: every line matched
    // the previous repetition and they all agree on -2.2 s.
    const estimator = new LyricOffsetEstimator()
    estimator.add([1, 2, 3, 4].map(index => repeatedDelta(index, -2200)))
    const second = estimator.add([5, 6, 7, 8].map(index => repeatedDelta(index, -2200)))
    expect(second).toMatchObject({ state: 'collecting', lines: 8, measuredDeltaMs: -2200 })
    // They do not narrow the search either.
    expect(estimator.prior).toBeUndefined()
  })

  it('give way to lines sung once, which place themselves', () => {
    const estimator = new LyricOffsetEstimator()
    estimator.add([1, 2, 3, 4, 5, 6].map(index => repeatedDelta(index, -2200)))
    estimator.add([delta(10, 2790), delta(11, 2800), delta(12, 2810)])
    expect(estimator.prior).toBe(2800)
    const decided = estimator.add([delta(13, 2800), delta(14, 2790), delta(15, 2805)])
    // Six once-only lines from two windows decide; the six on the wrong repetition are ignored.
    expect(decided).toMatchObject({ state: 'decided', measuredDeltaMs: 2800, offsetMs: 2650 })
  })

  it('support an offset that lines sung once agree with', () => {
    const estimator = new LyricOffsetEstimator()
    estimator.add([1, 2, 3, 4].map(index => repeatedDelta(index, 900)))
    expect(estimator.add([repeatedDelta(5, 910), delta(6, 890)]).state).toBe('collecting')
    // The second once-only line agreeing with the rest is enough.
    expect(estimator.add([delta(7, 905)])).toMatchObject({ state: 'decided', measuredDeltaMs: 900 })
  })

  it('never call a file inconsistent: only lines sung once can', () => {
    const estimator = new LyricOffsetEstimator()
    let last = estimator.add([1, 2, 3].map(index => repeatedDelta(index, index * 900)))
    for (let window = 0; window < LISTEN_MAX_WINDOWS; window += 1) last = estimator.add([repeatedDelta(10 + window, window % 2 ? -2000 : 3000)])
    expect(last.state).toBe('collecting')
  })
})
