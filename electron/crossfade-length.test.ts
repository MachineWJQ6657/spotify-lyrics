import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalSpotifyService, type LocalState } from './local-spotify'

afterEach(() => { vi.useRealTimers() })

// What the service tells the windows when Spotify's crossfade shortens the
// reported length (measured 2026-11-22, 7 s crossfade). No Worker, no player.
function fixture(initial: Partial<LocalState> = {}) {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  let state: LocalState = { title: 'Lemon', artist: '米津玄師', album: 'Lemon', albumArtBase64: '',
    positionMs: 0, durationMs: 256_116, statusName: 'PLAYING', sampledAtMs: 100_000, ...initial }
  const service = new LocalSpotifyService()
  const internals = service as unknown as {
    state: LocalState | null; worker: object; refreshTransitionProfile: () => Promise<void>
    handleMessage(message: { type: 'state'; state: LocalState | null }): void
  }
  Object.assign(internals, { state, worker: {}, refreshTransitionProfile: async () => {} })
  /** The player's next report, `afterMs` later; position follows the clock unless given. */
  const report = (afterMs: number, patch: Partial<LocalState> = {}) => {
    vi.setSystemTime(Date.now() + afterMs)
    const sameSong = !patch.title || patch.title === state.title
    state = { ...state, positionMs: sameSong ? state.positionMs + afterMs : 0, ...patch, sampledAtMs: Date.now() }
    internals.handleMessage({ type: 'state', state })
  }
  return { service, report }
}

describe('a song whose reported length drops by the crossfade time', () => {
  it('keeps its own length for lyric matching and reports the crossfade time', () => {
    const { service, report } = fixture()
    report(1400); report(1400); report(1400)
    expect(service.current()?.track).toMatchObject({ durationMs: 256_116 })
    expect(service.current()?.track?.sourceDurationMs).toBeUndefined()
    // 5.06 s in: 249 116 ms, as measured. Held until it has been seen for 2.8 s.
    report(860, { durationMs: 249_116 })
    expect(service.current()?.track).toMatchObject({ durationMs: 256_116 })
    report(1400, { durationMs: 249_116 })
    report(1400, { durationMs: 249_116 })
    const snapshot = service.current()
    expect(snapshot?.track).toMatchObject({ durationMs: 249_116, sourceDurationMs: 256_116 })
    expect(snapshot?.fadeTrimMs).toBe(7000)
    // It stays that way for the rest of the song.
    report(1400, { durationMs: 249_116 })
    expect(service.current()?.track).toMatchObject({ durationMs: 249_116, sourceDurationMs: 256_116 })
  })

  it('forgets the kept length at the next song', () => {
    const { service, report } = fixture()
    report(1400); report(1400); report(1400)
    report(860, { durationMs: 249_116 }); report(1400, { durationMs: 249_116 }); report(1400, { durationMs: 249_116 })
    report(1400, { title: 'ワンダー', artist: 'tayori', album: 'ワンダー', durationMs: 220_053 })
    const snapshot = service.current()
    expect(snapshot?.track).toMatchObject({ name: 'ワンダー', durationMs: 220_053 })
    expect(snapshot?.track?.sourceDurationMs).toBeUndefined()
    // The crossfade time travels only with the play that showed it; the window remembers it.
    expect(snapshot?.fadeTrimMs).toBeUndefined()
    // The user skipped: this song did not begin at the end of the previous one.
    expect(snapshot?.enteredAtEnd).toBeUndefined()
  })

  it('does not take a change of another size, or one in the first seconds, for a crossfade', () => {
    // Another recording's length (4.5 s shorter).
    const other = fixture()
    other.report(1400); other.report(1400); other.report(1400)
    other.report(860, { durationMs: 251_600 }); other.report(1400, { durationMs: 251_600 }); other.report(1400, { durationMs: 251_600 })
    expect(other.service.current()?.fadeTrimMs).toBeUndefined()
    expect(other.service.current()?.track?.sourceDurationMs).toBeUndefined()
    // A length that changes right at the start: the queue boundary's mix-up of two songs' lengths.
    const boundary = fixture()
    boundary.report(300, { durationMs: 249_116 }); boundary.report(1400, { durationMs: 249_116 }); boundary.report(1500, { durationMs: 249_116 })
    expect(boundary.service.current()?.track).toMatchObject({ durationMs: 249_116 })
    expect(boundary.service.current()?.fadeTrimMs).toBeUndefined()
    expect(boundary.service.current()?.track?.sourceDurationMs).toBeUndefined()
  })
})

describe('how a song began', () => {
  it('is marked when the previous song ran out', () => {
    const { service, report } = fixture({ durationMs: 249_116, positionMs: 240_000 })
    report(1400); report(1400); report(1400); report(1400); report(1400); report(1400)
    // 248.4 s of 249.1 s: the hand-over follows.
    report(700, { title: 'ワンダー', artist: 'tayori', album: 'ワンダー', durationMs: 220_053 })
    expect(service.current()).toMatchObject({ enteredAtEnd: true })
    expect(service.current()?.track).toMatchObject({ name: 'ワンダー', durationMs: 220_053 })
    // The one after it was picked by the user 20 s in.
    report(20_000, { title: 'Lemon', artist: '米津玄師', album: 'Lemon', durationMs: 256_116 })
    expect(service.current()?.enteredAtEnd).toBeUndefined()
  })

  it('is not marked minutes after a song repeated, was sought back from its end, or stopped there', () => {
    // Repeat-one: the song reaches its end and starts over; much later the user picks another.
    const repeat = fixture({ durationMs: 249_116, positionMs: 247_000 })
    repeat.report(1400)
    repeat.report(1400, { positionMs: 300 })
    repeat.report(60_000)
    repeat.report(1400, { title: 'ワンダー', artist: 'tayori', album: 'ワンダー', durationMs: 227_053 })
    expect(repeat.service.current()?.enteredAtEnd).toBeUndefined()
    // The queue ended: paused at the end, another song picked later.
    const stopped = fixture({ durationMs: 249_116, positionMs: 247_500 })
    stopped.report(1400)
    stopped.report(200, { statusName: 'PAUSED', positionMs: 249_116 })
    stopped.report(120_000, { title: 'ワンダー', artist: 'tayori', album: 'ワンダー', durationMs: 227_053, statusName: 'PLAYING' })
    expect(stopped.service.current()?.enteredAtEnd).toBeUndefined()
  })

  it('survives an empty session between the two songs', () => {
    const { service, report } = fixture({ durationMs: 249_116, positionMs: 246_000 })
    report(1400); report(1400)
    report(300, { title: '', artist: '', album: '', durationMs: 0 })
    report(200, { title: 'ワンダー', artist: 'tayori', album: 'ワンダー', durationMs: 220_053, statusName: 'PLAYING' })
    expect(service.current()).toMatchObject({ enteredAtEnd: true })
  })
})
