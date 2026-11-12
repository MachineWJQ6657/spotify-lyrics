import type { CtcOutput } from './ctc-tokens'

/**
 * Listening-based lyric offset.
 *
 * Community LRC files (LRCLIB, NetEase, Kugou) are often timed against another
 * master of the recording or deliberately ahead of the vocal. On Spotify's
 * audio the whole file is then early or late by a near-constant amount.
 *
 * Given the KNOWN lyric text, a CTC acoustic model can locate each line in a
 * captured window (forced alignment; no free transcription). Each located
 * line gives "sung at media position X, file says Y". Their median over
 * several windows is the per-song offset. Nothing here moves the Spotify
 * clock: the result only shifts when lines are displayed.
 */

export interface PhoneLine {
  /** Index in the original lyric track. */
  index: number
  startMs: number
  /** RomajiASR vocabulary labels for the line's leading supported words. */
  phones: string[]
}

export interface LineAlignment {
  index: number
  onsetFrame: number
  endFrame: number
  /** Mean best per-phone log-probability relative to the frame maximum (<= 0; 0 is a perfect match). */
  score: number
  phones: number
}

export interface AlignOptions {
  /** Per-frame cost of the "not singing any of these lines" filler state. */
  fillerCost?: number
  /** Cost per phone of leaving a line unaligned (outside the window, not sung). */
  skipCostPerPhone?: number
  /** Extra cost of starting line k's first phone at frame f (weak timing prior). */
  onsetCost?: (line: number, frame: number) => number
}

const ALTERNATES: Record<string, string[]> = {
  shi: ['si'], chi: ['ti'], tsu: ['tu'], fu: ['hu'], ji: ['zi', 'di'], zu: ['du'], wo: ['o'], o: ['wo'],
  ha: ['wa'], he: ['e'],
}
// Isolated consonant labels the model emits for devoiced or clipped morae.
const CONSONANT: Record<string, string> = { shi: 'sh', su: 's', ku: 'k', ki: 'k', tsu: 't', chi: 'ch', fu: 'f', hi: 'h' }

export interface LogProbabilities { frames: number; width: number; values: Float32Array; frameMax: Float32Array; blankId: number; vocabulary: string[] }

export function logSoftmax(output: CtcOutput): LogProbabilities | null {
  const width = output.vocabulary?.length ?? 0
  const logits = output.logits
  if (!width || !(logits instanceof Float32Array) || logits.length % width !== 0) return null
  const frames = logits.length / width
  const values = new Float32Array(logits.length)
  const frameMax = new Float32Array(frames)
  for (let f = 0; f < frames; f += 1) {
    const row = f * width
    let max = -Infinity
    for (let k = 0; k < width; k += 1) max = Math.max(max, logits[row + k])
    if (!Number.isFinite(max)) return null
    let sum = 0
    for (let k = 0; k < width; k += 1) sum += Math.exp(logits[row + k] - max)
    const log = Math.log(sum)
    let best = -Infinity
    for (let k = 0; k < width; k += 1) { const value = logits[row + k] - max - log; values[row + k] = value; if (value > best) best = value }
    frameMax[f] = best
  }
  return { frames, width, values, frameMax, blankId: output.blankId, vocabulary: output.vocabulary }
}

function phoneIds(phone: string, index: Map<string, number>) {
  const ids = new Set<number>()
  for (const label of [phone, ...(ALTERNATES[phone] ?? []), ...(CONSONANT[phone] ? [CONSONANT[phone]] : [])]) {
    const id = index.get(label)
    if (id !== undefined) ids.add(id)
  }
  return [...ids]
}

/**
 * Monotonic forced alignment of several lines inside one window. Between and
 * around lines a filler state absorbs instrumentals and noise at a fixed cost;
 * any line may be skipped. Returns one entry per input line (null = skipped).
 */
