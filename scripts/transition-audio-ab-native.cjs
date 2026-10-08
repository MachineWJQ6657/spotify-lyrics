// Native bindings are deliberately confined to this terminable Worker.
const { parentPort } = require('node:worker_threads')
const { SpotifyClient } = require('libspotifyctl')
let client, previousKey = '', sequence = 0
const publish = raw => {
  const sample = { title: raw?.title || '', artist: raw?.artist || '', album: raw?.album || '',
    positionMs: Number(raw?.positionMs) || 0, durationMs: Number(raw?.durationMs) || 0, statusName: raw?.statusName || 'UNKNOWN' }
  const key = JSON.stringify([sample.title, sample.artist, sample.album, sample.positionMs, sample.statusName])
  if (key === previousKey) return
  previousKey = key
  parentPort.postMessage({ type: 'sample', sample: { ...sample, rawObservedAtMs: Date.now(), sequence: ++sequence } })
}
try {
  client = new SpotifyClient()
  client.on('stateChanged', publish)
  client.on('closed', () => parentPort.postMessage({ type: 'error', error: 'Native session closed' }))
  client.start()
  publish(client.latestState())
  setInterval(() => { try { publish(client.latestState()) } catch (error) { parentPort.postMessage({ type: 'error', error: String(error) }) } }, 500)
  parentPort.on('message', message => {
    if (message.type !== 'seek' || !Number.isFinite(message.positionMs) || message.positionMs < 0) return
    try {
      const current = client.latestState()
      const currentIdentity = `${current?.artist || ''}\0${current?.title || ''}\0${current?.album || ''}`
      if (currentIdentity !== message.expectedIdentity || current?.statusName !== 'PLAYING'
        || !Number.isFinite(current.durationMs) || message.positionMs >= current.durationMs - 2000) throw new Error('Playback changed before seek; command refused')
      parentPort.postMessage({ type: 'response', id: message.id, ok: Boolean(client.seekMs(message.positionMs)) })
    }
    catch (error) { parentPort.postMessage({ type: 'response', id: message.id, ok: false, error: String(error) }) }
  })
} catch (error) { parentPort.postMessage({ type: 'error', error: String(error) }) }
