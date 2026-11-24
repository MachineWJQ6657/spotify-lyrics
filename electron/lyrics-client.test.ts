import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureLyricsClient, fetchLyrics, lyricsThread, onLyricsWorkerReport, searchLyrics, stopLyricsWorker } from './lyrics-client'

class FakeWorker extends EventEmitter {
  sent: Array<{ id: number; method: string; args: unknown[] }> = []
  postMessage = vi.fn((message: { id: number; method: string; args: unknown[] }) => { this.sent.push(message) })
  unref = vi.fn()
  terminate = vi.fn(async () => 1)
  answer(index: number, result: unknown) { this.emit('message', { id: this.sent[index].id, result }) }
}

const track = { id: 't1', name: 'Song', artist: 'Artist', album: '', durationMs: 200_000 } as Parameters<typeof fetchLyrics>[0]
const found = { source: 'LRCLIB', syncedLyrics: '[00:01.00]line' } as Awaited<ReturnType<typeof fetchLyrics>>
let workers: FakeWorker[]
let provider: { fetchLyrics: ReturnType<typeof vi.fn>; searchLyrics: ReturnType<typeof vi.fn> }
let reports: string[]

beforeEach(() => {
  workers = []
  reports = []
  provider = { fetchLyrics: vi.fn(async () => found), searchLyrics: vi.fn(async () => []) }
  configureLyricsClient({ createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker },
    loadProvider: async () => provider as never, timeoutMs: 90_000 })
  onLyricsWorkerReport(message => reports.push(message))
})
afterEach(() => { vi.useRealTimers() })

describe('lyric lookups run in the worker', () => {
  it('sends a lookup to one lasting worker and gives its answer back', async () => {
    const first = fetchLyrics(track, 'token', true, { preferredSource: 'netease' })
    const second = searchLyrics({ track: 'Song', artist: 'Artist' })
    expect(workers).toHaveLength(1)
    expect(workers[0].unref).toHaveBeenCalled()
    expect(workers[0].sent[0]).toMatchObject({ method: 'fetch', args: [track, 'token', true, { preferredSource: 'netease' }] })
    expect(workers[0].sent[1]).toMatchObject({ method: 'search', args: [{ track: 'Song', artist: 'Artist' }] })
    // Answers may come back in any order.
    workers[0].answer(1, [])
    workers[0].answer(0, found)
    await expect(first).resolves.toEqual(found)
    await expect(second).resolves.toEqual([])
    expect(lyricsThread()).toBe('worker')
    expect(provider.fetchLyrics).not.toHaveBeenCalled()
  })

  it("passes the provider's own error on without asking again", async () => {
    const lookup = fetchLyrics(track)
    workers[0].emit('message', { id: workers[0].sent[0].id, error: 'provider refused' })
    await expect(lookup).rejects.toThrow('provider refused')
    expect(provider.fetchLyrics).not.toHaveBeenCalled()
    expect(workers).toHaveLength(1)
  })

  it('answers in this process when the worker dies, and starts a new worker for the next lookup', async () => {
    const lookup = fetchLyrics(track)
    workers[0].emit('error', new Error('boom'))
    await expect(lookup).resolves.toEqual(found)
    expect(provider.fetchLyrics).toHaveBeenCalledWith(track)
    expect(lyricsThread()).toBe('main')
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(reports[0]).toContain('boom')
    const next = fetchLyrics(track)
    expect(workers).toHaveLength(2)
    workers[1].answer(0, found)
    await next
    expect(lyricsThread()).toBe('worker')
  })

  it('answers every waiting lookup when the worker exits', async () => {
    const lookups = [fetchLyrics(track), searchLyrics({ track: 'a', artist: 'b' })]
    workers[0].emit('exit', 1)
    await expect(Promise.all(lookups)).resolves.toEqual([found, []])
  })

  it('stops trying the worker after three failures in a row', async () => {
    for (let round = 0; round < 3; round++) {
      const lookup = fetchLyrics(track)
      workers.at(-1)!.emit('exit', 1)
      await lookup
    }
    expect(workers).toHaveLength(3)
    await fetchLyrics(track)
    expect(workers).toHaveLength(3)
    expect(provider.fetchLyrics).toHaveBeenCalledTimes(4)
  })

  it('counts a worker that cannot be created as a failure and still answers', async () => {
    configureLyricsClient({ createWorker: () => { throw new Error('no such file') } })
    await expect(fetchLyrics(track)).resolves.toEqual(found)
    expect(lyricsThread()).toBe('main')
    expect(reports.at(-1)).toContain('no such file')
  })

  it('gives up on a silent worker after the time limit', async () => {
    vi.useFakeTimers()
    const lookup = fetchLyrics(track)
    await vi.advanceTimersByTimeAsync(90_001)
    await expect(lookup).resolves.toEqual(found)
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(lyricsThread()).toBe('main')
  })

  it('ignores a late answer from a worker that was given up on', async () => {
    const lookup = fetchLyrics(track)
    const old = workers[0]
    old.emit('exit', 1)
    await lookup
    const next = fetchLyrics(track)
    old.emit('message', { id: workers[1].sent[0].id, result: null })
    workers[1].answer(0, found)
    await expect(next).resolves.toEqual(found)
  })

  it('ends the worker at quit and starts no other', async () => {
    const waiting = fetchLyrics(track)
    await stopLyricsWorker()
    await expect(waiting).rejects.toThrow('stopped')
    expect(workers[0].terminate).toHaveBeenCalled()
    await fetchLyrics(track)
    expect(workers).toHaveLength(1)
  })
})
