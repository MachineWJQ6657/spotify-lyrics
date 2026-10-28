import { describe, expect, it } from 'vitest'
import { overlayInputState, OVERLAY_INPUT_FAR_POLL_MS, OVERLAY_INPUT_NEAR_POLL_MS,
  OVERLAY_INPUT_NEAR_MARGIN, type OverlayInputSnapshot } from './overlay-input'

const bounds = { x: -1600, y: -50, width: 800, height: 220 }
const region = { x: 150, y: 70, width: 500, height: 60 }

function state(localX = 300, localY = 100, patch: Partial<OverlayInputSnapshot> = {}) {
  return overlayInputState({ bounds, cursor: { x: bounds.x + localX, y: bounds.y + localY },
    regions: [region], layoutReady: true, movable: true, clickThrough: false, ...patch })
}

describe('paint-independent overlay cursor input policy', () => {
  it('accepts current text on a negative-coordinate secondary monitor', () => {
    expect(state()).toEqual({ ignoreMouse: false, overInteractive: true, pollMs: OVERLAY_INPUT_NEAR_POLL_MS })
    // Screen origin must be subtracted exactly once; no monitor-DPI multiplier.
    expect(state(700, 100).ignoreMouse).toBe(true)
  })

  it('passes blank interior through while preserving text and background targets', () => {
    expect(state(80, 100).ignoreMouse).toBe(true)
    expect(state(300, 170).ignoreMouse).toBe(true)
    expect(state(80, 100, { regions: [{ x: 0, y: 0, width: 800, height: 220 }] }).ignoreMouse).toBe(false)
  })

  it.each([
    [0, 100], [7.99, 100], [792, 100], [799.99, 100],
    [80, 0], [80, 7.99], [80, 212], [80, 219.99], [0, 0], [799.99, 219.99]
  ])('preserves unlocked resize edge at (%s,%s)', (x, y) => {
    expect(state(x, y, { regions: [] }).overInteractive).toBe(true)
  })

  it('does not grow resize edges inward or outside the native HWND', () => {
    for (const [x, y] of [[8, 100], [791.99, 100], [80, 8], [80, 211.99],
      [-0.01, 100], [800, 100], [80, -0.01], [80, 220]]) {
      expect(state(x, y, { regions: [] }).ignoreMouse).toBe(true)
    }
  })

  it.each([
    { movable: false }, { clickThrough: true }, { layoutReady: false },
    { movable: false, clickThrough: false }, { movable: true, clickThrough: true }
  ])('passes text, backgrounds and every resize edge through when protected: %j', patch => {
    for (const [x, y] of [[300, 100], [80, 100], [0, 100], [799, 219], [80, 0]]) {
      expect(state(x, y, { regions: [{ x: 0, y: 0, width: 800, height: 220 }], ...patch }))
        .toEqual({ ignoreMouse: true, overInteractive: false, pollMs: OVERLAY_INPUT_NEAR_POLL_MS })
    }
  })

  it('has exact, bounded text padding rather than taking the whole line container', () => {
    expect(state(140, 100).ignoreMouse).toBe(false)
    expect(state(139.99, 100).ignoreMouse).toBe(true)
    expect(state(659.99, 100).ignoreMouse).toBe(false)
    expect(state(660, 100).ignoreMouse).toBe(true)
    expect(state(300, 62).ignoreMouse).toBe(false)
    expect(state(300, 61.99).ignoreMouse).toBe(true)
    expect(state(300, 137.99).ignoreMouse).toBe(false)
    expect(state(300, 138).ignoreMouse).toBe(true)
  })

  it('applies fresh line shrink immediately and does not latch an old target', () => {
    expect(state(600, 100).ignoreMouse).toBe(false)
    expect(state(600, 100, { regions: [{ ...region, width: 100 }] }).ignoreMouse).toBe(true)
    expect(state(200, 100, { regions: [{ ...region, width: 100 }] }).ignoreMouse).toBe(false)
  })

  it('never pads invalid or completely off-window regions into a new target', () => {
    const invalid = [
      { x: NaN, y: 0, width: 800, height: 220 },
      { x: 0, y: 0, width: Infinity, height: 220 },
      { x: 0, y: 0, width: -800, height: 220 },
      { x: 0, y: 0, width: 800, height: 0 },
      { x: 0, y: -10, width: 800, height: 5 },
      { x: 0, y: 220, width: 800, height: 60 },
      { x: 800, y: 0, width: 600, height: 220 },
      { x: 100_000, y: 0, width: 800, height: 220 }
    ]
    expect(state(300, 100, { regions: invalid }).ignoreMouse).toBe(true)
    expect(state(300, 100, { regions: [...invalid, region] }).ignoreMouse).toBe(false)
  })

  it('clips partially visible regions before checking local input', () => {
    const partial = [{ x: -50, y: 70, width: 100, height: 60 }]
    expect(state(20, 100, { regions: partial }).ignoreMouse).toBe(false)
    expect(state(59.99, 100, { regions: partial }).ignoreMouse).toBe(false)
    expect(state(60, 100, { regions: partial }).ignoreMouse).toBe(true)
    expect(state(-1, 100, { regions: partial }).ignoreMouse).toBe(true)
  })

  it('uses a fast fallback near the HWND and backs off far away without IPC', () => {
    expect(state(-OVERLAY_INPUT_NEAR_MARGIN, 100).pollMs).toBe(OVERLAY_INPUT_NEAR_POLL_MS)
    expect(state(-OVERLAY_INPUT_NEAR_MARGIN - 0.01, 100).pollMs).toBe(OVERLAY_INPUT_FAR_POLL_MS)
    expect(state(800 + OVERLAY_INPUT_NEAR_MARGIN - 0.01, 100).pollMs).toBe(OVERLAY_INPUT_NEAR_POLL_MS)
    expect(state(800 + OVERLAY_INPUT_NEAR_MARGIN, 100).pollMs).toBe(OVERLAY_INPUT_FAR_POLL_MS)
    expect(state(300, 10_000).pollMs).toBe(OVERLAY_INPUT_FAR_POLL_MS)
    expect(state(300, 100, { movable: false }).pollMs).toBe(OVERLAY_INPUT_NEAR_POLL_MS)
  })

  it('fails closed on invalid bounds, cursors, or an unbounded region publication', () => {
    for (const patch of [
      { bounds: { ...bounds, width: 0 } }, { bounds: { ...bounds, height: NaN } },
      { bounds: { ...bounds, width: 1e9 } }, { bounds: { ...bounds, x: Infinity } },
      { cursor: { x: NaN, y: 100 } }, { cursor: { x: 1e9, y: 100 } },
      { regions: Array.from({ length: 65 }, () => region) }
    ]) expect(state(300, 100, patch).ignoreMouse).toBe(true)
  })

  it('does not mutate frozen geometry or keep hidden state between calls', () => {
    const frozenBounds = Object.freeze({ ...bounds })
    const regions = Object.freeze([Object.freeze({ ...region })])
    expect(state(300, 100, { bounds: frozenBounds, regions }).ignoreMouse).toBe(false)
    expect(state(300, 100, { bounds: frozenBounds, regions, clickThrough: true }).ignoreMouse).toBe(true)
    expect(state(300, 100, { bounds: frozenBounds, regions }).ignoreMouse).toBe(false)
  })
})
