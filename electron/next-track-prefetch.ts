import type { LyricsResult } from './lyrics-provider'
import type { PlaybackSnapshot } from './spotify'

type Track = NonNullable<PlaybackSnapshot['track']>

export interface PrefetchQueue { current: Track | null; next: Track | null }

export interface PrefetchDeps {
  /** The Web API queue; null when unavailable (not connected, 204, 429 …). */
  getQueue: () => Promise<PrefetchQueue | null>
  /** The full provider pipeline (source choice, completeness, language, translation). */
  fetchLyrics: (track: Track) => Promise<LyricsResult | null>
  /** Optional: pre-compute generated romaji so the song change shows it at once. */
  warmRomanization?: (result: LyricsResult) => Promise<unknown>
  log?: (message: string) => void
  now?: () => number
}

/** Start this long before the end; a Mix crossfade can begin ~25 s early. */
export const PREFETCH_LEAD_MS = 60_000
/** Too close to the end: the switch will win the race anyway. */
export const PREFETCH_MIN_REMAINING_MS = 4_000
export const PREFETCH_RETRY_MS = 15_000
export const PREFETCH_MAX_ATTEMPTS = 2
export const PREFETCH_TTL_MS = 15 * 60_000
const MAX_ENTRIES = 4
const MAX_TRACKED_SONGS = 50

