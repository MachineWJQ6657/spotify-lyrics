export type TransportCommand = 'next' | 'previous'
export type TransportBackend = 'local' | 'web'
export type TransportAction = TransportCommand | 'seek-to-zero'

export const TRACK_CHANGE_SETTLE_MS = 250
export const TRANSPORT_TIMEOUT_MS = 6_000
export const SEEK_TO_ZERO_LOCK_MS = 300
export const PREVIOUS_RESTART_THRESHOLD_MS = 3_000

export interface BeginTransportInput {
  command: TransportCommand
  fromTrackId: string | null | undefined
  backend: TransportBackend
  livePositionMs?: number
  startedAtMs?: number
}

export interface PendingTransport {
  readonly id: number
  readonly command: TransportCommand
  readonly action: TransportAction
  readonly fromTrackId: string | null
  readonly backend: TransportBackend
  readonly startedAtMs: number
  readonly expiresAtMs: number
}

export type TransportGateDecision =
  | { accepted: true; action: TransportAction; pending: PendingTransport }
  | { accepted: false; action: null; reason: 'pending'; pending: PendingTransport }

function trackId(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || null
}

/**
 * Serializes main-process next/previous requests without knowing how either
 * Spotify backend is implemented. Time is injectable so every boundary can be
 * tested without timers.
 */
export class TransportGate {
  private active: PendingTransport | null = null
  private candidate: { trackId: string; since: number } | null = null
  private nextId = 1

  constructor(private readonly now: () => number = Date.now) {}

  begin(input: BeginTransportInput): TransportGateDecision {
    const startedAtMs = Number.isFinite(input.startedAtMs) ? input.startedAtMs! : this.now()
    const active = this.pending(startedAtMs)
    if (active) return { accepted: false, action: null, reason: 'pending', pending: active }

    const livePositionMs = Number.isFinite(input.livePositionMs) ? input.livePositionMs! : 0
    const action: TransportAction = input.command === 'previous' && livePositionMs > PREVIOUS_RESTART_THRESHOLD_MS
      ? 'seek-to-zero'
      : input.command
    const lifetimeMs = action === 'seek-to-zero' ? SEEK_TO_ZERO_LOCK_MS : TRANSPORT_TIMEOUT_MS
    const pending = Object.freeze({
      id: this.nextId++,
      command: input.command,
      action,
      fromTrackId: trackId(input.fromTrackId),
      backend: input.backend,
      startedAtMs,
      expiresAtMs: startedAtMs + lifetimeMs
    })
    this.active = pending
    this.candidate = null
    return { accepted: true, action, pending }
  }

  /** Returns the live transaction, lazily releasing an elapsed timeout. */
  pending(atMs: number = this.now()): PendingTransport | null {
    if (this.active && atMs >= this.active.expiresAtMs) {
      this.active = null
      this.candidate = null
    }
    return this.active
  }

  isPending(atMs: number = this.now()) {
    return this.pending(atMs) !== null
  }

  /**
   * Releases only after a settled, non-empty identity change. Empty snapshots
   * and same-track refreshes are not evidence that a skip completed.
   */
  observeTrack(observedTrackId: string | null | undefined, observedAtMs: number = this.now()) {
    const pending = this.pending(observedAtMs)
    if (!pending || pending.action === 'seek-to-zero') return false
    const observed = trackId(observedTrackId)
    if (!observed || observed === pending.fromTrackId) {
      this.candidate = null
      return false
    }
    if (this.candidate?.trackId !== observed) {
      this.candidate = { trackId: observed, since: observedAtMs }
      return false
    }
    if (observedAtMs - this.candidate.since < TRACK_CHANGE_SETTLE_MS) return false
    this.active = null
    this.candidate = null
    return true
  }

  /**
   * Explicitly releases a failed transaction. The ID prevents a late failure
   * from clearing a newer transaction that began after the old one timed out.
   */
  release(transactionId: number) {
    if (!this.active || this.active.id !== transactionId) return false
    this.active = null
    this.candidate = null
    return true
  }
}
