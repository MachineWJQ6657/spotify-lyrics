import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForFirstPaint } from './first-paint'

function fixture() {
  return Object.assign(new EventEmitter(), { isDestroyed: (): boolean => false, webContents: new EventEmitter() })
}
afterEach(() => vi.useRealTimers())
describe('first transparent-window paint barrier', () => {
  it('waits for a real paint instead of DOM/load completion, then removes listeners', async () => {
    const window = fixture(), ready = vi.fn()
    const pending = waitForFirstPaint(window).then(ready)
    window.webContents.emit('did-finish-load')
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    await pending
    expect(ready).toHaveBeenCalledWith(true)
    expect(window.eventNames()).toEqual([])
    expect(window.webContents.eventNames()).toEqual([])
  })
  it.each(['render-process-gone', 'destroyed'])('releases failed %s before any frame', async event => {
    const window = fixture(), pending = waitForFirstPaint(window)
    window.webContents.emit(event)
    expect(await pending).toBe(false)
    expect(window.listenerCount('ready-to-show')).toBe(0)
  })
  it('bounds a silent load failure instead of waiting indefinitely', async () => {
    vi.useFakeTimers()
    const window = fixture(), pending = waitForFirstPaint(window, 500)
    await vi.advanceTimersByTimeAsync(500)
    expect(await pending).toBe(false)
    expect(window.webContents.eventNames()).toEqual([])
  })
  it('ignores a subframe error but fails a main document error', async () => {
    const window = fixture(), ready = vi.fn(), pending = waitForFirstPaint(window).then(ready)
    window.webContents.emit('did-fail-load', {}, -1, 'error', 'local', false)
    await Promise.resolve(); expect(ready).not.toHaveBeenCalled()
    window.webContents.emit('did-fail-load', {}, -1, 'error', 'local', true)
    await pending; expect(ready).toHaveBeenCalledWith(false)
  })
  it('can arm a fresh bounded attempt after the original renderer fails', async () => {
    const window = fixture(), failed = waitForFirstPaint(window)
    window.webContents.emit('render-process-gone')
    expect(await failed).toBe(false)
    const retry = waitForFirstPaint(window)
    window.emit('ready-to-show')
    expect(await retry).toBe(true)
  })
  it('settles close/destroyed windows without keeping timers alive', async () => {
    const window = fixture(), pending = waitForFirstPaint(window)
    window.emit('closed')
    expect(await pending).toBe(false)
    const destroyed = fixture()
    destroyed.isDestroyed = () => true
    expect(await waitForFirstPaint(destroyed)).toBe(false)
  })
})
