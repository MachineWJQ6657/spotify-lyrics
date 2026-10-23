import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhonemeSession, type PhonemeMatcher } from './phoneme-session'
import type { CtcLandmarkResult } from './ctc-landmarks'
import type { CtcOutput } from './ctc-tokens'
import type { VocalCapture } from '../../src/lib/vocal-sync-types'
import type { PlaybackSnapshot } from '../../src/types'
import type { analyzeJapaneseLines } from '../romanizer'

const playback: PlaybackSnapshot = { track: { id: 'song', name: '', artist: '', album: '', coverUrl: '', durationMs: 200000 },
  isPlaying: true, positionMs: 150000, observedAtMs: 100000 }
const lines = Array.from({ length: 4 }, (_, i) => ({ text: `あおぞら${i}`, startMs: 10000 + i * 12000 }))
const pcm = Float32Array.from({ length: 192000 }, (_, i) => Math.sin(i * .1) * .1)
function evidence(index = 0): CtcLandmarkResult {
  return { reason: 'hypotheses', groups: [{ heardMs: 1000, choices: [{ lineIndex: index,
    sourceMs: lines[index].startMs, role: 'eligible', score: .99 }] }], candidates: [],
    coverage: { complete: false, reasons: ['uncalibrated-acoustic-onsets'], unsupportedSpans: [],
      graphsScored: 4, graphsPrepared: 4, endTraces: 1, work: 100 } }
}
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(100000)
  const engine = { cancel: vi.fn(), recognize: vi.fn<(pcm: Float32Array, options?: { signal?: AbortSignal }) => Promise<CtcOutput>>(async () => ({} as CtcOutput)) }
  const match = vi.fn<PhonemeMatcher>(async () => evidence())
  const analyze = vi.fn<typeof analyzeJapaneseLines>(async requested => requested.map(surface_form => [{ surface_form }]))
  const session = new PhonemeSession(engine, match, analyze)
  session.observePlayback(playback); session.start('song')
  vi.setSystemTime(112000)
  const capture: VocalCapture = { trackId: 'song', language: 'ja', capturedAtMs: 112000,
    captureDurationMs: 12000, sampleRate: 16000, pcm, lines }
  return { session, engine, match, analyze, capture }
}
afterEach(() => vi.useRealTimers())

describe('continuous phoneme diagnostics ownership', () => {
  it('keeps inference timing and source readings separate from a playback clock, even when hypotheses resolve', async () => {
    const { session, engine, match, analyze, capture } = setup()
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(112000 + i * 12000); match.mockResolvedValue(evidence(i))
      const result = await session.process({ ...capture, capturedAtMs: Date.now() })
      expect(result.clockApplied).toBe(false)
      expect(result.coverageComplete).toBe(false)
      expect(result).not.toHaveProperty('rate')
      expect(result).not.toHaveProperty('anchor')
      expect(JSON.stringify(result)).not.toContain(lines[0].text)
      if (i === 2) expect(result).toMatchObject({ hypothesisDecision: 'resolved', commonRows: 3 })
    }
    expect(analyze).toHaveBeenCalledOnce()
    expect(engine.recognize).toHaveBeenCalledTimes(3)
  })
  it('uses actual capture end, not model completion, for cross-capture hypotheses', async () => {
    const { session, match, capture } = setup()
    match.mockImplementation(async () => { vi.setSystemTime(114000); return evidence() })
    expect(await session.process(capture)).toMatchObject({ clockApplied: false, elapsedMs: 2000, matchingMs: 2000 })
    expect(match.mock.calls[0][3]).toBe(12000)
  })
  it('aborts pause/seek/track changes and ignores a late model answer', async () => {
    for (const next of [{ ...playback, isPlaying: false }, { ...playback, positionMs: 10000 },
      { ...playback, track: { ...playback.track!, id: 'other' } }]) {
      const { session, engine, match, capture } = setup()
      let finish!: (value: CtcOutput) => void
      engine.recognize.mockImplementation(() => new Promise(resolve => { finish = resolve }))
      const job = session.process(capture); await Promise.resolve()
      const signal = engine.recognize.mock.calls[0][1]?.signal
      session.observePlayback(next)
      expect(signal?.aborted).toBe(true)
      finish({} as CtcOutput)
      expect(await job).toMatchObject({ clockApplied: false, reason: 'cancelled' })
      expect(match).not.toHaveBeenCalled()
    }
  })
  it('does not queue overlapping work or accept old capture after restart', async () => {
    const { session, engine, capture } = setup()
    let finish!: (value: CtcOutput) => void
    engine.recognize.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const job = session.process(capture); await Promise.resolve()
    expect((await session.process(capture)).reason).toBe('busy')
    session.start('song', 112000)
    expect((await session.process(capture)).reason).toBe('busy')
    finish({} as CtcOutput); await job
    expect((await session.process(capture)).reason).toBe('stale-input')
  })
  it('rejects an updated original and releases cached readings instead of mixing source coordinates', async () => {
    const { session, engine, capture, analyze } = setup()
    await session.process(capture); vi.setSystemTime(124000)
    const changed = { ...capture, capturedAtMs: 124000, lines: lines.map(line => ({ ...line, startMs: line.startMs + 1000 })) }
    expect((await session.process(changed)).reason).toBe('lyrics-changed')
    expect(engine.recognize).toHaveBeenCalledOnce()
    expect((await session.process(changed)).reason).toBe('inactive')
    session.start('song'); vi.setSystemTime(136000)
    await session.process({ ...changed, capturedAtMs: 136000 })
    expect(analyze).toHaveBeenCalledTimes(2)
  })
  it('bounds the full reading/model/matcher task and continues with a later fresh capture', async () => {
    const { session, engine, capture } = setup()
    engine.recognize.mockImplementationOnce((_pcm, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }))
    const pending = session.process(capture); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(15000)
    expect((await pending).reason).toBe('timeout')
    vi.setSystemTime(136000)
    expect((await session.process({ ...capture, capturedAtMs: 136000 })).reason).toBe('hypotheses')
  })
  it('does not run the heavy model for silence, unsupported languages, stale or malformed input', async () => {
    const { session, engine, analyze, capture } = setup()
    expect((await session.process({ ...capture, language: 'en' })).reason).toBe('unsupported-language')
    expect((await session.process({ ...capture, capturedAtMs: 109000 })).reason).toBe('invalid-input')
    expect((await session.process({ ...capture, lines: new Array(4) })).reason).toBe('invalid-input')
    expect((await session.process({ ...capture, pcm: new Float32Array(192000) })).reason).toBe('silence')
    expect(engine.recognize).not.toHaveBeenCalled(); expect(analyze).not.toHaveBeenCalled()
  })
  it('rejects overlapping captures and requires rearming before accepting another job', async () => {
    const { session, engine, capture } = setup()
    await session.process(capture); vi.setSystemTime(118000)
    expect((await session.process({ ...capture, capturedAtMs: 118000 })).reason).toBe('overlapping-capture')
    vi.setSystemTime(130000)
    expect((await session.process({ ...capture, capturedAtMs: 130000 })).reason).toBe('inactive')
    expect(engine.recognize).toHaveBeenCalledOnce()
  })
})
