// Runs two builds of the lyrics provider on songs of a saved library and
// reports where their answers differ. The provider HTTP of the first run is
// cached on disk per song and replayed for the others, so both builds see the
// same responses and a second run is offline.
//
//   bash scripts/qa/provider-compare/bundle.sh .qa-scratch/provider-old.mjs <git ref>
//   bash scripts/qa/provider-compare/bundle.sh .qa-scratch/provider-new.mjs
//   node scripts/qa/provider-compare/compare.mjs .qa-scratch/provider-old.mjs .qa-scratch/provider-new.mjs \
//        .qa-scratch/library-originals.json .qa-scratch/http-cache .qa-scratch/compare.json --every 3 --offset 0
//   node scripts/qa/provider-compare/show.mjs .qa-scratch/compare.json
//
// Songs are looked up one after another with a pause: concurrent lookups trip
// the providers' rate limits, which look like transient failures.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const [oldFile, newFile, libraryFile, cacheDir, outFile, ...rest] = process.argv.slice(2)
if (!outFile) {
  console.error('usage: compare.mjs <old.mjs> <new.mjs> <library-originals.json> <cache dir> <out.json> [--names names.json] [--every N --offset K]')
  process.exit(1)
}
const option = name => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined }
const OLD = await import(pathToFileURL(path.resolve(oldFile)).href)
const NEW = await import(pathToFileURL(path.resolve(newFile)).href)
const names = option('--names') ? JSON.parse(fs.readFileSync(option('--names'), 'utf8')) : null
const every = Number(option('--every') ?? 1)
const offset = Number(option('--offset') ?? 0)
const docs = JSON.parse(fs.readFileSync(libraryFile, 'utf8'))
  .filter(doc => doc.track?.name)
  .filter((doc, index) => names ? names.includes(doc.track.name) : index % every === offset)
fs.mkdirSync(cacheDir, { recursive: true })

const realFetch = globalThis.fetch
let disk = {}
let live = 0
globalThis.fetch = async (url, init = {}) => {
  const key = `${init.method || 'GET'} ${String(url)} ${init.body ? String(init.body) : ''}`
  if (!disk[key]) {
    live += 1
    const response = await realFetch(url, init)
    const body = Buffer.from(await response.arrayBuffer())
    disk[key] = { status: response.status, type: response.headers.get('content-type') || 'application/json', body: body.toString('base64') }
  }
  const hit = disk[key]
  const body = Buffer.from(hit.body, 'base64')
  return new Response(body.length && hit.status !== 204 && hit.status !== 304 ? body : null, { status: hit.status, headers: { 'content-type': hit.type } })
}

const shape = result => result ? {
  source: result.source, transient: Boolean(result.transient), lyrics: result.syncedLyrics ?? result.plainLyrics ?? '',
  extras: (result.additionalTracks ?? []).map(track => ({ id: `${track.language}/${track.kind}`, source: track.source, lyrics: track.syncedLyrics ?? '' }))
} : null
const rowsOf = text => text.split('\n').filter(Boolean)
const diffRows = (before, after) => {
  const left = rowsOf(before)
  const right = rowsOf(after)
  const rightSet = new Set(right)
  const leftSet = new Set(left)
  return { onlyOld: left.filter(row => !rightSet.has(row)), onlyNew: right.filter(row => !leftSet.has(row)) }
}
const brief = result => result && { source: result.source, transient: result.transient, rows: rowsOf(result.lyrics).length,
  extras: result.extras.map(extra => `${extra.id} ${extra.source} ${rowsOf(extra.lyrics).length}`) }

const report = []
for (const doc of docs) {
  const cacheFile = path.join(cacheDir, `${crypto.createHash('sha1').update(`${doc.track.name}\n${doc.track.artist}`).digest('hex').slice(0, 12)}.json`)
  disk = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {}
  live = 0
  const entry = { name: doc.track.name, artist: doc.track.artist, durationMs: doc.track.durationMs }
  try {
    // The first run fills the cache; both compared runs then replay it.
    await NEW.fetchLyrics(doc.track, null, true)
    const before = shape(await OLD.fetchLyrics(doc.track, null, true))
    const after = shape(await NEW.fetchLyrics(doc.track, null, true))
    entry.live = live
    entry.same = JSON.stringify(before) === JSON.stringify(after)
    if (!entry.same) {
      entry.old = brief(before)
      entry.new = brief(after)
      if (before && after) {
        entry.lyricDiff = diffRows(before.lyrics, after.lyrics)
        entry.extraDiff = Object.fromEntries(after.extras.map(extra => {
          const earlier = before.extras.find(other => other.id === extra.id)
          return [extra.id, earlier ? diffRows(earlier.lyrics, extra.lyrics) : 'new track']
        }))
      }
    }
  } catch (error) {
    entry.error = String(error?.message ?? error)
  }
  fs.writeFileSync(cacheFile, JSON.stringify(disk))
  report.push(entry)
  fs.writeFileSync(outFile, JSON.stringify(report, null, 1))
  console.log(`${report.length}/${docs.length} ${entry.error ? 'ERROR' : entry.same ? 'same' : 'DIFF'} | live requests ${live}`)
  if (live) await new Promise(resolve => setTimeout(resolve, 1500))
}
console.log(`done: ${report.filter(entry => entry.same).length} same of ${report.length}, ${report.filter(entry => entry.error).length} errors`)
process.exit(0)
