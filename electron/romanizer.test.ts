import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ workers: [] as any[] }))
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter {
  terminate = vi.fn(() => Promise.resolve(0))
  constructor(_source: string, public options: any) { super(); state.workers.push(this) }
} }))

afterEach(() => { vi.useRealTimers(); state.workers = []; vi.resetModules() })

it('serializes dictionaries, deduplicates requests and waits for termination', async () => {
  const { romanizeLines } = await import('./romanizer')
  const first = romanizeLines(['一'])
  expect(romanizeLines(['一'])).toBe(first)
  const second = romanizeLines(['二'])
  await Promise.resolve()
  expect(state.workers).toHaveLength(1)
  let terminated!: () => void
  state.workers[0].terminate.mockImplementation(() => new Promise<void>(resolve => { terminated = resolve }))
  state.workers[0].emit('message', { output: ['ichi'] })
  await Promise.resolve()
  expect(state.workers).toHaveLength(1)
  terminated()
  expect(await first).toEqual(['ichi'])
  await Promise.resolve()
  expect(state.workers).toHaveLength(2)
  state.workers[1].emit('message', { output: ['ni'] })
  expect(await second).toEqual(['ni'])
})

it('releases the queue after a worker exits before producing output', async () => {
  const { romanizeLines } = await import('./romanizer')
  const first = expect(romanizeLines(['一'])).rejects.toThrow('提前退出')
  const second = romanizeLines(['二'])
  await Promise.resolve()
  state.workers[0].emit('exit', 1)
  await first
  await Promise.resolve()
  state.workers[1].emit('message', { output: ['ni'] })
  expect(await second).toEqual(['ni'])
})
