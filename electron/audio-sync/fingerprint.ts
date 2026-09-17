/** Local spectral alignment prototype. No Spotify timestamps enter the matcher. */
export interface AudioFingerprint {
  version: 1
  frames: Float32Array
  active: Uint8Array
  dimensions: number
  stepMs: number
  centerMs: number
  durationMs: number
}

export interface AcousticMatch {
  accepted: boolean
  reason: 'matched' | 'silence' | 'too-short' | 'low-score' | 'ambiguous'
  /** Reference recording position at the END of the captured audio. */
  sourceEndMs: number
  sourceStartMs: number
  rate: number
  score: number
  runnerUpScore: number
  margin: number
}

const SAMPLE_RATE = 8000
const SIZE = 1024
const HOP = 400
const BANDS = 48
const DIMENSIONS = BANDS * 2

/** Area averaging avoids the worst aliasing from selecting every Nth sample. */
function downsample(pcm: Float32Array, sampleRate: number) {
  const ratio = sampleRate / SAMPLE_RATE
  const output = new Float32Array(Math.floor(pcm.length / ratio))
  for (let index = 0; index < output.length; index++) {
    const start = index * ratio
    const end = (index + 1) * ratio
    let sum = 0
    for (let source = Math.floor(start); source < Math.ceil(end); source++) {
      const weight = Math.min(source + 1, end) - Math.max(source, start)
      const value = pcm[source] ?? 0
      sum += (Number.isFinite(value) ? value : 0) * weight
    }
    output[index] = sum / ratio
  }
  return output
}

function fft(real: Float64Array, imaginary: Float64Array) {
  const size = real.length
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]] }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length
    const wr = Math.cos(angle), wi = Math.sin(angle)
    for (let start = 0; start < size; start += length) {
      let r = 1, im = 0
      for (let j = 0; j < length / 2; j++) {
        const a = start + j, b = a + length / 2
        const br = real[b] * r - imaginary[b] * im
        const bi = real[b] * im + imaginary[b] * r
        real[b] = real[a] - br; imaginary[b] = imaginary[a] - bi
        real[a] += br; imaginary[a] += bi
        const next = r * wr - im * wi
        im = r * wi + im * wr; r = next
      }
    }
  }
}

export function fingerprint(pcm: Float32Array, sampleRate: number): AudioFingerprint {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported audio sample rate')
  if (pcm.length > sampleRate * 600) throw new Error('Reference exceeds the 10-minute prototype limit')
  const samples = downsample(pcm, sampleRate)
  const count = Math.max(0, Math.floor((samples.length - SIZE) / HOP) + 1)
  const frames = new Float32Array(count * BANDS)
  const active = new Uint8Array(count)
  const real = new Float64Array(SIZE), imaginary = new Float64Array(SIZE)
  const window = Float64Array.from({ length: SIZE }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (SIZE - 1)))
  const binBands = Int16Array.from({ length: SIZE / 2 }, (_, i) => {
    const hz = i * SAMPLE_RATE / SIZE
    return hz < 80 || hz >= 3600 ? -1 : Math.min(BANDS - 1, Math.floor(Math.log(hz / 80) / Math.log(3600 / 80) * BANDS))
  })
  const powers = new Float64Array(BANDS)
  for (let frame = 0; frame < count; frame++) {
    let energy = 0
    for (let i = 0; i < SIZE; i++) {
      const value = samples[frame * HOP + i]
      energy += value * value
      real[i] = value * window[i]; imaginary[i] = 0
    }
    if (energy / SIZE < 1e-8) continue
    fft(real, imaginary)
    powers.fill(0)
    let total = 0
    for (let bin = 0; bin < binBands.length; bin++) {
      const band = binBands[bin]
      if (band < 0) continue
      const power = real[bin] ** 2 + imaginary[bin] ** 2
      powers[band] += power; total += power
    }
    let mean = 0
    for (let band = 0; band < BANDS; band++) {
      powers[band] = Math.log1p(1000 * powers[band] / Math.max(1e-12, total))
      mean += powers[band] / BANDS
    }
    let norm = 0
    for (let band = 0; band < BANDS; band++) norm += (powers[band] - mean) ** 2
    if (norm < 1e-8) continue
    norm = Math.sqrt(norm)
    for (let band = 0; band < BANDS; band++) frames[frame * BANDS + band] = (powers[band] - mean) / norm
    active[frame] = 1
  }
  // 150ms averaging reduces codec / tempo-stretcher phase artifacts.
  const smoothed = new Float32Array(frames.length)
  for (let frame = 0; frame < count; frame++) {
    for (let band = 0; band < BANDS; band++) {
      for (let neighbor = Math.max(0, frame - 1); neighbor <= Math.min(count - 1, frame + 1); neighbor++) {
        smoothed[frame * BANDS + band] += frames[neighbor * BANDS + band] / (Math.min(count - 1, frame + 1) - Math.max(0, frame - 1) + 1)
      }
    }
  }
  frames.set(smoothed)
  // Static instrument timbre alone matches many unrelated parts of a song.
  // Add normalized spectral change across 250ms to distinguish musical events.
  const features = new Float32Array(count * DIMENSIONS)
  for (let frame = 0; frame < count; frame++) {
    const earlier = Math.max(0, frame - 5)
    let norm = 0
    for (let band = 0; band < BANDS; band++) norm += (frames[frame * BANDS + band] - frames[earlier * BANDS + band]) ** 2
    norm = Math.sqrt(norm)
    for (let band = 0; band < BANDS; band++) {
      features[frame * DIMENSIONS + band] = frames[frame * BANDS + band] * Math.sqrt(.35)
      features[frame * DIMENSIONS + BANDS + band] = (frames[frame * BANDS + band] - frames[earlier * BANDS + band]) / Math.max(.1, norm) * Math.sqrt(.65)
    }
    let featureNorm = 0
    for (let band = 0; band < DIMENSIONS; band++) featureNorm += features[frame * DIMENSIONS + band] ** 2
    featureNorm = Math.sqrt(featureNorm)
    if (featureNorm > 0) for (let band = 0; band < DIMENSIONS; band++) features[frame * DIMENSIONS + band] /= featureNorm
  }
  return { version: 1, frames: features, active, dimensions: DIMENSIONS, stepMs: HOP / SAMPLE_RATE * 1000,
    centerMs: SIZE / SAMPLE_RATE * 500, durationMs: pcm.length / sampleRate * 1000 }
}

