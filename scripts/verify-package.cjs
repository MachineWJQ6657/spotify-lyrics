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
const main = read(mainEntry)
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
  unprovenRecipeNotApplied: renderer.includes('MIX · 未套用推算') && renderer.includes('媒体时间回退（未验证听感）') && main.includes('hypotheticalRecipePositionMs'),
  retainedVocalResult: renderer.includes('此为历史结果，不表示当前校准仍有效') && renderer.includes('lastResult'),
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
  providerRevision43: renderer.includes('LYRICS_PROVIDER_REVISION = 43') && main.includes('function kanaSkeletonMatches(') && main.includes('searchTimelineVersionDominated'),
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
  overlayLockInteraction: main.includes('function toggleOverlayLock(') && main.includes('OVERLAY_CONTROLS_DWELL_MS') && main.includes('window:show-section')
    && renderer.includes('悬浮窗设置') && renderer.includes('syllable:panel-tab') && !/\.overlay-shell\.paused/.test(rendererCss),
  // 0.4.59 crash fixes: stop libspotifyctl's event thread off the JS thread before terminating its worker,
  // never touch destroyed windows from timers, log main-process errors instead of a modal dialog, quit on request.
  orderedNativeShutdown: native.includes('stopNativeThread.async(') && native.includes("type: 'shutdown-done'") && native.includes('function stopWorker(') && main.includes('QUIT_FLUSH_BUDGET_MS'),
  crashHardening: main.includes('function isShown(') && /process\.on\(["']uncaughtException["']/.test(main) && /["']error\.log["']/.test(main)
    && /["']--syllable-quit["']/.test(main) && /["']session-end["']/.test(main),
  staticListeningIndicator: /\.listen-pulse\s*\{/.test(rendererCss) && !/\.listen-pulse\s*\{[^}]*animation/.test(rendererCss),
  nextTrackPrefetch: main.includes('/v1/me/player/queue') && main.includes('lyrics prefetch: next=') && main.includes('prefetched before the song change') && main.includes('rememberRomanized'),
  providerRequestBudget: main.includes('function lrclibTimelineHealthy(') && main.includes('function fetchKugouByKeyword(') && main.includes('function fetchKugouByFileHash('),
  instrumentalIsDefinitive: main.includes('function isInstrumentalPlaceholder(') && main.includes('instrumentalRecord') && renderer.includes('歌词源确认这首歌没有歌词'),
  romanizationRevision3: renderer.includes('ROMANIZATION_REVISION = 3') && main.includes('furiganaReadings') && main.includes('ヒトリ') && main.includes('ハルカゼ'),
  displayLayoutRecovery: main.includes('class OverlayLayoutGate') && main.includes('display-metrics-changed') && main.includes('overlay:layout-reset') && renderer.includes('onLayoutReset'),
  duplicateClockObservation: renderer.includes('this.rawAnchor') && renderer.includes('positionMs: this.anchor.positionMs'),
  exactTranslationAnchor: renderer.includes('baseLines[exactIndex].startMs === line.startMs'),
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
    && renderer.includes('开启音素校验（不接管）') && renderer.includes('未接管歌词时钟'),
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
  lockedFullWindowPassthrough: main.includes('setIgnoreMouseEvents(value, { forward: true })') && main.includes('overlay:movable-changed'),
  finalBoundsFlush: main.includes('Final overlay bounds save failed:') && main.includes('session.flushStorageData()'),
  lockedOverlayRecovery: main.includes('function recoverOverlayControls()') && main.includes('function sampleTransparentHover(') && main.includes('CommandOrControl+Alt+U') && renderer.includes('解锁并显示控制栏'),
}
console.log(JSON.stringify({ directory, expectedVersion, packagedVersion: packaged.version, checks,
  archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }, null, 2))
if (Object.values(checks).some(value => !value)) process.exitCode = 1
