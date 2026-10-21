import { decodeCtcFrames, type CtcGeometry, type CtcOutput } from './ctc-tokens'
import type { CtcAlignedLabel } from './ctc-phrase-scorer'

/** One ordinary phone, never an unknown word or a wildcard. Node indices are
 * stable identifiers; callers may retain reading/source metadata separately. */
export interface CtcPhoneGraphNode {
  phoneId: number
  previous: readonly number[]
  kind?: 'phone'
}
export interface CtcPhoneGraph {
  nodes: readonly CtcPhoneGraphNode[]
  finalNodes: readonly number[]
}
export interface CtcGraphAlignedLabel extends CtcAlignedLabel { nodeId: number }
export interface CtcGraphScore {
  /** A minimum-cost mathematical fit, not acceptance or an onset observation. */
  reason: 'scored'
  regret: number
  labelRegret: number
  blankRegret: number
  regretPerLabel: number
  labelCount: number
  pathLogProbability: number
  firstFrame: number
  /** Extrema of ALL exactly minimum-cost paths at the selected terminal
   * frame. firstFrame/labels above describe only one witness of that set. */
  firstFrameRange: { earliest: number; latest: number }
  lastFrameExclusive: number
  peakDistanceMs: number
  frameCoverageMs: number
  activeMismatchFrames: number
  activeMismatchRegret: number
  maxLabelRegret: number
  pathNodeIds: number[]
  labels: CtcGraphAlignedLabel[]
  /** The best final PHONE cost at each frame, not a sum over paths and not
   * proof that the best start/reading is unique. No trailing blank is scored. */
  endRegrets: Float64Array
  /** Original graph node selected at each terminal frame, or -1 if no path. */
  endNodeIds: Int16Array
  /** Inclusive extrema of the first frame among all exactly minimum-cost
   * paths at each ending, or -1 when unreachable. No near-cost pruning. */
  endFirstFramesEarliest: Int32Array
  endFirstFramesLatest: Int32Array
}
type Rejected = { reason: 'invalid-target' | 'work-budget' | 'unreachable' }
export interface CtcGraphScoreOptions {
  /** Trace the best path ending at this actual recording frame instead of the
   * global minimum. Does not establish a unique start at that frame. */
  endFrame?: number
}
export interface CtcGraphScorer {
  readonly frames: number
  readonly geometry: Readonly<CtcGeometry>
  readonly vocabulary: readonly string[]
  score(graph: CtcPhoneGraph, options?: CtcGraphScoreOptions): CtcGraphScore | Rejected
}

/** Shares pronunciation prefixes/suffixes without enumerating their Cartesian
 * product. Each node has one emission and one blank-after state. Only roots
 * (previous=[]) can start in the free greedy background. Equal adjacent phones
 * must traverse a real blank frame, including at branch joins. */
