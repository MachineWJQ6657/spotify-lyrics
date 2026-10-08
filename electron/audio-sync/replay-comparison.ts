import type { AcousticMatch } from './fingerprint'

interface Sample {
  phase: string; rawObservedAtMs: number; positionMs: number
  statusName: string; title: string; artist: string; album: string
}
interface Capture { phase: string; startedAtMs: number; endedAtMs: number; durationMs: number }
export interface ReplayEvidence {
  track: { title: string; artist: string; album: string }
  samples: Sample[]; captures: Capture[]
}

/** Media readings are a measured dependent variable, NEVER a search prior. */
export function replayMediaPosition(report: ReplayEvidence, phase: string, wallMs: number): number | null {
  const capture = report.captures.find(value => value.phase === phase)
  if (!capture || !Number.isFinite(wallMs) || wallMs < capture.startedAtMs - 1 || wallMs > capture.endedAtMs + 1) return null
  const candidates = report.samples.filter(sample => sample.phase === phase && sample.statusName === 'PLAYING'
    && (['title', 'artist', 'album'] as const).every(key => sample[key] === report.track[key])
    && Number.isFinite(sample.positionMs) && Number.isFinite(sample.rawObservedAtMs)
    && sample.rawObservedAtMs <= wallMs && wallMs - sample.rawObservedAtMs <= 6500)
  const sample = candidates.sort((a, b) => b.rawObservedAtMs - a.rawObservedAtMs)[0]
  return sample ? sample.positionMs + wallMs - sample.rawObservedAtMs : null
}

/** Same acoustic phrase under two playback histories. This can expose a
 * changed media/audio relation, but cannot certify which history is correct. */
export function compareReplay(report: ReplayEvidence, whole: AcousticMatch, first: AcousticMatch, last: AcousticMatch) {
  const before = report.captures.find(value => value.phase === 'before')
  const after = report.captures.find(value => value.phase === 'after')
  const reject = (reason: string) => ({ accepted: false as const, reason })
  if (!before || !after || before.durationMs !== 12000 || after.durationMs !== 36000
    || [before, after].some(capture => ![capture.startedAtMs, capture.endedAtMs].every(Number.isFinite)
      || Math.abs(capture.endedAtMs - capture.startedAtMs - capture.durationMs) > 50)) return reject('invalid-captures')
  const matches = [whole, first, last]
  if (matches.some(match => !match.accepted || match.reason !== 'matched'
    || ![match.sourceStartMs, match.sourceEndMs, match.rate, match.score].every(Number.isFinite)
    || match.sourceStartMs < 0 || match.sourceEndMs > after.durationMs + 100
    || match.rate < .8 || match.rate > 1.2 || match.score < .8)) return reject('audio-not-confirmed')
  // Independent halves must support the same path; a high average must not
  // hide a different chorus or a tempo change near the end of the capture.
  if (Math.abs(first.sourceStartMs - whole.sourceStartMs) > 200
    || Math.abs(last.sourceStartMs - (whole.sourceStartMs + 6000 * whole.rate)) > 200
    || Math.abs(last.sourceEndMs - whole.sourceEndMs) > 200
    || Math.max(...matches.map(value => value.rate)) - Math.min(...matches.map(value => value.rate)) > .025) return reject('halves-disagree')
  const beforeMediaEndMs = replayMediaPosition(report, 'before', before.endedAtMs)
  const afterMediaEndMs = replayMediaPosition(report, 'after', after.startedAtMs + whole.sourceEndMs)
  if (beforeMediaEndMs == null || afterMediaEndMs == null) return reject('media-observation-unavailable')
  return { accepted: true as const, reason: 'same-audio-compared', beforeMediaEndMs, afterMediaEndMs,
    // Positive: the earlier capture was labelled with a later media position.
    mediaDifferenceMs: beforeMediaEndMs - afterMediaEndMs,
    replayMsPerOriginalMs: whole.rate,
    interpretation: 'Relative media/audio difference only. Seeking is not proof of a clean reference; do not automatically apply as a lyric offset.' }
}
