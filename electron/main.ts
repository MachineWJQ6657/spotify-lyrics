import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import path from 'node:path'
import { appendFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SpotifyRateLimitError, SpotifyService } from './spotify'
import { fetchLyrics, searchLyrics, timedLyricsStats } from './lyrics-provider'
import { romanizeLines } from './romanizer'
import type { LocalSpotifyService } from './local-spotify'
import { WindowBoundsStore, type StoredWindowBounds } from './store'
import { enforceWindowsToolWindow, type ToolWindowStyleResult } from './windows-tool-window'
import { TransportGate, type TransportBackend } from './transport-gate'
import { PlaybackRequestGate } from './playback-request-gate'
import { PlaybackRefreshGate } from './playback-refresh-gate'
import { PlaybackDiagnostics } from './playback-diagnostics'
import { DiagnosticExporter } from './diagnostic-export'
import { sanitizeLyricDiagnosticContext } from '../src/lib/sync-diagnostics'
import { createQaChecks } from './qa-checks'
import { overlayShape } from './overlay-shape'
import { AcousticClock, type AcousticObservation } from './audio-sync/acoustic-clock'

// All three windows load the same trusted local renderer. Reusing one renderer
// process removes most of the per-window Chromium overhead while preserving GPU
// acceleration for smooth lyric animation.
app.commandLine.appendSwitch('process-per-site')
if (process.platform === 'win32') app.setAppUserModelId('studio.syllable.desktop')

const directory = path.dirname(fileURLToPath(import.meta.url))
const spotify = new SpotifyService()
const acousticClock = new AcousticClock()
let audioCaptureGrantUntil = 0
let localSpotify: LocalSpotifyService | null = null
let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayControlsWindow: BrowserWindow | null = null
let overlayControlsHideTimer: NodeJS.Timeout | null = null
let overlayHovered = false
let overlayControlsHovered = false
let overlayDragSettleTimer: NodeJS.Timeout | null = null
let overlayControlsRaisePending = false
let overlayControlsSuppressedUntil = 0
let overlayControlsAnchor: Electron.Point | null = null
let pollTimer: NodeJS.Timeout | null = null
let lastPlayback: Awaited<ReturnType<typeof spotify.getPlayback>> = null
let tray: Tray | null = null
let quitting = false
let boundsSaveTimer: NodeJS.Timeout | null = null
let boundsPublishTimer: NodeJS.Timeout | null = null
let pendingBoundsShapeUpdate = false
let applyingOverlayBounds = false
const transportGate = new TransportGate()
const playbackRequests = new PlaybackRequestGate()
const playbackRefreshes = new PlaybackRefreshGate()
const playbackDiagnostics = new PlaybackDiagnostics()
const diagnosticExporter = new DiagnosticExporter()
let overlayClickThrough = false
let overlayMouseIgnored = false
let overlayMovable = true
let overlayPointerDrag: { cursor: Electron.Point; bounds: Electron.Rectangle; fromControls: boolean; controlsWereVisible: boolean } | null = null
let lastOverlayDragEndedAt = 0
let overlayHitRegions: Array<{ x: number; y: number; width: number; height: number }> = []
let lastBroadcastCoverTrackId = ''
const windowBoundsStore = new WindowBoundsStore()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const qaCapturePath = process.argv.find(value => value.startsWith('--syllable-qa-capture='))?.slice('--syllable-qa-capture='.length)
const qaView = process.argv.find(value => value.startsWith('--syllable-qa-view='))?.slice('--syllable-qa-view='.length)
const qaLogPath = process.argv.find(value => value.startsWith('--syllable-qa-log='))?.slice('--syllable-qa-log='.length)
const forceOverlayForQa = process.argv.includes('--syllable-force-overlay')
const secondaryMonitorQa = process.argv.includes('--syllable-secondary-test') || process.env.SYLLABLE_SECONDARY_TEST === '1'
const disableOverlayShapeForQa = process.argv.includes('--syllable-disable-overlay-shape')
const qaLog = (message: string) => { if (qaLogPath) void appendFile(qaLogPath, `${new Date().toISOString()} ${message}\n`, 'utf8') }
const loggedToolWindowStyles = new Set<string>()

function formatHexStyle(style: number | undefined) {
  return style === undefined ? 'unknown' : `0x${style.toString(16).padStart(8, '0')}`
}

function logToolWindowStyleOnce(label: string, result: ToolWindowStyleResult) {
  if (!qaLogPath || loggedToolWindowStyles.has(label)) return
  qaLog(`native tool window ${label}: ok=${result.ok}; changed=${result.changed}; before=${formatHexStyle(result.before)}; after=${formatHexStyle(result.after)}${result.error ? `; error=${result.error}` : ''}`)
  // A failed early attempt can recover after Chromium finishes creating the
  // native window, so only suppress later diagnostics after a verified result.
  if (result.ok) loggedToolWindowStyles.add(label)
}

function applyToolWindowStyle(window: BrowserWindow, label: string) {
  if (window.isDestroyed()) return
  window.setSkipTaskbar(true)
  logToolWindowStyleOnce(label, enforceWindowsToolWindow(window))
}

function bindToolWindowStyle(window: BrowserWindow, label: string) {
  const apply = () => applyToolWindowStyle(window, label)
  apply()
  window.on('ready-to-show', apply)
  window.on('show', apply)
  window.webContents.on('did-finish-load', apply)
}

function rendererUrl(route = '') {
  if (process.env.ELECTRON_RENDERER_URL) return `${process.env.ELECTRON_RENDERER_URL}${route}`
  return `${pathToFileURL(path.join(directory, '../renderer/index.html')).toString()}${route}`
}

function controlsRendererUrl() {
  return rendererUrl('#/overlay-controls')
}

function appIcon() {
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(directory, '../../build/icon.ico')
  return nativeImage.createFromPath(iconPath)
}

function defaultOverlayBounds(width = 820, height = 220, display = secondaryMonitorQa ? secondaryDisplay() : screen.getPrimaryDisplay()): StoredWindowBounds {
  const area = display.workArea
  const safeWidth = Math.min(width, area.width)
  const safeHeight = Math.min(height, area.height)
  return { width: safeWidth, height: safeHeight, x: Math.round(area.x + (area.width - safeWidth) / 2), y: area.y + area.height - safeHeight - 40 }
}

function visibleOverlayBounds(bounds: StoredWindowBounds) {
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(Math.max(480, bounds.width), area.width)
  const height = Math.min(Math.max(140, bounds.height), area.height)
  return {
    width, height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
  }
}

function publishOverlayVisibility(visible: boolean) {
  for (const window of [mainWindow, overlayWindow, overlayControlsWindow]) if (window && !window.isDestroyed()) window.webContents.send('overlay:visibility-changed', visible)
}

const overlayControlsSize = { width: 262, height: 40 }

function secondaryDisplay() {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().find(display => display.id !== primary.id) ?? primary
}

