import { describe, expect, it } from 'vitest'
import { adoptQueuedTrackDuration, advanceStartupClockGate, gateSameTrackDurationChange, localTrackIdentity, projectTransportState, retainPendingLocalState, shouldResetTrackClock, stabilizeLocalState } from './local-spotify'

describe('local Spotify track identity', () => {
  it('stays stable when SMTC reports a different duration for the same song', () => {
    const base = { artist: 'ヨルシカ', title: 'ルバート', album: '二人称' }
    expect(localTrackIdentity(base)).toBe(localTrackIdentity({ ...base }))
  })

  it('distinguishes same-name tracks from different albums', () => {
    const first = localTrackIdentity({ artist: 'Artist', title: 'Song', album: 'Studio' })
    const second = localTrackIdentity({ artist: 'Artist', title: 'Song', album: 'Live' })
    expect(first).not.toBe(second)
  })

  it('re-arms clock stabilization only for a real replacement identity', () => {
    const walk = { artist: 'ヨルシカ', title: '歩く', album: 'エルマ' }
    const settled = localTrackIdentity(walk)
    expect(shouldResetTrackClock(settled, walk)).toBe(false)
    expect(shouldResetTrackClock(settled, { ...walk, title: '雨とカプチーノ' })).toBe(true)
    expect(shouldResetTrackClock(settled, null)).toBe(false)
    expect(shouldResetTrackClock('', walk)).toBe(false)
  })

  it('preserves the larger reliable duration and cover for the same track', () => {
    const shared = { artist: 'Artist', title: 'Song', album: 'Album', positionMs: 10_000, statusName: 'PAUSED', sampledAtMs: 1 }
    const previous = { ...shared, durationMs: 231_000, albumArtBase64: 'cover' }
    const next = { ...shared, durationMs: 218_000, albumArtBase64: '' }
    expect(stabilizeLocalState(previous, next)).toMatchObject({ durationMs: 231_000, albumArtBase64: 'cover' })
  })

  it('can accept a confirmed shorter Automix transport duration', () => {
    const shared = { artist: 'Artist', title: 'Song', album: 'Album', positionMs: 10_000, statusName: 'PLAYING', sampledAtMs: 2, albumArtBase64: '' }
    const previous = { ...shared, durationMs: 250_000, sampledAtMs: 1 }
    const next = { ...shared, durationMs: 239_000 }
    expect(stabilizeLocalState(previous, next)?.durationMs).toBe(250_000)
    expect(stabilizeLocalState(previous, next, true)?.durationMs).toBe(239_000)
  })

  it('freezes the projected live position instead of an old sample when pausing', () => {
    const state = {
      artist: 'Artist', title: 'Song', album: 'Album', durationMs: 200_000, albumArtBase64: '',
      positionMs: 10_000, statusName: 'PLAYING', sampledAtMs: 1_000
    }
    expect(projectTransportState(state, 'pause', 3_500)).toMatchObject({ positionMs: 12_500, statusName: 'PAUSED', sampledAtMs: 3_500 })
  })

  it('accepts Spotify pause time even when the previous extrapolation was ahead', () => {
    const shared = { artist: 'Artist', title: 'Song', album: 'Album', durationMs: 200_000, albumArtBase64: '' }
    const previous = { ...shared, positionMs: 10_000, statusName: 'PLAYING', sampledAtMs: 1_000 }
    const delayedPause = { ...shared, positionMs: 10_300, statusName: 'PAUSED', sampledAtMs: 3_000 }
    expect(stabilizeLocalState(previous, delayedPause)?.positionMs).toBe(10_300)
  })

  it('does not preserve an early lyric clock after an authoritative pause', () => {
    const shared = { artist: 'Artist', title: 'Song', album: 'Album', durationMs: 200_000, albumArtBase64: '', sampledAtMs: 1 }
    const previous = { ...shared, positionMs: 37_694, statusName: 'PLAYING' }
    const next = { ...shared, positionMs: 36_175, statusName: 'PAUSED' }
    expect(stabilizeLocalState(previous, next)?.positionMs).toBe(36_175)
  })
})

