import { parentPort } from 'node:worker_threads'
import { fetchLyrics, searchLyrics } from './lyrics-provider'

// The lyric lookup of the app: the requests to the providers, the comparison
// of their candidates and the alignment of translations. It lives in this
// thread for as long as the app runs, with the provider's caches, so the work
// (more than 100 ms without a break for one song) never holds up the main
// process. No Electron, playback or file access.
type Call = { id: number; method: 'fetch'; args: Parameters<typeof fetchLyrics> } | { id: number; method: 'search'; args: Parameters<typeof searchLyrics> }

parentPort?.on('message', (call: Call) => {
  const id = call?.id
  void (async () => call.method === 'fetch' ? fetchLyrics(...call.args) : call.method === 'search' ? searchLyrics(...call.args) : Promise.reject(new Error('Unknown lyric call')))()
    .then(result => parentPort!.postMessage({ id, result }))
    .catch(error => parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }))
})
