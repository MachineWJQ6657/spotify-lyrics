import { promises as fs } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findSpotifyTransitionStateFiles, parseSpotifyPlaybackState } from './spotify-transition'

const runNative = process.env.SYLLABLE_NATIVE_QA === '1' ? describe : describe.skip

runNative('read-only local Spotify restore-file inspection', () => {
  it('parses available local state without logging account paths, URIs or queue contents', async () => {
    const files = await findSpotifyTransitionStateFiles()
    expect(files.length, 'No readable Spotify restore files; start Spotify before this explicit diagnostic').toBeGreaterThan(0)
    for (const file of files) {
      const buffer = await fs.readFile(file)
      const parsed = parseSpotifyPlaybackState(buffer)
      expect(parsed.title.length).toBeGreaterThan(0)
      if (parsed.profile) {
        expect(parsed.profile.title).toBe(parsed.title)
        expect(parsed.profile.speedAutomation.every(point => Number.isFinite(point.fromPositionMs) && point.fromPositionMs >= 0 && point.speed >= .5 && point.speed <= 2)).toBe(true)
      }
      console.log('native-restore-summary', JSON.stringify({ bytes: buffer.length, title: parsed.title, hasTrackIdentity: Boolean(parsed.trackUri),
        mixed: Boolean(parsed.profile), outputDurationMs: parsed.profile?.outputDurationMs,
        cuePointMs: parsed.profile?.cuePointMs, speedPoints: parsed.profile?.speedAutomation.length,
        firstSpeed: parsed.profile?.speedAutomation[0]?.speed, lastSpeed: parsed.profile?.speedAutomation.at(-1)?.speed }))
    }
  })
})
