import { promises as fs } from 'node:fs'
import {
  findSpotifyTransitionStateFiles,
  parseSpotifyPlaybackState,
  readSpotifyMetadataValues,
  resolveSpotifyTransitionProfile
} from '../electron/spotify-transition.ts'

const expectedTitle = process.argv[2] ?? ''
const durationMs = Number(process.argv[3] ?? 0)
const summaryOnly = process.argv.includes('--summary')
const keys = [
  'title', 'album_title', 'duration_override', 'has-custom-transitions',
  'custom_reporting_attribution', 'automix.transition_uri',
  'automix.fade_in_cuepoint.position', 'audio.fade_overlap',
  'audio.speed_automation'
]

const files = await findSpotifyTransitionStateFiles()
for (const file of files) {
  const buffer = await fs.readFile(file)
  const parsed = parseSpotifyPlaybackState(buffer)
  const titleValues = readSpotifyMetadataValues(buffer, 'title').map(value => value.trim())
  const expectedTitleIndexes = expectedTitle
    ? titleValues.flatMap((value, index) => value === expectedTitle ? [index] : [])
    : []
  const expectedByteOffset = expectedTitle ? buffer.indexOf(Buffer.from(expectedTitle, 'utf8')) : -1
  const expectedPrefix = expectedByteOffset >= 0
    ? buffer.subarray(Math.max(0, expectedByteOffset - 8192), expectedByteOffset).toString('utf8')
    : ''
  const expectedUris = [...expectedPrefix.matchAll(/spotify:track:[A-Za-z0-9]{22}/g)]
  console.log(JSON.stringify(summaryOnly ? {
    file: file.split(/[\\/]/).at(-1),
    bytes: buffer.length,
    title: parsed.title,
    titleValueCount: titleValues.length,
    expectedTitleIndexes,
    expectedHasNearbyTrackUri: Boolean(expectedUris.length),
    hasTrackUri: Boolean(parsed.trackUri),
    hasMixProfile: Boolean(parsed.profile),
    outputDurationMs: parsed.profile?.outputDurationMs,
    speedPointCount: parsed.profile?.speedAutomation.length ?? 0
  } : {
    file,
    bytes: buffer.length,
    parsed,
    values: Object.fromEntries(keys.map(key => [key, readSpotifyMetadataValues(buffer, key)]))
  }, null, 2))
}

if (expectedTitle) {
  console.log(JSON.stringify({ expectedTitle, durationMs, resolved: await resolveSpotifyTransitionProfile(expectedTitle, durationMs) }, null, 2))
}
