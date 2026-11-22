export type LanguageCode = 'ja' | 'romaji' | 'zh-Hans' | 'en' | string

export interface LyricWord { text: string; startMs: number; endMs?: number }
export interface LyricLine { startMs: number; endMs?: number; text: string; words?: LyricWord[] }
export interface LyricTrack {
  id: string; language: LanguageCode; label: string; kind: 'original' | 'translation' | 'romanization'; lines: LyricLine[]; source: string
  /** Generated readings only. Provider or explicitly edited romaji retain ownership. */
  generatedRomanizationRevision?: number
}
/** A lyric provider the user can pick as the timed original. */
export type LyricsSourceId = 'spotify' | 'lrclib' | 'netease' | 'kugou'

export interface LyricsDocument {
  /** The user's choice in the source menu for this song; absent = automatic. */
  sourcePreference?: LyricsSourceId
  /** Providers that had timed lyrics for this song at the last lookup. */
  availableSources?: Array<{ id: LyricsSourceId; lines: number
    /** Whether this provider's words and length agree with the automatic choice (absent in documents saved before 0.4.65). */
    agrees?: boolean }>
  /** The chosen source had no timed lyrics at the last lookup; the automatic choice is shown. */
  sourceUnavailable?: boolean
  /** Who set sourcePreference: the user in the menu, or listening calibration after another source proved inconsistent. */
  sourceChosenBy?: 'user' | 'listening'
  /** Listening's verdict per provider timeline for this song; an inconsistent source is not listened to again. */
  sourceTrials?: Partial<Record<LyricsSourceId, 'consistent' | 'inconsistent' | 'unmeasurable'>>
  /** Actual original words without trusted timing; never drive active-line playback. */
  untimedOriginal?: { text: string; language: string; source: string }
  textReference?: { referenceSource: string; status: 'consistent' | 'partial' | 'conflict'; matchedLines: number; referenceLines: number }
  trackId: string
  track?: TrackInfo
  tracks: LyricTrack[]
  /** Per-song visual calibration. Positive values delay the lyrics. */
  offsetMs?: number
  /** Automatic calibration measured by listening to Spotify's audio. Applies
   * only while the original lyric timing still has this key; a manual
   * offsetMs always wins. */
  listenedOffset?: ListenedOffset
  updatedAt?: number
  providerRevision?: number
  /** The translation-matching revision at which this song was last looked up (see usePlayback's TRANSLATION_RECHECK_REVISION). */
  translationRecheck?: number
  /** Provider release duration retained for matching and diagnostics only. */
  sourceDurationMs?: number
  /** Invalidates cached lyrics when Spotify later reveals its source recording. */
  providerContext?: string
  /** Tracks whose text/timing was explicitly supplied or edited by the user. */
  userEditedTrackIds?: string[]
  /** Providers confirm the recording is instrumental; nothing to retry. */
  instrumental?: boolean
  /** View only, never saved: the lookup and its one automatic retry both failed and nothing is pending. */
  lookupFailed?: boolean
}

export interface ListenedOffset {
  timingKey: string
  /** dismissed: the user reset this song's calibration; keep the measurement, never re-apply. */
  state: 'decided' | 'inconsistent' | 'dismissed'
  /** Positive values delay the lyrics. 0 when inconsistent or already in sync. */
  offsetMs: number
  /** Median of (sung - file timestamp) over the located lines. */
  measuredDeltaMs?: number
  spreadMs?: number
  lines: number
  measuredAt: number
  /** A large offset that a second play measured the same (src/lib/listen-confirmation.ts). */
  confirmed?: boolean
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
  /** Local playback: the crossfade time Spotify shortens reported lengths by, once seen (src/lib/fade-trim.ts). */
  fadeTrimMs?: number
  /** Local playback: this song began when the previous one ran out. */
  enteredAtEnd?: boolean
  acousticAnchor?: AcousticAnchor
  track: TrackInfo | null; positionMs: number; observedAtMs: number; isPlaying: boolean; deviceName?: string; sampleId?: number; playbackSource?: 'web' | 'local' | 'demo'; clockDriftMs?: number; transition?: SpotifyTransitionProfile; transitionResolved?: boolean; error?: string
}

export interface AcousticAnchor {
  /** Vocal matching already targets LRC coordinates; reference matching targets recording time. */
  coordinate?: 'recording' | 'lyrics'
  lyricTimingKey?: string
  trackId: string
  sourcePositionMs: number
  observedAtMs: number
  expiresAtMs: number
  rate: number
  score: number
}

/** Explicit user onset, scoped to this uninterrupted playback, never persisted. */
export interface SessionCalibration {
  trackId: string
  originalKey: string
  offsetMs: number
  createdAtMs: number
}

export interface LyricsCandidate {
  id: number; trackName: string; artistName: string; albumName: string; durationMs: number
  instrumental: boolean; syncedLyrics: string | null; plainLyrics: string | null; provider: string; score: number
}

export interface AppSettings {
  /** Interface language: follow the system (default), Chinese or English. */
  language?: 'auto' | 'zh' | 'en'
  /** Remember the one-time system-output capture opt-in across tracks and launches. */
  automaticAudioSync?: boolean
  /** Diagnostic CTC backend never publishes a playback/lyric clock anchor. */
  audioSyncBackend?: 'whisper' | 'phoneme-diagnostic'
  /** Automatic per-song lyric offset by listening (default on when the local model exists). */
  listenOffset?: boolean
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
  /** Show the next line under the one being sung, when the overlay has room for it. */
  overlayNextLine?: boolean
  /** How lyric rows are aligned in the main window (the overlay has its own `alignment`). */
  mainAlignment?: 'left' | 'center'
  /** Fade the locked overlay out after playback has been paused for a while; it returns when playback resumes. */
  overlayHideWhenPaused?: boolean
}
