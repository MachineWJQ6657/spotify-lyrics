import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
const { identity, project, safetyError, preflightError, discontinuity } = createRequire(import.meta.url)('../../scripts/transition-audio-ab.cjs')
const sample = { title: 'Fixture', artist: 'Example', album: 'A', statusName: 'PLAYING', positionMs: 60000, durationMs: 240000, rawObservedAtMs: 100000 }
describe('explicit replay diagnostic safety', () => {
  it('allows only playing, fresh, same-identity samples with enough time on both sides', () => {
    expect(preflightError(sample, 101000)).toBe('')
    expect(preflightError({ ...sample, positionMs: 5000 }, 101000)).not.toBe('')
    expect(preflightError({ ...sample, positionMs: 180000 }, 101000)).not.toBe('')
    expect(safetyError(sample, 107000)).not.toBe('')
    expect(safetyError({ ...sample, statusName: 'PAUSED' }, 101000)).not.toBe('')
    expect(safetyError({ ...sample, title: 'New song' }, 101000, identity(sample))).not.toBe('')
  })
  it('detects unexpected seeks but not normal raw cadence or metadata updates', () => {
    expect(discontinuity(sample, { ...sample, positionMs: 64500, rawObservedAtMs: 104500 })).toBe(false)
    expect(discontinuity(sample, sample)).toBe(false)
    expect(discontinuity(sample, { ...sample, positionMs: 32000, rawObservedAtMs: 104500 })).toBe(true)
    expect(discontinuity(sample, { ...sample, positionMs: 120000, rawObservedAtMs: 104500 })).toBe(true)
  })
  it('never adds elapsed time to paused positions', () => {
    expect(project(sample, 101000)).toBe(61000)
    expect(project({ ...sample, statusName: 'PAUSED' }, 101000)).toBe(60000)
  })
})
