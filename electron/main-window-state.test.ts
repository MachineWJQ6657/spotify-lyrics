import { describe, expect, it } from 'vitest'
import { fitWindowToWorkArea, parseMainWindowState } from './main-window-state'

const area = { x: 0, y: 0, width: 1920, height: 1040 }
const minimum = { width: 1024, height: 680 }

describe('main window state', () => {
  it('keeps a saved rectangle that still fits', () => {
    expect(fitWindowToWorkArea({ x: 200, y: 100, width: 1300, height: 800 }, area, minimum)).toEqual({ x: 200, y: 100, width: 1300, height: 800 })
  })
  it('pulls a window back inside the work area and enforces the size limits', () => {
    expect(fitWindowToWorkArea({ x: 1500, y: 900, width: 1300, height: 800 }, area, minimum)).toEqual({ x: 620, y: 240, width: 1300, height: 800 })
    expect(fitWindowToWorkArea({ x: -500, y: -50, width: 600, height: 300 }, area, minimum)).toEqual({ x: 0, y: 0, width: 1024, height: 680 })
    expect(fitWindowToWorkArea({ x: 0, y: 0, width: 4000, height: 3000 }, area, minimum)).toEqual({ x: 0, y: 0, width: 1920, height: 1040 })
  })
  it('works on a display left of the primary one', () => {
    const left = { x: -1707, y: -44, width: 1707, height: 1020 }
    expect(fitWindowToWorkArea({ x: -1420, y: 106, width: 1120, height: 720 }, left, minimum)).toEqual({ x: -1420, y: 106, width: 1120, height: 720 })
  })
  it('rejects malformed saved state', () => {
    expect(parseMainWindowState('{"x":1,"y":2,"width":1200,"height":800,"maximized":true}')).toEqual({ x: 1, y: 2, width: 1200, height: 800, maximized: true })
    expect(parseMainWindowState('{"x":1,"y":2,"width":1200,"height":800}')?.maximized).toBe(false)
    for (const raw of ['', 'null', '{"x":1}', '{"x":"1","y":2,"width":1200,"height":800}', '{"x":1,"y":2,"width":5,"height":800}']) expect(parseMainWindowState(raw)).toBeNull()
  })
})
