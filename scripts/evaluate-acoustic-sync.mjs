// Local labeled regression matrix. No capture, playback control or upload.
// node scripts/evaluate-acoustic-sync.mjs reference1.wav reference2.wav ...
// --report=path.json writes metrics only, never PCM or source paths.
// --warped selects the NON-PRODUCTION piecewise alignment research matcher.
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const files = process.argv.slice(2).filter(value => !value.startsWith('--'))
const reportPath = process.argv.find(value => value.startsWith('--report='))?.slice(9)
if (!files.length) throw new Error('Provide at least one local reference audio file (at least 14 seconds)')
const outfile = path.resolve('.qa-acoustic/evaluation-matcher.mjs')
await build({ entryPoints: ['electron/audio-sync/fingerprint.ts'], outfile, bundle: true, platform: 'node', format: 'esm' })
const { fingerprint, matchFingerprint } = await import(pathToFileURL(outfile).href)
let matcher = matchFingerprint
if (process.argv.includes('--warped')) {
  const warpedOut = path.resolve('.qa-acoustic/warped-matcher.mjs')
  await build({ entryPoints: ['electron/audio-sync/warped-match.ts'], outfile: warpedOut, bundle: true, platform: 'node', format: 'esm' })
  matcher = (await import(pathToFileURL(warpedOut).href)).matchWarped
}
const sr = 8000
function decode(file, filter) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, ...(filter ? ['-af', filter] : []),
    '-t', '600', '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1'], { windowsHide: true, timeout: 30000, maxBuffer: 25 * 1024 * 1024 })
  if (result.status !== 0 || result.error) throw new Error(result.error?.message || result.stderr?.toString() || 'ffmpeg failed')
  const bytes = result.stdout
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
let seed = 301
const noise = length => Float32Array.from({ length }, () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return ((seed / 2 ** 32) * 2 - 1) * .1
})
const recordings = files.map(file => decode(file))
if (recordings.some(pcm => pcm.length < sr * 14)) throw new Error('Each reference must contain at least 14 seconds')
const rows = []
for (let recording = 0; recording < files.length; recording++) {
  const pcm = recordings[recording]
  const reference = fingerprint(pcm, sr)
  const excerpt = pcm.slice(sr * 2, sr * 14)
  const cases = [.84, .92, 1, 1.08, 1.16].map(rate => ({
    name: `tempo-${rate}`, positive: true, startMs: 2000, rate,
    pcm: decode(files[recording], `atrim=start=2:end=14,asetpts=PTS-STARTPTS,atempo=${rate},volume=0.3`),
  }))
  const fade = excerpt.map((value, i) => value * (.08 + .4 * i / excerpt.length))
  cases.push({ name: 'gain-fade', positive: true, startMs: 2000, rate: 1, pcm: fade })
  const slow = decode(files[recording], 'atrim=start=2:end=8,asetpts=PTS-STARTPTS,atempo=0.88')
  const fast = decode(files[recording], 'atrim=start=8:end=14,asetpts=PTS-STARTPTS,atempo=1.12')
  const changingRate = new Float32Array(slow.length + fast.length)
  changingRate.set(slow); changingRate.set(fast, slow.length)
  // Source start/end are known independently of output duration. The endpoint
  // rate is 1.12, not the whole-capture average: future projection needs it.
  cases.push({ name: 'tempo-step-0.88-to-1.12', positive: true, startMs: 2000, endMs: 14000, rate: 1.12, pcm: changingRate })
  const silentTail = excerpt.slice(); silentTail.fill(0, sr * 10)
  const switchedTail = excerpt.slice(); switchedTail.set(noise(sr * 2), sr * 10)
  const seekTail = excerpt.slice(); seekTail.set(pcm.subarray(0, sr * 2), sr * 10)
  cases.push({ name: 'silence-at-end', positive: false, pcm: silentTail },
    { name: 'other-sound-at-end', positive: false, pcm: switchedTail },
    { name: 'seek-at-end', positive: false, pcm: seekTail },
    { name: 'noise', positive: false, pcm: noise(sr * 12) })
  if (recordings.length > 1) cases.push({ name: 'other-recording', positive: false, pcm: recordings[(recording + 1) % recordings.length].slice(0, sr * 12) })
  for (const item of cases) {
    const began = performance.now()
    const result = matcher(reference, fingerprint(item.pcm, sr))
    const startErrorMs = item.positive ? result.sourceStartMs - item.startMs : undefined
    const endErrorMs = item.positive ? result.sourceEndMs - (item.endMs ?? item.startMs + item.pcm.length / sr * 1000 * item.rate) : undefined
    const correctPosition = item.positive && Math.abs(startErrorMs) <= 150 && Math.abs(endErrorMs) <= 150 && Math.abs(result.rate - item.rate) <= .015
    const passed = item.positive ? result.accepted && correctPosition : !result.accepted
    const row = { recording, case: item.name, positive: item.positive, passed, falseAcceptance: result.accepted && (!item.positive || !correctPosition),
      expectedStartMs: item.startMs, expectedEndMs: item.positive ? item.endMs ?? item.startMs + item.pcm.length / sr * 1000 * item.rate : undefined,
      expectedEndRate: item.rate,
      startErrorMs, endErrorMs, elapsedMs: Math.round(performance.now() - began), ...result }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
}
const summary = { cases: rows.length, passed: rows.filter(row => row.passed).length,
  positiveCases: rows.filter(row => row.positive).length, positiveAcceptedCorrect: rows.filter(row => row.positive && row.passed).length,
  falseAcceptances: rows.filter(row => row.falseAcceptance).length }
console.log(JSON.stringify({ summary }))
if (reportPath) {
  mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true })
  writeFileSync(reportPath, JSON.stringify({ createdAt: new Date().toISOString(), matcher: process.argv.includes('--warped') ? 'experimental-warped' : 'production-affine', summary, rows }, null, 2))
}
// Strict: unsupported tempo positives stay red, not silently reclassified as successes.
if (rows.some(row => !row.passed)) process.exitCode = 1