function revealMainWindow(preferredDisplay: 'preserve' | 'cursor' | 'overlay' = 'preserve') {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (preferredDisplay !== 'preserve') {
    const display = preferredDisplay === 'overlay' && overlayWindow && !overlayWindow.isDestroyed()
      ? screen.getDisplayMatching(overlayWindow.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    const current = mainWindow.getBounds()
    const width = Math.min(current.width, area.width)
    const height = Math.min(current.height, area.height)
    mainWindow.setBounds({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height
    })
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  return true
}

function overlayControlsTarget(overlay: Electron.Rectangle) {
  const padding = 8
  const relativeX = overlayControlsAnchor?.x ?? 20
  const area = screen.getDisplayMatching(overlay).workArea
  const desiredX = overlay.x + relativeX
  const aboveY = overlay.y - overlayControlsSize.height - padding
  const belowY = overlay.y + overlay.height + padding
  const desiredY = aboveY >= area.y + padding
    ? aboveY
    : belowY + overlayControlsSize.height <= area.y + area.height - padding
      ? belowY
      : overlay.y + padding
  return {
    x: Math.max(area.x + padding, Math.min(Math.round(desiredX), area.x + area.width - overlayControlsSize.width - padding)),
    y: Math.round(desiredY),
    ...overlayControlsSize
  }
}

function raiseOverlayControls() {
  if (!overlayControlsWindow || overlayControlsWindow.isDestroyed() || !overlayControlsWindow.isVisible() || overlayControlsRaisePending) return
  overlayControlsRaisePending = true
  overlayControlsWindow.moveTop()
  // setPosition() may finish its native Z-order work after Electron emits the
  // move event. Re-raise once on the next task to keep controls above lyrics.
  setTimeout(() => {
    overlayControlsRaisePending = false
    if (overlayControlsWindow && !overlayControlsWindow.isDestroyed() && overlayControlsWindow.isVisible()) overlayControlsWindow.moveTop()
  }, 0)
}

function startOverlayControlsVisibilityTracking() {
  if (overlayControlsHideTimer) clearTimeout(overlayControlsHideTimer)
  overlayControlsHideTimer = null
  overlayHovered = false
  overlayControlsHovered = false
}

function stopOverlayControlsVisibilityTracking() {
  if (overlayControlsHideTimer) clearTimeout(overlayControlsHideTimer)
  overlayControlsHideTimer = null
  overlayHovered = false
  overlayControlsHovered = false
  overlayControlsWindow?.hide()
}

function updateOverlayControlsHover(sender: Electron.WebContents, hovered: boolean) {
  if (sender === overlayWindow?.webContents) overlayHovered = hovered
  else if (sender === overlayControlsWindow?.webContents) overlayControlsHovered = hovered
  else return
  if (overlayControlsHideTimer) clearTimeout(overlayControlsHideTimer)
  overlayControlsHideTimer = null
  if (!overlayWindow?.isVisible() || !overlayControlsWindow || overlayControlsWindow.isDestroyed()) return
  if (overlayHovered || overlayControlsHovered) {
    if (overlayPointerDrag || Date.now() < overlayControlsSuppressedUntil) return
    if (!overlayControlsWindow.isVisible()) {
      syncOverlayControlsBounds()
      overlayControlsWindow.showInactive()
      raiseOverlayControls()
      qaLog(`overlay controls shown: ${sender === overlayWindow.webContents ? 'lyrics' : 'controls'}`)
    }
    return
  }
  // The pill lives in a separate HWND with a small visual gap above the lyric
  // text. Keep it alive long enough for the pointer to cross that gap, then
  // hide it without a permanent 8 Hz global cursor poll in the main process.
  overlayControlsHideTimer = setTimeout(() => {
    overlayControlsHideTimer = null
    if (!overlayHovered && !overlayControlsHovered && !overlayPointerDrag) overlayControlsWindow?.hide()
  }, 600)
}

function suppressOverlayControls(durationMs = 180) {
  overlayControlsSuppressedUntil = Math.max(overlayControlsSuppressedUntil, Date.now() + durationMs)
  if (!overlayPointerDrag) overlayControlsWindow?.hide()
}

function syncOverlayControlsBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayControlsWindow || overlayControlsWindow.isDestroyed()) return
  const target = overlayControlsTarget(overlayWindow.getBounds())
  const current = overlayControlsWindow.getBounds()
  let changed = false
  if (current.x !== target.x || current.y !== target.y) {
    // setPosition() alone repeatedly rescales a transparent child window on
    // mixed-DPI Windows. Supplying the logical size in the same native update
    // makes each move idempotent instead of growing by one pixel per anchor.
    overlayControlsWindow.setBounds(target, false)
    changed = true
  }
  if (changed) raiseOverlayControls()
  if (changed) qaLog(`controls anchored: ${JSON.stringify(overlayControlsWindow.getBounds())}`)
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  const current = overlayWindow.getBounds()
  const visible = visibleOverlayBounds(current)
  if (current.x !== visible.x || current.y !== visible.y) overlayWindow.setPosition(visible.x, visible.y)
  const positioned = overlayWindow.getBounds()
  if (positioned.width !== visible.width || positioned.height !== visible.height) setExactOverlaySize(visible.width, visible.height)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  applyToolWindowStyle(overlayWindow, 'overlay')
  // A transparent window opened with showInactive() can be hit-tested by
  // Windows without Chromium receiving the first pointer sequence. Keep the
  // overlay focusable and show it normally; subsequent clicks then reach the
  // toolbar reliably. This only activates when the overlay is explicitly
  // shown, never during playback polling.
  overlayWindow.setFocusable(true)
  overlayWindow.setOpacity(1)
  overlayWindow.showInactive()
  applyToolWindowStyle(overlayWindow, 'overlay')
  startOverlayMouseTracking()
  publishOverlayBounds()
  syncOverlayControlsBounds()
  startOverlayControlsVisibilityTracking()
  publishOverlayVisibility(true)
  qaLog(`overlay shown: ${JSON.stringify(overlayWindow.getBounds())}`)
  return true
}

function hideOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  overlayPointerDrag = null
  if (overlayDragSettleTimer) clearTimeout(overlayDragSettleTimer)
  overlayDragSettleTimer = null
  overlayControlsWindow?.setOpacity(1)
  overlayWindow.hide()
  stopOverlayControlsVisibilityTracking()
  stopOverlayMouseTracking()
  publishOverlayVisibility(false)
  qaLog('overlay hidden')
  return true
}

function setOverlayClickThrough(value: boolean) {
  overlayClickThrough = value
  qaLog(`overlay click-through=${value}`)
  applyOverlayShape()
  // Windows uses a shaped HWND: the transparent interior falls through while
  // its thin native resize border stays available. Other platforms use the
  // conventional whole-window mouse-ignore behavior.
  applyOverlayMouseIgnore(process.platform === 'win32' ? false : value)
  for (const window of [mainWindow, overlayWindow, overlayControlsWindow]) if (window && !window.isDestroyed()) window.webContents.send('overlay:click-through-changed', value)
  return value
}

function applyOverlayMouseIgnore(value: boolean) {
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayMouseIgnored === value) return
  overlayMouseIgnored = value
  overlayWindow.setIgnoreMouseEvents(value)
  qaLog(`overlay mouse ignored=${value}; regions=${overlayHitRegions.length}`)
}

function applyOverlayShape() {
  if (!overlayWindow || overlayWindow.isDestroyed() || process.platform !== 'win32') return
  if (disableOverlayShapeForQa) { overlayWindow.setShape([]); return }
  const bounds = overlayWindow.getBounds()
  overlayWindow.setShape(overlayShape(bounds.width, bounds.height, overlayHitRegions, overlayClickThrough))
}

function startOverlayMouseTracking() {
  applyOverlayShape()
  applyOverlayMouseIgnore(process.platform === 'win32' ? false : overlayClickThrough)
}

function stopOverlayMouseTracking() {
  applyOverlayMouseIgnore(false)
}

function publishOverlayBounds(updateShape = true) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const bounds = overlayWindow.getBounds()
  if (updateShape && !overlayDragSettleTimer) applyOverlayShape()
  if (!overlayPointerDrag && Date.now() >= overlayControlsSuppressedUntil) syncOverlayControlsBounds()
  overlayWindow.webContents.send('overlay:bounds-changed', bounds)
  mainWindow?.webContents.send('overlay:bounds-changed', bounds)
  if (applyingOverlayBounds) return
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
  boundsSaveTimer = setTimeout(() => void windowBoundsStore.set(bounds), 220)
}

function setExactOverlaySize(width: number, height: number, animate = false) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  let requestedWidth = Math.round(width)
  let requestedHeight = Math.round(height)
  // Electron/Windows can round a requested DIP size one pixel upward at 150%
  // scale. Feed the measured error back a few times so loading or moving the
  // window never accumulates one extra pixel per run.
  for (let attempt = 0; attempt < 3; attempt++) {
    overlayWindow.setSize(requestedWidth, requestedHeight, animate && attempt === 0)
    const actual = overlayWindow.getBounds()
    const widthError = actual.width - width
    const heightError = actual.height - height
    if (!widthError && !heightError) break
    requestedWidth = Math.max(480, requestedWidth - widthError)
    requestedHeight = Math.max(140, requestedHeight - heightError)
  }
}

