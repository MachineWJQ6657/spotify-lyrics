import type { JapaneseWord } from '../romanizer'
import { decodeCtcFrames, type CtcOutput } from './ctc-tokens'
import { prepareCtcGraphScorer, type CtcGraphScore, type CtcPhoneGraph } from './ctc-graph-scorer'
import { mapJapanesePhones, type JapanesePhoneMapping } from './japanese-phonemes'
import { buildJapanesePhoneGraph } from './japanese-phone-graph'
import type { OnsetHypothesisGroup } from './onset-hypotheses'

export interface CtcSourceLine { startMs: number; text: string }
export interface CtcLandmarkCandidate {
  lineIndex: number
  kind: 'line-start' | 'internal-word'
  /** Internal words deliberately have no invented LRC timestamp. */
  sourceMs?: number
  firstWordIndex: number
  lastWordIndex: number
  /** One mathematical witness, NOT a measured singing onset. */
  witnessHeardMs: number
  firstFrameRange: { earliest: number; latest: number }
  lastFrameExclusive: number
  labelCount: number
  firstPeakPosterior: number
  lastPeakPosterior: number
  minPeakPosterior: number
  meanPeakPosterior: number
  peakDistanceMs: number
  role: 'eligible' | 'veto'
}
export type CtcCoverageReason = 'uncalibrated-acoustic-onsets' | 'near-cost-competitors-unmeasured'
  | 'word-interior-competitors-unmeasured' | 'unsupported-source' | 'model-vocabulary'
  | 'short-source-row' | 'ambiguous-acoustic-start' | 'work-budget'
export interface CtcLandmarkCoverage {
  /** Always false until acoustic onset/near-cost coverage has been calibrated.
   * A diagnostic eligible group must NEVER be connected directly to a clock. */
  complete: false
  reasons: CtcCoverageReason[]
  unsupportedSpans: Array<{ lineIndex: number; wordIndex: number; sourceStart: number; sourceEnd: number; reason: string }>
  graphsScored: number
  graphsPrepared: number
  endTraces: number
  work: number
}
export interface CtcLandmarkResult {
  reason: 'hypotheses' | 'insufficient-words' | 'invalid-input' | 'work-budget'
  groups: OnsetHypothesisGroup[]
  candidates: CtcLandmarkCandidate[]
  coverage: CtcLandmarkCoverage
}
export interface CtcLandmarkLimits { graphs: number; work: number; endTraces: number; candidates: number }
export const CTC_LANDMARK_LIMITS: Readonly<CtcLandmarkLimits> = Object.freeze({
  graphs: 2048, work: 120_000_000, endTraces: 256, candidates: 512,
})
interface Target {
  lineIndex: number
  firstWordIndex: number
  lastWordIndex: number
  kind: CtcLandmarkCandidate['kind']
  graph: CtcPhoneGraph
  work: number
}

/** Prompt-free CTC posterior diagnostics against the COMPLETE supplied source.
 * Every word-boundary prefix from 8..32 phones is searched, including all
 * dictionary pronunciation combinations. Internal word windows are competing
 * explanations, never row timestamps. No media position or fitted clock enters
 * this API. All budgets abstain as a whole instead of pruning into uniqueness.
 *
 * This first implementation is SHADOW ONLY: word-interior and near-cost paths
 * are not exhaustively measured, and model peaks are not proven onset labels.
 */
