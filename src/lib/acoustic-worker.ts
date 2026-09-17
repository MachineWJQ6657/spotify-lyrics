import { fingerprint, matchFingerprint, type AudioFingerprint } from '../../electron/audio-sync/fingerprint'

let reference: AudioFingerprint | null = null
self.onmessage = (event: MessageEvent<{ id: number; type: 'reference' | 'query' | 'clear'; pcm?: Float32Array; sampleRate?: number }>) => {
  const { id, type, pcm, sampleRate } = event.data
  try {
    if (type === 'clear') { reference = null; self.postMessage({ id, value: true }); return }
    if (!pcm || !sampleRate) throw new Error('Missing PCM audio')
    const features = fingerprint(pcm, sampleRate)
    if (type === 'reference') {
      reference = features
      self.postMessage({ id, value: { durationMs: features.durationMs, bytes: features.frames.byteLength + features.active.byteLength } })
    } else {
      if (!reference) throw new Error('请先导入参考音频')
      self.postMessage({ id, value: matchFingerprint(reference, features) })
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
}