function queueOverlayBounds(updateShape = true) {
  // A custom pointer drag publishes its final bounds on release. Broadcasting
  // every native move event makes all renderer contexts wake up and can force
  // transparent-window composition work even though width/height did not
  // change.
  if (overlayPointerDrag && !updateShape) return
  pendingBoundsShapeUpdate ||= updateShape
  if (boundsPublishTimer) return
  boundsPublishTimer = setTimeout(() => {
    boundsPublishTimer = null
    const shouldUpdateShape = pendingBoundsShapeUpdate
    pendingBoundsShapeUpdate = false
    publishOverlayBounds(shouldUpdateShape)
  }, 16)
}

async function applyOverlayBounds(bounds: StoredWindowBounds, animate = false) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return bounds
  applyingOverlayBounds = true
  try {
    // Moving a window between displays with different DPI in one setBounds()
    // call lets Windows rescale its size (for example 1280 -> 1707). Let the
    // DPI transition finish first, then re-assert the saved logical size.
    overlayWindow.setPosition(bounds.x, bounds.y, animate)
    await new Promise(resolve => setTimeout(resolve, 100))
    if (!overlayWindow || overlayWindow.isDestroyed()) return bounds
    setExactOverlaySize(bounds.width, bounds.height, animate)
    await new Promise(resolve => setTimeout(resolve, 40))
    return overlayWindow.getBounds()
  } finally {
    applyingOverlayBounds = false
    publishOverlayBounds()
  }
}