export function extractCtcLandmarks(output: CtcOutput, lines: readonly CtcSourceLine[], sourceWords: JapaneseWord[][],
  captureDurationMs: number, limits: Partial<CtcLandmarkLimits> = {}): CtcLandmarkResult {
  const reasons = new Set<CtcCoverageReason>(['uncalibrated-acoustic-onsets', 'near-cost-competitors-unmeasured', 'word-interior-competitors-unmeasured'])
  const coverage: CtcLandmarkCoverage = { complete: false, reasons: [], unsupportedSpans: [], graphsScored: 0, graphsPrepared: 0, endTraces: 0, work: 0 }
  const result = (reason: CtcLandmarkResult['reason'], groups: OnsetHypothesisGroup[] = [], candidates: CtcLandmarkCandidate[] = []): CtcLandmarkResult => {
    coverage.reasons = [...reasons]
    return { reason, groups, candidates, coverage }
  }
  const budget = () => { reasons.add('work-budget'); return result('work-budget') }
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)
    || (Object.getPrototypeOf(limits) !== Object.prototype && Object.getPrototypeOf(limits) !== null)
    || Reflect.ownKeys(limits).some(key => typeof key !== 'string' || !Object.hasOwn(CTC_LANDMARK_LIMITS, key))) return result('invalid-input')
  const cap = { ...CTC_LANDMARK_LIMITS, ...limits }
  if (Object.entries(cap).some(([key, value]) => !Number.isSafeInteger(value) || value < 1
    || value > CTC_LANDMARK_LIMITS[key as keyof CtcLandmarkLimits])) return result('invalid-input')
  if (!Array.isArray(lines) || !lines.length || lines.length > 400 || !Array.isArray(sourceWords) || sourceWords.length !== lines.length
    || !Number.isFinite(captureDurationMs) || captureDurationMs < 6000 || captureDurationMs > 15000
    || !output?.geometry || Math.abs(output.geometry.sampleCount / 16 - captureDurationMs) > 1) return result('invalid-input')
  let characters = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !Number.isFinite(line.startMs) || line.startMs < 0 || line.startMs > 600000
      || typeof line.text !== 'string' || line.text.length > 500 || !Array.isArray(sourceWords[i])
      || (i > 0 && line.startMs < lines[i - 1].startMs)) return result('invalid-input')
    characters += line.text.length
    if (characters > 16000) return result('invalid-input')
  }
  const decoded = decodeCtcFrames(output)
  if (decoded.reason === 'invalid-input' || decoded.reason === 'unsupported-label') return result('invalid-input')
  const mappings: JapanesePhoneMapping[] = []
  for (const [lineIndex, line] of lines.entries()) {
    const mapping = mapJapanesePhones(line.text, sourceWords[lineIndex])
    if (mapping.reason === 'invalid-input' || mapping.reason === 'surface-mismatch') return result('invalid-input')
    mappings.push(mapping)
    for (const span of mapping.unsupported) coverage.unsupportedSpans.push({ lineIndex, wordIndex: span.wordIndex,
      sourceStart: span.sourceStart, sourceEnd: span.sourceEnd, reason: span.reason })
    if (!mapping.complete) reasons.add('unsupported-source')
  }
  // Blank or uniformly uncertain emissions cannot support any eligible prefix.
  // Do not expend an entire song's DP budget manufacturing thousands of flat
  // zero-cost vetoes; absence of strong acoustic labels is not a source match.
  if (decoded.tokens.filter(token => token.maxPosterior >= .85).length < 8) return result('insufficient-words')
  const prepared = prepareCtcGraphScorer(output)
  if (prepared.reason !== 'ready') return result('invalid-input')
  const scorer = prepared.scorer
  const phoneIds = new Map(scorer.vocabulary.map((phone, id) => [phone, id]))
  const targets: Target[] = []
  for (const [lineIndex, mapping] of mappings.entries()) {
    const firstLexical = mapping.words.findIndex(word => word.status !== 'punctuation')
    let hasStart = false
    for (const start of mapping.words) {
      if (start.status !== 'supported') continue
      let minPhones = 0, maxPhones = 0
      for (let end = start.wordIndex; end < mapping.words.length; end++) {
        const word = mapping.words[end]
        if (word.status === 'unsupported') break
        if (word.status === 'punctuation') continue
        const lengths = word.variants.map(variant => variant.phones.length)
        minPhones += Math.min(...lengths); maxPhones += Math.max(...lengths)
        // We never truncate a long dictionary word to an imaginary word edge.
        // When even the shortest variant exceeds the prefix policy, no later
        // complete word boundary belongs to the 8..32-phone search domain.
        if (minPhones > 32) break
        if (maxPhones < 8) continue
        // Some dictionary paths cross the policy boundary: keep the complete
        // DAG. The actual traced path must pass length gates to be eligible.
        const firstWordIndex = start.wordIndex, lastWordIndex = end
        const segmentText = lines[lineIndex].text.slice(start.sourceStart, word.sourceEnd)
        const segment = mapJapanesePhones(segmentText, sourceWords[lineIndex].slice(firstWordIndex, lastWordIndex + 1))
        const graph = buildJapanesePhoneGraph(segment, segment.words.length - 1)
        if (graph.reason === 'work-budget') return budget()
        if (graph.reason !== 'ready') return result('invalid-input')
        const nodes = graph.nodes.map(node => ({ phoneId: phoneIds.get(node.phone)!, previous: node.previous }))
        if (nodes.some(node => node.phoneId === undefined || node.phoneId === output.blankId)) {
          reasons.add('model-vocabulary'); continue
        }
        const kind = firstWordIndex === firstLexical ? 'line-start' : 'internal-word'
        if (kind === 'line-start') hasStart = true
        const edges = nodes.reduce((n, node) => n + node.previous.length, 0)
        targets.push({ lineIndex, firstWordIndex, lastWordIndex, kind,
          graph: { nodes, finalNodes: graph.finalNodes }, work: scorer.frames * (2 * nodes.length + 1 + edges) })
        coverage.graphsPrepared++
        if (targets.length > cap.graphs) return budget()
      }
    }
    if (firstLexical >= 0 && !hasStart && mapping.complete) reasons.add('short-source-row')
  }
  const candidates: CtcLandmarkCandidate[] = []
  const score = (target: Target, endFrame?: number) => {
    coverage.work += target.work
    if (coverage.work > cap.work) return null
    if (endFrame === undefined) coverage.graphsScored++
    else { coverage.endTraces++; if (coverage.endTraces > cap.endTraces) return null }
    return scorer.score(target.graph, endFrame === undefined ? undefined : { endFrame })
  }
  for (const target of targets) {
    const baseline = score(target)
    if (!baseline || baseline.reason === 'work-budget') return budget()
    if (baseline.reason === 'unreachable') continue
    if (baseline.reason !== 'scored') return result('invalid-input')
    if (baseline.regret !== 0) continue
    // Distinct terminal frames can expose repeated phrases within one clip.
    // Deduplication includes the complete exact-best start range. A single
    // global-minimum witness is not sufficient to declare an onset unique.
    const endings = new Map<string, number>()
    for (let end = 0; end < baseline.endRegrets.length; end++) {
      if (baseline.endRegrets[end] !== 0) continue
      const earliest = baseline.endFirstFramesEarliest[end], latest = baseline.endFirstFramesLatest[end]
      const key = `${earliest}:${latest}`
      // Complete the last acoustic run before measuring its peak probability.
      // An early weak frame must not hide a later strong frame in the SAME
      // phone run. Different starts/ranges remain separate explanations.
      endings.set(key, end)
    }
    for (const end of endings.values()) {
      const earliest = baseline.endFirstFramesEarliest[end], latest = baseline.endFirstFramesLatest[end]
      const event = end === baseline.lastFrameExclusive - 1 ? baseline : score(target, end)
      if (!event || event.reason === 'work-budget') return budget()
      if (event.reason !== 'scored') return result('invalid-input')
      const candidate = describe(event, target, lines[target.lineIndex].startMs, captureDurationMs)
      if (earliest !== latest) reasons.add('ambiguous-acoustic-start')
      candidates.push(candidate)
      if (candidates.length > cap.candidates) return budget()
    }
  }
  const groups: OnsetHypothesisGroup[] = []
  const lineStarts = candidates.filter(candidate => candidate.kind === 'line-start'
    && candidate.firstFrameRange.earliest === candidate.firstFrameRange.latest
    && candidate.witnessHeardMs >= 150 && candidate.witnessHeardMs <= captureDurationMs - 150)
  for (const heardMs of [...new Set(lineStarts.map(candidate => candidate.witnessHeardMs))].sort((a, b) => a - b)) {
    const byLine = new Map<number, OnsetHypothesisGroup['choices'][number]>()
    for (const candidate of lineStarts.filter(item => item.witnessHeardMs === heardMs)) {
      const previous = byLine.get(candidate.lineIndex)
      // Multiple complete-word prefixes with the very same source mapping are
      // corroboration, not competing source positions. Preserve every DIFFERENT
      // row mapping regardless of its probability or its order in the document.
      if (!previous || (previous.role === 'veto' && candidate.role === 'eligible')
        || (previous.role === candidate.role && candidate.meanPeakPosterior > previous.score)) {
        byLine.set(candidate.lineIndex, { lineIndex: candidate.lineIndex, sourceMs: candidate.sourceMs!,
          score: candidate.meanPeakPosterior, role: candidate.role })
      }
    }
    const strideMs = output.geometry.strideSamples / output.geometry.sampleRate * 1000
    const unresolvedInternalCompetitor = candidates.some(candidate => {
      const low = candidate.firstFrameRange.earliest * strideMs, high = candidate.firstFrameRange.latest * strideMs
      return heardMs >= low && heardMs <= high && (candidate.kind === 'internal-word' || low !== high)
    })
    groups.push({ heardMs, choices: [...byLine.values()], ...(unresolvedInternalCompetitor ? { unresolvedInternalCompetitor: true as const } : {}) })
    if (groups.length > 40 || byLine.size > 40 || groups.reduce((n, group) => n + group.choices.length, 0) > 160) return budget()
  }
  return result(groups.length ? 'hypotheses' : 'insufficient-words', groups, candidates)
}

