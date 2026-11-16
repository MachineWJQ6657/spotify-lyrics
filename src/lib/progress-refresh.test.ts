import { describe, expect, it } from 'vitest'
import { progressRefreshMs } from './clock'

describe('when the player bar redraws', () => {
  it('waits for the next whole second of the time text on a long song with a short bar', () => {
    // 4 min over 200 px: 1.2 s per pixel, so the time text decides.
    expect(progressRefreshMs(61_250, 240_000, 200)).toBe(750)
    expect(progressRefreshMs(61_999, 240_000, 200)).toBe(16)
  })

  it('redraws for each pixel of the bar when that comes first', () => {
    // 2 min over 800 px: 150 ms per pixel.
    expect(progressRefreshMs(10_000, 120_000, 800)).toBe(150)
  })

  it('keeps the old pace while the bar has not been measured or the length is unknown', () => {
    expect(progressRefreshMs(10_000, 240_000, 0)).toBe(160)
    expect(progressRefreshMs(10_000, 0, 600)).toBe(160)
    expect(progressRefreshMs(10_000, undefined, 600)).toBe(160)
  })

  it('never asks for a busy loop', () => {
    expect(progressRefreshMs(10_000, 1_000, 2_000)).toBe(16)
  })
})