function createWindows() {
  const testArea = secondaryMonitorQa ? secondaryDisplay().workArea : null
  const mainWidth = testArea ? Math.min(1120, testArea.width) : 1120
  const mainHeight = testArea ? Math.min(720, testArea.height) : 720
  mainWindow = new BrowserWindow({
    width: mainWidth, height: mainHeight,
    ...(testArea ? {
      x: Math.round(testArea.x + (testArea.width - mainWidth) / 2),
      y: Math.round(testArea.y + (testArea.height - mainHeight) / 2)
    } : {}),
    minWidth: 1024, minHeight: 680, frame: false,
    backgroundColor: '#000000', titleBarStyle: 'hidden', icon: appIcon(),
    webPreferences: { preload: path.join(directory, '../preload/preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: true }
  })
  void mainWindow.loadURL(rendererUrl())
  mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    // A short, one-use grant from the visible main renderer. Auxiliary windows
    // cannot start capture. This prototype reads system output, never a mic.
    if (!mainWindow || request.frame !== mainWindow.webContents.mainFrame || Date.now() > audioCaptureGrantUntil) {
      callback({}); return
    }
    audioCaptureGrantUntil = 0
    void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(sources => {
        const source = sources.find(item => item.display_id === String(secondaryDisplay().id)) ?? sources[0]
        callback(source ? { video: source, audio: 'loopback' } : {})
      }).catch(() => callback({}))
  })
  mainWindow.on('close', event => {
    if (quitting) return
    event.preventDefault()
    // Keep an ordinary taskbar entry so the client never becomes impossible
    // to find while its lyrics overlay continues running.
    mainWindow?.minimize()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' } })
  if (qaCapturePath) {
    const qaWatchdog = setTimeout(() => {
      qaLog(`qa watchdog forced exit: view=${qaView ?? 'main'}`)
      quitting = true
      app.exit(2)
    }, 20_000)
    setTimeout(async () => {
      if (!mainWindow) return
      const checks = createQaChecks(qaView === 'overlay-controls'
        ? ['hover', 'leave', 'open', 'close', 'reopen']
        : qaView === 'overlay-drag-open-guard' ? ['guarded', 'deliberate']
        : qaView === 'audio-sync' ? ['panel', 'off', 'controls', 'visible'] : [])
      if (qaView === 'audio-sync') {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          [...document.querySelectorAll('.nav-item')].find(item => item.textContent === '偏好设置')?.click();
          await new Promise(resolve => setTimeout(resolve, 200));
          const panel = document.querySelector('.audio-sync-panel');
          panel?.scrollIntoView({ block: 'end' });
          await new Promise(resolve => setTimeout(resolve, 300));
          const buttons = panel?.querySelectorAll('button');
          const rect = panel?.getBoundingClientRect();
          const viewport = document.querySelector('.content-page')?.getBoundingClientRect();
          return { panel: Boolean(panel?.textContent.includes('当前阶段不支持无参照校准')),
            off: Boolean(panel?.querySelector('[role="status"]')?.textContent.includes('未启用')),
            controls: buttons?.length === 3 && buttons[1].disabled && buttons[2].disabled,
            visible: Boolean(rect && viewport && rect.top >= viewport.top && rect.bottom <= viewport.bottom + 1) };
        })()`)
        for (const name of ['panel', 'off', 'controls', 'visible']) checks.record(name, result?.[name] === true)
        qaLog(`audio sync UI: ${JSON.stringify(result)}`)
      }
      if (qaView === 'render-isolation') {
        const playingAtStart = Boolean(lastPlayback?.isPlaying)
        await mainWindow.webContents.executeJavaScript('window.__syllableRenderProbe = {}')
        await new Promise(resolve => setTimeout(resolve, 2400))
        const counts = await mainWindow.webContents.executeJavaScript('JSON.stringify(window.__syllableRenderProbe)')
        await mainWindow.webContents.executeJavaScript('delete window.__syllableRenderProbe')
        const renders = JSON.parse(counts) as Record<string, number>
        const passed = playingAtStart && Boolean(lastPlayback?.isPlaying)
          && (renders.lyrics ?? 0) >= 8 && (renders.player ?? 0) >= 8
          && (renders.shell ?? 0) < Math.min(renders.lyrics, renders.player) / 2
        qaLog(`render isolation: ${JSON.stringify({ passed, playingAtStart, renders })}`)
        if (!passed) process.exitCode = 1
      }
      if (qaView === 'editor') {
        await mainWindow.webContents.executeJavaScript(`document.querySelector('[title="搜索、编辑与校时"]')?.click()`)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      if (qaView === 'help') {
        await mainWindow.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(button => button.textContent?.includes('帮助与诊断'))?.click()`)
        await new Promise(resolve => setTimeout(resolve, 350))
      }
      if (qaView === 'controls') {
        const wasPlaying = lastPlayback?.isPlaying ?? false
        qaLog(`control test start: ${wasPlaying ? 'playing' : 'paused'}`)
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.play-button')?.click()`)
        await new Promise(resolve => setTimeout(resolve, 1800))
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.play-button')?.click()`)
        await new Promise(resolve => setTimeout(resolve, 1800))
        qaLog('control test restored')
      }
      if (qaView === 'skip-once' && localSpotify?.hasTrack()) {
        const initialTrack = localSpotify.current()?.track
        const initialWasPlaying = localSpotify.current()?.isPlaying ?? false
        const initialPositionMs = localSpotify.current()?.positionMs ?? 0
        qaLog(`skip test initial: ${initialTrack?.artist} - ${initialTrack?.name}`)
        await localSpotify.control('next')
        const nextDeadline = Date.now() + 7000
        let nextTrack = localSpotify.current()?.track
        while (Date.now() < nextDeadline && (!nextTrack?.id || nextTrack.id === initialTrack?.id)) {
          await new Promise(resolve => setTimeout(resolve, 150))
          nextTrack = localSpotify.current()?.track
        }
        qaLog(`skip test next: ${nextTrack?.artist} - ${nextTrack?.name}`)
        if (nextTrack?.id && nextTrack.id !== initialTrack?.id) {
          await localSpotify.control('previous')
          const restoreDeadline = Date.now() + 7000
          while (Date.now() < restoreDeadline && localSpotify.current()?.track?.id !== initialTrack?.id) await new Promise(resolve => setTimeout(resolve, 150))
          const restoredTrack = localSpotify.current()?.track
          qaLog(`skip test restored: ${restoredTrack?.artist} - ${restoredTrack?.name}`)
          if (restoredTrack?.id === initialTrack?.id) await localSpotify.seek(initialPositionMs)
          if (!initialWasPlaying) await localSpotify.control('pause')
        } else qaLog('skip test aborted: Spotify did not publish a replacement track before timeout')
      }
      if (qaView === 'reopen') {
        mainWindow.close()
        await new Promise(resolve => setTimeout(resolve, 350))
        qaLog(`close-to-taskbar: minimized=${mainWindow.isMinimized()}, destroyed=${mainWindow.isDestroyed()}`)
        revealMainWindow()
        await new Promise(resolve => setTimeout(resolve, 350))
        qaLog(`taskbar-reopen: visible=${mainWindow.isVisible()}, minimized=${mainWindow.isMinimized()}, destroyed=${mainWindow.isDestroyed()}`)
      }
      if (qaView === 'overlay-sync') {
        await mainWindow.webContents.executeJavaScript(`[...document.querySelectorAll('.language-grid button')].find(button => button.textContent?.includes('中文'))?.click()`)
        await new Promise(resolve => setTimeout(resolve, 350))
      }
      if (qaView === 'overlay-custom') {
        await mainWindow.webContents.executeJavaScript(`
          [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '宽屏')?.click();
          document.querySelector('.position-presets button:nth-child(2)')?.click();
          [...document.querySelectorAll('button')].find(button => button.textContent?.includes('清晰描边'))?.click();
          const background = document.querySelector('button[aria-label="显示悬浮窗背景"]');
          if (background?.getAttribute('aria-pressed') === 'true') background.click();
        `)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      if (qaView === 'overlay-hit-regions') {
        if (!overlayWindow) process.exitCode = 1
        else {
          const before = overlayHitRegions.map(region => ({ ...region }))
          const mutation = await overlayWindow.webContents.executeJavaScript(`(() => {
            const primary = document.querySelector('.overlay-primary');
            const surface = document.querySelector('.overlay-surface');
            if (!primary || !surface) return null;
            const oldStyle = primary.getAttribute('style');
            const surfaceWidth = surface.getBoundingClientRect().width;
            const surfaceHeight = surface.getBoundingClientRect().height;
            primary.style.height = primary.getBoundingClientRect().height + 'px';
            primary.style.overflow = 'hidden';
            primary.style.width = '180px';
            return { oldStyle, surfaceWidth, surfaceHeight };
          })()`)
          await new Promise(resolve => setTimeout(resolve, 350))
          const surfaceWidth = await overlayWindow.webContents.executeJavaScript(`document.querySelector('.overlay-surface')?.getBoundingClientRect().width`)
          const surfaceHeight = await overlayWindow.webContents.executeJavaScript(`document.querySelector('.overlay-surface')?.getBoundingClientRect().height`)
          const after = overlayHitRegions.map(region => ({ ...region }))
          const passed = Boolean(mutation && before[0] && after[0]
            && Math.abs(surfaceWidth - mutation.surfaceWidth) < 1
            && Math.abs(surfaceHeight - mutation.surfaceHeight) < 1
            && Math.abs(after[0].width - 180) < 2 && Math.abs(before[0].width - after[0].width) > 20)
          qaLog(`overlay hit-region resize: ${JSON.stringify({ passed, before, after, surfaceWidth, surfaceHeight })}`)
          if (!passed) process.exitCode = 1
          if (mutation) await overlayWindow.webContents.executeJavaScript(`(() => {
            const primary = document.querySelector('.overlay-primary');
            const oldStyle = ${JSON.stringify(mutation.oldStyle)};
            if (primary) { if (oldStyle == null) primary.removeAttribute('style'); else primary.setAttribute('style', oldStyle); }
          })()`)
        }
      }
      if (qaView === 'overlay-controls' && overlayWindow && overlayControlsWindow) {
        showOverlay()
        syncOverlayControlsBounds()
        await overlayWindow.webContents.executeJavaScript(`document.querySelector('.overlay-shell')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))`)
        await new Promise(resolve => setTimeout(resolve, 180))
        qaLog(`overlay hover control: visible=${overlayControlsWindow.isVisible()}`)
        checks.record('hover', overlayControlsWindow.isVisible())
        await overlayWindow.webContents.executeJavaScript(`document.querySelector('.overlay-shell')?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))`)
        await new Promise(resolve => setTimeout(resolve, 700))
        qaLog(`overlay leave control: hidden=${!overlayControlsWindow.isVisible()}`)
        checks.record('leave', !overlayControlsWindow.isVisible())
        await overlayWindow.webContents.executeJavaScript(`document.querySelector('.overlay-shell')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))`)
        await new Promise(resolve => setTimeout(resolve, 180))
        const opened = await overlayControlsWindow.webContents.executeJavaScript(`(() => { const button = document.querySelector('button[aria-label="打开 Syllable 客户端"]'); button?.click(); return Boolean(button) })()`)
        await new Promise(resolve => setTimeout(resolve, 220))
        qaLog(`overlay open-client control: found=${opened}, visible=${mainWindow.isVisible()}, minimized=${mainWindow.isMinimized()}, bounds=${JSON.stringify(mainWindow.getBounds())}`)
        checks.record('open', Boolean(opened) && mainWindow.isVisible() && !mainWindow.isMinimized())
        overlayControlsWindow.showInactive()
        const closed = await overlayControlsWindow.webContents.executeJavaScript(`(() => { const button = document.querySelector('button[aria-label="关闭桌面歌词"]'); button?.click(); return Boolean(button) })()`)
        await new Promise(resolve => setTimeout(resolve, 250))
        qaLog(`overlay close control: found=${closed}, hidden=${!overlayWindow.isVisible()}`)
        checks.record('close', Boolean(closed) && !overlayWindow.isVisible())
        showOverlay()
        await new Promise(resolve => setTimeout(resolve, 250))
        qaLog(`overlay reopen after close: visible=${overlayWindow.isVisible()}`)
        checks.record('reopen', overlayWindow.isVisible())
      }
      if (qaView === 'overlay-drag-open-guard' && overlayWindow && overlayControlsWindow) {
        showOverlay()
        syncOverlayControlsBounds()
        overlayControlsWindow.showInactive()
        mainWindow.minimize()
        await new Promise(resolve => setTimeout(resolve, 220))
        const immediate = await overlayControlsWindow.webContents.executeJavaScript(`(async () => {
          window.syllable.overlay.beginMove();
          window.syllable.overlay.endMove();
          const button = document.querySelector('button[aria-label="打开 Syllable 客户端"]');
          button?.click();
          await new Promise(resolve => setTimeout(resolve, 180));
          return Boolean(button);
        })()`)
        qaLog(`drag open guard immediate: invoked=${immediate}; minimized=${mainWindow.isMinimized()}; visible=${mainWindow.isVisible()}`)
        checks.record('guarded', Boolean(immediate) && mainWindow.isMinimized())
        await new Promise(resolve => setTimeout(resolve, 700))
        overlayControlsWindow.showInactive()
        await overlayControlsWindow.webContents.executeJavaScript(`document.querySelector('button[aria-label="打开 Syllable 客户端"]')?.click()`)
        await new Promise(resolve => setTimeout(resolve, 180))
        qaLog(`drag open guard deliberate: minimized=${mainWindow.isMinimized()}; visible=${mainWindow.isVisible()}`)
        checks.record('deliberate', mainWindow.isVisible() && !mainWindow.isMinimized())
      }
      if (qaView === 'overlay-drag-performance' && overlayWindow && overlayControlsWindow) {
        showOverlay()
        syncOverlayControlsBounds()
        overlayControlsWindow.showInactive()
        await new Promise(resolve => setTimeout(resolve, 180))
        const initial = overlayWindow.getBounds()
        await overlayControlsWindow.webContents.executeJavaScript(`window.syllable.overlay.beginMove()`)
        await new Promise(resolve => setTimeout(resolve, 80))
        qaLog(`drag performance start: ${JSON.stringify(initial)}`)
        for (let step = 1; step <= 18; step += 1) {
          overlayWindow.setPosition(initial.x + step * 5, initial.y - step * 2, false)
          await new Promise(resolve => setTimeout(resolve, 16))
        }
        await overlayControlsWindow.webContents.executeJavaScript(`window.syllable.overlay.endMove()`)
        await new Promise(resolve => setTimeout(resolve, 220))
        qaLog(`drag performance end: ${JSON.stringify(overlayWindow.getBounds())}`)
        await applyOverlayBounds(initial)
      }
      if (qaView === 'font-metrics') {
        const metrics = await mainWindow.webContents.executeJavaScript(`(async () => {
          await document.fonts.ready;
          const test = document.createElement('div');
          test.className = 'lyric-primary japanese-grid';
          test.style.cssText = 'position:fixed;left:-10000px;top:0;font-size:64px;white-space:nowrap';
          for (const character of [...'晴る会行']) { const span = document.createElement('span'); span.textContent = character; test.append(span) }
          document.body.append(test);
          const byWeight = [500, 600, 700, 800].map(weight => {
            test.style.fontWeight = String(weight);
            return { weight, computedWeight: getComputedStyle(test).fontWeight, widths: [...test.children].map(node => Number(node.getBoundingClientRect().width.toFixed(3))) };
          });
          const result = { family: getComputedStyle(test).fontFamily, byWeight, yuGothicReady: document.fonts.check("700 64px 'Yu Gothic'") };
          test.remove(); return result;
        })()`)
        qaLog(`font metrics: ${JSON.stringify(metrics)}`)
      }
      if (qaView === 'lyrics-scroll') {
        const scrollResult = await mainWindow.webContents.executeJavaScript(`(async () => {
          const viewport = document.querySelector('.lyrics-viewport');
          if (!viewport) return { found: false };
          const initial = viewport.scrollTop;
          viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 180 }));
          viewport.scrollTop = initial + 180;
          // A minimized/background BrowserWindow may suspend requestAnimationFrame.
          // Keep QA bounded so a renderer scheduling policy cannot strand the app.
          await new Promise(resolve => setTimeout(resolve, 80));
          const button = document.querySelector('.lyrics-follow-button');
          const browsed = viewport.scrollTop;
          button?.click();
          // The click handler centers synchronously. Capture that exact result
          // before a playing song can naturally advance to the next row and
          // begin its separate smooth-follow animation.
          const activeAfterClick = viewport.querySelector('.lyric-group.active');
          const targetAtClick = activeAfterClick ? Math.max(0, activeAfterClick.offsetTop + activeAfterClick.offsetHeight / 2 - viewport.clientHeight * .44) : 0;
          const restoredAtClick = viewport.scrollTop;
          await new Promise(resolve => setTimeout(resolve, 80));
          const followButtonHidden = !document.querySelector('.lyrics-follow-button');
          return { found: true, initial, browsed, followButton: Boolean(button), followButtonHidden, targetAtClick, restoredAtClick,
            passed: browsed > initial && Boolean(button) && followButtonHidden && Math.abs(restoredAtClick - targetAtClick) <= 2 };
        })()`)
        qaLog(`lyrics scroll: ${JSON.stringify(scrollResult)}`)
        if (!scrollResult?.passed) process.exitCode = 1
      }
      if (qaView === 'overlay-controls' && overlayControlsWindow) {
        syncOverlayControlsBounds()
        overlayControlsWindow.showInactive()
        await new Promise(resolve => setTimeout(resolve, 180))
        qaLog(`overlay controls capture: visible=${overlayControlsWindow.isVisible()}, bounds=${JSON.stringify(overlayControlsWindow.getBounds())}`)
        await writeFile(qaCapturePath, (await overlayControlsWindow.webContents.capturePage()).toPNG())
      } else if ((qaView === 'overlay' || qaView === 'overlay-sync' || qaView === 'overlay-custom' || qaView === 'overlay-drag-performance') && overlayWindow) {
        overlayWindow.showInactive()
        await new Promise(resolve => setTimeout(resolve, 450))
        qaLog(`overlay bounds: ${JSON.stringify(overlayWindow.getBounds())}`)
        await writeFile(qaCapturePath, (await overlayWindow.webContents.capturePage()).toPNG())
      } else await writeFile(qaCapturePath, (await mainWindow.webContents.capturePage()).toPNG())
      if (qaView === 'overlay-controls' || qaView === 'overlay-drag-open-guard' || qaView === 'audio-sync') {
        const result = checks.result()
        qaLog(`qa acceptance: ${JSON.stringify(result)}`)
        if (!result.passed) process.exitCode = 1
      }
      clearTimeout(qaWatchdog)
      quitting = true
      app.exit(typeof process.exitCode === 'number' ? process.exitCode : Number(process.exitCode) || 0)
    }, 7000)
  }

  const initialOverlayBounds = defaultOverlayBounds()
  overlayWindow = new BrowserWindow({
    ...initialOverlayBounds,
    minWidth: 480, minHeight: 140,
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: true, thickFrame: true, show: false, focusable: true, alwaysOnTop: true, skipTaskbar: true,
    hasShadow: false, webPreferences: { preload: path.join(directory, '../preload/preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: true }
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setBackgroundColor('#00000000')
  bindToolWindowStyle(overlayWindow, 'overlay')
  overlayWindow.on('move', () => queueOverlayBounds(false))
  overlayWindow.on('resize', () => {
    suppressOverlayControls()
    queueOverlayBounds(true)
  })
  void overlayWindow.loadURL(rendererUrl('#/overlay'))
  void windowBoundsStore.get().then(storedBounds => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    const bounds = secondaryMonitorQa
      ? defaultOverlayBounds(undefined, undefined, secondaryDisplay())
      : storedBounds
    if (bounds) void applyOverlayBounds(visibleOverlayBounds(bounds))
  })
  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  overlayWindow.webContents.on('console-message', (_details, _level, message) => {
    if (message.startsWith('[overlay-input]') || _level >= 2) qaLog(`overlay console[${_level}]: ${message}`)
  })
  overlayWindow.webContents.on('render-process-gone', (_event, details) => qaLog(`overlay renderer gone: ${details.reason} (${details.exitCode})`))
  overlayWindow.on('unresponsive', () => qaLog('overlay renderer unresponsive'))
  if (qaLogPath) overlayWindow.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return
      try {
        const diagnostic = await overlayWindow.webContents.executeJavaScript(`(() => {
          const root = document.querySelector('#root');
          const primary = document.querySelector('.overlay-primary');
          const shell = document.querySelector('.overlay-shell');
          const rect = primary?.getBoundingClientRect();
          return { hash: location.hash, rootChildren: root?.childElementCount ?? -1, shell: shell?.className ?? null, text: primary?.textContent ?? null, rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null, opacity: primary ? getComputedStyle(primary).opacity : null };
        })()`)
        qaLog(`overlay dom: ${JSON.stringify(diagnostic)}`)
      } catch (error) { qaLog(`overlay dom failed: ${error instanceof Error ? error.message : String(error)}`) }
    }, 3500)
  })

  overlayControlsWindow = new BrowserWindow({
    ...overlayControlsTarget(overlayWindow.getBounds()),
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, show: false,
    focusable: true, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, roundedCorners: true,
    webPreferences: { preload: path.join(directory, '../preload/preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: true }
  })
  overlayControlsWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayControlsWindow.setOpacity(1)
  overlayControlsWindow.setMenu(null)
  bindToolWindowStyle(overlayControlsWindow, 'overlay-controls')
  void overlayControlsWindow.loadURL(controlsRendererUrl())
  overlayControlsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

function toggleOverlay() {
  if (!overlayWindow) return
  if (overlayWindow.isVisible()) hideOverlay()
  else showOverlay()
}

function createTray() {
  const icon = appIcon()
  if (icon.isEmpty()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#1ed760"/><path d="M10 9v14m0-10 12-3v9" fill="none" stroke="#07150c" stroke-width="2.4" stroke-linecap="round"/><circle cx="7.5" cy="23" r="3" fill="#07150c"/><circle cx="19.5" cy="19" r="3" fill="#07150c"/></svg>`
    tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 16, height: 16 }))
  } else tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Syllable · 单击打开客户端')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Syllable', accelerator: 'Ctrl+Alt+S', click: () => revealMainWindow('cursor') },
    { label: '显示 / 隐藏桌面歌词', accelerator: 'Ctrl+Alt+L', click: toggleOverlay },
    { label: '切换鼠标穿透', accelerator: 'Ctrl+Alt+M', click: () => setOverlayClickThrough(!overlayClickThrough) },
    { label: '播放 / 暂停', click: () => { void executePlaybackCommand(lastPlayback?.isPlaying ? 'pause' : 'play').catch(() => undefined) } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('click', () => revealMainWindow('cursor'))
}

