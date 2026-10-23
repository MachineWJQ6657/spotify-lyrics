// Explicit bounded LOCAL diagnostic: system-output audio and native timeline.
// No playback commands, microphone, network, persistent scheduling or uploads.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import lifecycle from './monitor-lifecycle.cjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const seconds = Number(process.argv.find(value => value.startsWith('--seconds='))?.slice(10) ?? 300)
if (!process.argv.includes('--ack-system-audio') || !Number.isFinite(seconds) || seconds < 15 || seconds > 600) throw new Error('Requires --ack-system-audio and 15–600 second limit')
const directory = fs.mkdtempSync(path.join(root, '.qa-acoustic', 'monitor-'))
const startedAtMs = Date.now(), deadline = startedAtMs + seconds * 1000
const report = { startedAtMs, limitSeconds: seconds, status: 'running', directory, samples: 0, captures: [] }
const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
save(); console.log(JSON.stringify({ event: 'started', directory, limitSeconds: seconds }))
let currentChild, latestNative, finished = false, finishPromise, nativeFailure
const native = new Worker(path.join(root, 'scripts/monitor-audio-native.cjs'))
native.on('message', message => {
  if (message.type === 'error') { nativeFailure = new Error(message.error || 'Native monitor error'); void finish(); return }
  if (finished) return
  if (message.type !== 'sample') return
  const value = message.state ?? message.sample
  if (!value) return
  const row = { observedAtMs: Date.now(), ...value }
  latestNative = row
  // Native helper only exposes metadata/timing; exclude artwork/credentials.
  fs.appendFileSync(path.join(directory, 'timeline.ndjson'), JSON.stringify(row) + '\n')
  report.samples++; save()
})
native.on('error', error => { nativeFailure = error; void finish() })
native.on('exit', code => { if (!finished) { nativeFailure = new Error(`Unexpected native exit ${code}`); void finish() } })
function finish() {
  if (finishPromise) return finishPromise
  finished = true
  finishPromise = (async () => {
    const capture = currentChild
    const releaseCapture = capture ? new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Capture close timed out')), 3000)
      capture.once('close', () => { clearTimeout(timer); resolve() })
      try { capture.kill() } catch (error) { clearTimeout(timer); reject(error) }
    }) : Promise.resolve()
    const results = await Promise.allSettled([releaseCapture, lifecycle.closeMonitorNative(native)])
    const failure = nativeFailure || results.find(result => result.status === 'rejected')?.reason
    report.status = failure ? 'failed' : 'completed'; report.endedAtMs = Date.now()
    if (failure) report.error = String(failure.message || failure)
    save()
    console.log(JSON.stringify({ event: report.status, directory, captures: report.captures.length, samples: report.samples, error: report.error }))
    // Persist failure BEFORE forced teardown can terminate the native host.
    if (failure) await native.terminate().catch(() => {})
    process.exitCode = failure ? 1 : 0
  })()
  return finishPromise
}
const watchdog = setTimeout(() => void finish(), seconds * 1000)
process.once('SIGINT', () => void finish()); process.once('SIGTERM', () => void finish())
while (!finished && Date.now() + 13000 < deadline) {
  // No reason to start a Chromium capture process for silent paused playback.
  // Native timing continues recording, and playback automatically resumes PCM.
  if (latestNative?.statusName !== 'PLAYING') {
    await new Promise(resolve => setTimeout(resolve, 500))
    continue
  }
  const result = await new Promise(resolve => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), ['scripts/capture-audio-probe.cjs'],
      { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    currentChild = child
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-32000) })
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000) })
    child.on('error', error => resolve({ error: error.message }))
    child.on('close', code => {
      currentChild = undefined
      try { resolve(code === 0 ? JSON.parse(stdout) : { error: stderr || stdout, code }) }
      catch { resolve({ error: stderr || stdout, code }) }
    })
  })
  if (finished) break // Do not append a deliberately cancelled final capture.
  report.captures.push(result); save()
  console.log(JSON.stringify({ event: 'capture', directory, ...result }))
  if (result.error) { nativeFailure = new Error('Audio capture failed'); break }
}
clearTimeout(watchdog); await finish()
