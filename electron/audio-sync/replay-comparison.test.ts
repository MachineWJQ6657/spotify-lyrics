import { describe, expect, it } from 'vitest'
import { compareReplay, replayMediaPosition, type ReplayEvidence } from './replay-comparison'
import type { AcousticMatch } from './fingerprint'

const track = { title: 'Fixture', artist: 'Example', album: 'Album' }
const report: ReplayEvidence = { track, captures: [
  { phase: 'before', startedAtMs: 100000, endedAtMs: 112000, durationMs: 12000 },
  { phase: 'after', startedAtMs: 120000, endedAtMs: 156000, durationMs: 36000 },
], samples: [
  { ...track, phase: 'before', rawObservedAtMs: 110000, positionMs: 61000, statusName: 'PLAYING' },
  { ...track, phase: 'after', rawObservedAtMs: 140000, positionMs: 56000, statusName: 'PLAYING' },
] }
const match = (start: number, duration: number): AcousticMatch => ({ accepted: true, reason: 'matched',
  sourceStartMs: start, sourceEndMs: start + duration, rate: 1, score: .95, runnerUpScore: .5, margin: .45 })
const whole = match(12000, 12000), first = match(12000, 6000), last = match(18000, 6000)

describe('independent replay evidence', () => {
  it('measures media difference only after acoustic matching, with an explicit non-calibration result', () => {
    expect(compareReplay(report, whole, first, last)).toMatchObject({ accepted: true, mediaDifferenceMs: 3000 })
  })
  it('does not interpolate across a seek, another song, paused sample or stale reading', () => {
    expect(replayMediaPosition(report, 'after', 119000)).toBeNull()
    expect(replayMediaPosition(report, 'after', 150000)).toBeNull()
    for (const changed of [{ title: 'Other' }, { statusName: 'PAUSED' }, { phase: 'seek-back' }]) {
      const copy = { ...report, samples: report.samples.map(value => ({ ...value, ...changed })) }
      expect(compareReplay(copy, whole, first, last).accepted).toBe(false)
    }
  })
  it('rejects failed matches and mismatched halves even when the whole score is high', () => {
    expect(compareReplay(report, whole, first, { ...last, accepted: false }).accepted).toBe(false)
    expect(compareReplay(report, whole, first, match(22000, 6000)).reason).toBe('halves-disagree')
    expect(compareReplay(report, whole, first, { ...last, rate: 1.08 }).reason).toBe('halves-disagree')
  })
  it('rejects invalid timing or an endpoint outside the recorded reference', () => {
    expect(compareReplay({ ...report, captures: report.captures.map(value => ({ ...value, endedAtMs: NaN })) }, whole, first, last).accepted).toBe(false)
    expect(compareReplay(report, { ...whole, sourceEndMs: 40000 }, first, last).accepted).toBe(false)
  })
})
