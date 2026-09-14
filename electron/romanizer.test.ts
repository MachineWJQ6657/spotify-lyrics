import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ workers: [] as any[] }))
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter {
  terminate = vi.fn(() => Promise.resolve(0))
  constructor(_source: string, public options: any) { super(); state.workers.push(this) }
} }))

afterEach(() => { vi.useRealTimers(); state.workers = []; vi.resetModules() })

it('times out only the running job and preserves the queued input snapshot', async () => {
  vi.useFakeTimers()
  const { romanizeLines } = await import('./romanizer')
  const first = expect(romanizeLines(['一'])).rejects.toThrow('超时')
  const input = ['二']
  const second = romanizeLines(input)
  input[0] = '変更'
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(20_000)
  await first
  expect(state.workers).toHaveLength(2)
  expect(state.workers[1].options.workerData.lines).toEqual(['二'])
  state.workers[1].emit('message', { output: ['ni'] })
  expect(await second).toEqual(['ni'])
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds outstanding jobs without breaking duplicate reuse or future admission', async () => {
  const { romanizeLines } = await import('./romanizer')
  const pending = Array.from({ length: 8 }, (_, index) => romanizeLines([String(index)]))
  expect(romanizeLines(['0'])).toBe(pending[0])
  await expect(romanizeLines(['overflow'])).rejects.toThrow('任务较多')
  for (let index = 0; index < 8; index++) {
    await Promise.resolve()
    state.workers[index].emit('message', { output: [String(index)] })
    await pending[index]
  }
  const next = romanizeLines(['new'])
  await Promise.resolve()
  state.workers[8].emit('message', { output: ['new'] })
  expect(await next).toEqual(['new'])
})

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
