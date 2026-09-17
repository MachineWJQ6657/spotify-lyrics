// Local-only evaluation. ffmpeg decodes files; no audio is sent over a network.
// Usage: node scripts/verify-acoustic-sync.mjs reference.wav [query.wav]
// With only a reference, generate a held-out excerpt and an atempo variant.
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const [referenceFile, queryFile] = process.argv.slice(2)
if (!referenceFile) throw new Error('Provide a local reference audio file')
const outfile = path.resolve('.qa-acoustic/fingerprint.mjs')
await build({ entryPoints: ['electron/audio-sync/fingerprint.ts'], outfile, bundle: true, platform: 'node', format: 'esm' })
const { fingerprint, matchFingerprint } = await import(pathToFileURL(outfile).href)
function decode(file, filters = []) {
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, ...filters, '-t', '600', '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1'], { maxBuffer: 25 * 1024 * 1024, windowsHide: true })
  if (decoded.status !== 0) throw new Error(decoded.stderr?.toString() || 'ffmpeg failed')
  const bytes = decoded.stdout
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
const start = performance.now()
const reference = fingerprint(decode(referenceFile), 8000)
const preparedMs = performance.now() - start
const cases = queryFile ? [{ label: 'supplied-query', pcm: decode(queryFile) }] : [
  { label: 'gain-and-offset', expectedStartMs: 3000, expectedRate: 1, pcm: decode(referenceFile, ['-af', 'atrim=start=3:end=12,asetpts=PTS-STARTPTS,volume=0.2']) },
  { label: 'tempo-1.08-and-offset', expectedStartMs: 3000, expectedRate: 1.08, pcm: decode(referenceFile, ['-af', 'atrim=start=3:end=13,asetpts=PTS-STARTPTS,atempo=1.08,volume=0.35']) }
]
let failed = false
for (const item of cases) {
  const began = performance.now()
  const result = matchFingerprint(reference, fingerprint(item.pcm, 8000))
  const startErrorMs = item.expectedStartMs == null ? undefined : result.sourceStartMs - item.expectedStartMs
  console.log(JSON.stringify({ label: item.label, preparedMs: Math.round(preparedMs), elapsedMs: Math.round(performance.now() - began), result,
    expectedStartMs: item.expectedStartMs, expectedRate: item.expectedRate, startErrorMs }, null, 2))
  if (item.expectedStartMs != null && (!result.accepted || Math.abs(startErrorMs) > 150 || Math.abs(result.rate - item.expectedRate) > .015)) failed = true
}
if (failed) process.exitCode = 1
