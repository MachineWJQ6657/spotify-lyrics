import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
const { closeMonitorNative } = createRequire(import.meta.url)('../scripts/monitor-lifecycle.cjs')
afterEach(() => vi.useRealTimers())
function worker() { return Object.assign(new EventEmitter(), { postMessage: vi.fn(), terminate: vi.fn() }) }
it('requires stop acknowledgement AND successful exit; never calls terminate on success', async () => {
  const native = worker(), pending = closeMonitorNative(native)
  expect(native.postMessage).toHaveBeenCalledWith({ type: 'stop' })
  native.emit('message', { type: 'stopped' }); native.emit('exit', 0)
  await pending
  expect(native.terminate).not.toHaveBeenCalled()
  expect(native.listenerCount('message')).toBe(0)
})
it('rejects nonzero/unacknowledged exits and explicit close errors', async () => {
  for (const [ack, code] of [[false, 0], [true, 1]] as const) {
    const native = worker(), pending = expect(closeMonitorNative(native)).rejects.toThrow('not confirmed')
    if (ack) native.emit('message', { type: 'stopped' })
    native.emit('exit', code); await pending
  }
  const native = worker(), pending = expect(closeMonitorNative(native)).rejects.toThrow('failure')
  native.emit('message', { type: 'error', error: 'failure' }); await pending
})
it('times out cleanup without forcing termination before its caller can save failure', async () => {
  vi.useFakeTimers()
  const native = worker(), pending = expect(closeMonitorNative(native)).rejects.toThrow('timed out')
  native.emit('message', { type: 'stopped' })
  await vi.advanceTimersByTimeAsync(3000); await pending
  expect(native.terminate).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it('actual read-only helper stops polling and native callbacks before closing its port; seek messages do nothing', () => {
  vi.useFakeTimers()
  const calls: string[] = []
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn(), close: vi.fn() })
  class Client extends EventEmitter {
    start() { calls.push('start') }
    latestState() { return { title: 'Synthetic', artist: '', album: '', positionMs: 1, durationMs: 10000, statusName: 'PAUSED' } }
    stop() { calls.push('stop') }
    close() { calls.push('close'); this.emit('closed') }
  }
  runInNewContext(readFileSync(new URL('../scripts/monitor-audio-native.cjs', import.meta.url), 'utf8'), {
    require: (name: string) => name === 'node:worker_threads' ? { parentPort: port } : { SpotifyClient: Client },
    setInterval, clearInterval, Date,
  })
  port.emit('message', { type: 'seek', positionMs: 5000 })
  expect(calls).toEqual(['start'])
  port.emit('message', { type: 'stop' })
  expect(calls).toEqual(['start', 'stop', 'close'])
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'stopped' })
  expect(port.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