/** Search an independent reference over position AND local playback speed.
 * A short segment approximates moderate tempo automation with one local rate.
 * Repeated choruses must win by a margin; a Spotify-position prior is never
 * used to turn an ambiguous match into a confident audio observation.
 */
export function matchFingerprint(reference: AudioFingerprint, query: AudioFingerprint): AcousticMatch {
  if (reference.version !== 1 || query.version !== 1 || reference.dimensions !== query.dimensions
    || reference.stepMs !== query.stepMs || reference.dimensions !== DIMENSIONS
    || reference.frames.length !== reference.active.length * DIMENSIONS || query.frames.length !== query.active.length * DIMENSIONS) throw new Error('Incompatible fingerprints')
  const empty = (reason: AcousticMatch['reason']): AcousticMatch => ({ accepted: false, reason, sourceEndMs: 0, sourceStartMs: 0, rate: 1, score: 0, runnerUpScore: 0, margin: 0 })
  if (query.durationMs < 6000 || query.durationMs > 15000 || reference.durationMs < query.durationMs * .8) return empty('too-short')
  const count = query.active.length, referenceCount = reference.active.length
  const activeCount = query.active.reduce((sum, value) => sum + value, 0)
  if (activeCount < count * .7) return empty('silence')
  // A held tone can correlate perfectly at many positions while carrying no
  // timing information. Even a short reference with no runner-up must reject it.
  let changingFrames = 0
  for (let frame = 5; frame < count; frame++) {
    let changeEnergy = 0
    for (let band = BANDS; band < DIMENSIONS; band++) changeEnergy += query.frames[frame * DIMENSIONS + band] ** 2
    if (changeEnergy > .08) changingFrames++
  }
  if (changingFrames < count * .2) return empty('ambiguous')
  const similarity = (start: number, rate: number, stride: number) => {
    if (start < 0 || Math.round(start + rate * (count - 1)) >= referenceCount) return -1
    let sum = 0, used = 0
    for (let frame = 5; frame < count; frame += stride) {
      if (!query.active[frame]) continue
      used++
      const index = Math.round(start + frame * rate)
      if (!reference.active[index]) continue
      let dot = 0
      for (let band = 0; band < DIMENSIONS; band++) dot += query.frames[frame * DIMENSIONS + band] * reference.frames[index * DIMENSIONS + band]
      sum += dot
    }
    return used ? sum / used : -1
  }
  const candidates: Array<{ start: number; rate: number; score: number }> = []
  // 200ms coarse search, followed by a 12.5ms / 0.25% local refinement.
  for (let start = 0; start < referenceCount - count * .8; start += 4) {
    let best = { start, rate: 1, score: -1 }
    for (let step = 0; step <= 20; step++) {
      const rate = .8 + step * .02
      const score = similarity(start, rate, 2)
      if (score > best.score) best = { start, rate, score }
    }
    candidates.push(best)
  }
  candidates.sort((a, b) => b.score - a.score)
  if (!candidates.length) return empty('too-short')
  const peaks: typeof candidates = []
  for (const candidate of candidates) {
    if (peaks.every(peak => Math.abs(peak.start - candidate.start) * query.stepMs > 2500)) peaks.push(candidate)
    if (peaks.length === 4) break
  }
  const refined = peaks.map(peak => {
    let best = { ...peak, score: similarity(peak.start, peak.rate, 1) }
    for (let start = Math.max(0, peak.start - 4); start <= peak.start + 4; start += .25) {
      for (let step = -8; step <= 8; step++) {
        const rate = peak.rate + step * .0025
        if (rate < .8 || rate > 1.2) continue
        const score = similarity(start, rate, 1)
        if (score > best.score) best = { start, rate, score }
      }
    }
    return best
  }).sort((a, b) => b.score - a.score)
  const best = refined[0]
  const runnerUpScore = refined[1]?.score ?? 0
  const margin = best.score - runnerUpScore
  const reason = best.score < .8 ? 'low-score' : margin < .075 ? 'ambiguous' : 'matched'
  const sourceStartMs = best.start * reference.stepMs + reference.centerMs - best.rate * query.centerMs
  return { accepted: reason === 'matched', reason, sourceStartMs, sourceEndMs: sourceStartMs + query.durationMs * best.rate,
    rate: best.rate, score: best.score, runnerUpScore, margin }
}
