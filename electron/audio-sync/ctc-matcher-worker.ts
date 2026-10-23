import { parentPort } from 'node:worker_threads'
import { extractCtcLandmarks } from './ctc-landmarks'

// No Electron, playback, file access or model. The bounded CPU search runs off
// the main thread and can be terminated if the owning capture is cancelled.
parentPort?.once('message', ({ output, lines, words, durationMs }) => {
  try { parentPort!.postMessage({ result: extractCtcLandmarks(output, lines, words, durationMs) }) }
  catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message.slice(0, 300) : 'Phoneme matcher failed' }) }
})
