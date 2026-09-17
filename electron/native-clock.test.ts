import { describe, expect, it } from 'vitest'
import { nativeClockPosition, observeNativeClock } from './native-clock'

const song = { artist: 'ヨルシカ', title: '準透明少年', album: '負け犬にアンコールはいらない', positionMs: 206489, durationMs: 281467, statusName: 'PLAYING' }

describe('raw native clock', () => {
  it('corrects the observed 547ms persistent native smooth-clock error', () => {
    let clock = observeNativeClock(null, song, 5920297)
    clock = observeNativeClock(clock, { ...song, positionMs: 210989 }, 5924252)
    expect(nativeClockPosition(clock, 5924252)).toBe(210989)
    clock = observeNativeClock(clock, { ...song, positionMs: 215505 }, 5928768)
    expect(nativeClockPosition(clock, 5929768)).toBe(216505)
  })

  it('accepts a 1000ms backward correction instead of retaining early lyrics', () => {
    const first = observeNativeClock(null, { ...song, positionMs: 10000 }, 1000)
    const corrected = observeNativeClock(first, { ...song, positionMs: 13500 }, 5500)
    expect(nativeClockPosition(corrected, 5500)).toBe(13500)
    expect(nativeClockPosition(corrected, 6000)).toBe(14000)
  })

  it('does not restart the clock on duplicate polls or metadata notifications', () => {
    let clock = observeNativeClock(null, song, 1000)
    for (const time of [1010, 1500, 2500, 4000]) clock = observeNativeClock(clock, song, time)
    expect(nativeClockPosition(clock, 5000)).toBe(song.positionMs + 4000)
  })

  it('adopts the exact paused sample, including corrections backwards', () => {
    const clock = observeNativeClock(observeNativeClock(null, song, 1000), { ...song, statusName: 'PAUSED', positionMs: 207000 }, 2500)
    expect(nativeClockPosition(clock, 10000)).toBe(207000)
  })

  it('resets on track change even when the raw position is identical', () => {
    const first = observeNativeClock(null, song, 1000)
    const next = observeNativeClock(first, { ...song, title: 'Next' }, 5000)
    expect(nativeClockPosition(next, 5500)).toBe(song.positionMs + 500)
    expect(observeNativeClock(next, null, 6000)).toBeNull()
  })

  it('accepts short seeks, resumes, and unknown duration without extra smoothing', () => {
    let clock = observeNativeClock(null, { ...song, positionMs: 10000, durationMs: 0 }, 1000)
    clock = observeNativeClock(clock, { ...song, positionMs: 10200, durationMs: 0 }, 2000)
    expect(nativeClockPosition(clock, 2500)).toBe(10700)
    clock = observeNativeClock(clock, { ...song, positionMs: 10200, statusName: 'PAUSED' }, 2600)
    clock = observeNativeClock(clock, { ...song, positionMs: 10200 }, 10000)
    expect(nativeClockPosition(clock, 10500)).toBe(10700)
  })
})
