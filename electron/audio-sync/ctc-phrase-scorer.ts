import { decodeCtcFrames, type CtcGeometry, type CtcOutput } from './ctc-tokens'

export interface CtcAlignedLabel {
  id: number
  phone: string
  firstFrame: number
  lastFrameExclusive: number
  frameStartMs: number
  frameEndMs: number
  minPosterior: number
  meanPosterior: number
  peakPosterior: number
  greedyFrames: number
  substitutionRegret: number
}
export interface CtcPhraseScore {
  /** Mathematical fit only. Even wrong text/all-blank audio can be forced. */
  reason: 'scored'
  regret: number
  regretPerLabel: number
  labelCount: number
  /** Probability of the minimum-regret path, not summed CTC forward mass. */
  pathLogProbability: number
  firstFrame: number
  lastFrameExclusive: number
  peakDistanceMs: number
  frameCoverageMs: number
  activeMismatchFrames: number
  activeMismatchRegret: number
  blankRegret: number
  maxLabelRegret: number
  labels: CtcAlignedLabel[]
  /** Best cost at EACH terminal frame, not all paths at that frame. Neither
   * this array nor the returned best path can establish a unique start. */
  endRegrets: Float64Array
}
type Rejected = { reason: 'invalid-target' | 'work-budget' | 'unreachable' }
export interface CtcPhraseScorer {
  readonly frames: number
  readonly geometry: Readonly<CtcGeometry>
  readonly vocabulary: readonly string[]
  score(ids: readonly number[]): CtcPhraseScore | Rejected
}

/** Independent candidate verification, never ASR prompting or an accepted
 * lyric clock. Compare source alternatives separately and retain ambiguity.
 * Costs are greedy-path log likelihood minus constrained-path log likelihood
 * on the SAME frames. Free leading/trailing audio is not forced to silence.
 * Per-label regret is diagnostic, not calibrated across different lengths. */
