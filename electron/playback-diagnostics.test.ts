import { describe, expect, it } from 'vitest'
import { PlaybackDiagnostics } from './playback-diagnostics'
import type { PlaybackSnapshot } from '../src/types'

describe('bounded local playback diagnostics', () => {
  it('keeps only 180 recent samples and clears them on request', () => {
    const diagnostics = new PlaybackDiagnostics()
    for (let index = 0; index < 200; index++) diagnostics.record(null, index)
    expect(diagnostics.report().samples).toHaveLength(180)
    expect(diagnostics.report().samples[0].receivedAtMs).toBe(20)
    diagnostics.clear()
    expect(diagnostics.report().samples).toEqual([])
  })
  it('retains transport and mapped clocks without retaining artwork or identifiers', () => {
    const snapshot: PlaybackSnapshot = { positionMs: 10_000, observedAtMs: 1000, isPlaying: true, playbackSource: 'local',
      track: { id: 'private-id', name: 'song', artist: 'artist', album: 'album', durationMs: 100_000, coverUrl: 'data:image/secret' },
      transition: { kind: 'spotify-mix', title: 'song', cuePointMs: 0, speedAutomation: [{ fromPositionMs: 0, speed: .95 }] } }
    const diagnostics = new PlaybackDiagnostics()
    diagnostics.record(snapshot, 1100)
    const report = diagnostics.report()
    expect(report.samples[0]).toMatchObject({ positionMs: 10000, recordingPositionMs: 9500, observedAtMs: 1000, receivedAtMs: 1100 })
    expect(JSON.stringify(report)).not.toMatch(/private-id|data:image/)
    report.samples[0].title = 'mutated'
    expect(diagnostics.report().samples[0].title).toBe('song')
  })
})