export function prepareCtcGraphScorer(value: CtcOutput): { reason: 'ready'; scorer: CtcGraphScorer }
  | { reason: 'invalid-input' | 'unsupported-label' } {
  const decoded = decodeCtcFrames(value)
  if (decoded.reason === 'invalid-input' || decoded.reason === 'unsupported-label') return { reason: decoded.reason }
  const vocabulary = Object.freeze([...value.vocabulary]), width = vocabulary.length
  const geometry = Object.freeze({ ...value.geometry }), blankId = value.blankId
  const frames = value.logits.length / width
  const costs = new Float64Array(value.logits.length), normalizers = new Float64Array(frames)
  const greedy = new Uint16Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * width
    let maximum = -Infinity, best = 0
    for (let id = 0; id < width; id++) if (value.logits[offset + id] > maximum) { maximum = value.logits[offset + id]; best = id }
    let denominator = 0
    for (let id = 0; id < width; id++) {
      const cost = maximum - value.logits[offset + id]
      costs[offset + id] = cost; denominator += Math.exp(-cost)
    }
    normalizers[frame] = Math.log(denominator); greedy[frame] = best
  }
  const scorer: CtcGraphScorer = {
    frames, geometry, vocabulary,
    score(graph, options) {
      if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)
        || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
        || Reflect.ownKeys(options).some(key => key !== 'endFrame')
        || ('endFrame' in options && (!Number.isInteger(options.endFrame) || options.endFrame! < 0 || options.endFrame! >= frames)))) {
        return { reason: 'invalid-target' }
      }
      const requestedEnd = options?.endFrame
      if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !graph.nodes.length
        || !Array.isArray(graph.finalNodes) || !graph.finalNodes.length) return { reason: 'invalid-target' }
      const count = graph.nodes.length, states = 2 * count + 1
      if (count > 256 || frames * states > 1_000_000) return { reason: 'work-budget' }
      if (graph.finalNodes.length > count) return { reason: 'invalid-target' }
      const ids: number[] = [], parents: number[][] = [], outgoing: number[][] = Array.from({ length: count }, () => [])
      let edges = 0
      for (let nodeId = 0; nodeId < count; nodeId++) {
        const node = graph.nodes[nodeId]
        // Extra source metadata is harmless, but an explicit unknown/wildcard
        // node must never silently become an ordinary constrained phone.
        if (!node || typeof node !== 'object' || (node.kind !== undefined && node.kind !== 'phone')
          || 'wildcard' in node || 'unknownWord' in node
          || !Number.isInteger(node.phoneId) || node.phoneId < 0 || node.phoneId >= width || node.phoneId === blankId
          || !/^(?:[a-z]{1,4}|N|I|U)$/.test(vocabulary[node.phoneId]) || !Array.isArray(node.previous)) return { reason: 'invalid-target' }
        edges += node.previous.length
        if (edges > 1024) return { reason: 'work-budget' }
        // Spreading also makes sparse array holes explicit, so they cannot
        // evade validation via Array.prototype.some's hole-skipping behavior.
        const nodeParents: number[] = [...node.previous]
        if (nodeParents.some(id => !Number.isInteger(id) || id < 0 || id >= count || id === nodeId)
          || new Set(nodeParents).size !== nodeParents.length) return { reason: 'invalid-target' }
        ids.push(node.phoneId); parents.push(nodeParents)
        for (const parent of nodeParents) outgoing[parent].push(nodeId)
      }
      if (frames * (states + edges) > 2_000_000) return { reason: 'work-budget' }
      const finals = [...graph.finalNodes]
      if (finals.some(id => !Number.isInteger(id) || id < 0 || id >= count) || new Set(finals).size !== finals.length) {
        return { reason: 'invalid-target' }
      }
      // Validate a genuine DAG, while keeping all original indices in traces.
      const degrees = parents.map(nodes => nodes.length), queue: number[] = []
      for (let i = 0; i < count; i++) if (!degrees[i]) queue.push(i)
      for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const child of outgoing[queue[cursor]]) if (!--degrees[child]) queue.push(child)
      }
      if (queue.length !== count) return { reason: 'invalid-target' }
      const trace = new Int16Array(frames * states).fill(-1)
      let previous = new Float64Array(states).fill(Infinity), current = new Float64Array(states)
      let previousEarliest = new Int32Array(states).fill(-1), currentEarliest = new Int32Array(states)
      let previousLatest = new Int32Array(states).fill(-1), currentLatest = new Int32Array(states)
      previous[0] = 0
      let bestRegret = Infinity, bestEnd = -1, bestNode = -1
      const endRegrets = new Float64Array(frames).fill(Infinity), endNodeIds = new Int16Array(frames).fill(-1)
      const endFirstFramesEarliest = new Int32Array(frames).fill(-1), endFirstFramesLatest = new Int32Array(frames).fill(-1)
      const consider = (state: number, parent: number, frame: number, regret: number) => {
        const candidate = previous[parent] + regret
        if (!Number.isFinite(candidate)) return
        const earliest = parent === 0 ? frame : previousEarliest[parent]
        const latest = parent === 0 ? frame : previousLatest[parent]
        if (candidate < current[state]) {
          current[state] = candidate; currentEarliest[state] = earliest; currentLatest[state] = latest
          trace[frame * states + state] = parent
        } else if (candidate === current[state]) {
          // Keep the actual witness trace, but do not discard other optimal
          // starts. Aggregate after emission addition, including exact ties
          // caused by floating-point rounding of two parent costs.
          currentEarliest[state] = Math.min(currentEarliest[state], earliest)
          currentLatest[state] = Math.max(currentLatest[state], latest)
        }
      }
      for (let frame = 0; frame < frames; frame++) {
        current.fill(Infinity); currentEarliest.fill(-1); currentLatest.fill(-1)
        const offset = frame * width
        current[0] = 0
        for (let nodeId = 0; nodeId < count; nodeId++) {
          const emission = 2 * nodeId + 1, blank = emission + 1, id = ids[nodeId]
          const phoneRegret = costs[offset + id], blankCost = costs[offset + blankId]
          consider(emission, emission, frame, phoneRegret)
          if (!parents[nodeId].length) consider(emission, 0, frame, phoneRegret)
          for (const parent of parents[nodeId]) {
            const parentEmission = 2 * parent + 1, parentBlank = parentEmission + 1
            consider(emission, parentBlank, frame, phoneRegret)
            if (id !== ids[parent]) consider(emission, parentEmission, frame, phoneRegret)
          }
          // No transition from a node's own blank BACK to its emission: that
          // would insert an unrepresented duplicate phone in a single node.
          consider(blank, blank, frame, blankCost)
          consider(blank, emission, frame, blankCost)
        }
        let terminal = Infinity, terminalNode = -1, earliest = -1, latest = -1
        for (const nodeId of finals) {
          const state = 2 * nodeId + 1, candidate = current[state]
          if (!Number.isFinite(candidate)) continue
          if (candidate < terminal) {
            terminal = candidate; terminalNode = nodeId; earliest = currentEarliest[state]; latest = currentLatest[state]
          } else if (candidate === terminal) {
            earliest = Math.min(earliest, currentEarliest[state]); latest = Math.max(latest, currentLatest[state])
          }
        }
        endRegrets[frame] = terminal; endNodeIds[frame] = terminalNode
        endFirstFramesEarliest[frame] = earliest; endFirstFramesLatest[frame] = latest
        if (terminal < bestRegret) { bestRegret = terminal; bestEnd = frame; bestNode = terminalNode }
        const swap = previous; previous = current; current = swap
        const swapEarliest = previousEarliest; previousEarliest = currentEarliest; currentEarliest = swapEarliest
        const swapLatest = previousLatest; previousLatest = currentLatest; currentLatest = swapLatest
      }
      if (requestedEnd !== undefined) {
        bestEnd = requestedEnd; bestRegret = endRegrets[requestedEnd]; bestNode = endNodeIds[requestedEnd]
      }
      if (bestEnd < 0 || bestNode < 0 || !Number.isFinite(bestRegret)) return { reason: 'unreachable' }
      let state = 2 * bestNode + 1, start = bestEnd, pathLogProbability = 0, labelRegret = 0, blankRegret = 0
      let activeMismatchFrames = 0, activeMismatchRegret = 0
      const byNode = new Map<number, CtcGraphAlignedLabel>()
      const reversedNodeIds: number[] = []
      for (let frame = bestEnd; frame >= 0 && state > 0; frame--) {
        const parentState = trace[frame * states + state]
        if (parentState < 0) return { reason: 'unreachable' }
        start = frame
        const nodeId = Math.floor((state - 1) / 2), isPhone = state % 2 === 1, id = isPhone ? ids[nodeId] : blankId
        const regret = costs[frame * width + id]
        pathLogProbability -= regret + normalizers[frame]
        if (greedy[frame] !== blankId && greedy[frame] !== id) { activeMismatchFrames++; activeMismatchRegret += regret }
        if (isPhone) {
          let token = byNode.get(nodeId)
          if (!token) {
            token = { nodeId, id, phone: vocabulary[id], firstFrame: frame, lastFrameExclusive: frame + 1,
              frameStartMs: 0, frameEndMs: 0, minPosterior: 1, meanPosterior: 0, peakPosterior: 0,
              greedyFrames: 0, substitutionRegret: 0 }
            byNode.set(nodeId, token); reversedNodeIds.push(nodeId)
          }
          const posterior = Math.exp(-regret - normalizers[frame])
          token.firstFrame = frame; token.minPosterior = Math.min(token.minPosterior, posterior)
          token.meanPosterior += posterior; token.peakPosterior = Math.max(token.peakPosterior, posterior)
          token.greedyFrames += Number(greedy[frame] === id); token.substitutionRegret += regret
          labelRegret += regret
        } else blankRegret += regret
        state = parentState
      }
      if (state !== 0) return { reason: 'unreachable' }
      const pathNodeIds = reversedNodeIds.reverse(), labels = pathNodeIds.map(id => byNode.get(id)!)
      for (const label of labels) {
        label.meanPosterior /= label.lastFrameExclusive - label.firstFrame
        label.frameStartMs = label.firstFrame * geometry.strideSamples / geometry.sampleRate * 1000
        label.frameEndMs = ((label.lastFrameExclusive - 1) * geometry.strideSamples + geometry.receptiveFieldSamples) / geometry.sampleRate * 1000
      }
      return { reason: 'scored', regret: bestRegret, labelRegret, blankRegret, regretPerLabel: bestRegret / labels.length,
        labelCount: labels.length, pathLogProbability, firstFrame: start, lastFrameExclusive: bestEnd + 1,
        firstFrameRange: { earliest: endFirstFramesEarliest[bestEnd], latest: endFirstFramesLatest[bestEnd] },
        peakDistanceMs: (bestEnd - start) * geometry.strideSamples / geometry.sampleRate * 1000,
        frameCoverageMs: ((bestEnd - start) * geometry.strideSamples + geometry.receptiveFieldSamples) / geometry.sampleRate * 1000,
        activeMismatchFrames, activeMismatchRegret, maxLabelRegret: Math.max(...labels.map(label => label.substitutionRegret)),
        pathNodeIds, labels, endRegrets, endNodeIds, endFirstFramesEarliest, endFirstFramesLatest }
    },
  }
  return { reason: 'ready', scorer: Object.freeze(scorer) }
}
