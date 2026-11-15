import { describe, expect, it } from 'vitest'
import { visibleOverlayPlacement } from './overlay-placement'

// 1080p with a 48 px taskbar at the bottom.
const area = { x: 0, y: 0, width: 1920, height: 1032 }

describe('where the overlay is put back', () => {
  it('leaves lyrics that were dragged low over the taskbar where they are', () => {
    // Before: every unlock, resume, show and restart pulled them up to y = 812.
    expect(visibleOverlayPlacement({ x: 550, y: 900, width: 820, height: 220 }, area)).toEqual({ x: 550, y: 900, width: 820, height: 220 })
    expect(visibleOverlayPlacement({ x: 550, y: 984, width: 820, height: 220 }, area).y).toBe(984)
  })

  it('leaves lyrics that hang over a side by less than half their width', () => {
    expect(visibleOverlayPlacement({ x: -300, y: 400, width: 820, height: 220 }, area).x).toBe(-300)
    expect(visibleOverlayPlacement({ x: 1500, y: 400, width: 820, height: 220 }, area).x).toBe(1500)
  })

  it('brings an overlay that is out of reach back whole', () => {
    // The display it was on is gone, or the resolution shrank.
    expect(visibleOverlayPlacement({ x: 2500, y: 400, width: 820, height: 220 }, area)).toEqual({ x: 1100, y: 400, width: 820, height: 220 })
    expect(visibleOverlayPlacement({ x: 550, y: 1300, width: 820, height: 220 }, area)).toEqual({ x: 550, y: 812, width: 820, height: 220 })
    expect(visibleOverlayPlacement({ x: 550, y: -60, width: 820, height: 220 }, area).y).toBe(0)
    expect(visibleOverlayPlacement({ x: -900, y: 400, width: 820, height: 220 }, area).x).toBe(0)
  })

  it('keeps the size inside its limits', () => {
    expect(visibleOverlayPlacement({ x: 0, y: 0, width: 3000, height: 2000 }, area)).toEqual({ x: 0, y: 0, width: 1920, height: 1032 })
    expect(visibleOverlayPlacement({ x: 100, y: 100, width: 200, height: 50 }, area)).toMatchObject({ width: 480, height: 140 })
  })

  it('works on a display that does not start at the origin', () => {
    const second = { x: -1920, y: 0, width: 1920, height: 1032 }
    expect(visibleOverlayPlacement({ x: -1263, y: 716, width: 820, height: 220 }, second)).toEqual({ x: -1263, y: 716, width: 820, height: 220 })
    expect(visibleOverlayPlacement({ x: 400, y: 716, width: 820, height: 220 }, second).x).toBe(-820)
  })
})
