// Read-only source profile snapshot. Never launch the normal renderer or IPC.
// electron scripts/inspect-saved-lyrics.cjs <profile> <exact song title>
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const source = path.resolve(process.argv[2])
const title = process.argv[3]
if (!title) throw new Error('Provide a profile directory and exact title')
const parent = path.resolve('.qa-sync-current')
fs.mkdirSync(parent, { recursive: true })
const target = fs.mkdtempSync(path.join(parent, 'preferences-'))
fs.cpSync(path.join(source, 'Local Storage'), path.join(target, 'Local Storage'), { recursive: true, filter: name => path.basename(name) !== 'LOCK' })
app.setPath('userData', target)
const timeout = setTimeout(() => app.exit(2), 15000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.resourceType !== 'mainFrame' }))
  await window.loadURL(pathToFileURL(path.resolve('out/renderer/index.html')).href)
  const result = await window.webContents.executeJavaScript(`(() => {
    const saved = JSON.parse(localStorage.getItem('syllable-preferences') || 'null');
    return { version: saved?.version, defaultOffsetMs: saved?.state?.settings?.offsetMs,
      requestedTitle: ${JSON.stringify(title)}, availableTitles: Object.values(saved?.state?.library || {}).map(doc => doc.track?.name).filter(Boolean).slice(-12),
      documents: Object.values(saved?.state?.library || {}).filter(doc => doc.track?.name === ${JSON.stringify(title)}) };
  })()`)
  fs.writeFileSync(path.join(target, 'song.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ snapshot: path.join(target, 'song.json'), version: result.version, defaultOffsetMs: result.defaultOffsetMs,
    requestedTitle: result.requestedTitle, availableTitles: result.documents.length ? undefined : result.availableTitles,
    documents: result.documents.map(doc => ({ trackId: doc.trackId, track: doc.track, offsetMs: doc.offsetMs, sourceDurationMs: doc.sourceDurationMs,
      providerRevision: doc.providerRevision, updatedAt: doc.updatedAt,
      tracks: doc.tracks.map(track => ({ id: track.id, source: track.source, kind: track.kind, language: track.language,
        count: track.lines.length, firstMs: track.lines[0]?.startMs, lastMs: track.lines.at(-1)?.startMs })) })) }, null, 2))
  clearTimeout(timeout); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1) })
