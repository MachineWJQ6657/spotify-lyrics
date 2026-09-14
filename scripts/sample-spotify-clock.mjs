// Read-only bounded native sampling. No playback commands or audio recording.
import { SpotifyClient } from 'libspotifyctl'
import { performance } from 'node:perf_hooks'

const client = new SpotifyClient()
const samples = []
const started = performance.now()
let previousKey = ''
let generation = 0
const observe = state => {
  const key = JSON.stringify([state.artist, state.title, state.album])
  if (key !== previousKey) { generation++; previousKey = key }
  samples.push({ elapsedMs: Math.round(performance.now() - started), generation,
    title: state.title, artist: state.artist, status: state.statusName,
    positionMs: state.positionMs, durationMs: state.durationMs })
}
try {
  client.start()
  client.on('stateChanged', observe)
  await new Promise(resolve => setTimeout(resolve, 12000))
} finally {
  client.off('stateChanged', observe)
  client.stop()
  client.close()
}
console.log(JSON.stringify({ note: 'Native observations, not audible lyric accuracy. Startup state may be stale; no automatic correction inferred.', samples }, null, 2))
