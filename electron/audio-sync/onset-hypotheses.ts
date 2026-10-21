/** A candidate is a possible source-line onset, not a Spotify position. Veto
 * candidates participate in every timing check but can never become evidence. */
export interface OnsetHypothesisChoice {
  lineIndex: number
  sourceMs: number
  /** Upstream evidence score, not a calibrated probability. Eligible onsets
   * need .88, but even a zero-scored veto must remain a competing path. */
  score: number
  role: 'eligible' | 'veto'
}

export interface OnsetHypothesisGroup {
  heardMs: number
  choices: OnsetHypothesisChoice[]
  unresolvedInternalCompetitor?: true
}

export interface OnsetHypothesisCapture {
  trackId: string
  lyricTimingKey: string
  capturedAtMs: number
  captureDurationMs: number
  groups: OnsetHypothesisGroup[]
}

export interface OnsetHypothesisPoint {
  lineIndex: number
  sourceMs: number
  heardMs: number
  score: number
}

/** Receipt times belong to the original arrival, including older blocks that
 * only become unambiguous later. A consumer must not replay these as fresh. */
export interface OnsetHypothesisWindowBlock {
  trackId: string
  lyricTimingKey: string
  capturedAtMs: number
  captureDurationMs: number
  receivedAtMs: number
  points: OnsetHypothesisPoint[]
}

export type OnsetHypothesisReason = 'inactive' | 'stale-input' | 'foreign-input'
  | 'invalid-input' | 'overlapping-capture' | 'internal-competitor'
  | 'inconsistent-timing' | 'path-limit' | 'work-budget'
  | 'insufficient-words' | 'evidence-gap' | 'insufficient-baseline' | 'ambiguous' | 'resolved'

export interface OnsetHypothesisResult {
  decision: 'confirming' | 'resolved' | 'rejected'
  reason: OnsetHypothesisReason
  window: OnsetHypothesisWindowBlock[]
}

interface EvidenceBlock extends OnsetHypothesisCapture { receivedAtMs: number }
interface PathPoint extends OnsetHypothesisChoice {
  observedAtMs: number
  blockIndex: number
  groupIndex: number
}
interface Path { points: PathPoint[]; minRate: number; maxRate: number }

const MAX_PATHS = 128
const MAX_WORK = 100_000
const MAX_HISTORY_MS = 72_000
const MAX_BLOCKS = 7
const MAX_EVIDENCE_GAP_MS = 36_000
const MIN_RATE = .85
const MAX_RATE = 1.15
const PAIR_TOLERANCE_MS = 600

const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= Number.MAX_SAFE_INTEGER

/** Bounded cross-capture disambiguation only. No anchor, fitted clock, playback
 * state or absolute media time is accepted or produced. All surviving paths
 * are retained; exceeding a bound abstains instead of pruning alternatives. */
export class OnsetHypotheses {
  private owner: { trackId: string; lyricTimingKey: string; startedAtMs: number } | null = null
  private history: EvidenceBlock[] = []
  private latestCapture = -1
  private latestCaptureEnd = -1

  start(trackId: string, lyricTimingKey: string, now = Date.now()) {
    this.clear()
    if (identifier(trackId) && identifier(lyricTimingKey) && timestamp(now)) {
      this.owner = { trackId, lyricTimingKey, startedAtMs: now }
    }
  }

  /** Playback pause, seek, source change and track change must clear ownership. */
  clear() {
    this.owner = null; this.history = []; this.latestCapture = -1; this.latestCaptureEnd = -1
  }

  private reject(reason: OnsetHypothesisReason, discard = false): OnsetHypothesisResult {
    if (discard) this.history = []
    return { decision: 'rejected', reason, window: [] }
  }

