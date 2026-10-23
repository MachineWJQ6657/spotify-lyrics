import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventEmitter } from 'node:events'
import type { CtcOutput } from './ctc-tokens'
import type { CtcLandmarkResult } from './ctc-landmarks'

interface FakeWorker extends EventEmitter {
  terminate: ReturnType<typeof vi.fn<() => Promise<number>>>
  postMessage: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
}
const mocked = vi.hoisted(() => ({ workers: [] as FakeWorker[] }))
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  return { Worker: class extends EventEmitter {
    postMessage = vi.fn()
    unref = vi.fn()
    terminate = vi.fn(async () => { this.emit('exit', 1); return 1 })
    constructor() { super(); mocked.workers.push(this as FakeWorker) }
  } }
})
import { matchPhonemeInWorker } from './ctc-worker-client'

const result: CtcLandmarkResult = { reason: 'insufficient-words', groups: [], candidates: [],
  coverage: { complete: false, reasons: ['uncalibrated-acoustic-onsets'], unsupportedSpans: [],
    graphsPrepared: 0, graphsScored: 0, endTraces: 0, work: 0 } }
const request = (signal = new AbortController().signal) => matchPhonemeInWorker({} as CtcOutput, [], [], 12000, signal)
const latest = () => mocked.workers.at(-1)!
afterEach(() => {
  for (const worker of mocked.workers) worker.emit('exit', 1)
  mocked.workers.length = 0
  vi.useRealTimers()
})

describe('owned disposable phoneme worker', () => {
  it('does not start work for an already cancelled owner', async () => {
    const abort = new AbortController(); abort.abort()
    await expect(request(abort.signal)).rejects.toThrow('cancelled')
    expect(mocked.workers).toHaveLength(0)
  })
  it('posts one capture and resolves only after the worker actually exits', async () => {
    let exit!: (code: number) => void
    const job = request(), worker = latest()
    worker.terminate.mockImplementation(() => new Promise(resolve => { exit = resolve }))
    let done = false; void job.then(() => { done = true })
    worker.emit('message', { result }); await Promise.resolve()
    expect(worker.postMessage).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(done).toBe(false)
    await expect(request()).rejects.toThrow('awaiting confirmed exit')
    expect(mocked.workers).toHaveLength(1)
    worker.emit('exit', 0); exit(0)
    await expect(job).resolves.toBe(result)
    const next = request(); latest().emit('message', { result }); await expect(next).resolves.toBe(result)
  })
  it('cancels a live worker and does not accept its late result', async () => {
    const abort = new AbortController(), pending = request(abort.signal).catch(error => error), worker = latest()
    abort.abort(); worker.emit('message', { result })
    expect((await pending).message).toContain('cancelled')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('rejects an unexpected exit without trying to terminate an exited worker', async () => {
    const pending = request().catch(error => error), worker = latest()
    worker.emit('exit', 1)
    expect((await pending).message).toContain('without a result')
    expect(worker.terminate).not.toHaveBeenCalled()
  })
  it('terminates on worker errors and malformed messages', async () => {
    for (const event of ['error', 'message']) {
      const pending = request().catch(error => error), worker = latest()
      worker.emit(event, event === 'error' ? new Error('synthetic worker failure') : null)
      expect(await pending).toBeInstanceOf(Error)
      expect(worker.terminate).toHaveBeenCalledOnce()
    }
  })
  it('bounds search time to four seconds', async () => {
    vi.useFakeTimers()
    const pending = request().catch(error => error), worker = latest()
    await vi.advanceTimersByTimeAsync(4000)
    expect((await pending).message).toContain('4s budget')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('handles rejected termination without unhandled promises or releasing ownership', async () => {
    const pending = request().catch(error => error), worker = latest()
    worker.terminate.mockRejectedValue(new Error('synthetic terminate failure'))
    worker.emit('message', { result })
    expect((await pending).message).toContain('termination failed')
    expect(worker.unref).toHaveBeenCalled()
    await expect(request()).rejects.toThrow('awaiting confirmed exit')
    worker.emit('exit', 0)
    const next = request(); latest().emit('message', { result }); await expect(next).resolves.toBe(result)
  })
  it('bounds an unresolved termination and blocks replacements until late exit', async () => {
    vi.useFakeTimers()
    const pending = request().catch(error => error), worker = latest()
    worker.terminate.mockImplementation(() => new Promise(() => {}))
    worker.emit('message', { result })
    await vi.advanceTimersByTimeAsync(2000)
    expect((await pending).message).toContain('within 2s')
    expect(worker.unref).toHaveBeenCalled()
    await expect(request()).rejects.toThrow('awaiting confirmed exit')
    expect(mocked.workers).toHaveLength(1)
    worker.emit('exit', 0)
    const next = request(); latest().emit('message', { result }); await expect(next).resolves.toBe(result)
  })
  it('handles a synchronous termination failure without leaking a pending promise', async () => {
    const pending = request().catch(error => error), worker = latest()
    worker.terminate.mockImplementation(() => { throw new Error('synthetic throw') })
    worker.emit('message', { result })
    expect((await pending).message).toContain('termination failed')
    await expect(request()).rejects.toThrow('awaiting confirmed exit')
  })
})
