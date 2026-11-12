import { Worker } from 'node:worker_threads'
import type { PronunciationToken } from './lyric-pronunciation'

let busy = false

/**
 * Chinese / English readings of lyric lines from a disposable worker, so the
 * dictionaries never stay resident in the main process. One job at a time;
 * cancelled or slow jobs terminate the worker.
 */
export function readPronunciations(lines: string[], options: { signal?: AbortSignal } = {}): Promise<PronunciationToken[][]> {
  const signal = options.signal
  if (signal?.aborted) return Promise.reject(new Error('Pronunciation lookup cancelled'))
  if (busy) return Promise.reject(new Error('Pronunciation lookup is busy'))
  busy = true
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pronunciation-worker.js', import.meta.url))
    let settled = false
    const finish = (error: Error | null, value?: PronunciationToken[][]) => {
      if (settled) return
      settled = true
      clearTimeout(timeout); signal?.removeEventListener('abort', cancel)
      void worker.terminate().catch(() => undefined).finally(() => { busy = false })
      if (error) reject(error)
      else resolve(value!)
    }
    const cancel = () => finish(new Error('Pronunciation lookup cancelled'))
    const timeout = setTimeout(() => finish(new Error('Pronunciation lookup exceeded 10s')), 10_000)
    signal?.addEventListener('abort', cancel, { once: true })
    worker.once('message', (message: { result?: unknown; error?: string } | null) => {
      const result = message?.result
      if (!Array.isArray(result) || result.length !== lines.length) finish(new Error(message?.error || 'Invalid pronunciation response'))
      else finish(null, result as PronunciationToken[][])
    })
    worker.once('error', error => finish(error))
    worker.once('exit', () => finish(new Error('Pronunciation worker exited without a result')))
    try { worker.postMessage({ lines }) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
  })
}
