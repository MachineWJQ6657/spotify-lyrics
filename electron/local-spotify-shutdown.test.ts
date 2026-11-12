import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stopWorker, WORKER_SHUTDOWN_TIMEOUT_MS } from './local-spotify'

class FakeWorker extends EventEmitter {
  posted: unknown[] = []
  terminated = 0
  constructor(private readonly onShutdown?: (worker: FakeWorker) => void) { super() }
  postMessage(message: unknown) {
    this.posted.push(message)
    if ((message as { type?: string })?.type === 'shutdown') this.onShutdown?.(this)
  }
  terminate() { this.terminated++; return Promise.resolve(0) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('local Spotify worker shutdown', () => {
  it('asks the worker to stop the native thread before terminating it', async () => {
    const worker = new FakeWorker(self => setTimeout(() => self.emit('message', { type: 'shutdown-done' }), 40))
    const done = stopWorker(worker as never)
    expect(worker.posted).toEqual([{ type: 'shutdown' }])
    expect(worker.terminated).toBe(0)
    await vi.advanceTimersByTimeAsync(40)
    await done
    expect(worker.terminated).toBe(1)
    expect(worker.listenerCount('message')).toBe(0)
    expect(worker.listenerCount('exit')).toBe(0)
  })

  it('terminates a worker that never answers after the timeout', async () => {
    const worker = new FakeWorker()
    let finished = false
    void stopWorker(worker as never).then(() => { finished = true })
    await vi.advanceTimersByTimeAsync(WORKER_SHUTDOWN_TIMEOUT_MS - 1)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(finished).toBe(true)
    expect(worker.terminated).toBe(1)
  })

  it('does not wait for an already exited worker', async () => {
    const worker = new FakeWorker(self => self.emit('exit', 1))
    await stopWorker(worker as never)
    expect(worker.terminated).toBe(1)
  })

  it('ignores unrelated messages while waiting', async () => {
    const worker = new FakeWorker(self => { self.emit('message', { type: 'state' }); self.emit('message', null) })
    let finished = false
    void stopWorker(worker as never, 500).then(() => { finished = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(finished).toBe(true)
  })
})
