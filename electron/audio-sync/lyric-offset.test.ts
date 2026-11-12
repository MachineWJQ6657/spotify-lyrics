import { describe, expect, it } from 'vitest'
import type { CtcOutput } from './ctc-tokens'
import { alignLines, LISTEN_LEAD_MS, LyricOffsetEstimator, logSoftmax, measureWindow, median, type LineDelta, type PhoneLine } from './lyric-offset'

const VOCABULARY = ['<blank>', 'ka', 'na', 'shi', 'i', 'to', 'mo', 'ru', 'yo', 'sa', 'si', 'o', 'wo']
const id = (label: string) => VOCABULARY.indexOf(label)

/** Synthetic CTC output: blank everywhere except the given phone spans. */
function ctc(frames: number, spans: Array<[label: string, from: number, to: number]>, noise = 0): CtcOutput {
  const width = VOCABULARY.length
  const logits = new Float32Array(frames * width)
  for (let f = 0; f < frames; f += 1) {
    for (let k = 0; k < width; k += 1) logits[f * width + k] = -4 + (noise ? Math.sin(f * 7 + k * 13) * noise : 0)
    logits[f * width] = 4
  }
  for (const [label, from, to] of spans) for (let f = from; f < to; f += 1) { logits[f * width + id(label)] = 6; logits[f * width] = 0 }
  return { logits, vocabulary: VOCABULARY, blankId: 0, geometry: { sampleRate: 16000, sampleCount: (frames - 1) * 320 + 400, strideSamples: 320, receptiveFieldSamples: 400 } }
}
const sing = (start: number, phones: string[], each = 6) => phones.map((phone, index) => [phone, start + index * each, start + index * each + 4] as [string, number, number])

describe('alignLines', () => {
  it('locates each sung line and skips a line that is not in the window', () => {
    const output = ctc(500, [...sing(50, ['ka', 'na', 'shi', 'i']), ...sing(200, ['to', 'mo', 'ru', 'yo'])])
    const logp = logSoftmax(output)!
    const lines: PhoneLine[] = [
      { index: 0, startMs: 0, phones: ['ka', 'na', 'shi', 'i'] },
      { index: 1, startMs: 0, phones: ['sa', 'sa', 'sa', 'sa'] },
      { index: 2, startMs: 0, phones: ['to', 'mo', 'ru', 'yo'] },
    ]
    const result = alignLines(logp, lines)
    expect(result[0]?.onsetFrame).toBe(50)
    expect(result[1]).toBeNull()
    expect(result[2]?.onsetFrame).toBe(200)
    expect(result[0]!.score).toBeGreaterThan(-0.1)
  })

  it('keeps line order: a repeated line is matched to the occurrence after the previous line', () => {
    const output = ctc(600, [...sing(40, ['to', 'mo', 'ru', 'yo']), ...sing(150, ['ka', 'na', 'shi', 'i']), ...sing(300, ['to', 'mo', 'ru', 'yo'])])
    const result = alignLines(logSoftmax(output)!, [
      { index: 4, startMs: 0, phones: ['ka', 'na', 'shi', 'i'] },
      { index: 5, startMs: 0, phones: ['to', 'mo', 'ru', 'yo'] },
    ])
    expect(result[0]?.onsetFrame).toBe(150)
    expect(result[1]?.onsetFrame).toBe(300)
  })

  it('accepts the model spelling alternatives for し and を', () => {
    const output = ctc(300, sing(100, ['ka', 'si', 'o', 'na']))
    const [line] = alignLines(logSoftmax(output)!, [{ index: 0, startMs: 0, phones: ['ka', 'shi', 'wo', 'na'] }])
    expect(line?.onsetFrame).toBe(100)
  })

  it('rejects unknown labels and empty input instead of guessing', () => {
    const logp = logSoftmax(ctc(100, []))!
    expect(alignLines(logp, [{ index: 0, startMs: 0, phones: ['zz'] }])).toEqual([null])
    expect(alignLines(logp, [])).toEqual([])
  })
})

