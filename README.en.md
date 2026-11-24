# Syllable

English · [中文](README.md)

Syllable is a desktop lyrics client for Spotify on Windows. Play a song in the Spotify desktop app and Syllable finds synced lyrics for it, showing them line by line in its main window and in a transparent, always-on-top overlay. The original, a Chinese translation and Japanese romaji can be shown together.

Current version: 0.4.83

## Features

- **Works out of the box**: reads the playback state of the Spotify desktop app on Windows directly, with no developer account. Connecting the Spotify Web API is optional.
- **Automatic lyric matching**: asks LRCLIB, NetEase Cloud Music and Kugou at once and picks the best match by title, artist, length and the words themselves. The source menu next to the song title switches sources by hand.
- **Several lyric tracks**: original, Chinese translation and romaji (readings for Japanese lyrics are generated with Kuromoji) side by side, with the translation aligned to each line of the original.
- **Desktop lyrics**: a transparent, always-on-top overlay you can drag and resize. When locked, clicks pass through it. Font size, weight, colour, outline, background and alignment are adjustable; it can preview the next line and hide while paused.
- **Automatic listening calibration**: for Japanese, Chinese and English songs the app listens to a few passages and shifts the lyrics earlier or later as a whole (needs a local recognition model, which is not part of this repository).
- **Find lyrics**: read lyrics without playing anything. Search by title or artist, or open a song from the library.
- **Lyrics library**: the lyrics and calibration of the songs you played are kept on your computer and can be exported as a backup and imported again.
- **Editing and import**: search candidate lyrics, edit words and timing line by line, or drop LRC files into the window.
- **Interface language**: Chinese or English, chosen in Preferences; follows the system by default.

## Usage

1. Open the Spotify desktop app for Windows and play a song.
2. Start Syllable. The main window shows the song's lyrics.
3. Pick the languages to show in the panel on the right and click "Show desktop lyrics" to open the overlay.
4. If the lyrics are wrong, switch sources in the menu next to the song title, or click "Edit" to search and retime by hand.

| Shortcut | Action |
|---|---|
| `Ctrl + Alt + S` | Open the main window |
| `Ctrl + Alt + L` | Show or hide desktop lyrics |
| `Ctrl + Alt + M` | Lock or unlock desktop lyrics (clicks pass through when locked) |
| `Ctrl + Alt + U` | Unlock and show the lyrics toolbar |
| `F11` | Focus mode: lyrics only |
| `Ctrl + F` | Find in the lyrics |
| `Space`, `←` `→` | Play / pause, back / forward 5 seconds |

Closing the main window keeps the app in the tray; desktop lyrics stay on screen.

## Importing your own lyrics

Drop LRC files into the main window to import them for the song that is playing. The language suffix in the file name decides which track a file becomes:

```text
song.ja.lrc       Japanese original
song.romaji.lrc   romaji
song.zh.lrc       Chinese translation
song.en.lrc       English translation
```

The timestamps of the files need not match exactly; rows are aligned to the nearest line. Imported and edited lyrics are never replaced by automatic matches.

## Running from source

Requires Windows 10 / 11 and Node.js 22.

```bash
npm ci
npm run dev        # development mode
npm test           # unit and integration tests
npm run build      # type-check and build
npm run dist       # package the Windows app
```

## Optional: Spotify Web API

When you need Spotify Connect (for example, the song plays on another device), connect the Web API:

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add the Redirect URI `http://127.0.0.1:43821/callback`.
3. Enter the Client ID under "Connection" in Syllable's right-hand panel and connect.

The PKCE flow is used; no Client Secret is needed or stored.

## Project layout

```text
Spotify desktop app (Windows media session) ─┐
Spotify Web API (optional) ──────────────────┴─> playback state ─> lyric clock ─┬─> main window
LRCLIB / NetEase Cloud Music / Kugou ─┐                                          │
Local LRC files / editor ─────────────┴─> lyric matching and track alignment ────┴─> desktop lyrics
```

| Path | Contents |
|---|---|
| `electron/local-spotify.ts` | Reads the Spotify desktop app's playback state and controls playback |
| `electron/lyrics-provider.ts` | Lyric source queries, selection and translation alignment |
| `electron/song-search.ts` | Song search for the "Find lyrics" page |
| `electron/audio-sync/` | Listening calibration |
| `src/components/`, `src/Overlay.tsx` | Main window and desktop lyrics interface |
| `src/lib/lyrics.ts`, `src/lib/clock.ts` | LRC parsing, track alignment and the lyric clock |
| `src/i18n/` | Interface languages (see [src/i18n/README.md](src/i18n/README.md)) |
| `scripts/qa/` | Test instance, performance measurement and release scripts (see [scripts/qa/README.md](scripts/qa/README.md)) |

## What is and is not in this repository

The repository holds the source code and the resources needed to build it. Packaged builds, recognition models, recordings, test profiles and user data are not committed. `scripts/git-hooks/pre-push` checks this before every push; enable it after cloning:

```bash
git config core.hooksPath scripts/git-hooks
```

Lyrics come from LRCLIB, NetEase Cloud Music and Kugou and belong to their respective rights holders.
