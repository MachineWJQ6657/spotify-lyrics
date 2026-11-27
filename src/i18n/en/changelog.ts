/** English release notes by version, shown on the help page in English; a version without an entry shows the Chinese notes. */
export const CHANGELOG_EN: Record<string, string[]> = {
  '0.4.86': [
    'The switches under "Lyric languages" are now one to a row. Side by side, a switch marked "not here" took room from the one next to it and its name broke into two lines. The name is now on the left and what is said about it on the right, on one line.'
  ],
  '0.4.85': [
    'A translation can now be pasted in: when a song has no translation in a language (English, say), switch that language on under "Lyric languages", use "Search the web" to find a translation in your browser, copy it and use "Paste a translation"; the app puts it on the lyrics line by line and saves it. An English translation of a Japanese song is matched by meaning, so it fits even when the page breaks its lines differently from the lyrics.',
    'Matching by meaning uses the open dictionary JMdict (EDRDG, CC BY-SA 4.0).'
  ],
  '0.4.84': [
    'The switches under "Lyric languages" now say what they can do for the song on screen: a language the song lacks is marked "not here" (most songs have no English translation, so switching it on looked like nothing happened), and the language the song is in is marked "original" (it is always shown). A language that is switched on but missing in this song is named below the switches.'
  ],
  '0.4.83': [
    'Looking up and matching lyrics now happens on a thread of its own. Matching a new song used to keep the app from anything else for 0.1–0.2 s (playback updates and the reaction of desktop lyrics to the mouse waited for it); the app no longer pauses for it.'
  ],
  '0.4.82': [
    'Fixed the mouse cursor stuttering now and then while Syllable was running, even in the background: desktop lyrics used to install a system-wide mouse hook, so every mouse movement on the computer waited for Syllable, and whenever it was busy (for example matching lyrics at a song change) the cursor hitched; the hook is no longer used',
    'Two short pauses of the app itself at a song change are gone as well: listening calibration used to ask Windows for the list of screens at every song (about 0.5 s) and now asks once until the displays change, and the same lyric text is no longer parsed over and over while candidates are compared.'
  ],
  '0.4.81': [
    'When listening calibration measures an offset of 1.5 s or more, it is used at once and measured again the next time the song plays: it is kept for good only when both agree, otherwise the newer one replaces it. An offset from a play that was itself off (for example after switching Spotify crossfade in the middle of a song) no longer stays'
  ],
  '0.4.80': [
    'Lyric matching is no longer thrown off by Spotify crossfade: Spotify reports every song shorter by the crossfade time, which could match another edit of the song, re-match it a few seconds into a play, and leave a saved calibration not applying after the setting changed or a song was picked directly; lyrics are now always matched by the real length of the recording',
    'The help page shows the crossfade time that was detected'
  ],
  '0.4.79': [
    'The interface is available in English: choose Chinese, English or Follow the system under "Language" on the Preferences page; the main window, desktop lyrics, tray menu and messages all follow',
    'On a system whose language is not Chinese, the interface starts in English'
  ],
  '0.4.78': [
    'New Find lyrics page: read lyrics without playing anything. Search by song title or artist and open a song to see the same lyrics as during playback, with translation and romaji; right-click to copy, Ctrl+F to find in the lyrics',
    'Songs in the lyrics library can be opened and read directly (the "View lyrics" button on the right of each song, or type the title on the Find lyrics page)',
    'When Spotify is not playing, the Now playing page has a Find lyrics button at the top right'
  ],
  '0.4.77': [
    'The desktop overlay uses fewer resources: word highlighting and the fade-in on a new line now happen in a few steps, look almost the same and draw 90% fewer frames; while playing word-by-word lyrics the overlay\'s CPU use dropped from about 28% to about 4% (of one core)',
    'The overlay toolbar no longer pops up at the slightest touch: it appears after the pointer rests on the lyrics for about half a second; a pointer just passing by does not show it, it hides after the pointer stays still on the lyrics for 2.5 seconds, and moving and resting again brings it back',
    'The main window uses fewer resources: scrolling to a new line and the progress bar only redraw when something actually changes; with both windows open overall use is about 30% lower'
  ],
  '0.4.76': [
    'Tightened several rules the last two versions made too wide: short tracks with only a few lines are no longer shifted by a whole line; kanji words inside the lyrics (永遠, 運命) are no longer taken for a Chinese translation; credits with lowercase names such as "编曲：fox capture plan" are hidden as before; after a long pause, playback resumes at the position Spotify reports, as before'
  ],
  '0.4.75': [
    'An overlay dragged to the bottom of the screen (over the taskbar) is no longer moved back up when you unlock the PC, wake it from sleep or restart',
    'Library: after removing several songs in a row you can undo them all at once; special characters (/ : ? etc.) in exported file names are replaced, so exports no longer fail'
  ],
  '0.4.74': [
    'Fixed problems from the previous versions: when a whole translation track ran 0.6–1.2 seconds ahead of the lyrics, fast passages got the previous line\'s translation (now the track\'s overall offset is estimated before lines are matched, so early or late both land right); when lead and backing vocals share a time, the lead line\'s translation appeared on the backing line after it; embedded translations covering only part of the lyrics were not split into a translation track',
    'Part markings in lyrics ("和声：啦啦啦" and the like) are no longer removed as credits',
    'Lyrics no longer lag half a beat when you resume right after pausing; the lyrics list no longer slides half a screen when the main window opens'
  ],
  '0.4.73': [
    'More lyric lines have Chinese translations: when the chorus was translated only once, the other repeats show it too; lines are no longer lost when the translation is split into lines differently (《猫日》 had translations on only 18 of 38 lines); the same line written slightly differently on each side (想って / 思って) is matched too',
    'Credits at the start of a song (Guitar:, 贝斯:, Lyrics by: etc.) are no longer shown as lyrics',
    'Sync: the position correction after a song change no longer waits 5 seconds; lyrics no longer flash back at the moment of pausing; lyrics no longer freeze for 5 seconds after changing songs while paused; clicking the same line repeatedly to jump no longer makes the lyrics run early',
    'LRC import: files without timestamps are no longer imported as empty tracks; GBK, Shift_JIS and UTF-16 files can be read; a file in the song\'s own language counts as the original rather than a translation; an LRC dropped onto a song without synced lyrics is shown as its lyrics directly',
    'Lyrics editing: after nudging times or editing words, listening calibration and "calibrate to the singing" keep working (before, the lyrics jumped back as a whole); word-by-word lyrics update after editing words; candidate lyrics can be applied while the automatic search is still running',
    'Restoring a backup keeps your edited lyrics and manual offsets rather than versions fetched automatically later'
  ],
  '0.4.72': [
    'The main window scrolls smoothly to the next line (before, it jumped to every line)',
    'Lyric text can be selected with the mouse, and the right-click menu can copy the selection',
    'Fixed: in fast passages, translations and romaji with slightly off timing shifted down a line as a whole (most visible after nudging a track by 100 ms or importing a translation from elsewhere)',
    'Fixed: the list stopped following playback after right-clicking a lyric; Esc sometimes did not close the find bar; words with curly quotes or accents (don’t, café) could not be found',
    'Fixed: the first word of each line of word-by-word lyrics was sometimes missing; of two lines at the same time the overlay showed only the second; after Spotify closed, the overlay sometimes stayed on the first line of the previous song',
    'Translation alignment: a translation identical to the lyric line is no longer missed because of a similar neighbouring line'
  ],
  '0.4.71': [
    'Translations line up better: very short lines (Yeah, ねえ and the like) no longer get the translations of both neighbours; when a line is split in two, the second half\'s translation no longer slips to the next line; for short lines less than 1.2 seconds apart, translations are no longer a line late',
    'Lyrics are chosen more reliably: a song with a long interlude is no longer replaced by another song by the same artist with a similar title; the same NetEase Cloud Music version is no longer counted twice and preferred over the one playing; all-kanji lines repeated in the chorus are no longer taken as a Chinese translation',
    'A lyric source that stalls halfway no longer leaves "Searching" on screen forever; unfinished NetEase Cloud Music results are looked up again later (before, such songs had no translation until a restart)',
    'Saved songs are matched once more under the new rules the next time they play'
  ],
  '0.4.70': [
    'Listening calibration is steadier: hearing too few lines no longer gives an "inconsistent offsets" verdict (songs judged that way are measured again); a fully repeated chorus no longer puts the offset on the wrong repeat; seeking no longer wastes a calibration attempt',
    'Main window lyrics can be centred (Settings → Lyrics → Main window lyrics alignment)',
    'The help page lists the main window\'s playback shortcuts: Space to play / pause, ← → to skip back / forward 5 seconds'
  ],
  '0.4.69': [
    'New focus mode in the main window (F11 or the button next to the song title): only the title, lyrics and playback bar remain',
    'In the overlay settings "Text transparency" and "Background transparency" are renamed "opacity": 100% is fully opaque and smaller values are fainter (the old names made people turn them the wrong way)'
  ],
  '0.4.68': [
    'More songs get Chinese translations: when Spotify plays a version of a different length, such as the music video version, the same song\'s translation is used and aligned line by line',
    'New "Hide while paused" for the overlay: a locked overlay fades out after 10 seconds of pause and comes back when playback resumes (Settings → Overlay)',
    'Production credits at the start of lyrics (歌唱：, 作詞/作曲/編曲： etc.) are no longer shown as lyrics',
    'Fixed: lyrics search results were applied to the next song after a song change; a playing song removed from the library came back by itself; a failed re-match left an empty entry'
  ],
  '0.4.67': [
    'Fixed: pressing Alt+F4 or Ctrl+W on the desktop lyrics closed the lyrics window until a restart',
    'The toolbar comes back by itself when the pointer stays on the lyrics after dragging them',
    'Opening the main window from the tray or a shortcut keeps its last position and maximized state',
    'New "Recent updates" on the help page, with a small green dot in the sidebar when there is something new; library songs without a cover show a coloured initial'
  ],
  '0.4.66': [
    'The library can be exported and imported as a backup, including lyrics, manual calibration and listening calibration results',
    'The Sync page lists the lyric sources listening calibration compared',
    'The source menu marks sources whose content differs from the automatic choice; fixed overflowing menu descriptions and squeezed song titles'
  ],
  '0.4.65': [
    'Right-click lyrics: copy the line or the whole song (optionally with romaji and translation), or play from that line',
    'The tray icon\'s tooltip shows the song playing',
    'Listening calibration switches sources more reliably: sources that cannot be measured are skipped, it only switches to sources with the same lyrics, and songs judged inconsistent before are handled too',
    'Fixed: the first click on "Recalibrate now" said it had already tried twice'
  ],
  '0.4.64': [
    'The overlay can preview the next line (Settings → Overlay → Show next line)',
    'Ctrl+F finds in the lyrics, searching the original, romaji and translation',
    'The library shows each song\'s lyric source'
  ],
  '0.4.63': [
    'When listening calibration finds that the current source\'s lines are offset inconsistently, it switches to another source and measures again'
  ],
  '0.4.62': [
    'Translation and romaji font sizes scale with the lyrics font size',
    'The help page shows recent errors'
  ],
  '0.4.61': [
    'Better main window fonts; the window size and position are remembered; the app can start at login'
  ],
  '0.4.60': [
    'The source tag next to the song title switches lyric sources',
    'The Sync page can rerun listening calibration right away'
  ]
}