function withoutEmbeddedCover(value: typeof lastPlayback) {
  if (!value?.track?.coverUrl.startsWith('data:image')) return value
  return { ...value, track: { ...value.track, coverUrl: '' } }
}

function broadcast(value: unknown) {
  if (value === null || (value && typeof value === 'object' && 'track' in value)) {
    acousticClock.observePlayback(value as typeof lastPlayback)
    value = acousticClock.decorate(value as typeof lastPlayback)
  }
  let mainPayload = value
  let overlayPayload = value
  if (value && typeof value === 'object' && 'track' in value) {
    const playback = value as NonNullable<typeof lastPlayback>
    playbackDiagnostics.record(playback)
    const track = playback.track
    const pendingTransport = transportGate.pending()
    const observedBackend: TransportBackend = playback.playbackSource === 'local' ? 'local' : 'web'
    // Only the backend fixed at transaction start may complete its skip. A
    // temporary local-session gap must not be "completed" by an OAuth poll.
    if (!pendingTransport || pendingTransport.backend === observedBackend) {
      const released = transportGate.observeTrack(track?.id)
      if (!released && pendingTransport && track?.id && track.id !== pendingTransport.fromTrackId) {
        const settleDelayMs = 250
        if (settleDelayMs > 0) setTimeout(() => {
          const current = lastPlayback
          const currentBackend: TransportBackend = current?.playbackSource === 'local' ? 'local' : 'web'
          if (transportGate.pending()?.id === pendingTransport.id && currentBackend === pendingTransport.backend && current?.track?.id === track.id) transportGate.observeTrack(track.id)
        }, settleDelayMs)
      }
    } else transportGate.observeTrack(null)
    if (track?.coverUrl.startsWith('data:image')) {
      overlayPayload = withoutEmbeddedCover(playback)
      if (lastBroadcastCoverTrackId === track.id) mainPayload = overlayPayload
      else lastBroadcastCoverTrackId = track.id
    }
  } else if (value === null) {
    playbackDiagnostics.record(null)
    lastBroadcastCoverTrackId = ''
    transportGate.observeTrack(null)
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('playback:update', mainPayload)
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('playback:update', overlayPayload)
  if (overlayControlsWindow && !overlayControlsWindow.isDestroyed()) overlayControlsWindow.webContents.send('playback:update', overlayPayload)
}

interface PlaybackCommandResult {
  accepted: boolean
  action: 'play' | 'pause' | 'next' | 'previous' | 'seek-to-zero' | null
  pending: boolean
}

/** Single authority for every Syllable transport surface and backend. */
async function executePlaybackCommand(command: 'play' | 'pause' | 'next' | 'previous'): Promise<PlaybackCommandResult> {
  const result = await playbackRequests.run(() => {
    playbackRefreshes.invalidate()
    return executeSerializedPlaybackCommand(command)
  })
  if (!result.accepted) {
    qaLog(`transport ignored: ${command}; backend request still in flight`)
    return { accepted: false, action: null, pending: true }
  }
  return result.value
}

async function executeSerializedPlaybackCommand(command: 'play' | 'pause' | 'next' | 'previous'): Promise<PlaybackCommandResult> {
  const backend: TransportBackend = localSpotify?.hasTrack() ? 'local' : 'web'
  const service = backend === 'local' ? localSpotify : spotify
  if (!service) throw new Error('Spotify 本地控制服务尚未启动')
  if (command === 'next' || command === 'previous') {
    const now = Date.now()
    const transportSnapshot = backend === 'local' ? localSpotify?.current() ?? lastPlayback : lastPlayback
    const livePositionMs = transportSnapshot
      ? transportSnapshot.positionMs + (transportSnapshot.isPlaying ? Math.max(0, now - transportSnapshot.observedAtMs) : 0)
      : 0
    const decision = transportGate.begin({
      command,
      fromTrackId: transportSnapshot?.track?.id,
      backend,
      livePositionMs,
      startedAtMs: now
    })
    if (!decision.accepted) {
      qaLog(`transport ignored: ${command}; pending=${decision.pending.action}; from=${decision.pending.fromTrackId ?? 'none'}; backend=${decision.pending.backend}`)
      return { accepted: false, action: null, pending: true }
    }
    try {
      if (decision.action === 'seek-to-zero') await service.seek(0)
      else await service.control(decision.action)
    } catch (error) {
      // A native request timeout is ambiguous: Windows may have accepted the
      // command even if its response was lost. Retain the short transaction
      // guard in that case so a retry cannot skip a second track.
      if (!(error instanceof Error && /超时|timeout/i.test(error.message))) transportGate.release(decision.pending.id)
      throw error
    }
    if (decision.action === 'seek-to-zero' && lastPlayback?.track) {
      lastPlayback = { ...lastPlayback, positionMs: 0, observedAtMs: Date.now() }
      broadcast(lastPlayback)
    }
    qaLog(`transport accepted: ${command}; action=${decision.action}; from=${decision.pending.fromTrackId ?? 'none'}; backend=${backend}`)
    setTimeout(() => void refreshPlayback().catch(() => undefined), 180)
    return { accepted: true, action: decision.action, pending: decision.action !== 'seek-to-zero' }
  }
  if (transportGate.isPending()) {
    qaLog(`transport ignored: ${command}; skip transaction pending`)
    return { accepted: false, action: null, pending: true }
  }
  await service.control(command)
  setTimeout(() => void refreshPlayback().catch(() => undefined), 180)
  return { accepted: true, action: command, pending: false }
}

async function refreshPlayback() {
  const local = localSpotify?.current()
  if (local) {
    playbackRefreshes.invalidate()
    lastPlayback = local
    broadcast(local)
    return
  }
  await playbackRefreshes.refresh(() => spotify.getPlayback(), snapshot => {
    lastPlayback = snapshot
    broadcast(snapshot)
  })
}

async function poll() {
  let nextPollMs = lastPlayback?.isPlaying ? 1800 : lastPlayback?.track ? 4500 : 7000
  try {
    const local = localSpotify?.current()
    if (local) {
      playbackRefreshes.invalidate()
      if (lastPlayback?.playbackSource !== 'local') { lastPlayback = local; broadcast(local) }
      nextPollMs = 5000
    }
    else if (spotify.isConnected()) await refreshPlayback()
  }
  catch (error) {
    if (error instanceof SpotifyRateLimitError) nextPollMs = error.retryAfterMs
    broadcast({ error: error instanceof Error ? error.message : String(error) })
  } finally { pollTimer = setTimeout(() => void poll(), nextPollMs) }
}

if (!hasSingleInstanceLock) app.quit()
else app.on('second-instance', () => { revealMainWindow('cursor') })

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  qaLog(`startup secondary-test=${secondaryMonitorQa}; displays=${JSON.stringify(screen.getAllDisplays().map(display => ({ id: display.id, primary: display.id === screen.getPrimaryDisplay().id, workArea: display.workArea, scaleFactor: display.scaleFactor })))}`)
  ipcMain.handle('auth:status', () => ({ connected: spotify.isConnected(), localConnected: localSpotify?.hasTrack() ?? false }))
  ipcMain.handle('auth:login', async (_event, clientId: string) => { await spotify.login(clientId); return { connected: true } })
  ipcMain.handle('auth:logout', async () => { playbackRefreshes.invalidate(); await spotify.logout(); playbackRefreshes.invalidate(); lastPlayback = localSpotify?.current() ?? null; broadcast(lastPlayback); playbackDiagnostics.clear(); return { connected: false } })
  ipcMain.handle('playback:current', async event => {
    if (!lastPlayback) await refreshPlayback()
    const playback = acousticClock.decorate(lastPlayback)
    const auxiliary = event.sender === overlayWindow?.webContents || event.sender === overlayControlsWindow?.webContents
    return auxiliary ? withoutEmbeddedCover(playback) : playback
  })
  ipcMain.handle('playback:command', (_event, command: 'play' | 'pause' | 'next' | 'previous') => executePlaybackCommand(command))
  ipcMain.handle('audio-sync:prepare', event => {
    if (event.sender !== mainWindow?.webContents || !lastPlayback?.isPlaying) throw new Error('请先播放歌曲')
    audioCaptureGrantUntil = Date.now() + 10000
    return true
  })
  ipcMain.handle('audio-sync:clear', event => {
    if (event.sender !== mainWindow?.webContents) return false
    audioCaptureGrantUntil = 0
    acousticClock.clear()
    broadcast(lastPlayback)
    return true
  })
  ipcMain.handle('audio-sync:observation', (event, observation: AcousticObservation) => {
    if (event.sender !== mainWindow?.webContents) return 'rejected'
    const result = acousticClock.accept(observation)
    broadcast(lastPlayback)
    qaLog(`acoustic sync: ${result}; score=${Number(observation?.score).toFixed(3)}; rate=${observation?.rate}`)
    return result
  })
  ipcMain.handle('playback:export-diagnostics', async (event, lyricContext: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return false
    const report = { appVersion: app.getVersion(), ...playbackDiagnostics.report(), lyricContext: sanitizeLyricDiagnosticContext(lyricContext) }
    const owner = mainWindow
    return diagnosticExporter.save(report,
      () => dialog.showSaveDialog(owner, { defaultPath: 'Syllable-sync-diagnostics.json', filters: [{ name: '同步诊断 JSON', extensions: ['json'] }] }),
      (filePath, content) => writeFile(filePath, content, 'utf8'))
  })
  ipcMain.handle('playback:seek', async (_event, positionMs: number) => {
    acousticClock.clear()
    const result = await playbackRequests.run(async () => {
      if (transportGate.isPending()) throw new Error('Spotify 正在切换歌曲，请稍后再调整进度')
      playbackRefreshes.invalidate()
      if (lastPlayback?.playbackSource === 'local' && localSpotify) await localSpotify.seek(positionMs)
      else await spotify.seek(positionMs)
    })
    if (!result.accepted) throw new Error('Spotify 控制请求尚未完成，请稍后再调整进度')
    setTimeout(() => void refreshPlayback().catch(() => undefined), 180)
  })
  ipcMain.handle('lyrics:fetch', async (_event, track, options?: { bypassCache?: boolean }) => {
    const lyricsFetchStartedAt = Date.now()
    qaLog(`lyrics request: ${track?.artist ?? 'unknown'} - ${track?.name ?? 'unknown'}; spotifyDuration=${track?.durationMs ?? 0}; sourceDuration=${track?.sourceDurationMs ?? track?.durationMs ?? 0}`)
    const result = await fetchLyrics(track, await spotify.getAccessToken().catch(() => null), Boolean(options?.bypassCache))
    const lyricsDurationMs = track?.sourceDurationMs ?? track?.durationMs
    const stats = timedLyricsStats(result?.syncedLyrics, lyricsDurationMs)
    const durationRatio = result?.matchedDurationMs && lyricsDurationMs ? result.matchedDurationMs / lyricsDurationMs : 1
    qaLog(`lyrics: ${result?.source ?? 'not found'}; elapsed=${Date.now() - lyricsFetchStartedAt}ms; confidence=${result?.confidence ?? 0}; transient=${Boolean(result?.transient)}; spotifyDuration=${track?.durationMs ?? 0}; sourceDuration=${lyricsDurationMs ?? 0}; matchedDuration=${result?.matchedDurationMs ?? 0}; durationRatio=${durationRatio.toFixed(4)}; lines=${stats.lineCount}; last=${stats.lastMs}; extras=${result?.additionalTracks?.map(item => `${item.language}:${item.source}`).join(',') ?? 'none'}`)
    return result
  })
  ipcMain.handle('lyrics:search', (_event, query) => searchLyrics(query))
  ipcMain.handle('lyrics:romanize', (_event, lines: string[]) => romanizeLines(lines))
  ipcMain.handle('lyrics:export', async (_event, filename: string, content: string) => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: filename, filters: [{ name: 'LRC 歌词', extensions: ['lrc'] }] })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, 'utf8')
    return result.filePath
  })
  ipcMain.handle('overlay:show', showOverlay)
  ipcMain.handle('overlay:hide', hideOverlay)
  ipcMain.handle('overlay:click-through', (_event, value: boolean) => setOverlayClickThrough(value))
  ipcMain.handle('overlay:hit-regions', (_event, regions: Array<{ x: number; y: number; width: number; height: number }>, controlsAnchor?: { x: number; y: number }) => {
    const nextRegions = regions.filter(region => [region.x, region.y, region.width, region.height].every(Number.isFinite)).slice(0, 8)
    const regionsChanged = JSON.stringify(nextRegions) !== JSON.stringify(overlayHitRegions)
    const nextAnchor = controlsAnchor && Number.isFinite(controlsAnchor.x) && Number.isFinite(controlsAnchor.y)
      ? { x: Math.round(controlsAnchor.x), y: Math.round(controlsAnchor.y) }
      : null
    const anchorChanged = JSON.stringify(nextAnchor) !== JSON.stringify(overlayControlsAnchor)
    if (regionsChanged) {
      overlayHitRegions = nextRegions
      // Mixed-DPI moves can shift Chromium's content origin by fractions of a
      // DIP. Rebuilding a layered HWND shape for every one-pixel oscillation
      // causes drag lag and ghost trails; the final release publishes once.
      if (!overlayPointerDrag && Date.now() >= overlayControlsSuppressedUntil) {
        qaLog(`overlay hit regions: ${JSON.stringify(overlayHitRegions)}`)
        applyOverlayShape()
      }
    }
    if (anchorChanged) {
      overlayControlsAnchor = nextAnchor
      if (!overlayPointerDrag && Date.now() >= overlayControlsSuppressedUntil) qaLog(`overlay controls anchor: ${JSON.stringify(overlayControlsAnchor)}`)
      // Freeze a visible pill so it never follows line wrapping while the user
      // is aiming at a button. The newest anchor applies the next time it opens.
      if (!overlayPointerDrag && Date.now() >= overlayControlsSuppressedUntil && !overlayControlsWindow?.isVisible()) syncOverlayControlsBounds()
    }
    return true
  })
  ipcMain.on('overlay:controls-hover', (event, hovered: boolean) => updateOverlayControlsHover(event.sender, hovered === true))
  ipcMain.handle('overlay:bounds', () => overlayWindow?.getBounds() ?? defaultOverlayBounds())
  ipcMain.handle('overlay:size', (_event, width: number, height: number) => {
    if (!overlayWindow) return defaultOverlayBounds()
    const area = screen.getDisplayMatching(overlayWindow.getBounds()).workArea
    setExactOverlaySize(Math.max(480, Math.min(area.width, Math.round(width))), Math.max(140, Math.min(area.height, Math.round(height))), true)
    publishOverlayBounds()
    return overlayWindow.getBounds()
  })
  ipcMain.on('overlay:move-start', event => {
    if (overlayPointerDrag) return
    if (!overlayMovable || (event.sender !== overlayWindow?.webContents && event.sender !== overlayControlsWindow?.webContents) || !overlayWindow) return
    const fromControls = event.sender === overlayControlsWindow?.webContents
    const controlsWereVisible = overlayControlsWindow?.isVisible() ?? false
    overlayPointerDrag = { cursor: screen.getCursorScreenPoint(), bounds: overlayWindow.getBounds(), fromControls, controlsWereVisible }
    if (controlsWereVisible && overlayControlsWindow) {
      // Keep pointer capture alive when the handle initiated the drag, but
      // remove its layered pixels so the second window cannot leave a trail.
      if (fromControls) overlayControlsWindow.setOpacity(0)
      else overlayControlsWindow.hide()
    }
    qaLog(`overlay pointer drag start: ${JSON.stringify(overlayPointerDrag)}`)
  })
  ipcMain.on('overlay:move-to', event => {
    if (!overlayMovable || (event.sender !== overlayWindow?.webContents && event.sender !== overlayControlsWindow?.webContents) || !overlayWindow || !overlayPointerDrag) return
    // screen.getCursorScreenPoint() and BrowserWindow bounds both use
    // Electron's display-independent coordinates. Renderer screenX/screenY
    // can be physical pixels on mixed-DPI Windows desktops and caused gradual
    // resize drift when passed through directly.
    const point = screen.getCursorScreenPoint()
    const origin = overlayPointerDrag
    if ((event.sender === overlayControlsWindow?.webContents) !== origin.fromControls) return
    const x = origin.bounds.x + point.x - origin.cursor.x
    const y = origin.bounds.y + point.y - origin.cursor.y
    const area = screen.getDisplayNearestPoint(point).workArea
    const visibleGrip = 48
    const targetX = Math.max(area.x - origin.bounds.width + visibleGrip, Math.min(Math.round(x), area.x + area.width - visibleGrip))
    const targetY = Math.max(area.y, Math.min(Math.round(y), area.y + area.height - visibleGrip))
    const current = overlayWindow.getBounds()
    // Position-only movement avoids reallocating a large transparent surface
    // on every pointer event, which was the main source of drag ghosting.
    if (current.x !== targetX || current.y !== targetY) overlayWindow.setPosition(targetX, targetY, false)
  })
  ipcMain.on('overlay:move-end', event => {
    if (event.sender !== overlayWindow?.webContents && event.sender !== overlayControlsWindow?.webContents) return
    const origin = overlayPointerDrag
    if (!origin || (event.sender === overlayControlsWindow?.webContents) !== origin.fromControls) return
    if (origin && overlayWindow && !overlayWindow.isDestroyed()) {
      const bounds = overlayWindow.getBounds()
      if (bounds.width !== origin.bounds.width || bounds.height !== origin.bounds.height) setExactOverlaySize(origin.bounds.width, origin.bounds.height)
    }
    overlayPointerDrag = null
    lastOverlayDragEndedAt = Date.now()
    if (overlayControlsWindow && !overlayControlsWindow.isDestroyed()) {
      overlayControlsWindow.setOpacity(1)
      // Do not materialize a button underneath the pointer-up that finishes a
      // lyric drag. On Windows that cross-HWND sequence can synthesize a click
      // on the newly appeared open-client button. The hover tracker may show
      // the controls again after the pointer sequence is safely over.
      overlayControlsWindow.hide()
    }
    overlayControlsSuppressedUntil = Math.max(overlayControlsSuppressedUntil, lastOverlayDragEndedAt + 500)
    if (overlayDragSettleTimer) clearTimeout(overlayDragSettleTimer)
    overlayDragSettleTimer = setTimeout(() => {
      overlayDragSettleTimer = null
      if (overlayPointerDrag || !overlayWindow || overlayWindow.isDestroyed()) return
      applyOverlayShape()
      syncOverlayControlsBounds()
    }, 520)
    publishOverlayBounds()
    qaLog(`overlay pointer drag end: ${JSON.stringify(overlayWindow?.getBounds())}`)
  })
  ipcMain.handle('overlay:position', (_event, position: 'top' | 'center' | 'bottom') => {
    if (!overlayWindow) return defaultOverlayBounds()
    const current = overlayWindow.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    const margin = 32
    const x = Math.round(area.x + (area.width - current.width) / 2)
    const y = position === 'top' ? area.y + margin
      : position === 'center' ? Math.round(area.y + (area.height - current.height) / 2)
        : area.y + area.height - current.height - margin
    overlayWindow.setPosition(x, y, true)
    publishOverlayBounds()
    return overlayWindow.getBounds()
  })
  ipcMain.handle('overlay:reset-position', async () => {
    if (!overlayWindow) return defaultOverlayBounds()
    const current = overlayWindow.getBounds()
    const bounds = defaultOverlayBounds(current.width, current.height, screen.getDisplayMatching(current))
    return await applyOverlayBounds(bounds, true)
  })
  ipcMain.handle('overlay:movable', (_event, value: boolean) => {
    overlayMovable = value
    overlayWindow?.setMovable(value)
    overlayControlsWindow?.setMovable(value)
    // A user who explicitly unlocks the position expects direct dragging to
    // work immediately. Full lyric hit-through would otherwise make the drag
    // surface unreachable, while transparent blank pixels still pass through
    // naturally via the shaped window.
    if (value && overlayClickThrough) setOverlayClickThrough(false)
    return value
  })
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize())
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:show', event => {
    const fromOverlay = event.sender === overlayWindow?.webContents || event.sender === overlayControlsWindow?.webContents
    if (fromOverlay && Date.now() - lastOverlayDragEndedAt < 650) {
      qaLog('open-client suppressed: pointer sequence just moved the overlay')
      return false
    }
    qaLog(`open-client accepted: sender=${event.sender === overlayControlsWindow?.webContents ? 'controls' : event.sender === overlayWindow?.webContents ? 'overlay' : 'main'}`)
    return revealMainWindow(fromOverlay ? 'overlay' : 'cursor')
  })

  // The bridge must be ready before either renderer loads; otherwise their
  // first playback, visibility, and hit-region requests can race startup.
  createWindows(); createTray()
  if (forceOverlayForQa) setTimeout(showOverlay, 1200)
  await spotify.restore()
  void import('./local-spotify').then(({ LocalSpotifyService }) => {
    localSpotify = new LocalSpotifyService()
    localSpotify.start(snapshot => {
      // Repeated empty native polls must not starve the Web-only fallback.
      if (snapshot || lastPlayback?.playbackSource === 'local') playbackRefreshes.invalidate()
      if (!snapshot) {
        const pendingTransport = transportGate.pending()
        if (lastPlayback?.playbackSource === 'local' && pendingTransport?.backend === 'local') {
          transportGate.observeTrack(null)
          qaLog(`local empty snapshot retained during transport: ${pendingTransport.action}`)
          return
        }
        if (lastPlayback?.playbackSource === 'local') { lastPlayback = null; broadcast(null) }
        return
      }
      lastPlayback = snapshot
      broadcast(snapshot)
    }, qaLogPath ? qaLog : undefined)
  }).catch(error => console.warn('Local Spotify module failed to load:', error))
  globalShortcut.register('CommandOrControl+Alt+L', toggleOverlay)
  globalShortcut.register('CommandOrControl+Alt+M', () => setOverlayClickThrough(!overlayClickThrough))
  globalShortcut.register('CommandOrControl+Alt+S', () => revealMainWindow('cursor'))
  void poll()
})

app.on('activate', () => { revealMainWindow() })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { quitting = true; void localSpotify?.close(); globalShortcut.unregisterAll(); stopOverlayMouseTracking(); stopOverlayControlsVisibilityTracking(); if (pollTimer) clearTimeout(pollTimer); if (boundsSaveTimer) clearTimeout(boundsSaveTimer); if (boundsPublishTimer) clearTimeout(boundsPublishTimer) })
