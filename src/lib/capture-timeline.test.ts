import { describe, expect, it } from 'vitest'
import { CaptureTimeline } from './capture-timeline'

describe('PCM capture sample timeline', () => {
  it('preserves exact continuous sample spacing despite wall/render-quantum jitter', () => {
    const timeline = new CaptureTimeline()
    const ends = [12, 24, 36, 48].map((end, i) => timeline.timestamp(end - 12, end, end + .02, 100000 + (end + .02) * 1000 + [0, -5, 6, -2][i])!)
    expect(ends).toEqual([112000, 124000, 136000, 148000])
    expect(ends.slice(1).map((end, i) => end - ends[i])).toEqual([12000, 12000, 12000])
  })
  it('compensates dispatch lag, permits skipped work, but never retimes a completed block', () => {
    const timeline = new CaptureTimeline()
    expect(timeline.timestamp(0, 12, 12.5, 112500)).toBe(112000)
    expect(timeline.timestamp(24, 36, 36.8, 136800)).toBe(136000)
    expect(timeline.timestamp(24, 36, 36.8, 136800)).toBeNull()
    expect(timeline.timestamp(35, 47, 47, 147000)).toBeNull()
  })
  it('requires invalidation on wall-clock jumps, stale blocks, or device time reset', () => {
    const timeline = new CaptureTimeline()
    expect(timeline.timestamp(0, 12, 12, 112000)).toBe(112000)
    expect(timeline.timestamp(12, 24, 24, 130000)).toBeNull()
    expect(timeline.timestamp(12, 24, 26, 126000)).toBeNull()
    expect(timeline.timestamp(0, 12, 12, 112000)).toBeNull()
    timeline.reset()
    expect(timeline.timestamp(0, 12, 12, 130000)).toBe(130000)
  })
})
