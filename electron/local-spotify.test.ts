import { afterEach, describe, expect, it, vi } from 'vitest'
import { adoptQueuedTrackDuration, advanceStartupClockGate, gateSameTrackDurationChange, LocalSpotifyService, localTrackIdentity, projectTransportState, retainPendingLocalState, shouldResetTrackClock, stabilizeLocalState, type LocalState } from './local-spotify'

afterEach(() => { vi.useRealTimers() })

// Exercise command acknowledgements and native delivery ordering without a
// Worker, Spotify session, or any live playback mutation.
function controlFixture(statusName = 'PLAYING') {
  vi.useFakeTimers()
  vi.setSystemTime(2_000)
  const state: LocalState = { title: 'Song', artist: 'Artist', album: 'Album', albumArtBase64: '',
    positionMs: 10_000, durationMs: 200_000, statusName, sampledAtMs: 1_000 }
  const service = new LocalSpotifyService()
  const internals = service as unknown as {
    state: LocalState | null; worker: object; request: () => Promise<void>;
    refreshTransitionProfile: () => Promise<void>;
    handleMessage(message: { type: 'state'; state: LocalState | null }): void
  }
  let finish!: () => void
  const response = new Promise<void>(resolve => { finish = resolve })
  Object.assign(internals, { state, worker: {}, request: () => response, refreshTransitionProfile: async () => {} })
  const receive = (patch: Partial<LocalState>) => internals.handleMessage({ type: 'state', state: { ...state, ...patch } })
  return { service, internals, receive, finish }
}

describe('local Spotify command clock ownership', () => {
  it('keeps elapsed playback when an already-playing command receives no native callback', async () => {
    const { service, finish } = controlFixture()
    expect(service.current()?.positionMs).toBe(11_000)
    const pending = service.control('play')
    vi.setSystemTime(2_250)
    finish(); await pending
    expect(service.current()).toMatchObject({ positionMs: 11_250, observedAtMs: 2_250, isPlaying: true })
  })

  it('advances a resumed clock from the command-time projection through its response', async () => {
    const { service, finish } = controlFixture('PAUSED')
    const pending = service.control('play')
    vi.setSystemTime(2_300)
    finish(); await pending
    expect(service.current()).toMatchObject({ positionMs: 10_300, isPlaying: true })
  })

  it('preserves an authoritative backward pause correction received before the response', async () => {
    const { service, receive, finish } = controlFixture()
    const pending = service.control('pause')
    vi.setSystemTime(2_100)
    receive({ statusName: 'PAUSED', positionMs: 10_100, sampledAtMs: 2_100 })
    vi.setSystemTime(2_300)
    finish(); await pending
    expect(service.current()).toMatchObject({ positionMs: 10_100, isPlaying: false })
  })

  it('preserves elapsed time after a native play confirmation received before the response', async () => {
    const { service, receive, finish } = controlFixture('PAUSED')
    const pending = service.control('play')
    vi.setSystemTime(2_100)
    receive({ statusName: 'PLAYING', positionMs: 10_400, sampledAtMs: 2_100 })
    vi.setSystemTime(2_400)
    finish(); await pending
    expect(service.current()).toMatchObject({ positionMs: 10_700, isPlaying: true })
  })

  it('holds the pause projection through an old-status callback and accepts the later native pause', async () => {
    const { service, receive, finish } = controlFixture()
    const pending = service.control('pause')
    vi.setSystemTime(2_050)
    receive({ positionMs: 10_000, sampledAtMs: 2_050 })
    expect(service.current()).toMatchObject({ positionMs: 11_000, isPlaying: false })
    vi.setSystemTime(2_200)
    finish(); await pending
    expect(service.current()).toMatchObject({ positionMs: 11_000, isPlaying: false })
    vi.setSystemTime(2_300)
    receive({ statusName: 'PAUSED', positionMs: 10_100, sampledAtMs: 2_300 })
    expect(service.current()).toMatchObject({ positionMs: 10_100, isPlaying: false })
  })

  it('does not let a queued pre-command sample confirm or rewind an already-playing command', async () => {
    const { service, receive, finish } = controlFixture()
    const pending = service.control('play')
    vi.setSystemTime(2_050)
    receive({ positionMs: 10_200, sampledAtMs: 1_200 })
    expect(service.current()?.positionMs).toBe(11_050)
    vi.setSystemTime(2_200)
    finish(); await pending
    expect(service.current()?.positionMs).toBe(11_200)
  })

  it('does not apply the old response after playback changes track and returns', async () => {
    const { service, receive, finish } = controlFixture()
    const pending = service.control('pause')
    vi.setSystemTime(2_100)
    receive({ title: 'Other song', positionMs: 500, sampledAtMs: 2_100 })
    vi.setSystemTime(2_200)
    receive({ positionMs: 50_000, sampledAtMs: 2_200 })
    vi.setSystemTime(2_300)
    finish(); await pending
    expect(service.current()).toMatchObject({ positionMs: 50_100, isPlaying: true })
  })

  it('respects a native status change after the optimistic guard expires', async () => {
    const { service, receive, finish } = controlFixture()
    const pending = service.control('pause')
    vi.setSystemTime(2_900)
    receive({ positionMs: 11_800, sampledAtMs: 2_900 })
    vi.setSystemTime(3_000)
    finish(); await pending
    expect(service.current()).toMatchObject({ positionMs: 11_900, isPlaying: true })
  })

  it('does not turn a bounded confirmed native reset into another2.8-second position hold', () => {
    const { service, receive } = controlFixture()
    receive({ positionMs: 0, durationMs: 180_000, sampledAtMs: 2_000, nativeBoundaryResetConfirmed: true })
    expect(service.current()).toMatchObject({ positionMs: 0, isPlaying: true })
    vi.setSystemTime(2_250)
    expect(service.current()?.positionMs).toBe(250)
  })

  it('checks raw next-item duration ownership before applying the outgoing Mix duration', () => {
    const { service, internals, receive } = controlFixture()
    Object.assign(internals, { transitionTrackIdentity: localTrackIdentity(internals.state!), transitionProfile: { outputDurationMs: 200_000 } })
    receive({ positionMs: 0, durationMs: 218_000, sampledAtMs: 2_000, nativeBoundaryResetConfirmed: true })
    expect(service.current()).toMatchObject({ positionMs: 0, track: { durationMs: 200_000 } })
    expect((internals as unknown as { durationChangeCandidate: { durationMs: number } }).durationChangeCandidate.durationMs).toBe(218_000)
  })
})

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
  it.each([
    { elapsedMs: 2145, progressMs: 4501 },
    { elapsedMs: 1485, progressMs: 4511 },
  ])('retains the existing startup quarantine for measured stale subscription +$progressMs ms in$elapsedMs ms', ({ elapsedMs, progressMs }) => {
    const state = { artist: 'ヨルシカ', title: 'ただ君に晴れ', album: 'ただ君に晴れ', positionMs: 161385, statusName: 'PLAYING' }
    const initial = advanceStartupClockGate(null, state, 0)
    expect(initial?.readyAtMs).toBe(5000)
    const corrected = advanceStartupClockGate(initial, { ...state, positionMs: state.positionMs + progressMs }, elapsedMs)
    expect(corrected).toMatchObject({ correctionDetected: true, readyAtMs: elapsedMs + 180 })
    // This is an authoritative initial correction, not evidence for scaling
    // the remainder of the song or extrapolating a non-unit playback rate.
    expect(corrected?.anchorPositionMs).toBe(state.positionMs + progressMs)
  })

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
