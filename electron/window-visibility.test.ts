import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { watchWindowVisibility, windowVisible } from './window-visibility'
function fixture() {
  const window = Object.assign(new EventEmitter(), {
    visible: false, minimized: false, destroyed: false,
    isVisible() { return this.visible }, isMinimized() { return this.minimized }, isDestroyed() { return this.destroyed },
  })
  return window
}
it('publishes only real native render visibility changes, including minimized windows', () => {
  const window = fixture(), publish = vi.fn(), stop = watchWindowVisibility(window, publish)
  expect(windowVisible(window)).toBe(false)
  window.visible = true; window.emit('show'); window.emit('show')
  window.minimized = true; window.emit('minimize')
  expect(windowVisible(window)).toBe(false)
  window.minimized = false; window.emit('restore')
  window.visible = false; window.emit('hide'); window.emit('hide')
  expect(publish.mock.calls).toEqual([[true], [false], [true], [false]])
  stop(); window.visible = true; window.emit('show')
  expect(publish).toHaveBeenCalledTimes(4)
})
it('removes subscriptions on close and safely handles missing/destroyed windows', () => {
  const window = fixture(), publish = vi.fn()
  watchWindowVisibility(window, publish); window.emit('closed')
  expect(window.eventNames()).toEqual([])
  window.destroyed = true; window.visible = true
  expect(windowVisible(window)).toBe(false)
  expect(windowVisible(null)).toBe(false)
})