describe('local Spotify startup clock gate', () => {
  it('quarantines the observed Shura stale startup sample before the authoritative update', () => {
    const state = { artist: 'ヨルシカ', title: '修羅', album: '', positionMs: 27506, statusName: 'PLAYING' }
    const initial = advanceStartupClockGate(null, state, 32)
    expect(initial?.readyAtMs).toBeGreaterThan(936)
    const corrected = advanceStartupClockGate(initial, { ...state, positionMs: 32010 }, 936)
    expect(corrected).toMatchObject({ correctionDetected: true, anchorPositionMs: 32010, readyAtMs: 1116 })
    const stable = advanceStartupClockGate(corrected, { ...state, positionMs: 36511 }, 5437)
    expect(stable?.readyAtMs).toBe(1116)
  })
  const playing = { artist: 'Aimer', title: 'Eclipse', album: 'Open α Door', positionMs: 80_000, statusName: 'PLAYING' }

  it('holds an already-playing first sample for a bounded stabilization window', () => {
    expect(advanceStartupClockGate(null, playing, 1_000)).toMatchObject({
      readyAtMs: 6_000,
      startedAtMs: 1_000,
      correctionDetected: false
    })
  })

  it('does not mistake normally advancing position events for a correction', () => {
    const first = advanceStartupClockGate(null, playing, 1_000)
    const next = advanceStartupClockGate(first, { ...playing, positionMs: 80_900 }, 1_900)
    expect(next).toMatchObject({ readyAtMs: 6_000, correctionDetected: false })
  })

  it('releases shortly after Spotify republishes a corrected raw anchor', () => {
    const first = advanceStartupClockGate(null, playing, 1_000)
    const corrected = advanceStartupClockGate(first, { ...playing, positionMs: 85_000 }, 1_900)
    expect(corrected).toMatchObject({ readyAtMs: 2_080, correctionDetected: true, anchorPositionMs: 85_000 })
  })

  it('publishes paused transport promptly because its position is not extrapolated', () => {
    expect(advanceStartupClockGate(null, { ...playing, statusName: 'PAUSED' }, 1_000)?.readyAtMs).toBe(1_120)
  })

  it('restarts stabilization when the detected track changes', () => {
    const first = advanceStartupClockGate(null, playing, 1_000)
    const replacement = advanceStartupClockGate(first, { ...playing, title: 'Ref:rain', positionMs: 2_000 }, 2_000)
    expect(replacement).toMatchObject({ readyAtMs: 7_000, startedAtMs: 2_000, correctionDetected: false })
  })
  it('waits through a 4.5-second native cadence but releases a late correction promptly', () => {
    const first = advanceStartupClockGate(null, playing, 1000)
    const projected = advanceStartupClockGate(first, { ...playing, positionMs: 83000 }, 4000)
    expect(projected!.readyAtMs).toBeGreaterThan(5500)
    const corrected = advanceStartupClockGate(projected, { ...playing, positionMs: 88000 }, 5500)
    expect(corrected).toMatchObject({ readyAtMs: 5680, correctionDetected: true })
  })
})

