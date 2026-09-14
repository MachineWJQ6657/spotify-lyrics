import { describe, expect, it } from 'vitest'
import { parseSpotifyPlaybackState, parseSpotifyTransitionState, readSpotifyMetadataValues, transitionProfileMatchesNativeDuration } from './spotify-transition'

function varint(value: number) {
  const bytes: number[] = []
  do {
    const byte = value & 0x7f
    value >>>= 7
    bytes.push(byte | (value ? 0x80 : 0))
  } while (value)
  return Buffer.from(bytes)
}

function entry(key: string, value: string) {
  const keyBytes = Buffer.from(key)
  const valueBytes = Buffer.from(value)
  return Buffer.concat([Buffer.from([0x0a]), varint(keyBytes.length), keyBytes, Buffer.from([0x12]), varint(valueBytes.length), valueBytes])
}

describe('Spotify mixed-playlist transition parser', () => {
  it.each([0, 20_000])('does not borrow a later occurrence of the same song with a %i-byte queue gap', gap => {
    const uri = 'spotify:track:1mcXApk7PDpUTdJDKdqc4e'
    const data = Buffer.concat([
      entry('uri', uri), entry('title', '同じ曲'),
      Buffer.alloc(gap),
      entry('uri', uri), entry('title', '同じ曲'),
      entry('custom_reporting_attribution', 'MixedPlaylist'),
      entry('audio.speed_automation', '[{"from_position":0,"speed":0.9}]')
    ])
    expect(parseSpotifyPlaybackState(data)).toMatchObject({ title: '同じ曲', trackUri: uri, profile: null })
  })

  it('reads protobuf metadata map entries without the private outer schema', () => {
    const data = Buffer.concat([entry('title', 'パレード'), entry('title', 'duplicate')])
    expect(readSpotifyMetadataValues(data, 'title')).toEqual(['パレード', 'duplicate'])
  })

  it('matches complete map keys rather than suffixes of album or queue keys', () => {
    const data = Buffer.concat([entry('album_title', 'Album'), entry('title', 'Song'), entry('queue_title', 'Queue')])
    expect(readSpotifyMetadataValues(data, 'title')).toEqual(['Song'])
  })

  it('extracts cue points, fades and speed automation', () => {
    const data = Buffer.concat([
      entry('title', '幻燈'), entry('album_title', '幻燈'),
      entry('4f20ddf0e61846e4', 'spotify:track:1mcXApk7PDpUTdJDKdqc4e'), entry('title', 'パレード'), entry('context_uri', 'spotify:playlist:test'),
      entry('custom_reporting_attribution', 'MixedPlaylist'),
      entry('automix.transition_uri', 'spotify:core-auto-transition'),
      entry('automix.fade_in_cuepoint.position', '9090'), entry('duration_override', '291585'),
      entry('audio.fade_overlap', '18280'), entry('audio.fade_in_start_time', '370'),
      entry('audio.fade_in_duration', '17440'), entry('audio.fade_out_start_time', '294585'),
      entry('audio.fade_out_duration', '5000'),
      entry('audio.speed_automation', '[{"from_position":0,"speed":0.95405},{"from_position":26310,"speed":1}]')
    ])
    expect(parseSpotifyTransitionState(data)).toMatchObject({
      kind: 'spotify-mix', title: 'パレード', trackUri: 'spotify:track:1mcXApk7PDpUTdJDKdqc4e', cuePointMs: 9090,
      outputDurationMs: 291585, overlapMs: 18280,
      fadeInStartMs: 370, fadeInDurationMs: 17440,
      speedAutomation: [{ fromPositionMs: 0, speed: .95405 }, { fromPositionMs: 26310, speed: 1 }]
    })
    expect(parseSpotifyTransitionState(data)?.sourceDurationMs).toBeUndefined()
  })

  it('keeps the current Spotify track ID even when large Automix metadata separates it from the title', () => {
    const data = Buffer.concat([
      Buffer.from('spotify:track:61uep4aDBpNnnFGfm6yzUF'),
      Buffer.alloc(3200, 0x20),
      entry('title', '千鳥'), entry('album_title', '二人称')
    ])
    expect(parseSpotifyPlaybackState(data)).toMatchObject({
      title: '千鳥', trackUri: 'spotify:track:61uep4aDBpNnnFGfm6yzUF', profile: null
    })
  })

  it('ignores ordinary playback metadata', () => {
    expect(parseSpotifyTransitionState(Buffer.concat([entry('title', 'Song'), entry('duration_override', '100000')]))).toBeNull()
  })

  it('does not attach a restored queue item transition to the current track', () => {
    const currentUri = 'spotify:track:1234567890123456789012'
    const staleUri = 'spotify:track:abcdefghijklmnopqrstuv'
    const data = Buffer.concat([
      Buffer.from(currentUri), entry('title', 'Current Song'), entry('album_title', 'Current Album'),
      Buffer.alloc(9000, 0x20),
      Buffer.from(staleUri), entry('title', 'Queued Mix Song'),
      entry('custom_reporting_attribution', 'MixedPlaylist'),
      entry('automix.fade_in_cuepoint.position', '12000'),
      entry('duration_override', '180000'),
      entry('audio.speed_automation', '[{"from_position":0,"speed":0.9}]')
    ])
    expect(parseSpotifyPlaybackState(data)).toMatchObject({
      title: 'Current Song', trackUri: currentUri, profile: null
    })
  })

  it('keeps a large but locally scoped active-track transition recipe', () => {
    const uri = 'spotify:track:1234567890123456789012'
    const data = Buffer.concat([
      Buffer.from(uri), Buffer.alloc(5600, 0x20),
      entry('title', 'Current Mix'), entry('album_title', 'Mix Album'),
      entry('custom_reporting_attribution', 'MixedPlaylist'),
      entry('automix.fade_in_cuepoint.position', '6200'),
      entry('duration_override', '210000'),
      entry('audio.speed_automation', '[{"from_position":0,"speed":0.96}]')
    ])
    expect(parseSpotifyTransitionState(data)).toMatchObject({
      title: 'Current Mix', trackUri: uri, cuePointMs: 6200,
      outputDurationMs: 210000, speedAutomation: [{ fromPositionMs: 0, speed: .96 }]
    })
  })

  it('does not validate a Mix recipe against a title-only zero-duration snapshot', () => {
    const profile = parseSpotifyTransitionState(Buffer.concat([
      entry('title', 'Album'), entry('album_title', 'Album'),
      entry('title', 'Song'), entry('custom_reporting_attribution', 'MixedPlaylist'),
      entry('automix.fade_in_cuepoint.position', '9000'), entry('duration_override', '233081')
    ]))
    expect(profile).not.toBeNull()
    expect(transitionProfileMatchesNativeDuration(profile, 0)).toBe(false)
    expect(transitionProfileMatchesNativeDuration(profile, 242_182)).toBe(false)
    expect(transitionProfileMatchesNativeDuration(profile, 233_100)).toBe(true)
  })
})
