// Diagnostic only: bounded local system-output capture, no microphone or upload.
// Run with Electron: electron scripts/capture-audio-probe.cjs
const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
fs.mkdirSync(path.resolve('.qa-acoustic'), { recursive: true })
const trace = message => fs.appendFileSync(path.resolve('.qa-acoustic/capture.trace.log'), `${new Date().toISOString()} ${message}\n`)
trace('probe loaded')
app.setPath('userData', path.resolve('.qa-acoustic/capture-profile'))
let window
// Keep native Spotify bindings out of this process: their initialization can
// block Electron before a window or timeout exists. Sample metadata separately.
const watchdog = setTimeout(() => { console.error('capture timeout'); app.exit(2) }, 25000)
app.whenReady().then(async () => {
  trace('app ready')
  window = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } })
  window.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
    trace('capture requested')
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      callback({ video: sources[0], audio: 'loopback' })
    } catch { callback({}) }
  })
  ipcMain.once('probe-result', (_event, result) => {
    trace(result.error || 'capture completed')
    if (result.error) console.error(result.error)
    else {
      const base = path.resolve('.qa-acoustic', `capture-${Date.now()}`)
      fs.mkdirSync(path.dirname(base), { recursive: true })
      fs.writeFileSync(`${base}.f32`, Buffer.from(result.pcm))
      const values = new Float32Array(result.pcm)
      const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)
      const metadata = { startedAtMs: result.startedAtMs, endedAtMs: result.endedAtMs, sampleRate: result.sampleRate,
        durationMs: values.length / result.sampleRate * 1000, rms, allFinite: values.every(Number.isFinite),
        acousticSmoke: result.acousticSmoke, audioPath: `${base}.f32` }
      fs.writeFileSync(`${base}.json`, JSON.stringify(metadata, null, 2))
      console.log(JSON.stringify(metadata, null, 2))
    }
    clearTimeout(watchdog)
    app.exit(result.error ? 1 : 0)
  })
  await window.loadFile(path.join(__dirname, 'capture-audio-probe.html'))
  trace('renderer loaded')
}).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1) })
