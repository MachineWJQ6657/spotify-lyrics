import { describe, expect, it } from 'vitest'
import { nativeClockPosition, observeNativeClock } from './native-clock'
import { advanceStartupClockGate } from './local-spotify'

// Regressions from the seventh review (0.4.73): the lyric clock around pauses, track changes and seeks.

const song = { artist: 'x', title: 'A', album: 'a', positionMs: 169_134, durationMs: 240_000, statusName: 'PLAYING' }

describe('pausing', () => {
  it('holds the clock where it has run to when the notification repeats the last raw position', () => {
    // The last raw sample is 3787 ms old. Anchoring the pause there showed an
    // earlier line until the paused position arrived (4-70 ms later).
    const playing = observeNativeClock(null, song, 1000)
    const paused = observeNativeClock(playing, { ...song, statusName: 'PAUSED' }, 4787)
    expect(nativeClockPosition(paused, 4787)).toBe(172_921)
    expect(nativeClockPosition(paused, 9000)).toBe(172_921)
    // More notifications with the old raw position change nothing.
    const repeated = observeNativeClock(paused, { ...song, statusName: 'PAUSED' }, 4800)
    expect(nativeClockPosition(repeated, 9000)).toBe(172_921)
    // The measured paused position, when it comes, is taken exactly, also backwards.
    const measured = observeNativeClock(repeated, { ...song, statusName: 'PAUSED', positionMs: 172_800 }, 4856)
    expect(nativeClockPosition(measured, 9000)).toBe(172_800)
  })

  it('still adopts a paused sample that carries a new position at once', () => {
    const paused = observeNativeClock(observeNativeClock(null, song, 1000), { ...song, statusName: 'PAUSED', positionMs: 171_000 }, 4787)
    expect(nativeClockPosition(paused, 9000)).toBe(171_000)
  })

  it('resumes from the held position', () => {
    const paused = observeNativeClock(observeNativeClock(null, song, 1000), { ...song, statusName: 'PAUSED' }, 4787)
    const resumed = observeNativeClock(paused, song, 10_000)
    // The raw position is still the old one; a resume anchors it now, as before.
    expect(nativeClockPosition(resumed, 10_500)).toBe(169_634)
  })

  it('does not hold past the end of the song', () => {
    const near = observeNativeClock(null, { ...song, positionMs: 239_000 }, 1000)
    expect(nativeClockPosition(observeNativeClock(near, { ...song, positionMs: 239_000, statusName: 'PAUSED' }, 9000), 9000)).toBe(240_000)
  })
})

describe('the clock gate after a track change', () => {
  const first = { artist: 'x', title: 'B', album: 'b', positionMs: 0, statusName: 'PLAYING' }

  it('releases a correction of 150 ms or more shortly after it arrives', () => {
    // Logged: the first raw sample of a new song 884 ms ahead of the next one, published only at the 5 s fallback.
    const gate = advanceStartupClockGate(null, first, 0, true)
    expect(gate?.readyAtMs).toBe(5000)
    const corrected = advanceStartupClockGate(gate, { ...first, positionMs: 1227 }, 2111, true)
    expect(corrected).toMatchObject({ correctionDetected: true, anchorPositionMs: 1227, readyAtMs: 2291 })
  })

  it('keeps waiting when the next sample agrees', () => {
    const gate = advanceStartupClockGate(null, first, 0, true)
    expect(advanceStartupClockGate(gate, { ...first, positionMs: 2180 }, 2111, true)).toMatchObject({ correctionDetected: false, readyAtMs: 5000 })
  })

  it('publishes playing at once for a song that arrived paused (skipping while paused)', () => {
    const paused = advanceStartupClockGate(null, { ...first, statusName: 'PAUSED' }, 0, true)
    expect(paused?.readyAtMs).toBe(120)
    // Before: the 5 s wait restarted and the new song stayed "paused at 0" for five seconds.
    expect(advanceStartupClockGate(paused, first, 91, true)?.readyAtMs).toBe(271)
  })

  it('leaves the app-startup gate as it was', () => {
    const gate = advanceStartupClockGate(null, first, 0)
    expect(advanceStartupClockGate(gate, { ...first, positionMs: 1227 }, 2111)).toMatchObject({ correctionDetected: false, readyAtMs: 5000 })
    const paused = advanceStartupClockGate(null, { ...first, statusName: 'PAUSED' }, 0)
    expect(advanceStartupClockGate(paused, first, 91)?.readyAtMs).toBe(5091)
    // A new song under an announced gate still starts its own 5 s window.
    expect(advanceStartupClockGate(gate, { ...first, title: 'C' }, 3000, true)?.readyAtMs).toBe(8000)
  })
})
