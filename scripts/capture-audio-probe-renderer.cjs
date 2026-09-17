const { ipcRenderer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function verifyBundledWorker(pcm, sampleRate) {
  const assets = path.resolve(__dirname, '../out/renderer/assets')
  const name = fs.readdirSync(assets).find(name => /^acoustic-worker-.*\.js$/.test(name))
  if (!name) throw new Error('Build first: bundled acoustic worker missing')
  const worker = new Worker(pathToFileURL(path.join(assets, name)).href, { type: 'module' })
  let id = 0
  const request = (type, values) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timeout = setTimeout(() => reject(new Error('Bundled worker timed out')), 5000)
    worker.onmessage = event => {
      if (event.data.id !== requestId) return
      clearTimeout(timeout)
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.value)
    }
    worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)) }
    worker.postMessage({ id: requestId, type, pcm: values, sampleRate }, [values.buffer])
  })
  try {
    // Held-out slice verifies browser worker / transferable / feature plumbing,
    // not an independent reference for the user's live song.
    const started = performance.now()
    await request('reference', pcm.slice())
    const result = await request('query', pcm.slice(sampleRate * 2, sampleRate * 10))
    return { ...result, expectedStartMs: 2000, offsetErrorMs: result.sourceStartMs - 2000, elapsedMs: performance.now() - started }
  } finally { worker.terminate() }
}
;(async () => {
  let stream, context, node
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } })
    stream.getVideoTracks().forEach(track => track.stop())
    if (!stream.getAudioTracks().length) throw new Error('No loopback audio track')
    context = new AudioContext({ sampleRate: 8000 })
    await context.resume()
    await context.audioWorklet.addModule(new URL('../public/audio-sync-worklet.js', document.baseURI).href)
    const source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, 'syllable-audio-capture')
    const startedAtMs = Date.now()
    const block = await new Promise(resolve => {
      node.port.onmessage = event => { node.port.onmessage = null; resolve(event.data) }
      source.connect(node); node.connect(context.destination)
    })
    const endedAtMs = Date.now() - Math.max(0, context.currentTime - block.endContextTime) * 1000
    node.disconnect(); stream.getTracks().forEach(track => track.stop())
    const acousticSmoke = await verifyBundledWorker(block.pcm, context.sampleRate)
    ipcRenderer.send('probe-result', { pcm: block.pcm.buffer, sampleRate: context.sampleRate, startedAtMs, endedAtMs, acousticSmoke })
  } catch (error) { ipcRenderer.send('probe-result', { error: String(error) }) }
  finally { node?.disconnect(); stream?.getTracks().forEach(track => track.stop()); await context?.close() }
})()
