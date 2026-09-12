import { describe, expect, it } from 'vitest'
import {
  PREVIOUS_RESTART_THRESHOLD_MS,
  SEEK_TO_ZERO_LOCK_MS,
  TRACK_CHANGE_SETTLE_MS,
  TRANSPORT_TIMEOUT_MS,
  TransportGate
} from './transport-gate'

function clock(start = 1_000) {
  let now = start
  return {
    now: () => now,
    set(value: number) { now = value }
  }
}

describe('main-process transport transaction gate', () => {
  it('records the accepted transaction and backend', () => {
    const time = clock()
    const gate = new TransportGate(time.now)
    const decision = gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'local' })

    expect(decision).toMatchObject({
      accepted: true,
      action: 'next',
      pending: {
        id: 1,
        command: 'next',
        action: 'next',
        fromTrackId: 'track-a',
        backend: 'local',
        startedAtMs: 1_000,
        expiresAtMs: 1_000 + TRANSPORT_TIMEOUT_MS
      }
    })
    expect(gate.pending()).toBe(decision.pending)
  })

  it('shares one pending transaction across next and previous', () => {
    const time = clock()
    const gate = new TransportGate(time.now)
    const first = gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'local' })
    const interleaved = gate.begin({
      command: 'previous',
      fromTrackId: 'track-a',
      backend: 'web',
      livePositionMs: PREVIOUS_RESTART_THRESHOLD_MS + 1
    })

    expect(first.accepted).toBe(true)
    expect(interleaved).toMatchObject({ accepted: false, action: null, reason: 'pending' })
    expect(interleaved.pending).toBe(first.pending)
  })

  it('does not release for empty or same-track observations', () => {
    const time = clock()
    const gate = new TransportGate(time.now)
    gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'web' })

    time.set(1_000 + TRACK_CHANGE_SETTLE_MS)
    expect(gate.observeTrack(null)).toBe(false)
    expect(gate.observeTrack('')).toBe(false)
    expect(gate.observeTrack('   ')).toBe(false)
    expect(gate.observeTrack('track-a')).toBe(false)
    expect(gate.isPending()).toBe(true)
  })

  it('requires both a new non-empty track and the 250ms settle boundary', () => {
    const time = clock()
    const gate = new TransportGate(time.now)
    gate.begin({ command: 'previous', fromTrackId: 'track-a', backend: 'local' })

    time.set(2_000)
    expect(gate.observeTrack('track-b')).toBe(false)
    time.set(2_000 + TRACK_CHANGE_SETTLE_MS - 1)
    expect(gate.observeTrack('track-b')).toBe(false)
    time.set(2_000 + TRACK_CHANGE_SETTLE_MS)
    expect(gate.observeTrack('track-b')).toBe(true)
    expect(gate.isPending()).toBe(false)
  })

  it('restarts confirmation after an empty, outgoing, or different identity', () => {
    for (const interruption of [null, 'track-a', 'track-c']) {
      const time = clock()
      const gate = new TransportGate(time.now)
      gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'local' })
      expect(gate.observeTrack('track-b', 2_000)).toBe(false)
      expect(gate.observeTrack(interruption, 2_200)).toBe(false)
      expect(gate.observeTrack('track-b', 2_250)).toBe(false)
      expect(gate.observeTrack('track-b', 2_499)).toBe(false)
      expect(gate.observeTrack('track-b', 2_500)).toBe(true)
    }
  })

  it('accepts a new command once a skip transaction reaches six seconds', () => {
    const time = clock()
    const gate = new TransportGate(time.now)
    gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'local' })

    time.set(1_000 + TRANSPORT_TIMEOUT_MS - 1)
    expect(gate.begin({ command: 'previous', fromTrackId: 'track-a', backend: 'web' }).accepted).toBe(false)
    time.set(1_000 + TRANSPORT_TIMEOUT_MS)
    const accepted = gate.begin({ command: 'previous', fromTrackId: 'track-a', backend: 'web' })
    expect(accepted).toMatchObject({ accepted: true, action: 'previous', pending: { id: 2, backend: 'web' } })
  })

  it('can explicitly release a failed transaction', () => {
    const time = clock()
    const gate = new TransportGate(time.now)
    const failed = gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'local' })
    expect(failed.accepted).toBe(true)
    if (!failed.accepted) throw new Error('expected an accepted transaction')

    expect(gate.release(failed.pending.id)).toBe(true)
    expect(gate.release(failed.pending.id)).toBe(false)
    expect(gate.begin({ command: 'previous', fromTrackId: 'track-a', backend: 'local' }).accepted).toBe(true)
  })

  it('does not let a stale failure release a newer transaction', () => {
    const time = clock()
    const gate = new TransportGate(time.now)
    const old = gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'local' })
    if (!old.accepted) throw new Error('expected an accepted transaction')
    time.set(1_000 + TRANSPORT_TIMEOUT_MS)
    const current = gate.begin({ command: 'previous', fromTrackId: 'track-a', backend: 'web' })
    if (!current.accepted) throw new Error('expected an accepted transaction')

    expect(gate.release(old.pending.id)).toBe(false)
    expect(gate.pending()).toBe(current.pending)
  })

  it('atomically chooses seek-to-zero only above the previous threshold', () => {
    const time = clock()
    const gate = new TransportGate(time.now)

    const boundary = gate.begin({
      command: 'previous',
      fromTrackId: 'track-a',
      backend: 'local',
      livePositionMs: PREVIOUS_RESTART_THRESHOLD_MS
    })
    expect(boundary).toMatchObject({ accepted: true, action: 'previous' })
    if (!boundary.accepted) throw new Error('expected an accepted transaction')
    gate.release(boundary.pending.id)

    const restart = gate.begin({
      command: 'previous',
      fromTrackId: 'track-a',
      backend: 'local',
      livePositionMs: PREVIOUS_RESTART_THRESHOLD_MS + 1
    })
    expect(restart).toMatchObject({
      accepted: true,
      action: 'seek-to-zero',
      pending: { command: 'previous', expiresAtMs: 1_000 + SEEK_TO_ZERO_LOCK_MS }
    })
  })

  it('uses only a short lock for seek-to-zero while rejecting a simultaneous skip', () => {
    const time = clock()
    const gate = new TransportGate(time.now)
    gate.begin({ command: 'previous', fromTrackId: 'track-a', backend: 'web', livePositionMs: 9_000 })

    expect(gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'local' }).accepted).toBe(false)
    time.set(1_000 + SEEK_TO_ZERO_LOCK_MS - 1)
    expect(gate.begin({ command: 'previous', fromTrackId: 'track-a', backend: 'local' }).accepted).toBe(false)
    time.set(1_000 + SEEK_TO_ZERO_LOCK_MS)
    expect(gate.begin({ command: 'next', fromTrackId: 'track-a', backend: 'local' }))
      .toMatchObject({ accepted: true, action: 'next' })
  })
})
