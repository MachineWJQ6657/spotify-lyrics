// Read-only package identity check. Does not launch the app or touch user data.
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const asar = require('@electron/asar')

const directory = path.resolve(process.argv[2] || 'release/win-unpacked')
const archive = path.join(directory, 'resources', 'app.asar')
const expectedVersion = require('../package.json').version
const entries = asar.listPackage(archive)
const read = entry => asar.extractFile(archive, entry.replace(/^[\\/]/, '')).toString()
const packaged = JSON.parse(asar.extractFile(archive, 'package.json'))
const mainEntry = entries.find(entry => entry.replace(/\\/g, '/') === '/out/main/main.js')
if (!mainEntry) throw new Error('Packaged main entry is missing')
// Since 0.4.83 the lyric lookup is a chunk of its own, loaded by the main process and by the lyric worker thread.
const lyricsProviderChunks = entries.filter(entry => /[\\/]main[\\/]chunks[\\/]lyrics-provider-.*\.js$/.test(entry))
const lyricsWorkerEntry = entries.find(entry => entry.replace(/\\/g, '/') === '/out/main/lyrics-worker.js')
const lyricsWorker = lyricsWorkerEntry ? read(lyricsWorkerEntry) : ''
const mainOnly = read(mainEntry)
const main = [mainOnly, ...lyricsProviderChunks.map(read)].join('\n')
const native = entries.filter(entry => /[\\/]main[\\/]chunks[\\/]local-spotify-.*\.js$/.test(entry)).map(read).join('\n')
const renderer = entries.filter(entry => /[\\/]renderer[\\/].*\.js$/.test(entry)).map(read).join('\n')
const rendererCss = entries.filter(entry => /[\\/]renderer[\\/].*\.css$/.test(entry)).map(read).join('\n')
const pronunciationWorkerEntry = entries.find(entry => entry.replace(/\\/g, '/') === '/out/main/pronunciation-worker.js')
const pronunciationWorker = pronunciationWorkerEntry ? read(pronunciationWorkerEntry) : ''
const pronunciationChunk = entries.filter(entry => /[\\/]main[\\/]chunks[\\/]lyric-pronunciation-.*\.js$/.test(entry)).map(read).join('\n')
const preload = entries.filter(entry => /[\\/]preload[\\/].*\.cjs$/.test(entry)).map(read).join('\n')
const checks = {
  executable: fs.existsSync(path.join(directory, 'Syllable.exe')),
  version: packaged.version === expectedVersion,
  main: packaged.main === './out/main/main.js',
  durationDiagnostic: main.includes('durationRatio='),
  pointerCaptureCleanup: renderer.includes('onLostPointerCapture'),
  timelineLabel: renderer.includes('SPOTIFY TIMELINE'),
  noUnsupportedAccuracyClaim: !renderer.includes('FRAME-ACCURATE CLOCK'),
  honestSourceEvidence: renderer.includes('尚未取得 Spotify 原文对照') && renderer.includes('元数据匹配') && main.includes('referencePool'),
  unprovenRecipeNotApplied: renderer.includes('Spotify 播放进度') && main.includes('hypotheticalRecipePositionMs'),
  retainedVocalResult: renderer.includes('上次分析') && renderer.includes('lastResult'),
  manualSessionCalibration: renderer.includes('这句现在开始') && renderer.includes('session-calibration') && renderer.includes('function displayedLyricPosition('),
  captureContinuityGate: main.includes('function captureQuality(') && renderer.includes('captureEpoch') && renderer.includes('startContextTime'),
  automaticAudioRecovery: renderer.includes('automaticAudioSync') && renderer.includes('function reconcileAutomatic(') && renderer.includes('开启自动声音同步'),
  longBaselineVocalRate: main.includes('class OnsetClock') && main.includes('const slopes = this.history.flatMap') && main.includes('baseline < 2e4'),
  independentVocalLandmarks: main.includes('function extractLyricLandmarks(') && /captureStart \+ [\w$]+\.heardMs/.test(main) && main.includes('this.history.length < 3'),
  pronunciationLandmarks: main.includes('function extractPhoneticLandmarks(') && main.includes('function analyzeJapaneseLines(') && main.includes('phoneticElapsedMs'),
  boundedReadingFallback: main.includes('remainingMs - 100') && main.includes('this.readingAbort') && /mode === ["']analyze["']/.test(main),
  headlessAudioQa: main.includes('--syllable-qa-headless') && main.includes('show: !headlessAudioQa'),
  acousticTokenTiming: main.includes('function dtwModelPreset(') && main.includes('token.t_dtw') && main.includes('"-nfa"'),
  untimedOriginalFallback: renderer.includes('暂无可信时间轴') && main.includes('comparableLength'),
  translationOwnership: main.includes('translationCounts.get(ownerIndex) === 1') && main.includes('anchor.targetIndices'),
  providerRevision46: renderer.includes('LYRICS_PROVIDER_REVISION = 46') && main.includes('function kanaSkeletonMatches(') && main.includes('searchTimelineVersionDominated'),
  translationAlignmentVariants: main.includes('SPELLING_VARIANTS') && main.includes('FURIGANA_READING') && main.includes('uniqueGrouping'),
  siblingAndTextTranslation: main.includes('function withSiblingTranslation(') && main.includes('function enrichTranslationByLyricText(') && /type: ["']1006["']/.test(main),
  neteaseTimelinePreference: main.includes('function preferredNeteaseTimeline(') && main.includes('function onsetDistance('),
  consensusOutlierDropped: main.includes('const consistent = topIsTimelineOutlier'),
  listenedOffset: main.includes('audio-sync:listen') && main.includes('listen offset: reason=') && main.includes('function alignLines(') && main.includes('function timingPrior(')
    && renderer.includes('听音自动校准') && renderer.includes('listenedOffset'),
  // Chinese / English listening: the disposable worker carries pinyin-pro and CMUdict.
  listenPronunciation: main.includes('pronunciation-worker.js') && pronunciationChunk.includes('function pronunciationCoverage(') && pronunciationChunk.includes('function pinyinPhones(')
    && pronunciationWorker.includes('B AW1 T') && pronunciationWorker.includes('toneType') && renderer.includes('日语、中文、英文歌曲'),
  // 0.4.54 interaction: click a line to play from it, timing status on the card, library filter with undo.
  seekableLyrics: renderer.includes('lyric-seek-hint') && renderer.includes('播放这一句') && renderer.includes('input, textarea, select, button'),
  timingStatusLabel: renderer.includes('正在听音校准') && renderer.includes('听音校准 · 歌词'),
  librarySearchUndo: renderer.includes('按歌名、艺人或专辑筛选') && renderer.includes('restoreLibraryDocument'),
  // 0.4.55 redesign: main-window CSS is its own chunk (app.css); the overlay keeps styles.css.
  redesignedShell: rendererCss.includes('.app-backdrop-art') && rendererCss.includes('.panel-tabs') && renderer.includes('syllable-ui-panel-tab')
    && /\.player-bar\s*\{/.test(rendererCss) && !/\.player-bar\s*\{[^}]*backdrop-filter/.test(rendererCss),
  // An endless animation on the listening indicator kept the GPU process at ~20% while listening.
  // 0.4.57 overlay: long lines shrink to fit, title card before the first line, lyric surfaces wake at boundaries.
  overlayFitAndTitle: renderer.includes('function fitSearchStep(') && renderer.includes('title-card') && /--overlay-fit/.test(rendererCss) && /auto-phrase/.test(rendererCss),
  boundaryLyricClock: renderer.includes('function msUntilNextLyricChange(') && renderer.includes('nextDue.current'),
  // 0.4.58 overlay interaction: one lock (no separate click-through), dwell before the bar over locked lyrics,
  // contextual bar with an overlay-settings shortcut, and no paused dimming capping the text opacity.
  overlayLockInteraction: main.includes('function toggleOverlayLock(') && main.includes('advanceHoverIntent(') && main.includes('window:show-section')
    && renderer.includes('悬浮窗设置') && renderer.includes('syllable:panel-tab') && !/\.overlay-shell\.paused/.test(rendererCss),
  // 0.4.59 crash fixes: stop libspotifyctl's event thread off the JS thread before terminating its worker,
  // never touch destroyed windows from timers, log main-process errors instead of a modal dialog, quit on request.
  orderedNativeShutdown: native.includes('stopNativeThread.async(') && native.includes("type: 'shutdown-done'") && native.includes('function stopWorker(') && main.includes('QUIT_FLUSH_BUDGET_MS'),
  crashHardening: main.includes('function isShown(') && /process\.on\(["']uncaughtException["']/.test(main) && /["']error\.log["']/.test(main)
    && /["']--syllable-quit["']/.test(main) && /["']session-end["']/.test(main),
  // 0.4.60: pick the lyrics source per song, re-run listening calibration on demand, plain UI copy.
  lyricsSourceSwitch: main.includes('function assembleProviderSet(') && main.includes('reuseProviderResults') && renderer.includes('function sourceOptions(') && renderer.includes('setLyricsSource'),
  relistenOnDemand: renderer.includes('function relistenCurrentSong(') && renderer.includes('立即重新校准'),
  plainCopy: !/不保存、不上传|不代表时间同步|未验证听感|未接管歌词时钟|待核验/.test(renderer),
  // 0.4.61: main window remembers its place, optional start at login (tray only), Noto Sans SC for large Chinese text.
  mainWindowStateAndLogin: main.includes('function fitWindowToWorkArea(') && /--syllable-autostart/.test(main) && /app:set-login-item/.test(main) && renderer.includes('开机启动'),
  typography: /Noto Sans SC/.test(rendererCss) && /Segoe UI Variable Display/.test(rendererCss),
  // 0.4.62: translation/romaji rows scale with the lyric size (never below the outlined 18/16 px), recent errors on the help page.
  proportionalSecondaryRows: /max\(18px, var\(--overlay-size, 52px\) \* 9 \/ 26\)/.test(rendererCss) && /var\(--lyric-size\) \* 17 \/ 52/.test(rendererCss),
  recentErrorsCard: /app:recent-errors/.test(main) && main.includes('function recentErrorEntries(') && renderer.includes('最近的程序错误'),
  // 0.4.63: when listening finds the shown source inconsistent it measures another provider's timeline instead.
  listeningPicksSource: renderer.includes('function afterVerdict(') && renderer.includes('function nextSourceToTry(') && renderer.includes('source-inconsistent') && renderer.includes('recordSourceTrial'),
  // 0.4.64: optional next-line preview in the overlay (never shrinks the line being sung), find in lyrics (Ctrl+F), provider tag on library rows.
  overlayNextLine: renderer.includes('function upcomingLine(') && renderer.includes('overlayNextLine') && /\.overlay-secondary\.next-line\s*\{[^}]*text-overflow:\s*ellipsis/.test(rendererCss),
  findInLyrics: renderer.includes('function findLineMatches(') && renderer.includes('lyrics-find-open') && /\.lyric-group\.find-current::after/.test(rendererCss),
  librarySourceTag: renderer.includes('function librarySourceTag(') && /\.library-copy i\.source-tag/.test(rendererCss),
  // 0.4.65: right-click menu on lyric rows (copy, play from here, find) writing through the main-process clipboard; the tray tooltip names the song; the saved library keeps to a storage budget and a failed save no longer throws into the action.
  lyricRowMenu: renderer.includes('lyric-menu') && renderer.includes('function songText(') && /app:copy-text/.test(main) && /app:copy-text/.test(preload) && /\.lyric-menu\s*\{[^}]*position:\s*fixed/.test(rendererCss),
  trayNamesSong: main.includes('function trayTooltipText(') && main.includes('function updateTrayTooltip('),
  libraryStorageBudget: renderer.includes('function pruneLibrary(') && renderer.includes('function tolerateWriteFailures(') && /LIBRARY_BUDGET_CHARS = (12e6|12_000_000|12000000)\b/.test(renderer),
  listeningAdvancesEarlierVerdicts: renderer.includes('function advanceSource(') && renderer.includes('function adoptEarlierVerdict(') && renderer.includes('availabilityAsked'),
  // Review fixes for source switching: one session start at a time, no verdict against the user's own lyrics, an unmeasurable trial is given up, no listening during a source lookup, and only providers that agree with the automatic choice are tried.
  listeningSourceGuards: renderer.includes('function automaticSourceOf(') && renderer.includes('function giveUpUnmeasuredTrial(') && renderer.includes('source-switching') && renderer.includes('reconcileAgain') && main.includes('function describeAvailableSources(') && /agrees !== false/.test(renderer),
  // 0.4.66: source menu notes wrap, the song title outranks the track-count chip, the menu marks a provider whose lyrics differ, the 同步 tab lists the providers listening compared, and a debugger-only hook lets the source chain be exercised without audio.
  sourceMenuPolish: /\.source-popover p\.source-popover-note\s*\{[^}]*white-space:\s*normal/.test(rendererCss) && /span\.track-count\s*\{\s*display:\s*none/.test(rendererCss) && renderer.includes('内容与自动选择的不同'),
  triedSourcesStatus: renderer.includes('function sourceTrialsSummary(') && renderer.includes('__syllableListenQa'),
  libraryBackup: renderer.includes('function parseLibraryBackup(') && renderer.includes('function mergeLibraryBackup(') && renderer.includes('导入备份') && /Syllable 资料库备份/.test(main),
  // 0.4.67: the lyrics and control-bar windows close only on quit (no default menu accelerators, Alt+F4 refused), close() waits for an in-flight worker stop, the control bar returns after a suppression, a reveal keeps the remembered window state, recent updates on the help page.
  overlayWindowsStayOpen: /Menu\.setApplicationMenu\(null\)/.test(main) && (main.match(/\.on\(["']close["'], \(?event\)? => \{\s*if \(!quitting\) event\.preventDefault\(\)/g) ?? []).length >= 2,
  quitWaitsForWorkerStop: native.includes('this.stopping') && /await Promise\.all\(\[\.\.\.this\.stopping\]\)/.test(native),
  controlsResumeAndWindowState: main.includes('function resumeControlsAfterSuppression(') && main.includes('function mainWindowReachable(') && main.includes('mainWindowMaximizePending'),
  recentUpdates: renderer.includes('function releasedEntries(') && renderer.includes('最近更新') && /\.nav-item \.nav-news/.test(rendererCss) && renderer.includes('function coverTile('),
  // 0.4.68: optional "hide while paused" for a locked overlay (one fade, no hit regions while hidden). The class is not `.paused...`:
  // overlayLockInteraction above forbids any `.overlay-shell.paused` rule (0.4.57's dimming capped the text opacity setting).
  overlayHidesWhilePaused: renderer.includes('function hidesWhilePaused(') && renderer.includes('overlayHideWhenPaused') && /\.overlay-shell\.idle-hidden \.overlay-surface\s*\{[^}]*visibility:\s*hidden/.test(rendererCss),
  // A translation from an entry of another length (music-video cut, Mix-stretched length) is used when the words are the same.
  translationAcrossLengths: main.includes('function lengthsCompatible(') && main.includes('SAME_WORDS_SIMILARITY') && (main.match(/SAME_WORDS_SIMILARITY/g) ?? []).length >= 4,
  translationRecheck: renderer.includes('function needsTranslationRecheck(') && renderer.includes('translationRechecked'),
  // Third review (lookup lifecycle and library): a dropped answer is asked for again, a failed lookup says so, deleting the song on screen resets it, re-match and source choice never save an empty entry, search candidates stay with their song, credit headers are filtered.
  lookupLifecycleFixes: renderer.includes('function mayRerunDiscardedLookup(') && renderer.includes('rerunLyricsLookup') && renderer.includes('lookupFailed') && renderer.includes('歌词源暂时不可用') && renderer.includes('savedDocument') && renderer.includes('CREDIT_ROLE') && main.includes('bracketedTitle'),
  // 0.4.69: focus mode in the main window (F11); the opacity sliders are named 不透明度 so 100% reads as solid.
  focusMode: renderer.includes('syllable-ui-focus') && /\.body-grid\.focus-mode\s*\{/.test(rendererCss) && renderer.includes('专注模式'),
  opacityNaming: renderer.includes('文字不透明度') && renderer.includes('背景不透明度') && !/label: ["']文字透明度["']/.test(renderer),
  // 0.4.70: lyric rows can be centred in the main window; the help page lists the playback keys.
  mainAlignment: renderer.includes('mainAlignment') && /\.lyric-card\.lyrics-centered \.lyric-group\s*\{[^}]*text-align:\s*center/.test(rendererCss) && renderer.includes('主窗口歌词对齐'),
  // Fourth review (listening measurement): too few lines is never a verdict, once-only lines decide (repeated words can sit on another repetition), the search narrows only on agreeing once-only lines, an idle diagnostic session does not cancel the shared recognizer, a dropped session restarts.
  listeningEvidence: (main + native + pronunciationChunk).includes('function repeatedLineIndexes(') && (main + native + pronunciationChunk).includes('LISTEN_MIN_UNIQUE_LINES') && renderer.includes('function isConclusiveListen(') && renderer.includes('mayRestartSession'),
  // 0.4.71, fifth review (lyrics provider): a grouping must explain a row better than its own match and merged rows keep their translations, a row cut at another place joins the displayed row it ends, lone short rows in the same slot pair up; one long interlude admits only the same song; a NetEase entry is fetched once and an unfinished lookup is not final; bodies are read under the timeout; the interleaved-translation layout must cover the song; stamps 15 ms apart are the same line.
  providerAlignmentFixes: main.includes('grouped: true') && main.includes('> ownCloseness') && main.includes('targetEnd - 1300') && main.includes('const textualOwner = ') && renderer.includes('SAME_STAMP_MS'),
  providerSelectionFixes: main.includes('function sharesLyricWords(') && main.includes('topHasLongGap') && main.includes('const fetched = ') && main.includes('let incomplete = false') && main.includes('function bufferedResponse(') && /alternatingCoverage >= 0?\.4/.test(main),
  // 0.4.72, sixth review (renderer): a secondary row goes to the nearer row start (renderer and provider buckets); words before the first word tag are kept and rows with one timestamp become one; find folds apostrophes and Latin accents; the list scrolls smoothly on a new line and jumps only on content or size changes; a right-click keeps following; Esc closes the find bar from anywhere; a replaced document closes the row menu; lyric text is selectable; the overlay is idle without a track; an unknown length does not clamp a seek to 0.
  secondaryNearestRow: renderer.includes('leadMs < line.startMs - baseLines[current].startMs') && main.includes('leadMs < row.timeMs - baseRows[index].timeMs'),
  lyricParsingFixes: renderer.includes('const leading = ') && renderer.includes('JOINED_ROWS'),
  lyricListReviewFixes: renderer.includes('primed') && renderer.includes('event.button !== 2') && renderer.includes('findOpen') && renderer.includes('menuStale') && /\.lyrics-viewport \.lyric-primary,\s*\.lyrics-viewport \.lyric-secondary\s*\{[^}]*user-select:\s*text/.test(rendererCss),
  overlayIdleWithoutTrack: renderer.includes('playback?.track ? base?.lines[index]') && renderer.includes('Number.POSITIVE_INFINITY'),
  // An unmatched provider row takes the free displayed row with identical words; lone short rows in one slot pair up.
  providerSlotPairing: main.includes('sameWords') && main.includes('const targetsOf = '),
  // 0.4.73. Provider: rows the translation leaves empty take the translation of identical words (another row, another entry of the song); staff credits ("Guitar：", "贝斯：", "Lyrics by：") are not lyric rows.
  translationSameWordsFill: main.includes('function sameWordsFill(') && main.includes('function translationMemoryOf(') && main.includes('STAFF_ROLE') && renderer.includes('STAFF_ROLE'),
  // Seventh review (lyric clock): a status-only pause notification holds the projected position; after a track change corrections of 150 ms release the gate and a paused arrival that starts playing is published at once; an accepted seek moves the worker's and the service's clock.
  clockReviewFixes: native.includes('rawPositionMs') && native.includes('startupGateAnnounced') && native.includes('announced ? 150 : 1500'),
  // Eighth review (editor, library, settings): one import path that skips files without timed lines, reads legacy encodings and recognises the song's own language; edits keep the listened offset and a heard-line calibration; a backup's copy with the user's work wins; custom-language tracks need no switch.
  editorReviewFixes: renderer.includes('function importLyricFiles(') && renderer.includes('function decodeLyricFile(') && renderer.includes('shift_jis') && renderer.includes('function carryListenedOffset(') && renderer.includes('function carrySessionCalibration(') && renderer.includes('SWITCHED_LANGUAGES') && /keepRank\(document\d*\) !== keepRank\(existing\d*\)/.test(renderer),
  // 0.4.74, regressions found by reviewing 0.4.71-0.4.73: a whole-track shift is estimated before secondary rows are assigned (renderer and provider buckets); the translation memory skips timestamps shared by two rows; a sparse interleaved translation is split when its rows differ; a resume without a new measurement continues from the held position; sung part labels are not credits; only a new line glides.
  regressionReviewFixes: renderer.includes('function secondaryTrackShift(') && main.includes('function secondaryTrackShift(') && main.includes('distinctTranslations') && main.includes('rowsAt') && renderer.includes('SUNG_VALUE') && main.includes('SUNG_VALUE') && renderer.includes('centredLine') && native.includes('positionMs: previous.positionMs, rawPositionMs: positionMs'),
  // 0.4.75, tenth review: the overlay keeps a place the drag allows (over the taskbar) through unlock, resume, show and restart; the library undoes every removal of the undo window and sanitises export names.
  overlayPlacementKept: main.includes('function visibleOverlayPlacement(') && main.includes('OVERLAY_GRIP_PX') && renderer.includes('removed.length === 1'),
  // 0.4.76, regression review of 0.4.74-0.4.75: the track shift needs a dozen rows and ignores loose stamping; a sparse interleaved translation must read as Chinese; only part labels are tested for sung values; a resume continues from the held position only within 1.5 s; an overlay whose stored size does not fit is brought back whole.
  tightenedRules: renderer.includes('nearMs') && main.includes('CHINESE_ONLY_WORD') && renderer.includes('PART_LABEL') && native.includes('now - previous.observedAtMs <= 1500') && main.includes('width === bounds.width'),
  // 0.4.77, frames and the overlay bar: fades in steps (a word 40 -> 4 frames, an overlay line 64 -> 9 at 240 Hz), the lyric list glides at about 60 Hz, the player bar redraws on a visible change, the bar opens on a resting pointer
  fewerFramesRestingBar: /lyric-line-enter 260ms steps\(8, ?end\)/.test(rendererCss) && /\.karaoke-line span\s*\{\s*transition:\s*color 160ms steps\(3, ?jump-start\)/.test(rendererCss) && /\.lyric-group\.active,\s*\.lyric-group\.past\s*\{\s*transition-timing-function:\s*steps\(8, ?end\)/.test(rendererCss) && /color 120ms steps\(3, ?jump-start\)/.test(rendererCss) && renderer.includes('frameMs') && renderer.includes('onTrackWidth') && main.includes('advanceHoverIntent(') && !main.includes('OVERLAY_CONTROLS_DWELL_MS'),
  // 0.4.78, the search page: songs by free text from LRCLIB and NetEase merged into one list, a hit read through the normal lookup, the lyric list's reading mode, library songs opened for reading
  lyricSearchPage: main.includes('function mergeSongHits(') && main.includes('lyrics:find-songs') && renderer.includes('browse-page') && renderer.includes('findSongs') && renderer.includes('browse-reader-header') && rendererCss.includes('.lyrics-stage-shell.reading'),
  // 0.4.79, the English interface: texts go through t() with the English entries bundled in every window and the main process; the language control is bilingual; the tray menu follows the language
  englishInterface: renderer.includes('界面语言 · Language') && renderer.includes('Lyrics library') && renderer.includes('Find lyrics') && main.includes('app:set-language') && main.includes('Open Syllable') && main.includes('function applyTrayMenu('),
  // 0.4.80, Spotify crossfade shortens the reported length: the service keeps the recording's own length when it sees the drop, the window restores it from the saved lyric file or what was learned, lyric matching reads it first
  crossfadeLength: native.includes('crossfade: reported length') && native.includes('function fadeTrimOfDrop(') && native.includes('enteredAtEnd') && renderer.includes('function releaseDurationOf(') && renderer.includes('function withReleaseDuration(') && renderer.includes('syllable-fade-trim'),
  // 0.4.81, a listened offset of 1.5 s or more is confirmed on another play before it is kept for good
  listenConfirmation: renderer.includes('function awaitsConfirmation(') && renderer.includes('function confirmedBy(') && renderer.includes('measuredInPlay') && renderer.includes('confirmable'),
  // 0.4.82, no system-wide low-level mouse hook: the overlay never forwards mouse movement; hover over input-transparent lyrics comes from cursor sampling
  noMouseHook: !main.includes('forward: true') && main.includes('overlayWindow.setIgnoreMouseEvents(value)') && main.includes('function refreshTransparentHoverTracking('),
  // 0.4.82, the screen named for a system-audio capture is kept between songs (asking Windows for it blocked the main thread for about half a second each time)
  captureScreenKept: main.includes('if (captureScreenSource) {') && main.includes('audio-sync:capture-failed') && main.includes('captureScreenSource = null'),
  // 0.4.82, a lookup parses each lyric text once
  parsedRowsKept: main.includes('const known = parsedRows.get(value)') && main.includes('Object.freeze(row)'),
  // 0.4.83, lyric lookups run in a worker thread: the worker entry is packaged and loads the provider chunk; the main entry starts it and no longer holds the lookup itself
  lyricsWorkerThread: lyricsProviderChunks.length === 1 && lyricsWorker.includes('fetchLyrics(...call.args)') && /chunks\/lyrics-provider-/.test(lyricsWorker)
    && mainOnly.includes('new Worker(new URL("./lyrics-worker.js", import.meta.url))') && !mainOnly.includes('async function fetchLyrics(')
    && mainOnly.includes('lyrics worker lost') && mainOnly.includes('const closeLyrics = stopLyricsWorker()'),
  // 0.4.84, a language switch says what it can do for the song on screen: missing languages and the song's own language are marked
  languageSwitchStates: renderer.includes('这首没有') && renderer.includes('language-note') && rendererCss.includes('.language-grid button.missing'),
  staticListeningIndicator: /\.listen-pulse\s*\{/.test(rendererCss) && !/\.listen-pulse\s*\{[^}]*animation/.test(rendererCss),
  nextTrackPrefetch: main.includes('/v1/me/player/queue') && main.includes('lyrics prefetch: next=') && main.includes('prefetched before the song change') && main.includes('rememberRomanized'),
  providerRequestBudget: main.includes('function lrclibTimelineHealthy(') && main.includes('function fetchKugouByKeyword(') && main.includes('function fetchKugouByFileHash('),
  instrumentalIsDefinitive: main.includes('function isInstrumentalPlaceholder(') && main.includes('instrumentalRecord') && renderer.includes('歌词源确认这首歌没有歌词'),
  romanizationRevision3: renderer.includes('ROMANIZATION_REVISION = 3') && main.includes('furiganaReadings') && main.includes('ヒトリ') && main.includes('ハルカゼ'),
  displayLayoutRecovery: main.includes('class OverlayLayoutGate') && main.includes('display-metrics-changed') && main.includes('overlay:layout-reset') && renderer.includes('onLayoutReset'),
  duplicateClockObservation: renderer.includes('this.rawAnchor') && renderer.includes('positionMs: this.anchor.positionMs'),
  // 0.4.71: "exact" allows for rounding (15 ms), since re-timed tracks are written to 10 ms.
  exactTranslationAnchor: renderer.includes('Math.abs(baseLines[current].startMs - line.startMs) <= SAME_STAMP_MS'),
  displayedVersion: renderer.includes(`const version = "${expectedVersion}";`),
  unclippedOverlayPaint: !/overlayWindow\.setShape\(/.test(main) && main.includes('overlayShapeKey = "[]"'),
  separateOverlayInput: main.includes('function overlayInputState(') && main.includes('overlay:pointer-move') && preload.includes('overlay:pointer-move'),
  explicitOverlayAcceptance: main.includes('qa acceptance:'),
  serializedPlaybackRequests: main.includes('class PlaybackRequestGate') && main.includes('backend request still in flight'),
  orderedPlaybackRefreshes: main.includes('class PlaybackRefreshGate') && main.includes('playbackRefreshes.invalidate()'),
  cancellableWebMutations: main.includes('controller.signal.throwIfAborted()') && main.includes('Spotify 控制请求超时'),
  retainedTransitionClock: native.includes('!matched && wasResolved'),
  rawNativeClock: native.includes('function observeNativeClock(') && native.includes('nativeClockPosition(nativeClock, performance.now())') && !native.includes('client.positionSmoothMs'),
  rawBoundaryQuarantine: native.includes('function guardNativeBoundary(') && native.includes('nativeBoundaryPending') && native.includes('boundary.observedAtMs'),
  stablePcmTimestamp: renderer.includes('class CaptureTimeline') && renderer.includes('captureTimeline.timestamp('),
  nativeVisualSuspension: main.includes('watchWindowVisibility') && main.includes('window:visibility')
    && renderer.includes('nativeVisible.current') && renderer.includes('visibilitychange'),
  cachedLibrarySerialization: renderer.includes('serializedLibrary') && renderer.includes('hasSerializedLibrary') && renderer.includes('libraryJson'),
  phonemeDiagnosticIsolation: main.includes('audio-sync:phoneme') && main.includes('clockApplied: false')
    && renderer.includes('开启音素校验') && renderer.includes('正在连续校验日语歌声'),
  boundedPhonemeRuntime: main.includes('class LocalCtc') && main.includes('this.stoppingChild') && main.includes('Local phoneme shutdown failed:'),
  phonemeWorker: entries.some(entry => /[\\/]main[\\/]ctc-matcher-worker\.js$/.test(entry)),
  phonemePythonHelper: fs.existsSync(path.join(directory, 'resources', 'audio-sync', 'romaji-ctc-runner.py')),
  activeQueueOccurrence: native.includes('const end = Math.min(nextTitle, nextTrack)') && native.includes('keyLength.value === needle.length'),
  isolatedRenderSurfaces: renderer.includes('function ClockedLyricsStage') && renderer.includes('function ClockedPlayerBar') && main.includes('render isolation:'),
  diagnosticExport: main.includes('class DiagnosticExporter') && main.includes('playback:export-diagnostics'),
  serializedRomanization: main.includes('jobs.size >= 8') && main.includes('const previous = queue')
    && main.includes('void previous.then(') && main.includes('worker.terminate().then(') && main.includes('releaseQueue()'),
  composedRomajiReadings: main.includes('function romanizeJapaneseWords(') && main.includes('pendingClosure') && renderer.includes('generatedRomanizationRevision'),
  refreshCalibration: renderer.includes('function preserveLyricsCalibration(') && renderer.includes('const calibrated = preserveLyricsCalibration('),
  preservedRefreshBaseline: renderer.includes('providerRevision: void 0') && renderer.includes('const pending = baseline'),
  acousticWorker: entries.some(entry => /[\\/]renderer[\\/]assets[\\/]acoustic-worker-.*\.js$/.test(entry)),
  acousticWorklet: entries.some(entry => /[\\/]renderer[\\/]audio-sync-worklet\.js$/.test(entry)),
  acousticSafety: main.includes('captureDurationMs') && main.includes('invalidatedAtMs') && main.includes('audio-sync:observation'),
  acousticEndpointSafety: main.includes('value.capturedAtMs < this.latestCaptureMs') && main.includes('this.latestCaptureMs = value.capturedAtMs') && renderer.includes('unconfirmed-end'),
    experimentalAudioUi: renderer.includes('本地人声对齐') && renderer.includes('AUDIO ALIGNMENT') && main.includes('audio-sync:vocal'),
  closeToTray: main.includes('close-to-tray:') && main.includes('mainWindow?.hide()') && main.includes('new Tray(iconPath)'),
  trayIconAssets: ['icon.ico', 'icon.png'].every(name => fs.existsSync(path.join(directory, 'resources', name))),
  secondaryContrast: /-webkit-text-stroke:\s*1\.5px #121212/.test(rendererCss) && rendererCss.includes('.no-background.effect-none .overlay-secondary'),
  overlayStartupBarrier: main.includes('overlayRendererReady, overlaySettingsReady') && main.includes('overlay:restore') && renderer.includes('receivedSettings'),
  overlayFirstPaintBarrier: main.includes('overlayFirstPaintReady') && main.includes('function waitForFirstPaint(') && main.includes('function paintRecovery(') && main.includes('function waitForLoad(') && main.includes('reloading renderer once'),
  lockedFullWindowPassthrough: main.includes('overlayWindow.setIgnoreMouseEvents(value)') && !main.includes('forward: true') && main.includes('overlay:movable-changed'),
  finalBoundsFlush: main.includes('Final overlay bounds save failed:') && main.includes('session.flushStorageData()'),
  lockedOverlayRecovery: main.includes('function recoverOverlayControls()') && main.includes('function sampleTransparentHover(') && main.includes('CommandOrControl+Alt+U') && renderer.includes('解锁并显示控制栏'),
}
console.log(JSON.stringify({ directory, expectedVersion, packagedVersion: packaged.version, checks,
  archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }, null, 2))
if (Object.values(checks).some(value => !value)) process.exitCode = 1
