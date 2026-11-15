// Read-only summary of a saved Syllable profile: how many songs, their
// languages and lyric sources, listening-calibration verdicts, songs without a
// Chinese translation, the library's size, and the display settings.
//
//   ./node_modules/electron/dist/electron.exe scripts/qa/library-stats.cjs <profile directory> [out.json]
//
// Use a COPY or a backup of a profile (for example a `.qa-user-data-preupdate-*`
// directory), never the profile of a running app: this script copies its Local
// Storage into a throwaway directory and opens it in a hidden window whose
// subresources are blocked, so the renderer and its IPC never run.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const source = process.argv[2] && path.resolve(process.argv[2])
const outFile = process.argv[3] && path.resolve(process.argv[3])
if (!source || !fs.existsSync(path.join(source, 'Local Storage'))) {
  console.error('usage: electron scripts/qa/library-stats.cjs <profile directory> [out.json]')
  process.exit(1)
}
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'syllable-stats-'))
fs.cpSync(path.join(source, 'Local Storage'), path.join(target, 'Local Storage'), { recursive: true, filter: name => path.basename(name) !== 'LOCK' })
app.setPath('userData', target)
const timeout = setTimeout(() => app.exit(2), 30000)

const summarize = () => {
  const raw = localStorage.getItem('syllable-preferences') || ''
  const saved = JSON.parse(raw || 'null')
  const docs = Object.values(saved?.state?.library || {})
  const count = (items, key) => items.reduce((all, item) => { const name = key(item); all[name] = (all[name] || 0) + 1; return all }, {})
  const original = doc => (doc.tracks || []).find(track => track.kind === 'original')
  const hasChinese = doc => (doc.tracks || []).some(track => track.kind === 'translation' && String(track.language).startsWith('zh'))
  const foreign = docs.filter(doc => original(doc) && !String(original(doc).language).startsWith('zh'))
  const offsets = docs.filter(doc => doc.listenedOffset?.state === 'decided').map(doc => doc.listenedOffset.offsetMs).sort((a, b) => a - b)
  const settings = saved?.state?.settings || {}
  return {
    songs: docs.length,
    libraryChars: raw.length,
    languages: count(docs, doc => original(doc)?.language || 'none'),
    sources: count(docs, doc => String(original(doc)?.source || 'none').split(' ')[0]),
    providerRevisions: count(docs, doc => String(doc.providerRevision ?? 'none')),
    listening: count(docs, doc => doc.listenedOffset ? doc.listenedOffset.state : doc.offsetMs ? 'manual offset' : 'none'),
    decidedOffsetsMs: offsets.length ? { count: offsets.length, zero: offsets.filter(value => value === 0).length, min: offsets[0], median: offsets[Math.floor(offsets.length / 2)], max: offsets[offsets.length - 1] } : null,
    sourceChosenBy: count(docs.filter(doc => doc.sourcePreference), doc => `${doc.sourceChosenBy || 'user'}:${doc.sourcePreference}`),
    withSourceTrials: docs.filter(doc => doc.sourceTrials).map(doc => ({ name: doc.track?.name, trials: doc.sourceTrials, preference: doc.sourcePreference ?? null })),
    withoutChineseTranslation: foreign.filter(doc => !hasChinese(doc)).map(doc => `${doc.track?.name ?? doc.trackId} — ${doc.track?.artist ?? ''} (${Math.round((doc.track?.durationMs || 0) / 1000)} s, revision ${doc.providerRevision ?? 'none'})`),
    userEdited: docs.filter(doc => doc.userEditedTrackIds?.length).length,
    settings: Object.fromEntries(['overlayVisible', 'positionLocked', 'textOpacity', 'backgroundEnabled', 'fontSize', 'alignment', 'overlayWidth', 'overlayHeight', 'enabledLanguages', 'listenOffset', 'overlayNextLine', 'overlayHideWhenPaused'].map(key => [key, settings[key]]))
  }
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.resourceType !== 'mainFrame' }))
  // The same file origin as the app, so its localStorage is the one read.
  await window.loadURL(pathToFileURL(path.join(__dirname, '..', '..', 'out', 'renderer', 'index.html')).href)
  const result = await window.webContents.executeJavaScript(`(${summarize.toString()})()`)
  const text = JSON.stringify(result, null, 1)
  if (outFile) fs.writeFileSync(outFile, text)
  console.log(text)
  clearTimeout(timeout)
  fs.rmSync(target, { recursive: true, force: true })
  app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1) })
