// Writes the songs of a saved Syllable profile (track metadata and the original
// lyric lines) to a JSON file for compare.mjs / inspect.mjs. Read-only.
//
//   npm run build
//   ./node_modules/electron/dist/electron.exe scripts/qa/provider-compare/dump-originals.cjs <profile directory> .qa-scratch/library-originals.json
//
// Use a COPY or a backup of a profile (for example a `.qa-user-data-preupdate-*`
// directory), never the profile of a running app: this script copies its Local
// Storage into a throwaway directory and opens it in a hidden window whose
// subresources are blocked, so the renderer and its IPC never run. The output
// is the user's library: keep it in .qa-scratch/ (git-ignored).
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const source = process.argv[2] && path.resolve(process.argv[2])
const outFile = process.argv[3] && path.resolve(process.argv[3])
if (!source || !outFile || !fs.existsSync(path.join(source, 'Local Storage'))) {
  console.error('usage: electron scripts/qa/provider-compare/dump-originals.cjs <profile directory> <out.json>')
  process.exit(1)
}
// A copy left by an earlier run (Chromium can still hold it when this process exits).
for (const name of fs.readdirSync(os.tmpdir())) {
  if (name.startsWith('syllable-dump-')) { try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true }) } catch { /* still in use */ } }
}
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'syllable-dump-'))
fs.cpSync(path.join(source, 'Local Storage'), path.join(target, 'Local Storage'), { recursive: true, filter: name => path.basename(name) !== 'LOCK' })
app.setPath('userData', target)
const timeout = setTimeout(() => app.exit(2), 30000)
// The copy is still open while the window lives; remove it once the app has let go.
process.on('exit', () => { try { fs.rmSync(target, { recursive: true, force: true }) } catch { /* left in the temp folder */ } })

const collect = () => {
  const saved = JSON.parse(localStorage.getItem('syllable-preferences') || 'null')
  return Object.values(saved?.state?.library || {}).map(doc => {
    const original = (doc.tracks || []).find(track => track.kind === 'original')
    return { track: doc.track, language: original?.language, source: original?.source,
      lines: (original?.lines || []).map(line => [line.startMs, line.text]) }
  })
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.resourceType !== 'mainFrame' }))
  // The same file origin as the app, so its localStorage is the one read.
  await window.loadURL(pathToFileURL(path.join(__dirname, '..', '..', '..', 'out', 'renderer', 'index.html')).href)
  const songs = await window.webContents.executeJavaScript(`(${collect.toString()})()`)
  fs.writeFileSync(outFile, JSON.stringify(songs, null, 1))
  console.log(`${songs.length} songs written to ${outFile}`)
  clearTimeout(timeout)
  app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1) })
