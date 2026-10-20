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

it('shares the dictionary queue across modes while keeping their results distinct', async () => {
  const { romanizeLines, analyzeJapaneseLines } = await import('./romanizer')
  const first = romanizeLines(['晴れ'])
  const second = analyzeJapaneseLines(['晴れ'])
  expect(analyzeJapaneseLines(['晴れ'])).toBe(second)
  expect(romanizeLines(['晴れ'])).toBe(first)
  await Promise.resolve()
  expect(state.workers).toHaveLength(1)
  expect(state.workers[0].options.workerData.mode).toBe('romanize')
  let terminated!: () => void
  state.workers[0].terminate.mockImplementation(() => new Promise<void>(resolve => { terminated = resolve }))
  state.workers[0].emit('message', { output: ['hare'] })
  await Promise.resolve()
  expect(state.workers).toHaveLength(1)
  terminated()
  expect(await first).toEqual(['hare'])
  await Promise.resolve()
  expect(state.workers).toHaveLength(2)
  expect(state.workers[1].options.workerData.mode).toBe('analyze')
  const words = [[{ surface_form: '晴れ', reading: 'ハレ', pronunciation: 'ハレ', pos: '名詞' }]]
  state.workers[1].emit('message', { output: words })
  expect(await second).toEqual(words)
})

it('applies the outstanding limit to both modes together', async () => {
  const { romanizeLines, analyzeJapaneseLines } = await import('./romanizer')
  const pending = Array.from({ length: 8 }, (_, index) => index % 2
    ? analyzeJapaneseLines([String(index)]) : romanizeLines([String(index)]))
  await expect(analyzeJapaneseLines(['overflow'])).rejects.toThrow('任务较多')
  for (let index = 0; index < pending.length; index++) {
    await Promise.resolve()
    state.workers[index].emit('message', { output: [] })
    await pending[index]
  }
})

it('releases an analysis dictionary after timeout before starting a romanization', async () => {
  vi.useFakeTimers()
  const { romanizeLines, analyzeJapaneseLines } = await import('./romanizer')
  const first = expect(analyzeJapaneseLines(['晴れ'])).rejects.toThrow('超时')
  const second = romanizeLines(['風'])
  await Promise.resolve()
  let terminated!: () => void
  state.workers[0].terminate.mockImplementation(() => new Promise<void>(resolve => { terminated = resolve }))
  await vi.advanceTimersByTimeAsync(20_000)
  expect(state.workers[0].terminate).toHaveBeenCalledOnce()
  expect(state.workers).toHaveLength(1)
  terminated()
  await first
  await Promise.resolve()
  expect(state.workers).toHaveLength(2)
  state.workers[1].emit('message', { output: ['kaze'] })
  expect(await second).toEqual(['kaze'])
  expect(vi.getTimerCount()).toBe(0)
})

it('releases failed analysis workers and accepts future analysis', async () => {
  const { romanizeLines, analyzeJapaneseLines } = await import('./romanizer')
  const first = expect(analyzeJapaneseLines(['晴れ'])).rejects.toThrow('提前退出')
  const second = romanizeLines(['風'])
  await Promise.resolve()
  state.workers[0].emit('exit', 1)
  await first
  expect(state.workers[0].terminate).toHaveBeenCalledOnce()
  await Promise.resolve()
  state.workers[1].emit('message', { output: ['kaze'] })
  await second
  const third = analyzeJapaneseLines(['晴れ'])
  await Promise.resolve()
  state.workers[2].emit('message', { output: [[{ surface_form: '晴れ' }]] })
  expect(await third).toEqual([[{ surface_form: '晴れ' }]])
})