export function alignLines(logp: LogProbabilities, lines: PhoneLine[], options: AlignOptions = {}): Array<LineAlignment | null> {
  const fillerCost = options.fillerCost ?? 1.2
  const skipPerPhone = options.skipCostPerPhone ?? 1.4
  const onsetCost = options.onsetCost
  const vocabulary = new Map(logp.vocabulary.map((label, id) => [label, id]))
  const layout = lines.map(line => ({ ids: line.phones.map(phone => phoneIds(phone, vocabulary)), phones: line.phones }))
  if (!layout.length || layout.some(line => !line.ids.length || line.ids.some(ids => !ids.length))) return lines.map(() => null)
  // State indices: filler(k) then 2n+1 CTC states per line, then a final filler.
  const fillerOf: number[] = [], firstOf: number[] = [], statesOf: number[] = []
  let size = 0
  for (const line of layout) { fillerOf.push(size); firstOf.push(size + 1); statesOf.push(2 * line.ids.length + 1); size += 2 + 2 * line.ids.length }
  const finalFiller = size
  size += 1
  const T = logp.frames
  if (T < 2 || size * T > 30_000_000) return lines.map(() => null)
  const skipCost = (k: number) => skipPerPhone * Math.max(1, layout[k].ids.length)
  const fillerAfter = (k: number) => k + 1 < layout.length ? fillerOf[k + 1] : finalFiller
  const NEG = -1e300
  let previous = new Float64Array(size).fill(NEG)
  let current = new Float64Array(size)
  const back = new Int32Array(T * size)
  previous[fillerOf[0]] = 0
  for (let k = 0; k < layout.length; k += 1) previous[fillerAfter(k)] = Math.max(previous[fillerAfter(k)], previous[fillerOf[k]] - skipCost(k))
  const emit = (f: number, ids: number[]) => {
    const row = f * logp.width
    let best = -Infinity
    for (const id of ids) best = Math.max(best, logp.values[row + id])
    return best - logp.frameMax[f]
  }
  for (let f = 0; f < T; f += 1) {
    const blank = logp.values[f * logp.width + logp.blankId] - logp.frameMax[f]
    const base = f * size
    for (let k = 0; k < layout.length; k += 1) {
      const filler = fillerOf[k]
      let best = previous[filler], arg = filler
      if (k > 0) {
        const last = firstOf[k - 1] + statesOf[k - 1] - 1
        if (previous[last] > best) { best = previous[last]; arg = last }
        if (previous[last - 1] > best) { best = previous[last - 1]; arg = last - 1 }
      }
      current[filler] = best - fillerCost; back[base + filler] = arg
      const first = firstOf[k], ids = layout[k].ids, phones = layout[k].phones
      for (let s = 0; s < statesOf[k]; s += 1) {
        const index = first + s
        let b = previous[index], a = index
        if (s > 1 && previous[index - 1] > b) { b = previous[index - 1]; a = index - 1 }
        if (s <= 1) {
          // Entering the first phone (from the leading blank or the filler) is the line onset.
          const entry = s === 1 && onsetCost ? onsetCost(k, f) : 0
          if (s === 1 && previous[index - 1] - entry > b) { b = previous[index - 1] - entry; a = index - 1 }
          if (previous[filler] - entry > b) { b = previous[filler] - entry; a = filler }
        }
        if (s % 2 === 1 && s >= 3 && phones[(s - 1) / 2] !== phones[(s - 3) / 2] && previous[index - 2] > b) { b = previous[index - 2]; a = index - 2 }
        current[index] = b + (s % 2 === 0 ? blank : emit(f, ids[(s - 1) / 2])); back[base + index] = a
      }
    }
    {
      const k = layout.length - 1, last = firstOf[k] + statesOf[k] - 1
      let best = previous[finalFiller], arg = finalFiller
      if (previous[last] > best) { best = previous[last]; arg = last }
      if (previous[last - 1] > best) { best = previous[last - 1]; arg = last - 1 }
      current[finalFiller] = best - fillerCost; back[base + finalFiller] = arg
    }
    // Same-frame skips: filler k -> filler k+1 without aligning line k.
    for (let k = 0; k < layout.length; k += 1) {
      const to = fillerAfter(k), value = current[fillerOf[k]] - skipCost(k)
      if (value > current[to]) { current[to] = value; back[base + to] = -1 - fillerOf[k] }
    }
    ;[previous, current] = [current, previous]
  }
  const found: Array<{ onset: number; end: number; best: Map<number, number> } | null> = layout.map(() => null)
  const lineOf = (state: number) => {
    for (let k = layout.length - 1; k >= 0; k -= 1) if (state >= firstOf[k]) return state < firstOf[k] + statesOf[k] ? k : -1
    return -1
  }
  let state = finalFiller
  for (let f = T - 1; f >= 0; f -= 1) {
    let pointer = back[f * size + state]
    let hops = 0
    while (pointer < 0 && hops++ <= layout.length) { state = -1 - pointer; pointer = back[f * size + state] }
    const k = lineOf(state)
    if (k >= 0) {
      const s = state - firstOf[k]
      if (s % 2 === 1) {
        const phone = (s - 1) / 2
        const item = found[k] ?? (found[k] = { onset: f, end: f, best: new Map() })
        item.onset = f
        item.best.set(phone, Math.max(item.best.get(phone) ?? -Infinity, emit(f, layout[k].ids[phone])))
      }
    }
    state = pointer
  }
  return found.map((item, k) => item ? {
    index: lines[k].index, onsetFrame: item.onset, endFrame: item.end, phones: layout[k].ids.length,
    score: [...item.best.values()].reduce((sum, value) => sum + value, 0) / layout[k].ids.length,
  } : null)
}

