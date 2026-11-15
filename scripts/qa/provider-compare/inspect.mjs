// One place of one song, old build against new: the original rows there, each
// build's translation (or romaji) rows, and the NetEase entries' own rows, so a
// difference reported by compare.mjs can be judged against the provider data.
//
//   node scripts/qa/provider-compare/inspect.mjs <old.mjs> <new.mjs> <library-originals.json> <cache dir> "<song name>" <from s> <to s> [entries=1] [romaji]
//
// Uses the same per-song HTTP cache as compare.mjs (offline once the song is cached).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const [oldFile, newFile, libraryFile, cacheDir, name, fromSec, toSec, entries = '1', mode = 'zh'] = process.argv.slice(2)
if (!toSec) {
  console.error('usage: inspect.mjs <old.mjs> <new.mjs> <library-originals.json> <cache dir> "<song name>" <from s> <to s> [entries] [romaji]')
  process.exit(1)
}
const OLD = await import(pathToFileURL(path.resolve(oldFile)).href)
const NEW = await import(pathToFileURL(path.resolve(newFile)).href)
const doc = JSON.parse(fs.readFileSync(libraryFile, 'utf8')).find(item => item.track?.name === name)
if (!doc) { console.error('no such song in the library file'); process.exit(1) }
fs.mkdirSync(cacheDir, { recursive: true })
const cacheFile = path.join(cacheDir, `${crypto.createHash('sha1').update(`${doc.track.name}\n${doc.track.artist}`).digest('hex').slice(0, 12)}.json`)
const disk = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {}
const from = Number(fromSec) * 1000
const to = Number(toSec) * 1000
const realFetch = globalThis.fetch
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
const stampMs = row => {
  const match = row.match(/^\[(\d+):(\d+)\.(\d+)\]/)
  return match ? Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number(match[3].padEnd(3, '0').slice(0, 3)) : Number.NaN
}
const within = text => (text || '').split('\n').filter(row => { const ms = stampMs(row); return ms >= from && ms <= to })

await NEW.fetchLyrics(doc.track, null, true)
const before = await OLD.fetchLyrics(doc.track, null, true)
const after = await NEW.fetchLyrics(doc.track, null, true)
fs.writeFileSync(cacheFile, JSON.stringify(disk))
const wanted = track => mode === 'romaji' ? track.language === 'romaji' : track.language !== 'romaji'
console.log(`ORIGINAL old: ${before?.source} | new: ${after?.source} | live requests ${live}`)
console.log(within(after?.syncedLyrics).join('\n'))
for (const [label, result] of [['OLD', before], ['NEW', after]]) {
  for (const track of (result?.additionalTracks ?? []).filter(wanted)) {
    console.log(`-- ${label} ${track.language} ${track.source}`)
    console.log(within(track.syncedLyrics).join('\n'))
  }
}
let shown = 0
for (const [key, hit] of Object.entries(disk)) {
  if (!key.includes('/song/lyric')) continue
  let json
  try { json = JSON.parse(Buffer.from(hit.body, 'base64').toString('utf8')) } catch { continue }
  const extra = mode === 'romaji' ? json.romalrc?.lyric : json.tlyric?.lyric
  const rows = within(json.lrc?.lyric)
  if (!rows.length || !extra || shown++ >= Number(entries)) continue
  console.log(`-- NETEASE entry ${key.match(/id=(\d+)/)?.[1]}`)
  console.log(rows.join('\n'))
  console.log(`   its ${mode === 'romaji' ? 'romaji' : 'translation'}`)
  console.log(within(extra).join('\n'))
}
process.exit(0)
