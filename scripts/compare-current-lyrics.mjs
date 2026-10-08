// Offline saved document versus fresh community sources. No playback mutation.
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const snapshot = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const saved = snapshot.documents[0]
if (!saved?.track) throw new Error('No saved song in snapshot')
const directory = path.resolve('.qa-sync-current')
mkdirSync(directory, { recursive: true })
const outfile = path.join(directory, 'provider-probe.mjs')
await build({ stdin: { contents: readFileSync('electron/lyrics-provider.ts', 'utf8') + '\nexport { fetchLrcLib, fetchNetease, fetchKugou };',
  resolveDir: path.resolve('electron'), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
const provider = await import(pathToFileURL(outfile).href)
const controller = new AbortController()
const deadline = setTimeout(() => controller.abort(), 12000)
const results = await Promise.allSettled([provider.fetchLrcLib(saved.track, controller.signal), provider.fetchNetease(saved.track, controller.signal), provider.fetchKugou(saved.track, controller.signal)])
clearTimeout(deadline)
const original = saved.tracks.find(track => track.kind === 'original')
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const rows = original.lines.map(line => ({ timeMs: line.startMs, normalizedText: normalize(line.text) }))
const values = results.map(result => result.status === 'fulfilled' ? result.value : { error: String(result.reason) })
writeFileSync(path.join(directory, 'provider-results.json'), JSON.stringify(values, null, 2))
const summaries = values.map(value => {
  if (!value?.syncedLyrics) return { source: value?.source, error: value?.error, noSynced: true }
  const fresh = provider.parseTimedRows(value.syncedLyrics)
  const anchors = rows.flatMap(row => {
    if (row.normalizedText.length < 4 || rows.filter(other => other.normalizedText === row.normalizedText).length !== 1) return []
    const matched = fresh.filter(other => other.normalizedText === row.normalizedText)
    return matched.length === 1 ? [{ savedMs: row.timeMs, freshMs: matched[0].timeMs, deltaMs: row.timeMs - matched[0].timeMs }] : []
  })
  const deltas = anchors.map(row => row.deltaMs).sort((a, b) => a - b)
  return { source: value.source, confidence: value.confidence, durationMs: value.matchedDurationMs, lineCount: fresh.length,
    uniqueAnchors: anchors.length, medianSavedMinusFreshMs: deltas.length ? deltas[Math.floor(deltas.length / 2)] : null,
    minDeltaMs: deltas[0], maxDeltaMs: deltas.at(-1), anchors }
})
const report = { title: saved.track.name, savedSource: original.source, savedLines: rows.length,
  note: 'Cross-source timing differences are not measured audible errors. No automatic offset inferred.', summaries }
writeFileSync(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