export function prepareCtcPhraseScorer(value: CtcOutput): { reason: 'ready'; scorer: CtcPhraseScorer }
  | { reason: 'invalid-input' | 'unsupported-label' } {
  const decoded = decodeCtcFrames(value)
  if (decoded.reason === 'invalid-input' || decoded.reason === 'unsupported-label') return { reason: decoded.reason }
  const vocabulary = Object.freeze([...value.vocabulary]), width = vocabulary.length
  const geometry = Object.freeze({ ...value.geometry }), blankId = value.blankId
  const frames = value.logits.length / width
  const costs = new Float64Array(value.logits.length)
  const normalizers = new Float64Array(frames)
  const greedy = new Uint16Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * width
    let maximum = -Infinity, best = 0
    for (let id = 0; id < width; id++) if (value.logits[offset + id] > maximum) { maximum = value.logits[offset + id]; best = id }
    let denominator = 0
    for (let id = 0; id < width; id++) {
      const cost = maximum - value.logits[offset + id]
      costs[offset + id] = cost
      denominator += Math.exp(-cost)
    }
    normalizers[frame] = Math.log(denominator)
    greedy[frame] = best
  }
  const scorer: CtcPhraseScorer = {
    frames, geometry, vocabulary,
    score(ids) {
      if (!Array.isArray(ids) || !ids.length || [...ids].some(id => !Number.isInteger(id) || id < 0 || id >= width
        || id === blankId || !/^(?:[a-z]{1,4}|N|I|U)$/.test(vocabulary[id]))) return { reason: 'invalid-target' }
      const count = ids.length, states = 2 * count + 1
      if (count > 128 || frames * states > 1_000_000) return { reason: 'work-budget' }
      // Includes one real blank frame between consecutive identical labels.
      const minimumFrames = count + ids.slice(1).filter((id, i) => id === ids[i]).length
      if (minimumFrames > frames) return { reason: 'unreachable' }
      const trace = new Uint8Array(frames * states).fill(255)
      let previous = new Float64Array(states).fill(Infinity)
      previous[0] = 0
      let bestRegret = Infinity, bestEnd = -1
      const endRegrets = new Float64Array(frames).fill(Infinity)
      for (let frame = 0; frame < frames; frame++) {
        const current = new Float64Array(states).fill(Infinity)
        // Free greedy background before the phrase, not blank emission cost.
        current[0] = 0
        for (let state = 1; state < states; state++) {
          const label = state % 2 ? ids[(state - 1) / 2] : blankId
          let cost = previous[state], move = 0
          if (previous[state - 1] < cost) { cost = previous[state - 1]; move = 1 }
          if (state > 2 && state % 2 && label !== ids[(state - 3) / 2] && previous[state - 2] < cost) {
            cost = previous[state - 2]; move = 2
          }
          if (!Number.isFinite(cost)) continue
          current[state] = cost + costs[frame * width + label]
          trace[frame * states + state] = move
        }
        // The last PHONE is the final evidence, never a trailing blank.
        const terminal = current[states - 2]
        endRegrets[frame] = terminal
        if (terminal < bestRegret) { bestRegret = terminal; bestEnd = frame }
        previous = current
      }
      if (bestEnd < 0 || !Number.isFinite(bestRegret)) return { reason: 'unreachable' }
      let state = states - 2, start = bestEnd, logProbability = 0
      let activeMismatchFrames = 0, activeMismatchRegret = 0, blankRegret = 0
      const labels: CtcAlignedLabel[] = Array.from({ length: count }, (_, i) => ({
        id: ids[i], phone: vocabulary[ids[i]], firstFrame: Infinity, lastFrameExclusive: -1,
        frameStartMs: 0, frameEndMs: 0, minPosterior: 1, meanPosterior: 0, peakPosterior: 0, greedyFrames: 0, substitutionRegret: 0,
      }))
      for (let frame = bestEnd; frame >= 0 && state > 0; frame--) {
        start = frame
        const move = trace[frame * states + state]
        if (move === 255) return { reason: 'unreachable' }
        const id = state % 2 ? ids[(state - 1) / 2] : blankId
        const regret = costs[frame * width + id]
        logProbability -= regret + normalizers[frame]
        if (greedy[frame] !== blankId && greedy[frame] !== id) {
          activeMismatchFrames++; activeMismatchRegret += regret
        }
        if (state % 2) {
          const token = labels[(state - 1) / 2]
          const posterior = Math.exp(-regret - normalizers[frame])
          token.firstFrame = frame; token.lastFrameExclusive = Math.max(token.lastFrameExclusive, frame + 1)
          token.minPosterior = Math.min(token.minPosterior, posterior)
          token.peakPosterior = Math.max(token.peakPosterior, posterior)
          token.meanPosterior += posterior
          token.greedyFrames += Number(greedy[frame] === id)
          token.substitutionRegret += regret
        } else blankRegret += regret
        state -= move
      }
      if (state !== 0 || labels.some(label => !Number.isFinite(label.firstFrame) || label.lastFrameExclusive <= label.firstFrame)) return { reason: 'unreachable' }
      for (const label of labels) {
        label.meanPosterior /= label.lastFrameExclusive - label.firstFrame
        label.frameStartMs = label.firstFrame * geometry.strideSamples / geometry.sampleRate * 1000
        label.frameEndMs = ((label.lastFrameExclusive - 1) * geometry.strideSamples + geometry.receptiveFieldSamples) / geometry.sampleRate * 1000
      }
      return { reason: 'scored', regret: bestRegret, regretPerLabel: bestRegret / count, labelCount: count,
        pathLogProbability: logProbability, firstFrame: start, lastFrameExclusive: bestEnd + 1,
        peakDistanceMs: (bestEnd - start) * geometry.strideSamples / geometry.sampleRate * 1000,
        frameCoverageMs: ((bestEnd - start) * geometry.strideSamples + geometry.receptiveFieldSamples) / geometry.sampleRate * 1000,
        activeMismatchFrames, activeMismatchRegret, blankRegret,
        maxLabelRegret: Math.max(...labels.map(label => label.substitutionRegret)), labels, endRegrets }
    },
  }
  return { reason: 'ready', scorer: Object.freeze(scorer) }
}
