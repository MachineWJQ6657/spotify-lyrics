// Bounded integration check against independent raw SMTC observations.
// Read-only by default; --pause-resume explicitly enables a 2-second pause.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { SpotifyClient } from 'libspotifyctl'

const outfile = path.resolve('.qa-clock/native-clock-service.mjs')
await build({ entryPoints: ['electron/local-spotify.ts'], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
const { LocalSpotifyService } = await import(pathToFileURL(outfile).href)
const service = new LocalSpotifyService()
const appLog = process.argv.find(value => value.startsWith('--log='))?.slice(6)
function loggedSnapshot(raw, at) {
  let lines
  try { lines = readFileSync(appLog, 'utf8').trim().split('\n') } catch { return null }
  const identity = `track: ${raw.artist} - ${raw.title} [${raw.statusName}] `
  for (const line of lines.reverse()) {
    const time = Date.parse(line.slice(0, 24))
    if (time > at || at - time > 6000 || !line.includes(identity)) continue
    const position = Number(line.slice(line.indexOf(identity) + identity.length).match(/^([\d.]+)ms/)?.[1])
    if (!Number.isFinite(position)) continue
    return { track: { name: raw.title }, positionMs: position + (raw.statusName === 'PLAYING' ? at - time : 0) }
  }
  return null
}
const reference = new SpotifyClient()
const samples = []
const settledChecks = []
const status = []
const checkPauseResume = process.argv.includes('--pause-resume')
let resumeRequired = false
let lastRawKey = ''
const startedAt = Date.now()
try {
  if (!appLog) service.start(() => {}, message => { if (/fatal|failed|error|settled/i.test(message)) status.push(message) })
  reference.on('stateChanged', raw => {
    const at = Date.now()
    const key = JSON.stringify([raw.artist, raw.title, raw.album, raw.positionMs, raw.statusName])
    if (!raw.title || key === lastRawKey) return
    lastRawKey = key
    const current = appLog ? loggedSnapshot(raw, at) : service.current()
    if (!current?.track || current.track.name !== raw.title || at - startedAt < 6500) return
    const sample = { at, title: raw.title, status: raw.statusName,
      rawMs: raw.positionMs, librarySmoothMs: reference.positionSmoothMs,
      clientMs: Math.round(current.positionMs), errorMs: Math.round(current.positionMs - raw.positionMs) }
    samples.push(sample)
    // Independent native callbacks and log writes can arrive a few ms apart.
    // Keep that instantaneous discrepancy, and also measure after 200ms so a
    // brief delivery race is not mistaken for a persistent clock offset.
    settledChecks.push(new Promise(resolve => setTimeout(() => {
      const now = Date.now()
      const settled = appLog ? loggedSnapshot(raw, now) : service.current()
      if (settled?.track?.name === raw.title) {
        const expected = raw.positionMs + (raw.statusName === 'PLAYING' ? now - at : 0)
        sample.settledErrorMs = Math.round(settled.positionMs - expected)
      }
      resolve()
    }, 200)))
  })
  reference.start()
  if (checkPauseResume) {
    await new Promise(resolve => setTimeout(resolve, 8000))
    if (reference.latestState()?.statusName === 'PLAYING') {
      resumeRequired = reference.pause()
      status.push(`pause accepted=${resumeRequired}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      if (resumeRequired) {
        const resumed = reference.play()
        status.push(`resume accepted=${resumed}`)
        resumeRequired = !resumed
      }
    }
    await new Promise(resolve => setTimeout(resolve, 14000))
  } else await new Promise(resolve => setTimeout(resolve, 24000))
} finally {
  if (resumeRequired) reference.play()
  reference.stop()
  reference.close()
  await Promise.all(settledChecks)
  await service.close()
}
const errors = samples.map(sample => Math.abs(sample.errorMs))
const settledErrors = samples.flatMap(sample => Number.isFinite(sample.settledErrorMs) ? [Math.abs(sample.settledErrorMs)] : [])
console.log(JSON.stringify({ mode: appLog ? 'running-app-log' : 'worker-service', samples, status, maxErrorMs: errors.length ? Math.max(...errors) : null,
  maxSettledErrorMs: settledErrors.length ? Math.max(...settledErrors) : null,
  note: 'Raw SMTC comparison only; this does not independently establish audible lyric accuracy.' }, null, 2))
if (!samples.length) process.exitCode = 2
