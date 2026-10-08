// Local-only, read-only playback analysis. Never seeks or changes calibration.
// node scripts/analyze-transition-ab.mjs .qa-acoustic/ab-<run>
import { readFile, writeFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const directory = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Provide the local A/B capture directory')
const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'))
if (report.status !== 'captured-and-restored') throw new Error('A/B capture did not finish and restore; no timing result inferred')
const outdir = path.join(directory, 'analysis-modules')
await build({ entryPoints: ['electron/audio-sync/fingerprint.ts', 'electron/audio-sync/replay-comparison.ts'],
  outdir, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } })
const { fingerprint, matchFingerprint } = await import(pathToFileURL(path.join(outdir, 'fingerprint.mjs')).href)
const { compareReplay } = await import(pathToFileURL(path.join(outdir, 'replay-comparison.mjs')).href)
async function pcm(name, seconds) {
  const file = path.join(directory, `${name}.f32`)
  if ((await stat(file)).size !== seconds * 48000 * 4) throw new Error('Unexpected PCM length')
  const bytes = await readFile(file)
  const data = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  if (!data.every(Number.isFinite)) throw new Error('Invalid PCM')
  return data
}
const before = await pcm('before', 12), after = await pcm('after', 36)
const reference = fingerprint(after, 48000)
const whole = matchFingerprint(reference, fingerprint(before, 48000))
const first = matchFingerprint(reference, fingerprint(before.slice(0, 6 * 48000), 48000))
const last = matchFingerprint(reference, fingerprint(before.slice(6 * 48000), 48000))
const result = { analysisVersion: 1, track: report.track, comparison: compareReplay(report, whole, first, last),
  matches: { whole, first, last }, note: 'Actual audio comparison, not a lyric onset validation. No reference is assumed clean. No audio uploaded or calibration changed.' }
await writeFile(path.join(directory, 'analysis.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
