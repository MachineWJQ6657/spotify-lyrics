import { Worker } from 'node:worker_threads'
import type { PhonemeMatcher } from './phoneme-session'

let activeWorker: Worker | null = null

/** One disposable bounded worker; never block the app's UI/native controls
 * with hundreds of whole-song graph comparisons. No detached queued work. */
export const matchPhonemeInWorker: PhonemeMatcher = (output, lines, words, durationMs, signal) => {
  if (signal.aborted) return Promise.reject(new Error('Phoneme matching cancelled'))
  if (activeWorker) return Promise.reject(new Error('Phoneme matcher is busy or awaiting confirmed exit'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ctc-matcher-worker.js', import.meta.url))
    activeWorker = worker
    let finishing = false, settled = false, exited = false
    let stopTimeout: NodeJS.Timeout | undefined
    let finalError: Error | undefined, finalValue: Awaited<ReturnType<PhonemeMatcher>> | undefined
    const complete = (error = finalError, value = finalValue) => {
      if (settled) return
      settled = true
      if (stopTimeout) clearTimeout(stopTimeout)
      if (error) reject(error)
      else resolve(value!)
    }
    const stopFailed = (message: string) => {
      // Reject within a bounded budget, but keep ownership until actual exit.
      // A failed termination must never turn into overlapping replacement work
      // or make a broken worker prevent the application's eventual shutdown.
      worker.unref()
      complete(new Error(message))
    }
    const finish = (error?: Error, value?: Awaited<ReturnType<PhonemeMatcher>>) => {
      if (finishing) return
      finishing = true; finalError = error; finalValue = value
      clearTimeout(timeout); signal.removeEventListener('abort', cancel)
      // Releasing before settlement prevents a replacement job from leaving
      // both the previous matcher and the new one consuming CPU/memory.
      if (exited) { complete(); return }
      stopTimeout = setTimeout(() => stopFailed('Phoneme matcher exit was not confirmed within 2s'), 2000)
      try {
        void worker.terminate().then(() => {
          if (exited) complete()
          else stopFailed('Phoneme matcher termination did not confirm exit')
        }, () => stopFailed('Phoneme matcher termination failed'))
      } catch { stopFailed('Phoneme matcher termination failed') }
    }
    const cancel = () => finish(new Error('Phoneme matching cancelled'))
    const timeout = setTimeout(() => finish(new Error('Phoneme matching exceeded 4s budget')), 4000)
    signal.addEventListener('abort', cancel, { once: true })
    worker.once('message', (message: { result?: Awaited<ReturnType<PhonemeMatcher>>; error?: string } | null) => {
      if (!message || typeof message !== 'object' || message.error || !message.result) finish(new Error(message?.error || 'Invalid phoneme matcher response'))
      else finish(undefined, message.result)
    })
    worker.once('error', error => finish(error))
    worker.once('exit', () => {
      exited = true
      if (activeWorker === worker) activeWorker = null
      if (!finishing) finish(new Error('Phoneme matcher exited without a result'))
      else complete()
    })
    try { worker.postMessage({ output, lines, words, durationMs }) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
  })
}