export interface WindowGeometry {
  /** Media (Spotify) position of the first captured sample. */
  startMediaMs: number
  sampleRate: number
  strideSamples: number
  receptiveFieldSamples: number
}

export interface LineDelta { index: number; lineMs: number; sungMs: number; deltaMs: number; score: number; phones: number }

/** Search range before anything is known: whole-file shifts of up to 30 s
 * occur (Spotify relinked ケセラセラ to a 305 s recording; every provider's
 * file is for the 272 s edit and runs 12.3 s early). */
export const WINDOW_SLACK_MS = 30_000
/** Once an offset estimate exists, only lines near it are considered. */
export const NARROW_SLACK_MS = 6_000
/**
 * Timing prior, in nats per phone, for starting a line `distanceMs` away from
 * where the file (plus the offset found so far) expects it. Linear and mild:
 * it only decides between acoustically equal choices, i.e. a line versus its
 * own repetition later in the song (the nearer one wins).
 */
export function timingPrior(distanceMs: number) {
  const seconds = Math.abs(distanceMs) / 1000
  return 0.05 * seconds
}
export const MIN_LINE_SCORE = -1.2
export const MIN_LINE_PHONES = 4

/** Lines worth aligning in a window: expected time within the window +/- slack. */
export function linesForWindow(lines: PhoneLine[], startMediaMs: number, endMediaMs: number, slackMs = WINDOW_SLACK_MS, expectedOffsetMs = 0) {
  return lines.filter(line => line.phones.length >= 3 && line.startMs + expectedOffsetMs >= startMediaMs - slackMs && line.startMs + expectedOffsetMs <= endMediaMs + slackMs)
}

/** Located lines in one window, as sung-vs-file deltas (positive = file is early). */
export function measureWindow(output: CtcOutput, lines: PhoneLine[], geometry: WindowGeometry, options: AlignOptions & { expectedOffsetMs?: number } = {}): LineDelta[] {
  const logp = logSoftmax(output)
  const expectedFrames = Math.floor((output.geometry.sampleCount - geometry.receptiveFieldSamples) / geometry.strideSamples) + 1
  if (!logp || logp.frames !== expectedFrames || output.geometry.sampleRate !== geometry.sampleRate) return []
  const frameMs = (frame: number) => (frame * geometry.strideSamples + geometry.receptiveFieldSamples / 2) / geometry.sampleRate * 1000
  const endMediaMs = geometry.startMediaMs + frameMs(logp.frames - 1)
  const expected = options.expectedOffsetMs ?? 0
  const selected = linesForWindow(lines, geometry.startMediaMs, endMediaMs, options.expectedOffsetMs == null ? WINDOW_SLACK_MS : NARROW_SLACK_MS, expected)
  if (!selected.length) return []
  const aligned = alignLines(logp, selected, {
    onsetCost: (k, frame) => selected[k].phones.length * timingPrior(geometry.startMediaMs + frameMs(frame) - (selected[k].startMs + expected)),
    ...options
  })
  const deltas: LineDelta[] = []
  aligned.forEach((item, position) => {
    if (!item) return
    const line = selected[position]
    const sungMs = geometry.startMediaMs + frameMs(item.onsetFrame) - 10
    const endMs = geometry.startMediaMs + frameMs(item.endFrame)
    // A line cut by the window edge has an unreliable onset.
    if (sungMs < geometry.startMediaMs + 400 || endMs > endMediaMs - 300) return
    if (item.score < MIN_LINE_SCORE || item.phones < MIN_LINE_PHONES) return
    deltas.push({ index: line.index, lineMs: line.startMs, sungMs: Math.round(sungMs), deltaMs: Math.round(sungMs - line.startMs), score: item.score, phones: item.phones })
  })
  return deltas
}

