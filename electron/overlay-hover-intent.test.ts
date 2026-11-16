import { describe, expect, it } from 'vitest'
import { advanceHoverIntent, HOVER_IDLE_MS, HOVER_OUTSIDE, HOVER_REST_MS, type HoverIntent } from './overlay-hover-intent'

/** Feeds samples every 24 ms (the near-overlay poll) along a path; returns the result after each. */
function run(path: Array<{ x: number; y: number; over: boolean }>, start = HOVER_OUTSIDE, stepMs = 24) {
  let state: HoverIntent = start
  return path.map((point, index) => {
    const result = advanceHoverIntent(state, 1000 + index * stepMs, point, point.over)
    state = result.state
    return result
  })
}
const still = (count: number, x = 300, y = 60) => Array.from({ length: count }, () => ({ x, y, over: true }))

describe('when the pointer over the lyrics opens the control bar', () => {
  it('does not open it for a pointer crossing the lyrics', () => {
    // 140 px tall overlay crossed in about 300 ms on the way to another window.
    const crossing = Array.from({ length: 14 }, (_, index) => ({ x: 300 + index * 4, y: index * 10, over: index > 0 && index < 13 }))
    expect(run(crossing).some(result => result.ready)).toBe(false)
  })

  it('does not open it while the pointer keeps moving over the lyrics', () => {
    const wandering = Array.from({ length: 60 }, (_, index) => ({ x: 200 + index * 8, y: 60, over: true }))
    expect(run(wandering).some(result => result.ready)).toBe(false)
  })

  it('opens it once the pointer rests there for half a second', () => {
    const results = run([{ x: 280, y: 40, over: false }, { x: 295, y: 55, over: true }, { x: 300, y: 60, over: true }, ...still(40)])
    const first = results.findIndex(result => result.ready)
    expect(first).toBeGreaterThan(0)
    // 24 ms samples: ready on the first sample at least HOVER_REST_MS after coming to rest.
    expect((first - 2) * 24).toBeGreaterThanOrEqual(HOVER_REST_MS - 24)
    expect((first - 2) * 24).toBeLessThan(HOVER_REST_MS + 48)
  })

  it('treats a few pixels of hand jitter as resting', () => {
    const jitter = Array.from({ length: 40 }, (_, index) => ({ x: 300 + (index % 3) * 2, y: 60 + (index % 2) * 3, over: true }))
    expect(run([{ x: 360, y: 90, over: false }, { x: 330, y: 75, over: true }, ...jitter]).some(result => result.ready)).toBe(true)
  })

  it('does not open it when the lyrics grow or reappear under a pointer parked there', () => {
    // Parked at (300, 60) while the user types underneath; the hit region
    // comes and goes with each line (a short line, a long one, the title card).
    const flicker = Array.from({ length: 300 }, (_, index) => ({ x: 300, y: 60, over: Math.floor(index / 40) % 2 === 1 }))
    expect(run(flicker).some(result => result.ready)).toBe(false)
  })

  it('does not open it for a pointer that was already resting there when the overlay appeared', () => {
    expect(run(still(60)).some(result => result.ready)).toBe(false)
  })

  it('lets a parked pointer close the bar again, and keeps it closed until the pointer moves', () => {
    const parked = run([{ x: 250, y: 30, over: false }, ...still(Math.ceil(HOVER_IDLE_MS / 24) + 30)])
    expect(parked.some(result => result.ready)).toBe(true)
    const idleAt = parked.findIndex(result => result.idle)
    expect(idleAt).toBeGreaterThan(0)
    expect(parked.slice(idleAt).every(result => !result.ready && result.idle)).toBe(true)
    // A small move re-arms it; resting again opens it again.
    const after = run([{ x: 330, y: 70, over: true }, ...still(30, 330, 70)], parked[parked.length - 1].state)
    expect(after[0].idle).toBe(false)
    expect(after.some(result => result.ready)).toBe(true)
  })

  it('starts over when the pointer leaves', () => {
    const results = run([{ x: 250, y: 30, over: false }, ...still(30), { x: 900, y: 400, over: false }, { x: 300, y: 60, over: true }])
    expect(results[results.length - 1].ready).toBe(false)
    expect(results[results.length - 2].state.armed).toBe(false)
    expect(results[results.length - 2].state.inside).toBe(false)
  })
})