  receive(value: OnsetHypothesisCapture, now = Date.now()): OnsetHypothesisResult {
    if (!this.owner) return this.reject('inactive')
    if (!value || !timestamp(now) || !timestamp(value.capturedAtMs)) return this.reject('invalid-input')
    // Ownership, expiry and duplicate checks precede all state changes. A late
    // malformed reply from another request cannot erase current evidence.
    if (value.trackId !== this.owner.trackId || value.lyricTimingKey !== this.owner.lyricTimingKey) return this.reject('foreign-input')
    if (value.capturedAtMs <= this.latestCapture || value.capturedAtMs > now + 200
      || now - value.capturedAtMs > 15_000) return this.reject('stale-input')
    if (value.capturedAtMs < this.owner.startedAtMs || (Number.isFinite(value.captureDurationMs)
      && value.captureDurationMs >= 6000 && value.captureDurationMs <= 15_000
      && value.capturedAtMs - value.captureDurationMs < this.owner.startedAtMs)) return this.reject('stale-input')

    const priorEnd = this.latestCaptureEnd
    // Fresh malformed input consumes its capture identity, but never seeds a
    // hypothesis. In particular, retries cannot turn a rejected block into truth.
    this.latestCapture = value.capturedAtMs
    this.latestCaptureEnd = value.capturedAtMs
    if (!Number.isFinite(value.captureDurationMs) || value.captureDurationMs < 6000 || value.captureDurationMs > 15_000
      || !Array.isArray(value.groups) || value.groups.length > 40) return this.reject('invalid-input', true)
    const captureStart = value.capturedAtMs - value.captureDurationMs
    // Strictly non-overlapping captures: not even the 50 ms tolerance used by
    // a clock may manufacture independent observations for this resolver.
    if (priorEnd >= 0 && captureStart < priorEnd) return this.reject('overlapping-capture', true)

    let totalChoices = 0
    for (let index = 0; index < value.groups.length; index++) {
      const group = value.groups[index]
      if (!group || !Number.isFinite(group.heardMs) || group.heardMs < 150 || group.heardMs > value.captureDurationMs - 150
        || (index > 0 && group.heardMs <= value.groups[index - 1].heardMs)
        || !Array.isArray(group.choices) || group.choices.length === 0 || group.choices.length > 40
        || (group.unresolvedInternalCompetitor !== undefined && group.unresolvedInternalCompetitor !== true)) {
        return this.reject('invalid-input', true)
      }
      totalChoices += group.choices.length
      if (totalChoices > 160) return this.reject('invalid-input', true)
      // Array.some/every skip holes. Indexing inspects sparse entries and stays
      // bounded even if a caller has replaced an input array's iterator.
      for (let choiceIndex = 0; choiceIndex < group.choices.length; choiceIndex++) {
        const choice = group.choices[choiceIndex]
        if (!choice || !Number.isInteger(choice.lineIndex) || choice.lineIndex < 0 || choice.lineIndex >= 400
          || !Number.isFinite(choice.sourceMs) || choice.sourceMs < 0 || choice.sourceMs > 600_000
          || !Number.isFinite(choice.score) || choice.score < (choice.role === 'veto' ? 0 : .88) || choice.score > 1
          || (choice.role !== 'eligible' && choice.role !== 'veto')) return this.reject('invalid-input', true)
      }
      if (group.unresolvedInternalCompetitor) return this.reject('internal-competitor', true)
    }

    // Negative-only captures may veto a correspondence, but cannot keep old
    // positive support alive. A possible eligible path (even still ambiguous)
    // is needed to establish a new support block.
    const previousSupport = [...this.history].reverse().find(current => current.groups.some(group =>
      group.choices.some(choice => choice.role === 'eligible')))
    const evidenceGap = !!previousSupport && value.capturedAtMs - previousSupport.capturedAtMs > MAX_EVIDENCE_GAP_MS
    if (evidenceGap) this.history = []
    this.history = this.history.filter(block => value.capturedAtMs - block.capturedAtMs <= MAX_HISTORY_MS)
    // Empty captures advance overlap/arrival guards, not the support baseline,
    // receipt time or lifespan of any existing evidence.
    if (value.groups.length === 0) return this.reject(evidenceGap ? 'evidence-gap' : 'insufficient-words')

    const block: EvidenceBlock = {
      trackId: value.trackId, lyricTimingKey: value.lyricTimingKey,
      capturedAtMs: value.capturedAtMs, captureDurationMs: value.captureDurationMs, receivedAtMs: now,
      groups: value.groups.map(group => ({ heardMs: group.heardMs, choices: group.choices.map(choice => ({
        lineIndex: choice.lineIndex, sourceMs: choice.sourceMs, score: choice.score, role: choice.role,
      })) })),
    }
    const history = [...this.history, block].slice(-MAX_BLOCKS)
    let paths: Path[] = [{ points: [], minRate: MIN_RATE, maxRate: MAX_RATE }]
    let work = 0
    for (let blockIndex = 0; blockIndex < history.length; blockIndex++) {
      const current = history[blockIndex]
      for (let groupIndex = 0; groupIndex < current.groups.length; groupIndex++) {
        const group = current.groups[groupIndex]
        const observedAtMs = current.capturedAtMs - current.captureDurationMs + group.heardMs
        const next: Path[] = []
        for (const path of paths) for (const choice of group.choices) {
          if (++work > MAX_WORK) return this.reject('work-budget', true)
          const last = path.points.at(-1)
          if (last && (choice.lineIndex <= last.lineIndex || choice.sourceMs <= last.sourceMs || observedAtMs <= last.observedAtMs)) continue
          let minRate = path.minRate, maxRate = path.maxRate
          for (const earlier of path.points) {
            if (++work > MAX_WORK) return this.reject('work-budget', true)
            const elapsed = observedAtMs - earlier.observedAtMs, sourceElapsed = choice.sourceMs - earlier.sourceMs
            minRate = Math.max(minRate, (sourceElapsed - PAIR_TOLERANCE_MS) / elapsed)
            maxRate = Math.min(maxRate, (sourceElapsed + PAIR_TOLERANCE_MS) / elapsed)
            if (minRate > maxRate) break
          }
          if (minRate > maxRate) continue
          next.push({ points: [...path.points, { ...choice, observedAtMs, blockIndex, groupIndex }], minRate, maxRate })
          if (next.length > MAX_PATHS) return this.reject('path-limit', true)
        }
        if (!next.length) return this.reject('inconsistent-timing', true)
        paths = next
      }
    }

    this.history = history
    const window: OnsetHypothesisWindowBlock[] = history.map(current => ({
      trackId: current.trackId, lyricTimingKey: current.lyricTimingKey,
      capturedAtMs: current.capturedAtMs, captureDurationMs: current.captureDurationMs,
      receivedAtMs: current.receivedAtMs, points: [],
    }))
    for (let pointIndex = 0; pointIndex < paths[0].points.length; pointIndex++) {
      const first = paths[0].points[pointIndex]
      if (first.role !== 'eligible' || paths.some(path => {
        const point = path.points[pointIndex]
        return point.role !== 'eligible' || point.lineIndex !== first.lineIndex || point.sourceMs !== first.sourceMs
      })) continue
      window[first.blockIndex].points.push({ lineIndex: first.lineIndex, sourceMs: first.sourceMs,
        heardMs: history[first.blockIndex].groups[first.groupIndex].heardMs,
        score: Math.min(...paths.map(path => path.points[pointIndex].score)) })
    }
    const support = window.filter(current => current.points.length > 0)
    const first = support[0], last = support.at(-1)
    const firstTime = first && first.capturedAtMs - first.captureDurationMs + first.points[0].heardMs
    const lastTime = last && last.capturedAtMs - last.captureDurationMs + last.points.at(-1)!.heardMs
    if (support.length >= 3 && lastTime! - firstTime! >= 20_000) return { decision: 'resolved', reason: 'resolved', window }
    return { decision: 'confirming', reason: evidenceGap ? 'evidence-gap'
      : paths.length > 1 || !support.length ? 'ambiguous' : 'insufficient-baseline', window }
  }
}
