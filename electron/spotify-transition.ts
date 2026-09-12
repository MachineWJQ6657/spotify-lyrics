import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SpotifyTransitionProfile, SpotifyTransitionSpeedPoint } from '../src/types'

const STORE_PACKAGE = 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0'

function readVarint(buffer: Buffer, offset: number) {
  let value = 0
  let shift = 0
  for (let cursor = offset; cursor < buffer.length && shift <= 28; cursor += 1, shift += 7) {
    const byte = buffer[cursor]
    value += (byte & 0x7f) * 2 ** shift
    if (!(byte & 0x80)) return { value, next: cursor + 1 }
  }
  return null
}

/**
 * Spotify serializes track metadata as protobuf map entries: field 1 is the
 * UTF-8 key and field 2 is the UTF-8 value. We deliberately decode only those
 * entries instead of depending on Spotify's private, frequently changing full
 * protobuf schema.
 */
type SpotifyMetadataEntry = { offset: number; value: string }

function readSpotifyMetadataEntries(buffer: Buffer, key: string): SpotifyMetadataEntry[] {
  const needle = Buffer.from(key, 'utf8')
  const entries: SpotifyMetadataEntry[] = []
  let from = 0
  while (from < buffer.length) {
    const index = buffer.indexOf(needle, from)
    if (index < 0) break
    from = index + needle.length
    // A real map key is immediately followed by protobuf field 2 (wire type 2).
    if (buffer[from] !== 0x12) continue
    const length = readVarint(buffer, from + 1)
    if (!length || length.value < 0 || length.next + length.value > buffer.length) continue
    entries.push({ offset: index, value: buffer.subarray(length.next, length.next + length.value).toString('utf8') })
  }
  return entries
}

export function readSpotifyMetadataValues(buffer: Buffer, key: string) {
  return readSpotifyMetadataEntries(buffer, key).map(entry => entry.value)
}

function firstValue(buffer: Buffer, key: string) {
  return readSpotifyMetadataValues(buffer, key)[0]?.trim() ?? ''
}

const ACTIVE_TRACK_METADATA_RADIUS = 8192

function byteOffsets(buffer: Buffer, value: string) {
  if (!value) return []
  const needle = Buffer.from(value, 'utf8')
  const offsets: number[] = []
  let from = 0
  while (from < buffer.length) {
    const index = buffer.indexOf(needle, from)
    if (index < 0) break
    offsets.push(index)
    from = index + needle.length
  }
  return offsets
}

/**
 * `context_player_state_restore` contains the active item followed by a large
 * restored queue. Generic map keys such as `audio.speed_automation` can thus
 * occur for many other songs. Only fields near the active title/track URI are
 * safe to use; an absent local field is a normal, conservative fallback.
 */
function activeMetadataReader(buffer: Buffer, title: string, trackUri: string) {
  const titleOffsets = readSpotifyMetadataEntries(buffer, 'title')
    .filter(entry => entry.value.trim() === title)
    .map(entry => entry.offset)
  const anchors = [...titleOffsets, ...byteOffsets(buffer, trackUri)]
  const nearby = (key: string) => readSpotifyMetadataEntries(buffer, key)
    .map(entry => ({ ...entry, distance: anchors.reduce((best, anchor) => Math.min(best, Math.abs(entry.offset - anchor)), Infinity) }))
    .filter(entry => entry.distance <= ACTIVE_TRACK_METADATA_RADIUS)
    .sort((left, right) => left.distance - right.distance || left.offset - right.offset)
  return {
    first(key: string) { return nearby(key)[0]?.value.trim() ?? '' },
    values(key: string) { return nearby(key).map(entry => entry.value.trim()) }
  }
}

function finiteNumber(value: string) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function parseSpeedAutomation(value: string): SpotifyTransitionSpeedPoint[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as Array<{ from_position?: unknown; speed?: unknown }>
    if (!Array.isArray(parsed)) return []
    const points = parsed.flatMap(item => {
      const fromPositionMs = Number(item.from_position)
      const speed = Number(item.speed)
      return Number.isFinite(fromPositionMs) && fromPositionMs >= 0 && Number.isFinite(speed) && speed >= .5 && speed <= 2
        ? [{ fromPositionMs, speed }]
        : []
    }).sort((left, right) => left.fromPositionMs - right.fromPositionMs)
    return points.filter((point, index) => index === 0 || point.fromPositionMs > points[index - 1].fromPositionMs)
  } catch {
    return []
  }
}

function currentTrackUri(buffer: Buffer, title: string) {
  const titleBytes = Buffer.from(title, 'utf8')
  let from = 0
  while (from < buffer.length) {
    const index = buffer.indexOf(titleBytes, from)
    if (index < 0) break
    from = index + titleBytes.length
    // The URI is a field of the current track entity, while `title` lives in
    // its metadata map. Real desktop state files can put 2-5 KB of Automix
    // curves between those fields. Keep the nearest preceding track URI; the
    // narrower 384-byte window used before silently lost the ID on those
    // tracks and prevented Spotify's own lyric timeline from being queried.
    const nearby = buffer.subarray(Math.max(0, index - 8192), index).toString('utf8')
    const matches = [...nearby.matchAll(/spotify:track:[A-Za-z0-9]{22}/g)]
    const uri = matches.at(-1)?.[0]
    if (uri) return uri
  }
  return ''
}