describe('measureWindow', () => {
  const geometry = (startMediaMs: number) => ({ startMediaMs, sampleRate: 16000, strideSamples: 320, receptiveFieldSamples: 400 })

  it('reports how far each file timestamp is from the sung onset', () => {
    // 12 s window starting at media 30 s. Line sung at frame 100 (~32.0 s).
    const output = ctc(599, [...sing(100, ['ka', 'na', 'shi', 'i']), ...sing(400, ['to', 'mo', 'ru', 'yo'])])
    const lines: PhoneLine[] = [
      { index: 3, startMs: 31_000, phones: ['ka', 'na', 'shi', 'i'] },
      { index: 4, startMs: 37_500, phones: ['to', 'mo', 'ru', 'yo'] },
      { index: 9, startMs: 90_000, phones: ['ka', 'na', 'shi', 'i'] },
    ]
    const deltas = measureWindow(output, lines, geometry(30_000))
    expect(deltas.map(item => item.index)).toEqual([3, 4])
    expect(Math.abs(deltas[0].deltaMs - 1003)).toBeLessThanOrEqual(1)
    expect(Math.abs(deltas[1].deltaMs - (30_000 + 400 * 20 + 2.5 - 37_500))).toBeLessThanOrEqual(1)
  })

  it('drops lines cut by the window edges and mismatched geometry', () => {
    const output = ctc(599, [...sing(2, ['ka', 'na', 'shi', 'i']), ...sing(590, ['to', 'mo'])])
    const lines: PhoneLine[] = [{ index: 0, startMs: 30_000, phones: ['ka', 'na', 'shi', 'i'] }, { index: 1, startMs: 41_800, phones: ['to', 'mo', 'ru', 'yo'] }]
    expect(measureWindow(output, lines, geometry(30_000))).toEqual([])
    expect(measureWindow({ ...output, geometry: { ...output.geometry, sampleCount: 1000 } }, lines, geometry(30_000))).toEqual([])
  })
})

describe('LyricOffsetEstimator', () => {
  const delta = (index: number, deltaMs: number, score = -0.2): LineDelta => ({ index, lineMs: index * 4000, sungMs: index * 4000 + deltaMs, deltaMs, score, phones: 10 })

  it('waits for enough lines from at least two windows', () => {
    const estimator = new LyricOffsetEstimator()
    expect(estimator.add([1, 2, 3, 4, 5, 6].map(i => delta(i, 900))).state).toBe('collecting')
    const decided = estimator.add([delta(7, 880), delta(8, 920)])
    expect(decided).toMatchObject({ state: 'decided', measuredDeltaMs: 900, offsetMs: 900 - LISTEN_LEAD_MS, windows: 2, lines: 8 })
  })

  it('does not correct lyrics that are already in time', () => {
    const estimator = new LyricOffsetEstimator()
    estimator.add([1, 2, 3].map(i => delta(i, 200)))
    expect(estimator.add([4, 5, 6].map(i => delta(i, 120)))).toMatchObject({ state: 'decided', offsetMs: 0 })
  })

  it('handles late lyrics with a negative offset', () => {
    const estimator = new LyricOffsetEstimator()
    estimator.add([1, 2, 3].map(i => delta(i, -700)))
    expect(estimator.add([4, 5, 6].map(i => delta(i, -680))).offsetMs).toBe(-840)
  })

  it('refuses a file whose lines do not share one offset', () => {
    const estimator = new LyricOffsetEstimator()
    let last = estimator.add([1, 2, 3].map(i => delta(i, i * 900)))
    for (let window = 0; window < 7; window += 1) last = estimator.add([delta(10 + window, window % 2 ? -2000 : 3000)])
    expect(last.state).toBe('inconsistent')
    expect(last.offsetMs).toBeUndefined()
  })

  it('counts a line seen in two overlapping windows once, keeping the better observation', () => {
    const estimator = new LyricOffsetEstimator()
    estimator.add([delta(1, 500, -0.9)])
    estimator.add([delta(1, 900, -0.1)])
    expect(estimator.observations).toHaveLength(1)
    expect(estimator.observations[0].deltaMs).toBe(900)
  })

  it('median handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})
