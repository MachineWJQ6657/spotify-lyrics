/**
 * Spotify's crossfade and the length it reports for a song.
 *
 * With "crossfade songs" on (N seconds), the desktop app hands over to the
 * next song N seconds before a recording ends, and reports the recording's
 * length shortened by those N seconds. Measured 2026-11-22 with a 7 s
 * crossfade: a song the user picked first reported its real length
 * (256 116 ms) and five seconds later 249 116 ms; a song reached by the
 * previous one running out reported the short length from its first sample
 * (220 053 ms for a 227 053 ms recording). Positions are unaffected: both
 * songs lined up with the audio as before.
 *
 * Lyrics are matched by length. With the short length a lookup landed on
 * another edit of the song (Lemon: the 251 s file instead of the 256 s one),
 * the lookup ran twice within one play, and a song's saved lyrics and
 * calibration stopped applying when the setting changed. So lyric matching
 * uses the recording's own length, recovered here.
 */

/** The crossfade time, when a same-song drop of the reported length is one: whole seconds, 1 to 12. */
export function fadeTrimOfDrop(previousDurationMs: number, reportedDurationMs: number): number | null {
  if (!(previousDurationMs > 0) || !(reportedDurationMs > 0)) return null
  const drop = previousDurationMs - reportedDurationMs
  const seconds = Math.round(drop / 1000)
  return seconds >= 1 && seconds <= 12 && Math.abs(drop - seconds * 1000) <= 120 ? seconds * 1000 : null
}

export interface ReleaseInput {
  /** The length Spotify reports now. */
  durationMs: number
  /** The crossfade time learned from a drop (this session or an earlier one). */
  fadeTrimMs?: number
  /** The length of the lyric file matched for this song before, when one is saved. */
  matchedDurationMs?: number
  /** Whether crossfade was on at the last evidence: true, false, or not known yet. */
  believedOn: boolean | null
  /**
   * The reported length will not drop any more: the song began when the
   * previous one ran out (short from the first sample), or it has been the
   * current song for ten seconds (a picked song drops after about five).
   */
  settled: boolean
}

export type ReleaseVerdict =
  /** The saved lyric file's length says the reported one is shortened. */
  | 'reduced'
  /** The saved lyric file's length says the reported one is the real one. */
  | 'full'
  /** Nothing saved for the song: shortened because crossfade was on at the last evidence. */
  | 'assumed'
  | 'unknown'

/** A lyric file's length is rounded to the second and edits differ by more: this close is the same recording. */
const SAME_RECORDING_MS = 1500
/** One candidate has to fit clearly better than the other. */
const CLEARLY_CLOSER_MS = 400
/** A fit this close also says whether crossfade is on; a looser one may be a near edit matched under the wrong length. */
const TIGHT_FIT_MS = 700

/**
 * The recording's length for a song whose reported length may be shortened by
 * the crossfade, and why. `durationMs` is absent when the reported length
 * stands. `fitMs` is how far the saved lyric file is from the chosen length.
 */
export function releaseDurationOf(input: ReleaseInput): { durationMs?: number; verdict: ReleaseVerdict; fitMs?: number } {
  const { durationMs, fadeTrimMs, matchedDurationMs } = input
  if (!(durationMs > 0) || !fadeTrimMs || fadeTrimMs <= 0) return { verdict: 'unknown' }
  const restored = durationMs + fadeTrimMs
  if (matchedDurationMs && matchedDurationMs > 0) {
    const asReported = Math.abs(durationMs - matchedDurationMs)
    const asRestored = Math.abs(restored - matchedDurationMs)
    if (asRestored <= SAME_RECORDING_MS && asRestored + CLEARLY_CLOSER_MS <= asReported) return { durationMs: restored, verdict: 'reduced', fitMs: asRestored }
    if (asReported <= SAME_RECORDING_MS && asReported + CLEARLY_CLOSER_MS <= asRestored) return { verdict: 'full', fitMs: asReported }
  }
  return input.believedOn === true && input.settled ? { durationMs: restored, verdict: 'assumed' } : { verdict: 'unknown' }
}

// ---- What this computer last learned (the main window keeps it; other windows only read).

const KEY = 'syllable-fade-trim'
export interface FadeMemory { trimMs: number; on: boolean | null }
let memory: FadeMemory | null = null

/** `fresh` reads what the main window last saved (for the windows that never write it). */
export function fadeMemory(fresh = false): FadeMemory {
  if (memory && !fresh) return memory
  let saved: Partial<FadeMemory> | null = null
  try { saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as Partial<FadeMemory> | null } catch { saved = null }
  if (fresh && !saved && memory) return memory
  const trimMs = Number(saved?.trimMs)
  memory = { trimMs: Number.isFinite(trimMs) && trimMs >= 1000 && trimMs <= 12_000 ? trimMs : 0, on: typeof saved?.on === 'boolean' ? saved.on : null }
  return memory
}

export function rememberFade(patch: Partial<FadeMemory>) {
  const current = fadeMemory()
  const next = { ...current, ...patch }
  if (next.trimMs === current.trimMs && next.on === current.on) return
  memory = next
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)) } catch { /* a window without storage only loses the memory */ }
}

/** Test seam. */
export function resetFadeMemory(value: FadeMemory | null = null) { memory = value; gapCandidate = null; play = null }

