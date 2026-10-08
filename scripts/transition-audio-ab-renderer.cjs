const { ipcRenderer } = require('electron')
let active = null
async function stop() {
  if (!active) return
  const capture = active; active = null; capture.cancelled = true
  capture.node?.disconnect(); capture.source?.disconnect()
  capture.stream?.getTracks().forEach(track => track.stop())
  await capture.context?.close()
}
ipcRenderer.on('ab-stop', () => { void stop() })
ipcRenderer.on('ab-capture', async (_event, request) => {
  if (active || !['before', 'after'].includes(request.phase) || ![1, 3].includes(request.blocks)) return
  const capture = { cancelled: false }; active = capture
  try {
    capture.stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } })
    capture.stream.getVideoTracks().forEach(track => track.stop())
    if (capture.cancelled) { capture.stream.getTracks().forEach(track => track.stop()); return }
    if (!capture.stream.getAudioTracks().length) throw new Error('No system loopback audio track')
    capture.context = new AudioContext({ sampleRate: 48000 })
    await capture.context.resume()
    await capture.context.audioWorklet.addModule(new URL('../public/audio-sync-worklet.js', document.baseURI).href)
    if (capture.cancelled) return
    capture.source = capture.context.createMediaStreamSource(capture.stream)
    capture.node = new AudioWorkletNode(capture.context, 'syllable-audio-capture')
    const chunks = [], blocks = []
    await new Promise((resolve, reject) => {
      capture.node.onprocessorerror = () => reject(new Error('Audio worklet failed'))
      capture.node.port.onmessage = event => {
        if (capture.cancelled) return reject(new Error('Capture cancelled'))
        const block = event.data
        if (!(block.pcm instanceof Float32Array) || block.sampleRate !== 48000 || block.pcm.length !== 576000) return reject(new Error('Unexpected worklet block'))
        const endedAtMs = Date.now() - Math.max(0, capture.context.currentTime - block.endContextTime) * 1000
        blocks.push({ startedAtMs: endedAtMs - 12000, endedAtMs, endContextTime: block.endContextTime })
        chunks.push(block.pcm)
        if (chunks.length === request.blocks) resolve()
      }
      ipcRenderer.send('ab-started', { phase: request.phase, startedAtMs: Date.now() })
      capture.source.connect(capture.node); capture.node.connect(capture.context.destination)
    })
    const pcm = new Float32Array(chunks.length * 576000)
    chunks.forEach((chunk, index) => pcm.set(chunk, index * 576000))
    ipcRenderer.send('ab-result', { phase: request.phase, pcm: pcm.buffer, sampleRate: 48000,
      startedAtMs: blocks[0].startedAtMs, endedAtMs: blocks.at(-1).endedAtMs, blocks })
  } catch (error) { if (!capture.cancelled) ipcRenderer.send('ab-result', { phase: request.phase, error: String(error) }) }
  finally { if (active === capture) await stop() }
})