const identity = (value: string | undefined) => (value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

/**
 * Whether two track descriptions (Web API queue vs local SMTC) name the same
 * recording. The title must match; then either the duration agrees within 2 s
 * together with the artist or album, or (Mix playback can report a hand-off
 * duration instead of the release length) title, artist and album all agree.
 */
export function sameRecording(left: Track, right: Track) {
  const title = identity(left.name)
  if (!title || title !== identity(right.name)) return false
  const artist = identity(left.artist), album = identity(left.album)
  const artistSame = Boolean(artist) && artist === identity(right.artist)
  const albumSame = Boolean(album) && album === identity(right.album)
  if (artistSame && albumSame) return true
  const durationAgrees = left.durationMs > 0 && right.durationMs > 0 && Math.abs(left.durationMs - right.durationMs) <= 2000
  return durationAgrees && (artistSame || albumSame)
}

/** Remaining playback time, extrapolated from the last observation; null when not playing/unknown. */
export function playbackRemainingMs(snapshot: PlaybackSnapshot | null | undefined, now: number) {
  const track = snapshot?.track
  if (!snapshot?.isPlaying || !track || !(track.durationMs > 0) || !Number.isFinite(snapshot.positionMs)) return null
  const elapsed = Math.max(0, now - (Number.isFinite(snapshot.observedAtMs) ? snapshot.observedAtMs : now))
  return track.durationMs - (snapshot.positionMs + elapsed)
}

/** A prefetched answer may replace the switch-time fetch only when it is definitive and timed. */
export function prefetchedResultUsable(result: LyricsResult | null | undefined): result is LyricsResult {
  return Boolean(result?.syncedLyrics && !result.transient && !result.instrumental)
}

/** One-line completeness/language summary for the QA log (no lyric text). */
export function describePrefetch(result: LyricsResult | null | undefined) {
  if (!result) return 'none'
  const rows = (result.syncedLyrics ?? '').split('\n').filter(line => /^\s*\[\d+:\d+/.test(line))
  const text = rows.join('')
  const script = /[぀-ヿ]/.test(text) ? 'ja' : /[가-힯]/.test(text) ? 'ko' : /[一-鿿]/.test(text) ? 'han' : /[a-z]/i.test(text) ? 'latin' : 'other'
  const extras = (result.additionalTracks ?? []).map(extra => `${extra.kind}:${extra.language}`).join(',') || 'none'
  return `source=${result.source}; lines=${rows.length}; script=${script}; extras=${extras}; transient=${Boolean(result.transient)}; instrumental=${Boolean(result.instrumental)}`
}

interface Entry { track: Track; at: number; promise: Promise<LyricsResult | null>; settled?: LyricsResult | null }
interface Attempt { count: number; lastAt: number; done: boolean }

/**
 * Fetches and checks the next queued song's lyrics shortly before the current
 * song ends, so the song change can show a verified result immediately.
 * Best effort: every failure leaves the normal switch-time fetch in place.
 */
export class NextTrackPrefetcher {
  private entries: Entry[] = []
  private attempts = new Map<string, Attempt>()
  private running = false
  private readonly now: () => number

  constructor(private readonly deps: PrefetchDeps) {
    this.now = deps.now ?? Date.now
  }

  /** Call on every playback observation; cheap when nothing is due. */
  async maybePrefetch(snapshot: PlaybackSnapshot | null | undefined) {
    const current = snapshot?.track
    if (!current || this.running) return
    const now = this.now()
    const remaining = playbackRemainingMs(snapshot, now)
    if (remaining == null || remaining > PREFETCH_LEAD_MS || remaining < PREFETCH_MIN_REMAINING_MS) return
    const previous = this.attempts.get(current.id)
    if (previous && (previous.done || previous.count >= PREFETCH_MAX_ATTEMPTS || now - previous.lastAt < PREFETCH_RETRY_MS)) return
    const attempt: Attempt = { count: (previous?.count ?? 0) + 1, lastAt: now, done: false }
    this.attempts.delete(current.id)
    this.attempts.set(current.id, attempt)
    if (this.attempts.size > MAX_TRACKED_SONGS) this.attempts.delete(this.attempts.keys().next().value!)
    this.running = true
    try {
      const queue = await this.deps.getQueue()
      if (!queue) return
      // The Web API reports the account's active device. If it is not playing
      // what this PC is playing (another device, or the API lags behind a
      // skip), its queue is not ours.
      if (!queue.current || !sameRecording(queue.current, current)) {
        this.deps.log?.(`lyrics prefetch skipped: Web API is playing ${queue.current ? `${queue.current.artist} - ${queue.current.name}` : 'nothing'}`)
        return
      }
      const next = queue.next
      if (!next) { attempt.done = true; this.deps.log?.('lyrics prefetch skipped: queue empty'); return }
      // Repeat-one: the "next" song is this one, already loaded.
      if (sameRecording(next, current)) { attempt.done = true; return }
      this.prune(now)
      const existing = this.entries.find(entry => entry.track.id === next.id)
      if (existing && (existing.settled === undefined || prefetchedResultUsable(existing.settled))) { attempt.done = true; return }
      const startedAt = this.now()
      const entry: Entry = { track: next, at: startedAt, promise: this.deps.fetchLyrics(next).catch(() => null) }
      this.entries = [entry, ...this.entries.filter(item => item.track.id !== next.id)].slice(0, MAX_ENTRIES)
      const result = await entry.promise
      entry.settled = result
      const usable = prefetchedResultUsable(result)
      attempt.done = usable
      this.deps.log?.(`lyrics prefetch: next=${next.artist} - ${next.name}; usable=${usable}; ${describePrefetch(result)}; elapsed=${this.now() - startedAt}ms`)
      if (usable && this.deps.warmRomanization) await this.deps.warmRomanization(result).catch(() => undefined)
    } catch (error) {
      this.deps.log?.(`lyrics prefetch failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.running = false
    }
  }

  /**
   * The prefetched result for the song that just started, if it is the same
   * recording and usable. Awaits a prefetch still in flight instead of
   * starting a duplicate lookup.
   */
  async take(track: Track | null | undefined): Promise<LyricsResult | null> {
    if (!track) return null
    this.prune(this.now())
    const entry = this.entries.find(item => sameRecording(item.track, track))
    if (!entry) return null
    const result = entry.settled !== undefined ? entry.settled : await entry.promise
    return prefetchedResultUsable(result) ? result : null
  }

  private prune(now: number) {
    this.entries = this.entries.filter(entry => now - entry.at <= PREFETCH_TTL_MS)
  }
}
