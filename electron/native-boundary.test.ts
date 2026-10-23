import { describe, expect, it } from 'vitest'
import { guardNativeBoundary, type NativeBoundaryPending } from './native-boundary'
import { nativeClockPosition, observeNativeClock, type NativeClockSample } from './native-clock'

const state = (positionMs = 19350, durationMs = 276701): NativeClockSample => ({
  artist: 'ヨルシカ', title: '晴る', album: '晴る', positionMs, durationMs, statusName: 'PLAYING',
})

describe('raw SMTC queue-boundary ownership', () => {
  it('quarantines actual seq19→20 next-duration/zero-position until the title changes1 ms later', () => {
    const previous = state(), nextDuration = state(0, 218000)
    const held = guardNativeBoundary(previous, nextDuration, null, 1000)
    expect(held).toMatchObject({ held: true, sample: previous, resetConfirmed: false })
    const incoming = { ...state(0, 218000), title: '春ひさぎ', album: '盗作' }
    expect(guardNativeBoundary(previous, incoming, held.pending, 1001)).toMatchObject({
      sample: incoming, held: false, pending: null, observedAtMs: 1001, resetConfirmed: false,
    })
  })

  it('quarantines actual seq11→12 zero duration at the outgoing end for153 ms only', () => {
    const previous = { ...state(199842, 199842), title: 'ただ君に晴れ', album: 'ただ君に晴れ' }
    const held = guardNativeBoundary(previous, { ...previous, positionMs: 0, durationMs: 0 }, null, 1000)
    expect(held.held).toBe(true)
    const incoming = state(0, 0)
    expect(guardNativeBoundary(previous, incoming, held.pending, 1153)).toMatchObject({ sample: incoming, held: false, pending: null })
  })

  it('does not feed the mixed sample into the native clock or turn it into an outgoing seek', () => {
    const previous = state(), clock = observeNativeClock(null, previous, 1000)
    const held = guardNativeBoundary(previous, state(0, 218000), null, 1100)
    const projected = observeNativeClock(clock, held.sample, held.observedAtMs)
    expect(nativeClockPosition(projected, 1101)).toBe(19451)
    expect(projected?.durationMs).toBe(276701)
  })

  it('releases persistent same-title zero after250 ms using its original observation time', () => {
    const previous = state(), reset = state(0, 218000)
    const held = guardNativeBoundary(previous, reset, null, 1000)
    expect(guardNativeBoundary(previous, reset, held.pending, 1249).held).toBe(true)
    const released = guardNativeBoundary(previous, reset, held.pending, 1250)
    expect(released).toMatchObject({ held: false, pending: null, resetConfirmed: true, observedAtMs: 1000 })
    const clock = observeNativeClock(observeNativeClock(null, previous, 0), released.sample, released.observedAtMs)
    expect(nativeClockPosition(clock, 1250)).toBe(250)
  })

  it('uses the last distinct raw reset position without renewing the250 ms deadline', () => {
    const held = guardNativeBoundary(state(), state(0, 0), null, 1000)
    const progressed = guardNativeBoundary(state(), state(100, 218000), held.pending, 1100)
    expect(progressed.pending).toMatchObject({ firstSeenAtMs: 1000, observedAtMs: 1100 })
    const released = guardNativeBoundary(state(), state(100, 218000), progressed.pending, 1250)
    expect(released).toMatchObject({ held: false, resetConfirmed: true, observedAtMs: 1100 })
    expect(nativeClockPosition(observeNativeClock(null, released.sample, released.observedAtMs), 1250)).toBe(250)
  })

  it('never delays ordinary seeks, pause/resume, unknown-duration sessions or small corrections', () => {
    const cases: Array<[NativeClockSample, NativeClockSample]> = [
      [state(), state(0)], [state(), state(12000)], [state(), state(18000)],
      [state(), { ...state(0, 0), statusName: 'PAUSED' }],
      [{ ...state(), statusName: 'PAUSED' }, state(0, 0)],
      [state(19350, 0), state(0, 0)], [state(), state(0, 276700)],
    ]
    for (const [previous, incoming] of cases) expect(guardNativeBoundary(previous, incoming, null, 1000)).toMatchObject({
      sample: incoming, held: false, pending: null, resetConfirmed: false,
    })
  })

  it('cancels pending ownership when the native session disappears or recovers', () => {
    const held = guardNativeBoundary(state(), state(0, 0), null, 1000)
    expect(guardNativeBoundary(state(), null, held.pending, 1001).pending).toBeNull()
    expect(guardNativeBoundary(state(), state(19400), held.pending, 1001)).toMatchObject({ held: false, pending: null })
  })

  it('is self-contained for Worker injection and does not renew stale/foreign pending timestamps', () => {
    const injected = Function(`return (${guardNativeBoundary.toString()})`)() as typeof guardNativeBoundary
    const foreign: NativeBoundaryPending<NativeClockSample> = { trackIdentity: 'other', firstSeenAtMs: 0, observedAtMs: 0, sample: state() }
    expect(injected(state(), state(0, 0), foreign, 1000).pending?.firstSeenAtMs).toBe(1000)
    const future = guardNativeBoundary(state(), state(0, 0), null, 2000).pending
    expect(injected(state(), state(0, 0), future, 1000).pending?.firstSeenAtMs).toBe(1000)
  })
})
