// Explicit diagnostic only. Never invoked by Syllable itself.
// electron scripts/transition-audio-ab.cjs --ack-system-audio --ack-seek
// Records ALL system output locally, not a microphone. No network or upload.
const path = require('node:path')
const fs = require('node:fs')
const { Worker } = require('node:worker_threads')

function identity(sample) { return `${sample?.artist || ''}\0${sample?.title || ''}\0${sample?.album || ''}` }
function project(sample, now) { return sample.positionMs + (sample.statusName === 'PLAYING' ? Math.max(0, now - sample.rawObservedAtMs) : 0) }
function safetyError(sample, now, expectedIdentity) {
  if (!sample?.title || !Number.isFinite(sample.positionMs) || !Number.isFinite(sample.durationMs)) return 'Native playback unavailable'
  if (expectedIdentity && identity(sample) !== expectedIdentity) return 'Track identity changed'
  if (sample.statusName !== 'PLAYING') return 'Playback paused or stopped'
  if (!Number.isFinite(sample.rawObservedAtMs) || now - sample.rawObservedAtMs > 6500 || sample.rawObservedAtMs > now + 250) return 'Native observation stale'
  return ''
}
function preflightError(sample, now, expectedIdentity) {
  const error = safetyError(sample, now, expectedIdentity)
  if (error) return error
  const position = project(sample, now)
  if (position < 20_000) return 'Need at least 20 seconds of current progress'
  if (sample.durationMs - position < 80_000) return 'Need at least 80 seconds remaining; no seek performed'
  return ''
}
function discontinuity(previous, sample) {
  return previous && identity(previous) === identity(sample) && previous.statusName === 'PLAYING' && sample.statusName === 'PLAYING'
    && Math.abs(sample.positionMs - previous.positionMs - (sample.rawObservedAtMs - previous.rawObservedAtMs)) > 3000
}
module.exports = { identity, project, safetyError, preflightError, discontinuity }

