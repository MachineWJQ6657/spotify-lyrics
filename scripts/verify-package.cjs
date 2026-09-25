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
const checks = {
  executable: fs.existsSync(path.join(directory, 'Syllable.exe')),
  version: packaged.version === expectedVersion,
  main: packaged.main === './out/main/main.js',
  durationDiagnostic: main.includes('durationRatio='),
  pointerCaptureCleanup: renderer.includes('onLostPointerCapture'),
  timelineLabel: renderer.includes('SPOTIFY TIMELINE'),
  noUnsupportedAccuracyClaim: !renderer.includes('FRAME-ACCURATE CLOCK'),
  translationOwnership: main.includes('translationCounts.get(ownerIndex) === 1') && main.includes('anchor.targetIndices'),
  providerRevision34: renderer.includes('LYRICS_PROVIDER_REVISION = 34'),
  duplicateClockObservation: renderer.includes('this.rawAnchor') && renderer.includes('positionMs: this.anchor.positionMs'),
  exactTranslationAnchor: renderer.includes('baseLines[exactIndex].startMs === line.startMs'),
  displayedVersion: renderer.includes(`const version = "${expectedVersion}";`),
  clippedOverlayShape: main.includes('function overlayShape('),
  explicitOverlayAcceptance: main.includes('qa acceptance:'),
  serializedPlaybackRequests: main.includes('class PlaybackRequestGate') && main.includes('backend request still in flight'),
  orderedPlaybackRefreshes: main.includes('class PlaybackRefreshGate') && main.includes('playbackRefreshes.invalidate()'),
  cancellableWebMutations: main.includes('controller.signal.throwIfAborted()') && main.includes('Spotify 控制请求超时'),
  retainedTransitionClock: native.includes('!matched && wasResolved'),
  rawNativeClock: native.includes('function observeNativeClock(') && native.includes('nativeClockPosition(nativeClock, performance.now())') && !native.includes('client.positionSmoothMs'),
  activeQueueOccurrence: native.includes('const end = Math.min(nextTitle, nextTrack)') && native.includes('keyLength.value === needle.length'),
  isolatedRenderSurfaces: renderer.includes('function ClockedLyricsStage') && renderer.includes('function ClockedPlayerBar') && main.includes('render isolation:'),
  diagnosticExport: main.includes('class DiagnosticExporter') && main.includes('playback:export-diagnostics'),
  serializedRomanization: main.includes('jobs.size >= 8') && main.includes('queue = task.catch('),
  refreshCalibration: renderer.includes('function preserveLyricsCalibration(') && renderer.includes('const calibrated = preserveLyricsCalibration('),
  preservedRefreshBaseline: renderer.includes('providerRevision: void 0') && renderer.includes('const pending = baseline'),
  acousticWorker: entries.some(entry => /[\\/]renderer[\\/]assets[\\/]acoustic-worker-.*\.js$/.test(entry)),
  acousticWorklet: entries.some(entry => /[\\/]renderer[\\/]audio-sync-worklet\.js$/.test(entry)),
  acousticSafety: main.includes('captureDurationMs') && main.includes('invalidatedAtMs') && main.includes('audio-sync:observation'),
  acousticEndpointSafety: main.includes('value.capturedAtMs > this.anchor.observedAtMs') && renderer.includes('unconfirmed-end'),
  experimentalAudioUi: renderer.includes('当前阶段不支持无参照校准') && renderer.includes('AUDIO ALIGNMENT'),
  closeToTray: main.includes('close-to-tray:') && main.includes('mainWindow?.hide()') && main.includes('new Tray(iconPath)'),
  trayIconAssets: ['icon.ico', 'icon.png'].every(name => fs.existsSync(path.join(directory, 'resources', name))),
  secondaryContrast: /-webkit-text-stroke:\s*1\.5px #121212/.test(rendererCss) && rendererCss.includes('.no-background.effect-none .overlay-secondary'),
  overlayStartupBarrier: main.includes('overlayRendererReady, overlaySettingsReady') && main.includes('overlay:restore') && renderer.includes('receivedSettings'),
  lockedFullWindowPassthrough: main.includes('setIgnoreMouseEvents(value, { forward: true })') && main.includes('overlay:movable-changed'),
  finalBoundsFlush: main.includes('Final overlay bounds save failed:') && main.includes('session.flushStorageData()'),
  lockedOverlayRecovery: main.includes('function recoverOverlayControls()') && main.includes('function sampleTransparentHover(') && main.includes('CommandOrControl+Alt+U') && renderer.includes('解锁并显示控制栏'),
}
console.log(JSON.stringify({ directory, expectedVersion, packagedVersion: packaged.version, checks,
  archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }, null, 2))
if (Object.values(checks).some(value => !value)) process.exitCode = 1
