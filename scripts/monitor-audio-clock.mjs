// Explicit bounded LOCAL diagnostic: system-output audio and native timeline.
// No playback commands, microphone, network, persistent scheduling or uploads.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const seconds = Number(process.argv.find(value => value.startsWith('--seconds='))?.slice(10) ?? 300)
if (!process.argv.includes('--ack-system-audio') || !Number.isFinite(seconds) || seconds < 15 || seconds > 600) throw new Error('Requires --ack-system-audio and 15–600 second limit')
const directory = fs.mkdtempSync(path.join(root, '.qa-acoustic', 'monitor-'))
const startedAtMs = Date.now(), deadline = startedAtMs + seconds * 1000
const report = { startedAtMs, limitSeconds: seconds, status: 'running', directory, samples: 0, captures: [] }
const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
save(); console.log(JSON.stringify({ event: 'started', directory, limitSeconds: seconds }))
let currentChild, latestNative, finished = false
const native = new Worker(path.join(root, 'scripts/transition-audio-ab-native.cjs'))
native.on('message', message => {
  if (message.type !== 'sample') return
  const value = message.state ?? message.sample
  if (!value) return
  const row = { observedAtMs: Date.now(), ...value }
  latestNative = row
  // Native helper only exposes metadata/timing; exclude artwork/credentials.
  fs.appendFileSync(path.join(directory, 'timeline.ndjson'), JSON.stringify(row) + '\n')
  report.samples++; save()
})
native.on('error', error => console.log(JSON.stringify({ event: 'native-error', message: error.message })))
async function finish() {
  if (finished) return
  finished = true; currentChild?.kill()
  report.status = 'completed'; report.endedAtMs = Date.now(); save()
  console.log(JSON.stringify({ event: 'completed', directory, captures: report.captures.length, samples: report.samples }))
  void native.terminate()
  setTimeout(() => process.exit(0), 1000)
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
  report.captures.push(result); save()
  console.log(JSON.stringify({ event: 'capture', directory, ...result }))
  if (result.error) break
}
clearTimeout(watchdog); await finish()
