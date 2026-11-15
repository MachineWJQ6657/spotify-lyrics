import type { LyricTrack, LyricsDocument } from '../types'

/**
 * A track the user imported, edited or picked by hand. Automatic lookups never
 * replace it. Ids of imported files start with "local-"; a provider track's id
 * starts with the song's id.
 */
export function isUserOwnedTrack(track: LyricTrack, baseline: LyricsDocument) {
  return Boolean(baseline.userEditedTrackIds?.includes(track.id)
    || (track.id.startsWith('local-') && !track.id.startsWith(`${baseline.trackId}-`)))
}
