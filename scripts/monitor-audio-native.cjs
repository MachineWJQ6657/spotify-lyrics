// Read-only monitor worker. Intentionally has NO playback/seek command path.
const { parentPort } = require('node:worker_threads')
const { SpotifyClient } = require('libspotifyctl')
let client, timer, stopping = false, previousKey = '', sequence = 0
const publish = raw => {
  if (stopping) return
  const sample = { title: raw?.title || '', artist: raw?.artist || '', album: raw?.album || '',
    positionMs: Number(raw?.positionMs) || 0, durationMs: Number(raw?.durationMs) || 0, statusName: raw?.statusName || 'UNKNOWN' }
  const key = JSON.stringify(sample)
  if (key === previousKey) return
  previousKey = key
  parentPort.postMessage({ type: 'sample', sample: { ...sample, rawObservedAtMs: Date.now(), sequence: ++sequence } })
}
const stop = () => {
  if (stopping) return
  stopping = true; clearInterval(timer)
  try {
    client?.stop()
    client?.close()
    parentPort.postMessage({ type: 'stopped' })
  } catch (error) { parentPort.postMessage({ type: 'error', error: String(error) }) }
  parentPort.close()
}
parentPort.on('message', message => { if (message?.type === 'stop') stop() })
try {
  client = new SpotifyClient()
  client.on('stateChanged', publish)
  client.on('closed', () => { if (!stopping) parentPort.postMessage({ type: 'error', error: 'Native session closed' }) })
  client.start(); publish(client.latestState())
  timer = setInterval(() => {
    try { publish(client.latestState()) }
    catch (error) { parentPort.postMessage({ type: 'error', error: String(error) }); stop() }
  }, 500)
} catch (error) { parentPort.postMessage({ type: 'error', error: String(error) }); stop() }
