// Stand-in for node:worker_threads: records the generated worker source instead of starting a thread.
import { EventEmitter } from 'node:events'
globalThis.__workerSources = globalThis.__workerSources ?? []
export class Worker extends EventEmitter {
  constructor(source) { super(); globalThis.__workerSources.push(source); globalThis.__lastWorker = this }
  postMessage(message) { globalThis.__toWorker?.(message) }
  terminate() { return Promise.resolve(0) }
}
