// Displayed rows that still have no Chinese translation, on the songs whose
// provider responses are cached (compare.mjs fills the cache). Offline.
//
//   bash scripts/qa/provider-compare/bundle.sh .qa-scratch/provider-new.mjs
//   bash scripts/qa/provider-compare/bundle.sh .qa-scratch/lyrics-new.mjs "" src/lib/lyrics.ts
//   node scripts/qa/provider-compare/untranslated.mjs .qa-scratch/provider-new.mjs .qa-scratch/lyrics-new.mjs .qa-scratch/library-originals.json .qa-scratch/http-cache
//
// Prints the share of untranslated rows and the songs with the most of them.
// This measurement found the two-hop translation loss (猫日: 18 of 38 rows) and
// the staff credits shown as lyrics.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
const [bundle, lyricsBundle, libraryFile, cacheDir] = process.argv.slice(2)
if (!cacheDir) { console.error('usage: untranslated.mjs <provider bundle> <lyrics bundle> <library-originals.json> <cache dir>'); process.exit(1) }
const provider = await import(pathToFileURL(path.resolve(bundle)).href)
const lib = await import(pathToFileURL(path.resolve(lyricsBundle)).href)
const docs = JSON.parse(fs.readFileSync(libraryFile, 'utf8')).filter(doc => doc.track?.name)
let disk = {}
globalThis.fetch = async (url, init = {}) => {
  const hit = disk[`${init.method || 'GET'} ${String(url)} ${init.body ? String(init.body) : ''}`]
  if (!hit) throw new Error('not cached')
  const body = Buffer.from(hit.body, 'base64')
  return new Response(body.length && hit.status !== 204 && hit.status !== 304 ? body : null, { status: hit.status, headers: { 'content-type': hit.type } })
}
const norm = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const out = []
let songs = 0, rows = 0, untranslated = 0
for (const doc of docs) {
  const cacheFile = path.join(cacheDir, `${crypto.createHash('sha1').update(`${doc.track.name}\n${doc.track.artist}`).digest('hex').slice(0, 12)}.json`)
  if (!fs.existsSync(cacheFile)) continue
  disk = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  let result
  try { result = await provider.fetchLyrics(doc.track, null, true) } catch { continue }
  const zh = result?.additionalTracks?.find(track => track.language === 'zh-Hans')
  if (!result?.syncedLyrics || !zh) continue
  const baseLines = lib.parseLrc(result.syncedLyrics)
  const aligned = lib.alignSecondaryTrack(baseLines, lib.parseLrc(zh.syncedLyrics))
  const missing = baseLines.filter((line, index) => !aligned[index] && norm(line.text).length >= 2)
  songs += 1; rows += baseLines.filter(line => norm(line.text).length >= 2).length; untranslated += missing.length
  if (missing.length >= 3) out.push({ name: doc.track.name, rows: baseLines.length, missing: missing.map(line => `${Math.round(line.startMs / 1000)}:${line.text.slice(0, 18)}`) })
}
console.log(`songs ${songs}, rows ${rows}, untranslated ${untranslated} (${(100 * untranslated / Math.max(1, rows)).toFixed(1)} %)`)
out.sort((a, b) => b.missing.length - a.missing.length)
for (const item of out.slice(0, 12)) console.log(`## ${item.name} (${item.missing.length}/${item.rows}) ${item.missing.slice(0, 9).join(' | ')}`)
process.exit(0)
