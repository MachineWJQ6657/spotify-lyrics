import type { AcousticMatch, AudioFingerprint } from './fingerprint'

/** Research matcher: piecewise-affine subsequence alignment. Each 1-second
 * block advances through 0.8–1.2 seconds of the independent recording. It is
 * not selected by the production worker until the labeled corpus is passed.
 */
export interface WarpedMatch extends AcousticMatch {
  path: Array<{ captureOffsetMs: number; sourcePositionMs: number }>
}

export function matchWarped(reference: AudioFingerprint, query: AudioFingerprint): WarpedMatch {
  const rejected = (reason: AcousticMatch['reason']): WarpedMatch => ({ accepted: false, reason, sourceStartMs: 0, sourceEndMs: 0,
    rate: 1, score: 0, runnerUpScore: 0, margin: 0, path: [] })
  if (reference.version !== 1 || query.version !== 1 || reference.dimensions !== 96 || query.dimensions !== 96
    || reference.stepMs !== 50 || query.stepMs !== 50) throw new Error('Incompatible acoustic features')
  const n = query.active.length, m = reference.active.length
  if (reference.frames.length !== m * 96 || query.frames.length !== n * 96 || n > 300 || m > 12000) throw new Error('Invalid acoustic feature bounds')
  if (![reference.durationMs, query.durationMs, reference.centerMs, query.centerMs].every(Number.isFinite)
    || reference.frames.some(value => !Number.isFinite(value)) || query.frames.some(value => !Number.isFinite(value))) throw new Error('Non-finite acoustic features')
  if (query.durationMs < 6000 || query.durationMs > 15000 || reference.durationMs > 600000 || m < n * .8) return rejected('too-short')
  if (query.active.reduce((sum, value) => sum + value, 0) < n * .7) return rejected('silence')
  const features = (fp: AudioFingerprint) => {
    const count = fp.active.length, base = new Float32Array(count * 48), result = new Float32Array(count * 96)
    for (let i = 0; i < count; i++) {
      let norm = 0
      for (let b = 0; b < 48; b++) norm += fp.frames[i * 96 + b] ** 2
      norm = Math.sqrt(norm)
      if (norm) for (let b = 0; b < 48; b++) base[i * 48 + b] = fp.frames[i * 96 + b] / norm
    }
    const sum = new Float64Array(48)
    for (let i = 0; i < count; i++) {
      let norm = 0
      for (let b = 0; b < 48; b++) {
        sum[b] += base[i * 48 + b]
        if (i >= 40) sum[b] -= base[(i - 40) * 48 + b]
        const residual = base[i * 48 + b] - sum[b] / Math.min(i + 1, 40)
        result[i * 96 + 48 + b] = residual; norm += residual ** 2
      }
      norm = Math.sqrt(norm)
      for (let b = 0; b < 48; b++) {
        result[i * 96 + b] = base[i * 48 + b] * Math.sqrt(.35)
        result[i * 96 + 48 + b] = result[i * 96 + 48 + b] / Math.max(.01, norm) * Math.sqrt(.65)
      }
    }
    return result
  }
  const x = features(query), y = features(reference)
  const first = 40 // causal two-second spectral context must be complete
  // Cache frame affinities once: bounded at ~14 MB for a 15s query/10m song.
  const affinity = new Float32Array(n * m)
  for (let q = first; q < n; q++) {
    if (!query.active[q]) continue
    for (let r = 0; r < m; r++) {
      if (!reference.active[r]) continue
      let dot = 0
      for (let b = 0; b < 96; b++) dot += x[q * 96 + b] * y[r * 96 + b]
      affinity[q * m + r] = dot
    }
  }
  const boundaries = [first]
  while (boundaries.at(-1)! < n - 1) boundaries.push(Math.min(n - 1, boundaries.at(-1)! + 20))
  // Fold tiny terminal blocks into the previous one, avoiding a 50ms rate fit.
  if (boundaries.length > 2 && boundaries.at(-1)! - boundaries.at(-2)! < 10) boundaries.splice(-2, 1)
  let previous = Float64Array.from({ length: m }, (_, r) => affinity[first * m + r])
  const backs: Int8Array[] = []
  for (let block = 1; block < boundaries.length; block++) {
    const from = boundaries[block - 1], to = boundaries[block], span = to - from
    const next = new Float64Array(m).fill(-Infinity), back = new Int8Array(m).fill(-1)
    for (let advance = Math.ceil(span * .8); advance <= Math.floor(span * 1.2); advance++) {
      const offsets = Array.from({ length: span }, (_, i) => Math.round(advance * (i + 1) / span))
      for (let end = advance; end < m; end++) {
        const start = end - advance
        if (!Number.isFinite(previous[start])) continue
        let score = previous[start]
        for (let i = 0; i < span; i++) score += affinity[(from + i + 1) * m + start + offsets[i]]
        if (score > next[end]) { next[end] = score; back[end] = advance }
      }
    }
    backs.push(back); previous = next
  }
  const endpoints = Array.from({ length: m }, (_, end) => ({ end, score: previous[end] / (n - first) }))
    .filter(value => Number.isFinite(value.score)).sort((a, b) => b.score - a.score)
  if (!endpoints.length) return rejected('too-short')
  const best = endpoints[0]
  const runnerUpScore = endpoints.find(value => Math.abs(value.end - best.end) * query.stepMs > 2500)?.score ?? 0
  const indices = [best.end]
  for (let block = backs.length - 1; block >= 0; block--) indices.unshift(indices[0] - backs[block][indices[0]])
  const path = indices.map((r, i) => ({ captureOffsetMs: boundaries[i] * query.stepMs + query.centerMs,
    sourcePositionMs: r * reference.stepMs + reference.centerMs }))
  const firstRate = (indices[1] - indices[0]) / (boundaries[1] - boundaries[0])
  // Fit over the last ~2 seconds. This is endpoint velocity, not capture average.
  const tailIndex = Math.max(0, path.length - 3)
  const rate = (indices.at(-1)! - indices[tailIndex]) / (boundaries.at(-1)! - boundaries[tailIndex])
  const sourceStartMs = path[0].sourcePositionMs - path[0].captureOffsetMs * firstRate
  const sourceEndMs = path.at(-1)!.sourcePositionMs + (query.durationMs - path.at(-1)!.captureOffsetMs) * rate
  path.unshift({ captureOffsetMs: 0, sourcePositionMs: sourceStartMs })
  path.push({ captureOffsetMs: query.durationMs, sourcePositionMs: sourceEndMs })
  const margin = best.score - runnerUpScore
  let reason: AcousticMatch['reason'] = best.score < .8 ? 'low-score' : margin < .075 ? 'ambiguous' : 'matched'
  let tailScore = 0, tailFrames = 0
  for (let i = 1; i < boundaries.length; i++) {
    for (let q = Math.max(boundaries[i - 1] + 1, n - 40); q <= boundaries[i]; q++) {
      const r = Math.round(indices[i - 1] + (indices[i] - indices[i - 1]) * (q - boundaries[i - 1]) / (boundaries[i] - boundaries[i - 1]))
      tailScore += affinity[q * m + r]; tailFrames++
    }
  }
  const tailMean = tailScore / tailFrames
  if (reason === 'matched' && tailMean < .8) reason = 'unconfirmed-end'
  if (reason === 'matched') {
    const tailFrom = n - 40
    // Keep the independent endpoint challenge from the production matcher.
    // The dynamic path must not hide a same-recording seek in its final block.
    for (let start = 0; start + Math.round(39 * rate) < m; start++) {
      const end = start + 39 * rate
      if (Math.abs(end - best.end) * query.stepMs < 500) continue
      let score = 0
      for (let i = 0; i < 40; i++) score += affinity[(tailFrom + i) * m + start + Math.round(i * rate)]
      if (score / 40 > tailMean + .05) { reason = 'unconfirmed-end'; break }
    }
  }
  if (reason === 'matched') {
    // Long causal context changes after a seek. Challenge its endpoint using
    // the original short-context features as well, without lowering either
    // model's acceptance score to compensate for an inconsistent tail.
    const tailFrom = n - 40, rawTail = new Float32Array(40 * m)
    for (let i = 0; i < 40; i++) {
      if (!query.active[tailFrom + i]) continue
      for (let r = 0; r < m; r++) {
        if (!reference.active[r]) continue
        for (let b = 0; b < 96; b++) rawTail[i * m + r] += query.frames[(tailFrom + i) * 96 + b] * reference.frames[r * 96 + b]
      }
    }
    let pathScore = 0
    for (let block = 1; block < boundaries.length; block++) {
      for (let q = Math.max(boundaries[block - 1] + 1, tailFrom); q <= boundaries[block]; q++) {
        const r = Math.round(indices[block - 1] + (indices[block] - indices[block - 1]) * (q - boundaries[block - 1]) / (boundaries[block] - boundaries[block - 1]))
        pathScore += rawTail[(q - tailFrom) * m + r] / 40
      }
    }
    for (let start = 0; start + Math.round(39 * rate) < m; start++) {
      if (Math.abs(start + 39 * rate - best.end) * query.stepMs < 500) continue
      let score = 0
      for (let i = 0; i < 40; i++) score += rawTail[i * m + start + Math.round(i * rate)] / 40
      if (score > pathScore + .05) { reason = 'unconfirmed-end'; break }
    }
  }
  return { accepted: reason === 'matched', reason, sourceStartMs, sourceEndMs, rate, score: best.score, runnerUpScore, margin, path }
}