export function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export interface OffsetDecision {
  state: 'collecting' | 'decided' | 'inconsistent'
  /** Positive = delay lyrics (they were early). Only set when decided. */
  offsetMs?: number
  measuredDeltaMs?: number
  spreadMs?: number
  lines: number
  windows: number
}

/** Display target: show a line this long before its vocal starts. */
export const LISTEN_LEAD_MS = 150
/** Smaller corrections are not worth a visible change. */
export const LISTEN_MIN_CORRECTION_MS = 250
export const LISTEN_MIN_LINES = 6
export const LISTEN_MIN_WINDOWS = 2
export const LISTEN_MAX_SPREAD_MS = 160
export const LISTEN_MAX_WINDOWS = 8

/**
 * Accumulates located lines across windows of one song with one lyric timing.
 * Decides once enough lines from at least two windows agree on a constant
 * offset. A spread that stays large means the file is not a shifted copy of
 * this recording (another edit, wrong song, tempo change): never guess then.
 */
export class LyricOffsetEstimator {
  private deltas: LineDelta[] = []
  private windows = 0
  private windowsWithLines = 0
  add(window: LineDelta[]) {
    this.windows += 1
    // One line counts once (the best-scoring observation): overlapping
    // windows cannot double-weight a single sung line.
    let added = false
    for (const delta of window) {
      const existing = this.deltas.findIndex(item => item.index === delta.index)
      if (existing >= 0) { if (delta.score > this.deltas[existing].score) this.deltas[existing] = delta; continue }
      this.deltas.push(delta); added = true
    }
    if (added) this.windowsWithLines += 1
    return this.decision()
  }
  decision(): OffsetDecision {
    const lines = this.deltas.length
    const base = { lines, windows: this.windowsWithLines }
    if (lines < LISTEN_MIN_LINES || this.windowsWithLines < LISTEN_MIN_WINDOWS) {
      return { state: this.windows >= LISTEN_MAX_WINDOWS ? 'inconsistent' : 'collecting', ...base }
    }
    const values = this.deltas.map(item => item.deltaMs)
    const center = median(values)!
    const spread = median(values.map(value => Math.abs(value - center)))!
    // Most lines must sit near the center, not just half of them.
    const close = values.filter(value => Math.abs(value - center) <= 350).length
    if (spread > LISTEN_MAX_SPREAD_MS || close < Math.ceil(lines * 0.7)) {
      return { state: this.windows >= LISTEN_MAX_WINDOWS ? 'inconsistent' : 'collecting', ...base, measuredDeltaMs: Math.round(center), spreadMs: Math.round(spread) }
    }
    const correction = center - LISTEN_LEAD_MS
    const offsetMs = Math.abs(correction) < LISTEN_MIN_CORRECTION_MS ? 0 : Math.round(correction / 10) * 10
    return { state: 'decided', offsetMs, measuredDeltaMs: Math.round(center), spreadMs: Math.round(spread), ...base }
  }
  get observations() { return this.deltas.slice() }
  /** Current median delta, used as the next window's timing prior. */
  get center() { return median(this.deltas.map(item => item.deltaMs)) ?? undefined }
}
