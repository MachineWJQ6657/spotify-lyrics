import { describe, expect, it } from 'vitest'
import { overlayShape } from './overlay-shape'

describe('overlay window shape', () => {
  it('drops stale text entirely outside a resized window', () => {
    const border = overlayShape(200, 100, [], false)
    for (const [x, y] of [[400, 20], [-100, 20], [20, 300], [20, -100]]) {
      expect(overlayShape(200, 100, [{ x, y, width: 20, height: 20 }], false)).toEqual(border)
    }
  })
  it('clips partially visible padded text to integer window bounds', () => {
    expect(overlayShape(200, 100, [{ x: -4.5, y: 80.5, width: 250, height: 40 }], false)[0])
      .toEqual({ x: 0, y: 72, width: 200, height: 28 })
  })
  it('keeps only native resize edges in click-through mode', () => {
    expect(overlayShape(200, 100, [{ x: 20, y: 20, width: 100, height: 50 }], true))
      .toEqual(overlayShape(200, 100, [], false))
  })
  it('rejects invalid text geometry and keeps tiny-window borders bounded', () => {
    expect(overlayShape(5, 3, [{ x: NaN, y: 0, width: 20, height: 20 }, { x: 0, y: 0, width: -1, height: 2 }], false))
      .toEqual(overlayShape(5, 3, [], false))
    for (const rect of overlayShape(5, 3, [], false)) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(5)
      expect(rect.y + rect.height).toBeLessThanOrEqual(3)
    }
  })
})
