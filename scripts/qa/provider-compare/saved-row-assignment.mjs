// The row each saved translation / romaji line is shown on, under two builds of
// src/lib/lyrics.ts, for every song of a saved library. A renderer change to
// parsing or row assignment acts on all saved songs at once; this lists what
// it changes. Offline, read-only.
//
//   ./node_modules/electron/dist/electron.exe scripts/qa/provider-compare/dump-originals.cjs .qa-user-data-preupdate-<n> .qa-scratch/library-originals.json
//   bash scripts/qa/provider-compare/bundle.sh .qa-scratch/lyrics-old.mjs <git ref> src/lib/lyrics.ts
//   bash scripts/qa/provider-compare/bundle.sh .qa-scratch/lyrics-new.mjs "" src/lib/lyrics.ts
//   node scripts/qa/provider-compare/saved-row-assignment.mjs .qa-scratch/library-originals.json .qa-scratch/lyrics-old.mjs .qa-scratch/lyrics-new.mjs
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const [libraryFile, oldBundle, newBundle] = process.argv.slice(2)
if (!newBundle) { console.error('usage: saved-row-assignment.mjs <library-originals.json> <old lyrics bundle> <new lyrics bundle>'); process.exit(1) }
const docs = JSON.parse(fs.readFileSync(libraryFile, 'utf8')).map(doc => ({ name: doc.track?.name, untimed: doc.untimed, tracks: doc.tracks ?? [] }))
const versions = { old: await import(pathToFileURL(path.resolve(oldBundle)).href), now: await import(pathToFileURL(path.resolve(newBundle)).href) }
const shown = (lib, doc) => {
  const tracks = lib.visibleTracks({ trackId: 'x', tracks: doc.tracks }, ['ja', 'romaji', 'zh-Hans', 'en', 'custom'], true)
  const base = tracks.find(track => track.kind === 'original') ?? tracks[0]
  if (!base) return []
  return tracks.filter(track => track.id !== base.id).map(track => ({ id: track.id, base: base.lines.map(line => line.text), rows: lib.alignSecondaryTrack(base.lines, track.lines).map(line => line?.text ?? '') }))
}
let songs = 0, tracks = 0
const diff = { 'old->new': [] }
for (const doc of docs) {
  if (doc.untimed || !doc.tracks.length) continue
  songs += 1
  const out = Object.fromEntries(Object.entries(versions).map(([name, lib]) => [name, shown(lib, doc)]))
  tracks += out.now.length
  for (const [label, from] of [['old->new', 'old']]) {
    out.now.forEach((track, index) => {
      const earlier = out[from][index]
      if (!earlier || earlier.base.length !== track.base.length) { diff[label].push(`${doc.name}: ${track.id.slice(-12)} row count ${earlier?.base.length} -> ${track.base.length}`); return }
      const changed = track.rows.flatMap((text, row) => text !== earlier.rows[row] ? [row] : [])
      if (changed.length) diff[label].push(`${doc.name}: ${track.id.slice(-10)} ${changed.length} rows, e.g. row ${changed[0]} [${track.base[changed[0]].slice(0, 14)}] ${JSON.stringify(earlier.rows[changed[0]].slice(0, 16))} -> ${JSON.stringify(track.rows[changed[0]].slice(0, 16))}`)
    })
  }
}
console.log('songs', songs, 'secondary tracks', tracks)
for (const [label, list] of Object.entries(diff)) { console.log(`${label}: ${list.length} tracks differ`); for (const item of list.slice(0, 14)) console.log('  ' + item.slice(0, 170)) }