async function run() {
  if (!process.argv.includes('--ack-system-audio') || !process.argv.includes('--ack-seek')) {
    console.error('Refused: explicit --ack-system-audio and --ack-seek required. Captures all system output and seeks this song twice; no microphone/upload.')
    if (process.versions.electron && process.type === 'browser') require('electron').app.exit(2)
    process.exitCode = 2
    return
  }
  const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron')
  const startedAtMs = Date.now()
  const directory = fs.mkdtempSync(path.resolve('.qa-acoustic', 'ab-'))
  app.setPath('userData', path.join(directory, 'profile'))
  let window, worker, latest, baseline, beforeStarted, afterAnchor
  let phase = 'startup', finished = false, cancelled = '', ownSeek = false, seekAttempted = false, userIntervened = false
  let requestId = 0, captureRequests = 0, initialDistinct = 0, initialFirstAt = 0
  const pending = new Map(), listeners = new Set()
  const report = { schemaVersion: 1, startedAtMs, status: 'running', audio: 'local system-output loopback; may include other applications; no microphone or upload',
    note: 'A/B recording only; a seek does not prove Spotify disabled its transition. No synchronization result is inferred.', samples: [], events: [], captures: [] }
  const event = (kind, data = {}) => { report.events.push({ atMs: Date.now(), kind, ...data }) }
  const saveReport = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  const notify = () => { for (const callback of [...listeners]) callback() }
  const abort = reason => { if (!cancelled) { cancelled = reason; event('cancelled', { reason }); notify() } }
  const waitUntil = (test, timeoutMs, allowCancelled = false) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('Timed out waiting for ' + phase)), timeoutMs)
    function done(error, result) { clearTimeout(timer); listeners.delete(check); error ? reject(error) : resolve(result) }
    function check() {
      if (cancelled && !allowCancelled) return done(new Error(cancelled))
      try { const value = test(); if (value) done(null, value) } catch (error) { done(error) }
    }
    listeners.add(check); check()
  })
  const cleanup = async (code, status) => {
    if (finished) return
    finished = true; report.status = status; report.endedAtMs = Date.now()
    clearTimeout(watchdog); clearInterval(health)
    window?.webContents.send('ab-stop')
    window?.destroy()
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Diagnostic ended')) }
    pending.clear()
    // A native binding can block Worker termination. Do not let the diagnostic
    // watchdog itself hang forever waiting for that binding to return.
    let shutdownTimer
    await Promise.race([worker?.terminate().catch(() => {}), new Promise(resolve => { shutdownTimer = setTimeout(resolve, 2000) })])
    clearTimeout(shutdownTimer)
    try {
      saveReport()
      console.log(JSON.stringify({ directory, status, reason: cancelled || undefined, captures: report.captures.map(({ phase, durationMs, rms }) => ({ phase, durationMs, rms })) }))
    } finally { app.exit(code) }
  }
  const watchdog = setTimeout(() => { abort('80-second watchdog; recording stopped, no further seek'); void cleanup(2, 'watchdog-cancelled') }, 80_000)
  const health = setInterval(() => {
    if (!baseline || finished) return
    const error = safetyError(latest, Date.now(), identity(baseline))
    if (error) abort(error)
  }, 250)
  const seek = (positionMs) => new Promise((resolve, reject) => {
    const id = ++requestId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native seek acknowledgement timed out; will not retry')) }, 2500)
    pending.set(id, { resolve, reject, timer })
    worker.postMessage({ type: 'seek', id, positionMs: Math.round(positionMs), expectedIdentity: identity(baseline) })
  })
  async function seekAndConfirm(target) {
    const beforeSequence = latest.sequence
    ownSeek = true
    event('seek-request', { targetMs: target })
    try {
      await seek(target)
      const accepted = await waitUntil(() => latest.sequence > beforeSequence && Math.abs(latest.positionMs - target) <= 2000 && latest, 6500)
      event('seek-observed', { positionMs: accepted.positionMs, rawObservedAtMs: accepted.rawObservedAtMs })
      return { ...accepted }
    } finally { ownSeek = false }
  }
  const capture = (name, blocks) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => done(new Error('Capture timed out')), blocks * 12_000 + 4000)
    const stopOnCancel = () => { if (cancelled) done(new Error(cancelled)) }
    const onStarted = (_event, value) => {
      if (_event.sender !== window.webContents || value.phase !== name) return
      event('capture-started', { phase: name, atMs: value.startedAtMs })
      if (name === 'before') beforeStarted = { wallMs: value.startedAtMs, positionMs: project(latest, value.startedAtMs), sample: { ...latest } }
    }
    const onResult = (_event, result) => {
      if (_event.sender !== window.webContents || result.phase !== name) return
      if (result.error) return done(new Error(result.error))
      const pcm = new Float32Array(result.pcm)
      if (result.sampleRate !== 48000 || pcm.length !== 48000 * 12 * blocks || !pcm.every(Number.isFinite)) return done(new Error('Unexpected PCM shape'))
      fs.writeFileSync(path.join(directory, `${name}.f32`), Buffer.from(result.pcm))
      let energy = 0, peak = 0
      for (const value of pcm) { energy += value * value; peak = Math.max(peak, Math.abs(value)) }
      const info = { phase: name, sampleRate: result.sampleRate, durationMs: pcm.length / result.sampleRate * 1000,
        startedAtMs: result.startedAtMs, endedAtMs: result.endedAtMs, blocks: result.blocks, rms: Math.sqrt(energy / pcm.length), peak,
        file: `${name}.f32`, nativeAtEnd: { ...latest } }
      report.captures.push(info); saveReport(); done(null, info)
    }
    function done(error, result) {
      clearTimeout(timeout); listeners.delete(stopOnCancel)
      ipcMain.removeListener('ab-started', onStarted); ipcMain.removeListener('ab-result', onResult)
      if (error) window?.webContents.send('ab-stop')
      error ? reject(error) : resolve(result)
    }
    listeners.add(stopOnCancel); ipcMain.on('ab-started', onStarted); ipcMain.on('ab-result', onResult)
    window.webContents.send('ab-capture', { phase: name, blocks })
  })
  try {
    await app.whenReady()
    window = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: {
      nodeIntegration: true, contextIsolation: false, backgroundThrottling: false
    } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
      if (++captureRequests > 2 || cancelled || finished) return callback({})
      try {
        const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        if (!screens.length || cancelled || finished) return callback({})
        callback({ video: screens[0], audio: 'loopback' })
      } catch { callback({}) }
    })
    worker = new Worker(path.join(__dirname, 'transition-audio-ab-native.cjs'))
    worker.on('error', error => abort('Native worker: ' + error.message))
    worker.on('exit', code => { if (!finished) abort('Native worker exited: ' + code) })
    worker.on('message', message => {
      if (message.type === 'error') return abort(message.error)
      if (message.type === 'response') {
        const entry = pending.get(message.id); if (!entry) return
        clearTimeout(entry.timer); pending.delete(message.id)
        message.ok ? entry.resolve() : entry.reject(new Error(message.error || 'Seek rejected'))
        return
      }
      if (message.type !== 'sample') return
      const previous = latest; latest = message.sample
      report.samples.push({ ...latest, receivedAtMs: Date.now(), phase })
      if (report.samples.length > 500) report.samples.shift()
      if (!initialFirstAt) initialFirstAt = latest.rawObservedAtMs
      initialDistinct++
      if (baseline) {
        const error = safetyError(latest, Date.now(), identity(baseline))
        if (error) abort(error)
        if (!ownSeek && discontinuity(previous, latest)) { userIntervened = true; abort('Unexpected native jump; will not override user playback') }
      }
      notify()
    })
    await window.loadFile(path.join(__dirname, 'transition-audio-ab.html'))
    await waitUntil(() => initialDistinct >= 2 && latest.rawObservedAtMs - initialFirstAt >= 2000, 11_000)
    const error = preflightError(latest, Date.now())
    if (error) throw new Error(error)
    baseline = { ...latest }
    report.track = { title: baseline.title, artist: baseline.artist, album: baseline.album, durationMs: baseline.durationMs }
    phase = 'before'; await capture('before', 1)
    const secondCheck = preflightError(latest, Date.now(), identity(baseline))
    if (secondCheck) throw new Error(secondCheck)
    if (!beforeStarted || beforeStarted.positionMs < 20_000) throw new Error('Missing safe before-capture anchor')
    report.beforeAnchor = beforeStarted
    const target = Math.max(0, beforeStarted.positionMs - 15_000)
    phase = 'seek-back'; seekAttempted = true; afterAnchor = await seekAndConfirm(target)
    report.afterAnchor = afterAnchor
    phase = 'after'; await capture('after', 3)
    if (cancelled) throw new Error(cancelled)
    if (safetyError(latest, Date.now(), identity(baseline)) || userIntervened) throw new Error('No safe restore condition')
    const expectedAfter = project(afterAnchor, Date.now())
    if (Math.abs(project(latest, Date.now()) - expectedAfter) > 3000) throw new Error('After timeline changed; restore skipped')
    const restoreTarget = baseline.positionMs + Date.now() - baseline.rawObservedAtMs
    if (restoreTarget >= latest.durationMs - 2000) throw new Error('Restore target too near track end; restore skipped')
    phase = 'restore'; await seekAndConfirm(restoreTarget)
    event('restored', { targetMs: restoreTarget })
    await cleanup(0, 'captured-and-restored')
  } catch (error) {
    abort(String(error.message || error))
    // Never send a speculative restore after a pause, identity change, large
    // external seek, timed-out seek acknowledgement, or failed confirmation.
    event('restore-skipped-on-cancellation', { seekAttempted, reason: cancelled })
    await cleanup(1, seekAttempted ? 'cancelled-after-seek' : 'cancelled-no-seek')
  }
}

// Electron's CommonJS main loader does not always set require.main to this
// module. Node imports used by safety tests must still remain side-effect free.
if (require.main === module || (process.versions.electron && process.type === 'browser')) {
  // Parent directory contains ignored local-only recordings and profiles.
  fs.mkdirSync(path.resolve('.qa-acoustic'), { recursive: true })
  run().catch(error => {
    console.error(error)
    if (process.versions.electron && process.type === 'browser') require('electron').app.exit(1)
    process.exitCode = 1
  })
}
