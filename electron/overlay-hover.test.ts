import { expect, it } from 'vitest'
import { isOverOverlayRegion } from './overlay-hover'

it('finds locked text on a negative-coordinate secondary display', () => {
  const bounds = { x: -1600, y: -50, width: 800, height: 220 }
  const regions = [{ x: 50, y: 80, width: 400, height: 60 }]
  expect(isOverOverlayRegion({ x: -1400, y: 50 }, bounds, regions)).toBe(true)
  expect(isOverOverlayRegion({ x: -900, y: 50 }, bounds, regions)).toBe(false)
  expect(isOverOverlayRegion({ x: 200, y: 50 }, bounds, regions)).toBe(false)
  expect(isOverOverlayRegion({ x: -1400, y: 50 }, bounds, [])).toBe(false)
})
it('clips padded hover targets to the actual window and covers enabled backgrounds', () => {
  const bounds = { x: 20, y: 30, width: 600, height: 180 }
  const regions = [{ x: 0, y: 0, width: 600, height: 180 }]
  expect(isOverOverlayRegion({ x: 19, y: 60 }, bounds, regions)).toBe(false)
  expect(isOverOverlayRegion({ x: 200, y: 60 }, bounds, regions)).toBe(true)
})
