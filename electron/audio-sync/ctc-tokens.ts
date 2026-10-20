/** CTC emissions deliberately do not implement HeardToken. A CTC emission
 * peak is not a Whisper DTW point or a measured phoneme/lyric onset. */
export interface CtcToken {
  phone: string
  id: number
  firstFrame: number
  lastFrameExclusive: number
  frameStartMs: number
  frameEndMs: number
  /** Softmax posterior, not a calibrated synchronization confidence. */
  meanPosterior: number
  minPosterior: number
  maxPosterior: number
}

export interface CtcGeometry {
  sampleRate: number
  sampleCount: number
  strideSamples: number
  receptiveFieldSamples: number
}
export interface CtcOutput {
  geometry: CtcGeometry
  vocabulary: string[]
  blankId: number
  /** Flat, frame-major logits. Never generated from just argmax IDs. */
  logits: Float32Array
  predictedIds?: Int32Array | BigInt64Array
}
export type CtcDecode = { reason: 'decoded' | 'blank' | 'invalid-input' | 'unsupported-label'; tokens: CtcToken[] }

/** Bounded, prompt-free greedy evidence decoding. Frame geometry must come
 * from the model, including its convolution padding/receptive field. This
 * implementation accepts only the explicitly verified no-padding geometry.
 * It never divides recording duration by output length to fabricate times. */
export function decodeCtcFrames(value: CtcOutput): CtcDecode {
  const reject = (reason: 'invalid-input' | 'unsupported-label'): CtcDecode => ({ reason, tokens: [] })
  if (!value || !value.geometry || !Array.isArray(value.vocabulary)
    || value.vocabulary.length < 2 || value.vocabulary.length > 512
    || value.vocabulary.some(label => typeof label !== 'string' || !label || label.length > 32)
    || new Set(value.vocabulary).size !== value.vocabulary.length
    || !Number.isInteger(value.blankId) || value.blankId < 0 || value.blankId >= value.vocabulary.length
    || !(value.logits instanceof Float32Array) || value.logits.length > 1_000_000) return reject('invalid-input')
  const { sampleRate, sampleCount, strideSamples, receptiveFieldSamples } = value.geometry
  if (![sampleRate, sampleCount, strideSamples, receptiveFieldSamples].every(Number.isInteger)
    || sampleRate !== 16000 || sampleCount < 96000 || sampleCount > 480000
    || strideSamples < 80 || strideSamples > 1600 || receptiveFieldSamples < strideSamples
    || receptiveFieldSamples > 3200) return reject('invalid-input')
  const frames = Math.floor((sampleCount - receptiveFieldSamples) / strideSamples) + 1
  const width = value.vocabulary.length
  if (frames < 2 || frames > 6000 || value.logits.length !== frames * width
    || (value.predictedIds !== undefined && (!(value.predictedIds instanceof Int32Array || value.predictedIds instanceof BigInt64Array)
      || value.predictedIds.length !== frames))) return reject('invalid-input')
  const result: CtcToken[] = []
  let previousId = -1
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * width
    let best = 0, maximum = -Infinity
    for (let id = 0; id < width; id++) {
      const score = value.logits[offset + id]
      if (!Number.isFinite(score)) return reject('invalid-input')
      if (score > maximum) { maximum = score; best = id }
    }
    // Preserve the original model output as an independent export-equivalence
    // check. Lossy argmax-only models cannot manufacture posterior values.
    if (value.predictedIds && Number(value.predictedIds[frame]) !== best) return reject('invalid-input')
    if (best !== value.blankId) {
      const phone = value.vocabulary[best]
      // Case matters: N is a nasal, and cl is a closure. Unknown/start/end
      // labels interrupt evidence instead of disappearing between words.
      if (!/^(?:[a-z]{1,4}|N|I|U)$/.test(phone)) return reject('unsupported-label')
      let denominator = 0
      for (let id = 0; id < width; id++) denominator += Math.exp(value.logits[offset + id] - maximum)
      const posterior = 1 / denominator
      const previous = result.at(-1)
      if (previousId === best && previous) {
        const count = previous.lastFrameExclusive - previous.firstFrame
        previous.meanPosterior = (previous.meanPosterior * count + posterior) / (count + 1)
        previous.minPosterior = Math.min(previous.minPosterior, posterior)
        previous.maxPosterior = Math.max(previous.maxPosterior, posterior)
        previous.lastFrameExclusive = frame + 1
        previous.frameEndMs = (frame * strideSamples + receptiveFieldSamples) / sampleRate * 1000
      } else {
        result.push({ phone, id: best, firstFrame: frame, lastFrameExclusive: frame + 1,
          frameStartMs: frame * strideSamples / sampleRate * 1000,
          frameEndMs: (frame * strideSamples + receptiveFieldSamples) / sampleRate * 1000,
          meanPosterior: posterior, minPosterior: posterior, maxPosterior: posterior })
      }
    }
    previousId = best
  }
  return { reason: result.length ? 'decoded' : 'blank', tokens: result }
}