function describe(event: CtcGraphScore, target: Target, sourceMs: number, duration: number): CtcLandmarkCandidate {
  const first = event.labels[0], last = event.labels.at(-1)!
  const minPeakPosterior = Math.min(...event.labels.map(label => label.peakPosterior))
  const meanPeakPosterior = event.labels.reduce((sum, label) => sum + label.peakPosterior, 0) / event.labelCount
  const eligible = target.kind === 'line-start' && event.firstFrameRange.earliest === event.firstFrameRange.latest
    && event.labelCount >= 8 && event.labelCount <= 32 && event.peakDistanceMs >= 700
    && first.frameStartMs >= 150 && last.frameStartMs <= duration - 350
    && first.peakPosterior >= .85 && last.peakPosterior >= .85 && minPeakPosterior >= .75 && meanPeakPosterior >= .9
    && event.labels.every(label => label.greedyFrames > 0 && label.substitutionRegret === 0)
  return { lineIndex: target.lineIndex, kind: target.kind, ...(target.kind === 'line-start' ? { sourceMs } : {}),
    firstWordIndex: target.firstWordIndex, lastWordIndex: target.lastWordIndex,
    witnessHeardMs: first.frameStartMs, firstFrameRange: { ...event.firstFrameRange }, lastFrameExclusive: event.lastFrameExclusive,
    labelCount: event.labelCount, firstPeakPosterior: first.peakPosterior, lastPeakPosterior: last.peakPosterior,
    minPeakPosterior, meanPeakPosterior, peakDistanceMs: event.peakDistanceMs, role: eligible ? 'eligible' : 'veto' }
}
