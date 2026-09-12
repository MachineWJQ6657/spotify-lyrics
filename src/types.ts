export type LanguageCode = 'ja' | 'romaji' | 'zh-Hans' | 'en' | string

export interface LyricWord { text: string; startMs: number; endMs?: number }
export interface LyricLine { startMs: number; endMs?: number; text: string; words?: LyricWord[] }
export interface LyricTrack { id: string; language: LanguageCode; label: string; kind: 'original' | 'translation' | 'romanization'; lines: LyricLine[]; source: string }
export interface LyricsDocument {
  trackId: string
  track?: TrackInfo
  tracks: LyricTrack[]
  /** Per-song visual calibration. Positive values delay the lyrics. */
  offsetMs?: number
  updatedAt?: number
  providerRevision?: number
  /** Provider release duration retained for matching and diagnostics only. */
  sourceDurationMs?: number
  /** Invalidates cached lyrics when Spotify later reveals its source recording. */
  providerContext?: string
  /** Tracks whose text/timing was explicitly supplied or edited by the user. */
  userEditedTrackIds?: string[]
}

export interface TrackInfo {
  id: string; name: string; artist: string; album: string; coverUrl: string; durationMs: number; isrc?: string
  spotifyId?: string
  /** Original recording duration; durationMs remains Spotify's mixed transport duration. */
  sourceDurationMs?: number
}
export interface SpotifyTransitionSpeedPoint { fromPositionMs: number; speed: number }
export interface SpotifyTransitionProfile {
  kind: 'spotify-mix'
  title: string
  trackUri?: string
  contextUri?: string
  transitionUri?: string
  /** Musical alignment cue used by Spotify's transition recipe. It is not a transport offset. */
  cuePointMs: number
  /** Media-session hand-off duration exposed by Spotify for this mixed playback. */
  outputDurationMs?: number
  /** A true release duration when independently known. Never infer this from fade metadata. */
  sourceDurationMs?: number
  fadeInStartMs?: number
  fadeInDurationMs?: number
  fadeOutStartMs?: number
  fadeOutDurationMs?: number
  overlapMs?: number
  speedAutomation: SpotifyTransitionSpeedPoint[]
}
export interface PlaybackSnapshot {
  track: TrackInfo | null; positionMs: number; observedAtMs: number; isPlaying: boolean; deviceName?: string; sampleId?: number; playbackSource?: 'web' | 'local' | 'demo'; clockDriftMs?: number; transition?: SpotifyTransitionProfile; transitionResolved?: boolean; error?: string
}

export interface LyricsCandidate {
  id: number; trackName: string; artistName: string; albumName: string; durationMs: number
  instrumental: boolean; syncedLyrics: string | null; plainLyrics: string | null; provider: string; score: number
}

export interface AppSettings {
  enabledLanguages: string[]
  romanization: boolean
  offsetMs: number
  fontSize: number
  alignment: 'left' | 'center'
  overlayVisible: boolean
  clickThrough: boolean
  blur: number
  overlayWidth: number
  overlayHeight: number
  backgroundEnabled: boolean
  backgroundOpacity: number
  textOpacity: number
  textEffect: 'none' | 'shadow' | 'outline'
  textColor: 'white' | 'green' | 'warm'
  fontWeight: number
  lineHeight: number
  cornerRadius: number
  positionLocked: boolean
}