it('cancels queued analysis without starting its dictionary or stopping another consumer', async () => {
  const { romanizeLines, analyzeJapaneseLines } = await import('./romanizer')
  const first = romanizeLines(['晴れ'])
  const controller = new AbortController()
  const second = expect(analyzeJapaneseLines(['風'], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  const third = analyzeJapaneseLines(['風'])
  await Promise.resolve()
  controller.abort()
  await second
  expect(state.workers).toHaveLength(1)
  expect(state.workers[0].terminate).not.toHaveBeenCalled()
  state.workers[0].emit('message', { output: ['hare'] })
  await first
  await vi.waitFor(() => expect(state.workers).toHaveLength(2))
  expect(state.workers[1].options.workerData.mode).toBe('analyze')
  state.workers[1].emit('message', { output: [[{ surface_form: '風' }]] })
  expect(await third).toEqual([[{ surface_form: '風' }]])
})

it('waits for active cancellation to release its dictionary before the next job', async () => {
  const { romanizeLines, analyzeJapaneseLines } = await import('./romanizer')
  const controller = new AbortController()
  const first = expect(analyzeJapaneseLines(['晴れ'], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  const second = romanizeLines(['晴れ'])
  await Promise.resolve()
  let terminated!: () => void
  state.workers[0].terminate.mockImplementation(() => new Promise<void>(resolve => { terminated = resolve }))
  controller.abort()
  await Promise.resolve()
  expect(state.workers[0].terminate).toHaveBeenCalledOnce()
  expect(state.workers).toHaveLength(1)
  terminated()
  await first
  await Promise.resolve()
  expect(state.workers).toHaveLength(2)
  state.workers[1].emit('message', { output: ['hare'] })
  expect(await second).toEqual(['hare'])
})

it('keeps cancellable consumers independent and ignores already aborted requests', async () => {
  const { analyzeJapaneseLines } = await import('./romanizer')
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = analyzeJapaneseLines(['晴れ'], { signal: firstController.signal })
  const second = analyzeJapaneseLines(['晴れ'], { signal: secondController.signal })
  expect(first).not.toBe(second)
  const secondRejected = expect(second).rejects.toMatchObject({ name: 'AbortError' })
  secondController.abort()
  await secondRejected
  await expect(analyzeJapaneseLines(['晴れ'], { signal: secondController.signal })).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  expect(state.workers).toHaveLength(1)
  state.workers[0].emit('message', { output: [[{ surface_form: '晴れ' }]] })
  expect(await first).toEqual([[{ surface_form: '晴れ' }]])
})

it('honors cancellation that arrives while a completed worker is being terminated', async () => {
  const { analyzeJapaneseLines } = await import('./romanizer')
  const controller = new AbortController()
  const result = expect(analyzeJapaneseLines(['晴れ'], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  let terminated!: () => void
  state.workers[0].terminate.mockImplementation(() => new Promise<void>(resolve => { terminated = resolve }))
  state.workers[0].emit('message', { output: [[{ surface_form: '晴れ' }]] })
  controller.abort()
  terminated()
  await result
  expect(state.workers[0].terminate).toHaveBeenCalledOnce()
})

it('rejects oversized and malformed inputs before admitting a worker', async () => {
  const { analyzeJapaneseLines, romanizeLines } = await import('./romanizer')
  await expect(analyzeJapaneseLines(Array.from({ length: 401 }, () => ''))).rejects.toThrow('输入过大')
  await expect(analyzeJapaneseLines(['あ'.repeat(501)])).rejects.toThrow('输入过大')
  await expect(romanizeLines(Array.from({ length: 400 }, () => 'あ'.repeat(41)))).rejects.toThrow('输入过大')
  await expect(analyzeJapaneseLines([null as unknown as string])).rejects.toThrow('格式无效')
  expect(await analyzeJapaneseLines([])).toEqual([])
  expect(state.workers).toHaveLength(0)
  const edge = analyzeJapaneseLines(Array.from({ length: 400 }, () => 'あ'.repeat(40)))
  await Promise.resolve()
  state.workers[0].emit('message', { output: [] })
  expect(await edge).toEqual([])
})
