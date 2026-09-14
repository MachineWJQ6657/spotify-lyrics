import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackSnapshot, SpotifyTransitionProfile } from '../src/types'
import { LocalSpotifyService, localTrackIdentity, type LocalState } from './local-spotify'
import { resolveSpotifyTransitionProfile } from './spotify-transition'

vi.mock('./spotify-transition', () => ({ resolveSpotifyTransitionProfile: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

// Exercise the real asynchronous refresh without starting a native worker.
function fixture() {
  const state: LocalState = { title: 'song', artist: 'artist', album: 'album', albumArtBase64: '', positionMs: 50_000, durationMs: 200_000, statusName: 'PLAYING', sampledAtMs: 10_000 }
  const profile: SpotifyTransitionProfile = { kind: 'spotify-mix', title: 'song', cuePointMs: 0, outputDurationMs: 200_000, sourceDurationMs: 205_000,
    speedAutomation: [{ fromPositionMs: 0, speed: .95 }] }
  const service = new LocalSpotifyService()
  const internals = service as unknown as { state: LocalState; transitionProfile: SpotifyTransitionProfile | null; spotifyTrackUri: string;
    transitionTrackIdentity: string; listener: (snapshot: PlaybackSnapshot | null) => void; refreshTransitionProfile(state: LocalState, force: boolean): Promise<void> }
  Object.assign(internals, { state, transitionProfile: profile, spotifyTrackUri: 'spotify:track:known', transitionTrackIdentity: localTrackIdentity(state), listener: vi.fn() })
  return { service, internals, state, profile }
}

describe('native transition refresh stability', () => {
  it('retains an established mix clock across a temporary unmatched state file', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const { service, internals, state, profile } = fixture()
    vi.mocked(resolveSpotifyTransitionProfile).mockResolvedValue({ matched: false, profile: null, trackUri: undefined })
    const pending = internals.refreshTransitionProfile(state, true)
    await vi.advanceTimersByTimeAsync(600)
    await pending
    expect(resolveSpotifyTransitionProfile).toHaveBeenCalledTimes(4)
    expect(internals.transitionProfile).toBe(profile)
    expect(service.current()?.track?.spotifyId).toBe('known')
    expect(internals.listener).not.toHaveBeenCalled()
  })

  it('accepts positive evidence that the same track now has no mix automation', async () => {
    const { internals, state } = fixture()
    vi.mocked(resolveSpotifyTransitionProfile).mockResolvedValue({ matched: true, profile: null, trackUri: 'spotify:track:known' })
    await internals.refreshTransitionProfile(state, true)
    expect(internals.transitionProfile).toBeNull()
    expect(internals.listener).toHaveBeenCalledTimes(1)
  })

  it('cannot apply a completed lookup after native track identity changes', async () => {
    const { internals, state, profile } = fixture()
    let finish!: (value: Awaited<ReturnType<typeof resolveSpotifyTransitionProfile>>) => void
    vi.mocked(resolveSpotifyTransitionProfile).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = internals.refreshTransitionProfile(state, true)
    internals.state = { ...state, title: 'next song' }
    internals.transitionProfile = null
    finish({ matched: true, profile, trackUri: 'spotify:track:old' })
    await pending
    expect(internals.transitionProfile).toBeNull()
    expect(internals.listener).not.toHaveBeenCalled()
  })
})