describe('local Spotify duration ownership gate', () => {
  it('holds a next-track duration that arrives under the previous title', () => {
    const first = gateSameTrackDurationChange('old-track', 238_525, 350_200, null, 1_000)
    expect(first).toMatchObject({ durationMs: 238_525, allowShorterDuration: false })
    const repeated = gateSameTrackDurationChange('old-track', 238_525, 350_200, first.candidate, 2_400)
    expect(repeated).toMatchObject({ durationMs: 238_525, allowShorterDuration: false })
  })

  it('eventually accepts a genuine persistent correction for the same title', () => {
    const first = gateSameTrackDurationChange('same-track', 238_525, 350_200, null, 1_000)
    const confirmed = gateSameTrackDurationChange('same-track', 238_525, 350_200, first.candidate, 3_900)
    expect(confirmed).toEqual({ durationMs: 350_200, candidate: null, allowShorterDuration: true })
  })

  it('accepts a verified Spotify Mix endpoint without waiting', () => {
    expect(gateSameTrackDurationChange('mix', 250_000, 231_000, null, 1_000, true))
      .toEqual({ durationMs: 231_000, candidate: null, allowShorterDuration: true })
  })

  it('does not delay ordinary sub-second duration noise', () => {
    expect(gateSameTrackDurationChange('same-track', 242_000, 241_500, null, 1_000))
      .toEqual({ durationMs: 241_500, candidate: null, allowShorterDuration: false })
  })

  const state = (title: string, durationMs: number, positionMs: number): Parameters<typeof adoptQueuedTrackDuration>[0] => ({
    artist: 'Artist', title, album: title, durationMs, positionMs,
    albumArtBase64: '', statusName: 'PLAYING', sampledAtMs: 1_000
  })

  it('carries a fresh quarantined near-zero duration into the new title event', () => {
    const previous = state('Outgoing', 231_106, 225_844)
    const incoming = state('Incoming', 0, 185)
    const candidate = gateSameTrackDurationChange(localTrackIdentity(previous!), previous!.durationMs, 277_337, null, 1_000, false, 15).candidate
    expect(adoptQueuedTrackDuration(previous, incoming, candidate, 1_170)?.durationMs).toBe(277_337)
  })

  it('does not carry a duration from a mid-song correction or stale boundary', () => {
    const previous = state('Outgoing', 231_106, 120_000)
    const incoming = state('Incoming', 0, 185)
    const midSong = gateSameTrackDurationChange(localTrackIdentity(previous!), previous!.durationMs, 277_337, null, 1_000, false, 120_000).candidate
    const nearZero = gateSameTrackDurationChange(localTrackIdentity(previous!), previous!.durationMs, 277_337, null, 1_000, false, 15).candidate
    expect(adoptQueuedTrackDuration(previous, incoming, midSong, 1_170)?.durationMs).toBe(0)
    expect(adoptQueuedTrackDuration(previous, incoming, nearZero, 3_300)?.durationMs).toBe(0)
  })

  it('never replaces a positive duration already owned by the new title', () => {
    const previous = state('Outgoing', 231_106, 225_844)
    const incoming = state('Incoming', 285_400, 185)
    const candidate = gateSameTrackDurationChange(localTrackIdentity(previous!), previous!.durationMs, 277_337, null, 1_000, false, 15).candidate
    expect(adoptQueuedTrackDuration(previous, incoming, candidate, 1_170)?.durationMs).toBe(285_400)
  })
})

describe('local Spotify skip gaps', () => {
  const playing = {
    title: 'Outgoing', artist: 'Artist', album: 'Album', albumArtBase64: '',
    positionMs: 120_000, durationMs: 180_000, statusName: 'PLAYING', sampledAtMs: 1_000
  }

  it('retains the last non-empty identity during a bounded pending skip', () => {
    expect(retainPendingLocalState(playing, null, localTrackIdentity(playing), 2_000, 7_000)).toBe(playing)
    expect(retainPendingLocalState(playing, { ...playing, title: '' }, localTrackIdentity(playing), 2_000, 7_000)).toBe(playing)
  })

  it('accepts a replacement identity and clears an expired empty session', () => {
    const replacement = { ...playing, title: 'Incoming', positionMs: 0 }
    expect(retainPendingLocalState(playing, replacement, localTrackIdentity(playing), 2_000, 7_000)).toBe(replacement)
    expect(retainPendingLocalState(playing, null, localTrackIdentity(playing), 7_001, 7_000)).toBeNull()
  })
})
