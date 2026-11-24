import { Worker } from 'node:worker_threads'
import type { fetchLyrics as FetchLyrics, searchLyrics as SearchLyrics } from './lyrics-provider'

/**
 * The lyric lookup, run in a worker thread (`lyrics-worker.ts`).
 *
 * Comparing the providers' candidates for one song kept the main process busy
 * for 122 to 225 ms without a break (measured at a song change, 0.4.81 and
 * 0.4.82). Everything the main process does waits meanwhile: the playback
 * updates to the windows, the overlay's input, the tray. The worker stays for
 * the life of the app because the provider's caches live with it (a source
 * switch re-ranks what the lookup of the song left there).
 *
 * A worker that cannot start, dies or stops answering never costs a lookup its
 * answer: the call is made in this process instead, as before 0.4.83, and
 * after three failures in a row the worker is no longer tried.
 */
type Methods = { fetch: typeof FetchLyrics; search: typeof SearchLyrics }
type Provider = { fetchLyrics: typeof FetchLyrics; searchLyrics: typeof SearchLyrics }

interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): Promise<number>
  unref(): void
  on(event: 'message', listener: (message: { id?: number; result?: unknown; error?: string } | null) => void): unknown
  on(event: 'error', listener: (error: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
}

/** The worker is gone or silent; the provider itself did not answer with an error. */
class WorkerLost extends Error {}

const MAX_FAILURES = 3
let timeoutMs = 90_000
let createWorker: () => WorkerLike = () => new Worker(new URL('./lyrics-worker.js', import.meta.url))
let loadProvider: () => Promise<Provider> = () => import('./lyrics-provider')
let report: (message: string) => void = () => undefined

let lyricsWorker: WorkerLike | null = null
let failures = 0
let nextId = 0
let lastThread: 'worker' | 'main' | null = null
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

function lose(lost: WorkerLike, reason: string) {
  if (lyricsWorker !== lost) return
  lyricsWorker = null
  failures += 1
  report(`lyrics worker lost (${reason}); failures=${failures}`)
  const calls = [...pending.values()]
  pending.clear()
  for (const call of calls) { clearTimeout(call.timer); call.reject(new WorkerLost(reason)) }
  void lost.terminate().catch(() => undefined)
}

function ensureWorker(): WorkerLike {
  if (lyricsWorker) return lyricsWorker
  const created = createWorker()
  lyricsWorker = created
  // Nothing about quitting waits for this thread.
  created.unref()
  created.on('message', message => {
    const call = typeof message?.id === 'number' ? pending.get(message.id) : undefined
    if (!call || lyricsWorker !== created) return
    pending.delete(message!.id!)
    clearTimeout(call.timer)
    failures = 0
    if (typeof message!.error === 'string') call.reject(new Error(message!.error))
    else call.resolve(message!.result)
  })
  created.on('error', error => lose(created, error instanceof Error ? error.message : String(error)))
  created.on('exit', code => lose(created, `exited with ${code}`))
  return created
}

function viaWorker(method: keyof Methods, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let target: WorkerLike
    try { target = ensureWorker() } catch (error) {
      failures += 1
      report(`lyrics worker did not start (${error instanceof Error ? error.message : String(error)}); failures=${failures}`)
      reject(new WorkerLost('did not start'))
      return
    }
    const id = ++nextId
    const timer = setTimeout(() => lose(target, `no answer in ${timeoutMs} ms`), timeoutMs)
    timer.unref?.()
    pending.set(id, { resolve, reject, timer })
    try { target.postMessage({ id, method, args }) } catch (error) { lose(target, error instanceof Error ? error.message : String(error)) }
  })
}

async function call<M extends keyof Methods>(method: M, args: Parameters<Methods[M]>): Promise<Awaited<ReturnType<Methods[M]>>> {
  type Answer = Awaited<ReturnType<Methods[M]>>
  if (failures < MAX_FAILURES) {
    try {
      const answer = await viaWorker(method, args) as Answer
      lastThread = 'worker'
      return answer
    } catch (error) {
      // The provider's own error is the answer; only a lost worker is made up for here.
      if (!(error instanceof WorkerLost)) throw error
    }
  }
  const provider = await loadProvider()
  lastThread = 'main'
  return await (method === 'fetch'
    ? provider.fetchLyrics(...args as Parameters<typeof FetchLyrics>)
    : provider.searchLyrics(...args as Parameters<typeof SearchLyrics>)) as Answer
}

export const fetchLyrics = (...args: Parameters<typeof FetchLyrics>) => call('fetch', args)
export const searchLyrics = (...args: Parameters<typeof SearchLyrics>) => call('search', args)

/** Where the most recent lookup ran (for the log). */
export const lyricsThread = () => lastThread

/** At quit: the thread ends with the app, and no later call starts a new one. */
export function stopLyricsWorker(): Promise<void> {
  failures = MAX_FAILURES
  const stopped = lyricsWorker
  lyricsWorker = null
  const calls = [...pending.values()]
  pending.clear()
  for (const waiting of calls) { clearTimeout(waiting.timer); waiting.reject(new Error('Lyric lookup stopped')) }
  return stopped ? stopped.terminate().then(() => undefined, () => undefined) : Promise.resolve()
}

/** Where a lost worker is noted (the app's log). */
export function onLyricsWorkerReport(listener: (message: string) => void) { report = listener }

/** Test seam: a stand-in worker and provider, and a fresh state. */
export function configureLyricsClient(options: { createWorker?: () => WorkerLike; loadProvider?: () => Promise<Provider>; timeoutMs?: number } = {}) {
  if (options.createWorker) createWorker = options.createWorker
  if (options.loadProvider) loadProvider = options.loadProvider
  if (options.timeoutMs) timeoutMs = options.timeoutMs
  lyricsWorker = null; failures = 0; nextId = 0; lastThread = null
  pending.clear()
}
