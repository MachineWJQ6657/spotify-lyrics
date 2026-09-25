// Electron-only visual regression: real overlay CSS on light/dark/busy surfaces.
// No Spotify connection, audio capture, visible windows or user preferences.
// electron scripts/verify-overlay-contrast.cjs [release/win-unpacked]
const { app, BrowserWindow, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const output = path.resolve('.qa-overlay-contrast')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'profile'))
// Each scale gets its own compositor; closing one must not quit the runner.
app.on('window-all-closed', () => {})
const packageDirectory = process.argv[2]
const css = packageDirectory ? (() => {
  const asar = require('@electron/asar')
  const archive = path.resolve(packageDirectory, 'resources/app.asar')
  return asar.listPackage(archive).filter(entry => /[\\/]renderer[\\/].*\.css$/.test(entry))
    .map(entry => asar.extractFile(archive, entry.replace(/^[\\/]/, '')).toString()).join('\n')
})() : fs.readFileSync(path.resolve('src/styles.css'), 'utf8')
if (!css.includes('overlay-secondary')) throw new Error('Overlay CSS missing')
const watchdog = setTimeout(() => { console.error('Contrast QA timed out'); app.exit(2) }, 30000)
app.whenReady().then(async () => {
  const secondary = screen.getAllDisplays().find(display => display.id !== screen.getPrimaryDisplay().id)
  const modes = ['shadow', 'outline', 'none']
  const surfaces = ['white', 'gray', 'dark', 'busy']
  const cards = surfaces.flatMap(surface => modes.map(mode => `
    <section class="sample ${surface}"><label>${surface} / ${mode}</label>
      <div class="overlay-shell no-background effect-${mode}">
        <div class="overlay-surface"><div class="overlay-lyrics"><div class="overlay-line-content">
          <div lang="ja" class="overlay-primary japanese-grid">青い空を見上げて</div>
          <div lang="ja-Latn" class="overlay-secondary romanization latin-text">aoi sora wo miagete</div>
          <div lang="zh" class="overlay-secondary translation chinese-text">抬头看看蔚蓝的天空</div>
        </div></div></div>
      </div>
    </section>`)).join('')
  // Fixture styles control only the surrounding desktop/layout, never text
  // color, stroke, shadow, weight or size of either secondary line.
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <style>${css}</style><style>
      html, body { width:100%; height:100%; margin:0; overflow:hidden; background:#242424; }
      #matrix { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:8px; }
      .sample { height:calc((100vh - 40px) / 4); position:relative; overflow:hidden; }
      .sample label { position:absolute; left:12px; top:8px; color:#555; font:12px Arial; }
      .sample.dark label { color:#aaa; }
      .white { background:#fff; } .gray { background:#aaa; } .dark { background:#101010; }
      .busy { background:repeating-linear-gradient(125deg,#fff 0 35px,#7b7b7b 35px 70px,#222 70px 105px); }
      .sample.busy label { background:#fff; padding:2px; }
      .sample .overlay-shell { position:absolute; inset:22px 0 0; width:100%; height:auto;
        --overlay-size:28px; --overlay-font-weight:600; --overlay-text-color:#fff;
        --overlay-line-height:1.3; --overlay-text-opacity:1; }
      .sample .overlay-lyrics { padding:10px 16px; }
      .sample .overlay-surface { min-height:0; }
      .sample .overlay-line-content { animation:none; }
    </style></head><body><div id="matrix">${cards}</div></body></html>`
  const report = []
  for (const zoom of [1, 1.25, 1.5]) {
    const window = new BrowserWindow({
      show: false, x: secondary?.workArea.x, y: secondary?.workArea.y,
      width: Math.ceil(1080 * zoom), height: Math.ceil(760 * zoom), useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true, zoomFactor: zoom }
    })
    let lastFrame
    let frameSize
    let frameRevision = 0
    window.webContents.on('paint', (_event, _dirty, image) => {
      const png = image.toPNG()
      if (png.length > 0) { lastFrame = png; frameSize = image.getSize(); frameRevision += 1 }
    })
    window.webContents.setFrameRate(30)
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const metrics = await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      return [...document.querySelectorAll('.sample')].map(card => ({
        sample: card.querySelector('label').textContent,
        fullyVisible: card.getBoundingClientRect().bottom <= innerHeight,
        surface: getComputedStyle(card.querySelector('.overlay-surface')).backgroundColor,
        lines: [...card.querySelectorAll('.overlay-secondary')].map(line => {
          const s = getComputedStyle(line);
          return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight),
            stroke: parseFloat(s.webkitTextStrokeWidth), strokeColor: s.webkitTextStrokeColor,
            paintOrder: s.paintOrder, shadow: s.textShadow, color: s.color,
            opacity: getComputedStyle(line.closest('.overlay-lyrics')).opacity };
        })
      }));
    })()`)
    const passed = metrics.length === 12 && metrics.every(card =>
      card.fullyVisible && card.surface === 'rgba(0, 0, 0, 0)' && card.lines.length === 2 &&
      card.lines.every((line, index) => line.size >= (index === 0 ? 16 : 18) &&
        line.weight >= 600 && line.stroke >= 1.5 && line.strokeColor === 'rgb(18, 18, 18)' &&
        line.paintOrder.startsWith('stroke') && line.shadow !== 'none' && line.opacity === '1'))
    const previousRevision = frameRevision
    window.webContents.invalidate()
    for (let attempt = 0; attempt < 50 && frameRevision <= previousRevision; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!lastFrame || frameRevision <= previousRevision) throw new Error('No fresh offscreen frame')
    fs.writeFileSync(path.join(output, `contrast-${zoom}.png`), lastFrame)
    report.push({ zoom, passed: passed && frameSize.width >= 1080 * zoom, frameSize, metrics })
    window.destroy()
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ packageDirectory, report }, null, 2))
  console.log(JSON.stringify(report.map(({ zoom, passed, metrics }) => ({ zoom, passed, cards: metrics.length }))))
  clearTimeout(watchdog)
  app.exit(report.every(result => result.passed) ? 0 : 1)
}).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1) })