/**
 * Whole seconds (3 to 12) by which a song's saved lyric file is longer than
 * its reported length, else 0. Lyric files give their length in whole seconds.
 * A file one or two seconds longer than the song is common without any
 * crossfade; such short crossfades are learned from a drop only.
 */
export function fadeGapSeconds(durationMs: number, matchedDurationMs: number): number {
  if (!(durationMs > 0) || !(matchedDurationMs > 0)) return 0
  const gap = matchedDurationMs - durationMs
  const seconds = Math.round(gap / 1000)
  return seconds >= 3 && seconds <= 12 && Math.abs(gap - seconds * 1000) <= 600 ? seconds : 0
}

/**
 * The crossfade time without a drop to show it. Someone who lets songs run
 * into each other never produces a drop: every song arrives already short.
 * Its lyric file is still found by title and artist in most cases, and then
 * it is the same number of seconds longer than the reported length for every
 * song. Two different songs in a row with the same gap are taken as the
 * crossfade time (one could be a longer edit of that song).
 */
let gapCandidate: { trackId: string; seconds: number } | null = null
function learnFromGap(trackId: string, durationMs: number, matchedDurationMs: number, knownTrimMs: number) {
  const seconds = fadeGapSeconds(durationMs, matchedDurationMs)
  if (!seconds) { if (Math.abs(durationMs - matchedDurationMs) <= 600) gapCandidate = null; return }
  if (seconds * 1000 === knownTrimMs) return
  if (gapCandidate && gapCandidate.trackId !== trackId && gapCandidate.seconds === seconds) {
    gapCandidate = null
    rememberFade({ trimMs: seconds * 1000, on: true })
  } else if (gapCandidate?.trackId !== trackId) gapCandidate = { trackId, seconds }
}

/**
 * The saved lyric file's length as evidence of the recording's length.
 * Spotify's own lyrics carry no length: the lookup notes the one it was asked
 * with, which would confirm whatever was assumed.
 */
export function matchedLengthOf(document: { sourceDurationMs?: number; tracks: Array<{ kind: string; source: string }> } | null | undefined): number | undefined {
  if (!document?.sourceDurationMs) return undefined
  const original = document.tracks.find(track => track.kind === 'original')
  return original && !original.source.startsWith('Spotify') ? document.sourceDurationMs : undefined
}

interface ReportedPlayback {
  track: { id?: string; durationMs: number; sourceDurationMs?: number } | null
  positionMs: number
  playbackSource?: string
  fadeTrimMs?: number
  enteredAtEnd?: boolean
}

/**
 * What was decided for the song being played. A decision holds for the play:
 * seeking back to the start or repeating the song must not undo it, or the
 * lookup would run again each time.
 */
let play: { trackId: string; firstSeenAt: number; reportedMs: number; assumedMs: number; sureSince: number } | null = null

/**
 * The playback as the windows use it: the same snapshot, with the recording's
 * own length in `track.sourceDurationMs` when the reported one is (or is taken
 * to be) shortened by the crossfade. Lyric matching reads that field first.
 * `matchedDurationMs` is the length of the lyric file saved for the song
 * (`matchedLengthOf`). Only the main window (`remember`) updates what was learned.
 */
export function withReleaseDuration<T extends ReportedPlayback>(playback: T | null, matchedDurationMs: number | undefined, remember = true, now = Date.now()): T | null {
  const track = playback?.track
  if (!playback || !track || playback.playbackSource !== 'local') return playback
  const trackId = track.id ?? ''
  if (!play || play.trackId !== trackId) play = { trackId, firstSeenAt: now, reportedMs: track.durationMs, assumedMs: 0, sureSince: 0 }
  if (track.sourceDurationMs) {
    // The main process saw the length drop during this play. A mix-up of two
    // songs' lengths at a queue boundary looks the same for a moment, but the
    // song changes within seconds; a crossfade drop stays.
    if (playback.fadeTrimMs && Math.abs(track.sourceDurationMs - track.durationMs - playback.fadeTrimMs) <= 150) {
      if (!play.sureSince) play.sureSince = now
      if (remember && now - play.sureSince >= 5000) rememberFade({ trimMs: playback.fadeTrimMs, on: true })
    }
    return playback
  }
  play.sureSince = 0
  // Another reported length for the same song: decide anew.
  if (Math.abs(track.durationMs - play.reportedMs) > 50) { play.reportedMs = track.durationMs; play.assumedMs = 0 }
  const settled = playback.enteredAtEnd === true || now - play.firstSeenAt >= 10_000
  if (remember && settled && trackId && matchedDurationMs) learnFromGap(trackId, track.durationMs, matchedDurationMs, fadeMemory().trimMs)
  const known = fadeMemory(!remember)
  const result = releaseDurationOf({ durationMs: track.durationMs, fadeTrimMs: known.trimMs, matchedDurationMs, believedOn: known.on, settled })
  if (remember && result.fitMs !== undefined && result.fitMs <= TIGHT_FIT_MS) {
    if (result.verdict === 'reduced') rememberFade({ on: true })
    // A song that has been current this long and reports its real length: crossfade is off.
    else if (result.verdict === 'full' && now - play.firstSeenAt >= 12_000) rememberFade({ on: false })
  }
  let restored = result.durationMs
  if (result.verdict === 'assumed') play.assumedMs = restored!
  else if (result.verdict === 'unknown') restored = play.assumedMs || undefined
  else play.assumedMs = 0
  return restored ? { ...playback, track: { ...track, sourceDurationMs: restored } } : playback
}