function currentTitle(buffer: Buffer) {
  const albumTitle = firstValue(buffer, 'album_title')
  const titleValues = readSpotifyMetadataValues(buffer, 'title').map(value => value.trim()).filter(Boolean)
  return titleValues.find(value => value !== albumTitle) ?? titleValues[0] ?? ''
}

function parseTransitionProfile(buffer: Buffer, title: string, trackUri: string): SpotifyTransitionProfile | null {
  // The restored context contains an album entity immediately before the
  // current track entity. Its metadata also uses the generic `title` key.
  const active = activeMetadataReader(buffer, title, trackUri)
  const contextUri = active.first('context_uri')
  const reporting = active.first('custom_reporting_attribution')
  const transitionUri = active.first('automix.transition_uri')
  const hasCustomTransitions = active.values('has-custom-transitions').includes('true')
  const cuePointMs = finiteNumber(active.first('automix.fade_in_cuepoint.position')) ?? 0
  const outputDurationMs = finiteNumber(active.first('duration_override'))
  const fadeInStartMs = finiteNumber(active.first('audio.fade_in_start_time'))
  const fadeInDurationMs = finiteNumber(active.first('audio.fade_in_duration'))
  const fadeOutStartMs = finiteNumber(active.first('audio.fade_out_start_time'))
  const fadeOutDurationMs = finiteNumber(active.first('audio.fade_out_duration'))
  const overlapMs = finiteNumber(active.first('audio.fade_overlap'))
  const speedAutomation = parseSpeedAutomation(active.first('audio.speed_automation'))
  const isSpotifyMix = hasCustomTransitions || reporting === 'MixedPlaylist' || transitionUri.startsWith('spotify:transition:')
  if (!title || !isSpotifyMix || (!cuePointMs && !speedAutomation.length && !overlapMs)) return null
  return {
    kind: 'spotify-mix',
    title,
    trackUri: trackUri || undefined,
    contextUri: contextUri || undefined,
    transitionUri: transitionUri || undefined,
    cuePointMs: Math.max(0, cuePointMs),
    outputDurationMs,
    fadeInStartMs,
    fadeInDurationMs,
    fadeOutStartMs,
    fadeOutDurationMs,
    overlapMs,
    speedAutomation
  }
}

/** Identity is useful even for ordinary tracks, which have no Mix profile. */
export function parseSpotifyPlaybackState(buffer: Buffer) {
  const title = currentTitle(buffer)
  const trackUri = title ? currentTrackUri(buffer, title) : ''
  return {
    title,
    trackUri: trackUri || undefined,
    profile: title ? parseTransitionProfile(buffer, title, trackUri) : null
  }
}

export function parseSpotifyTransitionState(buffer: Buffer): SpotifyTransitionProfile | null {
  return parseSpotifyPlaybackState(buffer).profile
}

/**
 * A Mix recipe is not safe to attach until Spotify has published a positive
 * native duration for the same media item. At a queue boundary SMTC exposes
 * the new title one event before its duration, while the restored context can
 * still contain a same-title/stale recipe. Accepting that recipe used to turn
 * the previous song's duration into the next song's provider lookup key.
 */
export function transitionProfileMatchesNativeDuration(profile: SpotifyTransitionProfile | null, durationMs: number) {
  if (!profile?.outputDurationMs) return true
  return Number.isFinite(durationMs) && durationMs > 0 && Math.abs(profile.outputDurationMs - durationMs) <= 2500
}

function normalizedTitle(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000]+/g, ' ').trim()
}

async function directories(root: string) {
  try {
    return (await fs.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name))
  } catch {
    return []
  }
}

export async function findSpotifyTransitionStateFiles() {
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Packages', STORE_PACKAGE, 'LocalState', 'Spotify', 'Users'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'Spotify', 'Users')
  ].filter((value): value is string => Boolean(value))
  const files: string[] = []
  for (const root of roots) {
    for (const directory of await directories(root)) {
      const candidate = path.join(directory, 'context_player_state_restore')
      try { await fs.access(candidate); files.push(candidate) } catch { /* another Spotify installation layout */ }
    }
  }
  return files
}

export async function resolveSpotifyTransitionProfile(title: string, durationMs: number) {
  const expectedTitle = normalizedTitle(title)
  const files = await findSpotifyTransitionStateFiles()
  for (const file of files) {
    try {
      const buffer = await fs.readFile(file)
      const parsed = parseSpotifyPlaybackState(buffer)
      if (normalizedTitle(parsed.title) !== expectedTitle) continue
      const profile = parsed.profile
      if (!profile) return { matched: true, profile: null, trackUri: parsed.trackUri }
      // The restored context can lag one track behind the media session. A
      // duration check keeps a same-title recording from applying by accident.
      if (!transitionProfileMatchesNativeDuration(profile, durationMs)) continue
      return { matched: true, profile, trackUri: parsed.trackUri }
    } catch { /* Spotify may replace the file atomically while changing track */ }
  }
  return { matched: false, profile: null, trackUri: undefined }
}

export async function readSpotifyTransitionProfile(title: string, durationMs: number) {
  return (await resolveSpotifyTransitionProfile(title, durationMs)).profile
}
