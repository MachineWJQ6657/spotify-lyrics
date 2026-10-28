// Isolated native/compositor regression fixture; never loads app preferences,
// Spotify bindings, audio, or sends input. Hidden by default. Visible tests are
// secondary-display only and require --visible; their own blue underlay makes
// cropped compositor evidence contain fixture content rather than the desktop.
// electron scripts/verify-overlay-paint.cjs [--visible] [--strategy=both|direct|reset]
//   [--output=.qa-overlay-clip/paint-fixture] [--hold-ms=0]
// Both legacy strategies now exercise unrestricted painting; a custom native
// region is an architectural failure, never evidence that pixels were drawn.
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const koffi = require('koffi')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const value = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const visible = args.includes('--visible')
const strategy = value('strategy', 'both')
if (!['both', 'direct', 'reset'].includes(strategy)) throw Error('Unknown shape strategy')
const output = path.resolve(root, value('output', '.qa-overlay-clip/paint-fixture'))
if (!output.startsWith(path.join(root, '.qa-overlay-clip') + path.sep)) throw Error('Output must stay inside .qa-overlay-clip/')
const holdMs = Number(value('hold-ms', '0'))
if (!Number.isFinite(holdMs) || holdMs < 0 || holdMs > 10000) throw Error('hold-ms must be 0..10000')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'syllable-overlay-paint-')))
app.setName('Syllable isolated overlay paint fixture')
app.on('window-all-closed', () => {})

const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')
const shapeExports = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'electron/overlay-shape.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, { exports: shapeExports })
const makeShape = shapeExports.overlayShape
if (typeof makeShape !== 'function') throw Error('Production overlayShape helper missing')

const user = koffi.load('user32.dll'), gdi = koffi.load('gdi32.dll')
const Rect = koffi.struct('OverlayPaintFixtureRect', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
const getWindowRect = user.func('int __stdcall GetWindowRect(intptr_t hwnd, _Out_ OverlayPaintFixtureRect *rect)')
const getWindowRgn = user.func('int __stdcall GetWindowRgn(intptr_t hwnd, intptr_t region)')
const getDpi = user.func('uint32_t __stdcall GetDpiForWindow(intptr_t hwnd)')
const getStyle = user.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)')
const makeRegion = gdi.func('intptr_t __stdcall CreateRectRgn(int left, int top, int right, int bottom)')
const getRegionData = gdi.func('uint32_t __stdcall GetRegionData(intptr_t region, uint32_t count, void *buffer)')
const deleteObject = gdi.func('int __stdcall DeleteObject(intptr_t object)')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function native(window) {
  const buffer = window.getNativeWindowHandle()
  const hwnd = buffer.length >= 8 ? Number(buffer.readBigUInt64LE()) : buffer.readUInt32LE()
  const region = makeRegion(0, 0, 0, 0)
  try {
    const rect = {}; getWindowRect(hwnd, rect)
    const kind = getWindowRgn(hwnd, region)
    const size = getRegionData(region, 0, null)
    if (size > 1000000) throw Error('Unbounded region diagnostic')
    const data = Buffer.alloc(size)
    if (size) getRegionData(region, size, data)
    const rectangles = []
    if (size >= 32) for (let at = data.readUInt32LE(0); at + 16 <= size; at += 16) {
      rectangles.push({ x: data.readInt32LE(at), y: data.readInt32LE(at + 4), right: data.readInt32LE(at + 8), bottom: data.readInt32LE(at + 12) })
    }
    return { hwnd, rect, dpi: getDpi(hwnd), style: getStyle(hwnd, -16) >>> 0, exStyle: getStyle(hwnd, -20) >>> 0, regionKind: kind, rectangles }
  } finally { deleteObject(region) }
}

function bright(image) {
  const pixels = image.toBitmap()
  let count = 0
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    // All channels are tested, so BGRA/RGBA platform ordering is immaterial.
    if (pixels[at] > 220 && pixels[at + 1] > 220 && pixels[at + 2] > 220 && pixels[at + 3] > 128) count++
  }
  return count
}

// BEGIN PURE PAINT COVERAGE
// Bright neutral/mint text is distinguishable from the fixture's dark blue
// underlay. Comparing each expected text row also detects one missing language
// or a horizontal strip that an overall bright-pixel count would conceal.
function paintCoverage(renderer, composed, regions, viewport) {
  const expectedSize = renderer.getSize(), actualSize = composed.getSize()
  const validSize = size => Number.isInteger(size.width) && Number.isInteger(size.height)
    && size.width > 0 && size.height > 0 && size.width * size.height <= 16_000_000
  if (!validSize(expectedSize) || !validSize(actualSize)
    || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0 || !Array.isArray(regions) || regions.length !== 3) {
    return { passed: false, reason: 'invalid-image-or-three-row-geometry', rows: [] }
  }
  const expected = renderer.toBitmap(), actual = composed.toBitmap()
  if (expected.length < expectedSize.width * expectedSize.height * 4
    || actual.length < actualSize.width * actualSize.height * 4) {
    return { passed: false, reason: 'invalid-bitmap-size', rows: [] }
  }
  const textPixel = (pixels, width, x, y) => {
    const at = (y * width + x) * 4
    return pixels[at + 3] > 128 && Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) > 150
      && Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) > 210
  }
  const rows = regions.map((region, index) => {
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) {
      return { index, passed: false, reason: 'invalid-text-row' }
    }
    const left = Math.max(0, Math.floor(region.x / viewport.width * expectedSize.width))
    const top = Math.max(0, Math.floor(region.y / viewport.height * expectedSize.height))
    const right = Math.min(expectedSize.width, Math.ceil((region.x + region.width) / viewport.width * expectedSize.width))
    const bottom = Math.min(expectedSize.height, Math.ceil((region.y + region.height) / viewport.height * expectedSize.height))
    const bins = Array.from({ length: 8 }, () => ({ expected: 0, covered: 0 }))
    let expectedPixels = 0, coveredPixels = 0, actualPixels = 0
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      if (!textPixel(expected, expectedSize.width, x, y)) continue
      expectedPixels++
      const bin = bins[Math.min(7, Math.floor((x - left) / Math.max(1, right - left) * 8))]
      bin.expected++
      // The two captures can differ by one rounded physical pixel at mixed
      // DPI. A local 2px search tolerates that, not a relocated/missing glyph.
      const actualX = Math.round((x + .5) * actualSize.width / expectedSize.width - .5)
      const actualY = Math.round((y + .5) * actualSize.height / expectedSize.height - .5)
      let covered = false
      for (let yy = Math.max(0, actualY - 2); !covered && yy <= Math.min(actualSize.height - 1, actualY + 2); yy++) {
        for (let xx = Math.max(0, actualX - 2); xx <= Math.min(actualSize.width - 1, actualX + 2); xx++) {
          if (textPixel(actual, actualSize.width, xx, yy)) { covered = true; break }
        }
      }
      if (covered) { coveredPixels++; bin.covered++ }
    }
    const actualLeft = Math.max(0, Math.floor(left / expectedSize.width * actualSize.width))
    const actualTop = Math.max(0, Math.floor(top / expectedSize.height * actualSize.height))
    const actualRight = Math.min(actualSize.width, Math.ceil(right / expectedSize.width * actualSize.width))
    const actualBottom = Math.min(actualSize.height, Math.ceil(bottom / expectedSize.height * actualSize.height))
    for (let y = actualTop; y < actualBottom; y++) for (let x = actualLeft; x < actualRight; x++) {
      if (textPixel(actual, actualSize.width, x, y)) actualPixels++
    }
    const pixelRatio = expectedPixels ? actualPixels / expectedPixels
      * (expectedSize.width * expectedSize.height) / (actualSize.width * actualSize.height) : 0
    const coverage = expectedPixels ? coveredPixels / expectedPixels : 0
    const populatedBins = bins.filter(bin => bin.expected >= 12)
    const minColumnCoverage = populatedBins.length ? Math.min(...populatedBins.map(bin => bin.covered / bin.expected)) : 0
    return { index, expectedPixels, actualPixels, pixelRatio, coverage, minColumnCoverage,
      // Anti-aliasing over an opaque underlay changes counts slightly. Coverage
      // and independent column bins keep this tolerance from accepting strips.
      passed: expectedPixels >= 32 && pixelRatio >= .65 && pixelRatio <= 1.35
        && coverage >= .85 && minColumnCoverage >= .6,
      bins: bins.map(bin => ({ ...bin, coverage: bin.expected ? bin.covered / bin.expected : null })) }
  })
  return { passed: rows.every(row => row.passed), rows,
    thresholds: { minimumExpectedPixelsPerRow: 32, minimumPixelRatio: .65, maximumPixelRatio: 1.35,
      minimumCoverage: .85, minimumPopulatedColumnCoverage: .6, positionTolerancePx: 2 } }
}
// END PURE PAINT COVERAGE

async function composedCrop(display, bounds) {
  const physicalSize = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: physicalSize })
  const source = sources.find(item => item.display_id === String(display.id))
  if (!source || source.thumbnail.isEmpty()) throw Error('Secondary compositor screenshot unavailable')
  const size = source.thumbnail.getSize()
  const scaleX = size.width / display.bounds.width, scaleY = size.height / display.bounds.height
  const crop = { x: Math.round((bounds.x - display.bounds.x) * scaleX), y: Math.round((bounds.y - display.bounds.y) * scaleY),
    width: Math.round(bounds.width * scaleX), height: Math.round(bounds.height * scaleY) }
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.width > size.width || crop.y + crop.height > size.height) throw Error('Fixture crop outside its secondary display')
  return source.thumbnail.crop(crop)
}

const overlayHtml = `<!doctype html><html><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <style>${css}</style><style>.overlay-line-content { animation:none !important; }</style></head><body>
  <div class="overlay-shell center no-background effect-shadow" style="--overlay-size:48px;--overlay-font-weight:700;--overlay-line-height:1.3;--overlay-text-opacity:1;--overlay-radius:12px;--overlay-text-color:#fff;--overlay-blur:0px;--overlay-bg-opacity:.3">
    <div class="overlay-surface"><div class="overlay-lyrics"><div class="overlay-line-content">
      <div lang="ja" class="overlay-primary karaoke-line japanese-grid">青い空を見上げて</div>
      <div class="overlay-secondary translation chinese-text">抬头看看蔚蓝的天空</div>
      <div class="overlay-secondary romanization latin-text">aoi sora wo miagete</div>
    </div></div><span class="overlay-resize-cue" aria-hidden="true"></span></div>
  </div></body></html>`
const underlayHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body { margin:0; width:100%; height:100%; overflow:hidden; background:#234a76; }
  body { box-shadow:inset 0 0 0 2px #45a7c7; background:repeating-linear-gradient(90deg,#234a76 0 40px,#244d79 40px 80px); }
  p { margin:16px; color:#67b3c8; font:14px 'Segoe UI'; }
  </style></head><body><p>Syllable isolated paint fixture — no Spotify / no input</p></body></html>`

const report = { startedAt: new Date().toISOString(), visible, strategy, productionCss: 'src/styles.css',
  verificationScope: visible ? 'actual-secondary-compositor' : 'renderer-only-not-desktop-acceptance',
  compositorVerified: false, passed: false, phases: [] }
// A diagnostic failure must not show Electron's unhandled-exception dialog.
process.on('uncaughtException', error => {
  report.error = error instanceof Error ? error.stack : String(error)
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  app.exit(1)
})
const watchdog = setTimeout(() => { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report, timeout: true }, null, 2)); app.exit(2) }, 55000)

app.whenReady().then(async () => {
  const secondary = screen.getAllDisplays().find(display => display.id !== screen.getPrimaryDisplay().id)
  if (visible && !secondary) throw Error('Visible fixture requires a secondary display; primary untouched')
  const display = secondary ?? screen.getPrimaryDisplay()
  report.display = { id: display.id, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor }
  const area = display.workArea
  const width = Math.min(920, area.width - 160), height = 230
  if (width < 480 || area.height < 400) throw Error('Secondary display too small for this fixture')
  const base = { x: area.x + 80, y: area.y + 100, width, height }
  const underlay = new BrowserWindow({ x: base.x - 30, y: base.y - 50, width: width + 90, height: height + 120,
    show: false, title: 'Syllable isolated paint underlay', frame: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  underlay.setIgnoreMouseEvents(true)
  underlay.setAlwaysOnTop(true, 'screen-saver')
  await underlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(underlayHtml)}`)
  if (visible) { underlay.showInactive(); await sleep(200) }
  for (const mode of strategy === 'both' ? ['direct', 'reset'] : [strategy]) {
    const window = new BrowserWindow({ ...base, minWidth: 480, minHeight: 140,
      show: false, title: `Syllable isolated overlay paint ${mode}`, frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: true, thickFrame: true, hasShadow: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: !visible } })
    window.setAlwaysOnTop(true, 'screen-saver')
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`)
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    if (visible) { window.showInactive(); window.moveTop(); await sleep(250) }
    const capture = async (name, { unshaped = false, ignored = false } = {}) => {
      const metrics = await window.webContents.executeJavaScript(`(() => ({ width:innerWidth, height:innerHeight,
        regions:[...document.querySelectorAll('.overlay-primary,.overlay-secondary')].map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})
      }))()`)
      const bounds = window.getBounds()
      const shape = unshaped ? [] : makeShape(bounds.width, bounds.height, metrics.regions, false)
      // Production no longer invokes SetWindowRgn at all. "reset" retains
      // the former empty-reset path as a comparison, not as production code.
      if (mode === 'reset') window.setShape(shape)
      window.setIgnoreMouseEvents(ignored, { forward: true })
      await sleep(180)
      const prefix = `${mode}-${String(report.phases.filter(item => item.mode === mode).length).padStart(2, '0')}-${name}`
      let scene = null
      if (visible) {
        // Observe native composition first: capturePage() can request a new
        // renderer frame and would otherwise conceal a stale layered surface.
        scene = await composedCrop(display, bounds)
        fs.writeFileSync(path.join(output, `${prefix}-composed.png`), scene.toPNG())
      }
      const renderer = await window.webContents.capturePage(undefined, { stayHidden: !visible })
      fs.writeFileSync(path.join(output, `${prefix}-renderer.png`), renderer.toPNG())
      const coverage = scene ? paintCoverage(renderer, scene, metrics.regions, metrics) : null
      const nativeState = native(window)
      const row = { mode, name, ignored, unshaped, bounds, metrics, shape, native: native(window),
        rendererSize: renderer.getSize(), rendererBrightPixels: bright(renderer),
        composedSize: scene?.getSize() ?? null, composedBrightPixels: scene ? bright(scene) : null,
        coverage, checks: { unrestrictedPaint: shape.length === 0,
          noCustomNativeRegion: nativeState.regionKind === 0 && nativeState.rectangles.length === 0,
          nonemptyThreeRows: metrics.regions.length === 3 && metrics.regions.every(region => region.width > 0 && region.height > 0),
          // Fixed wide text at48px should never be accepted as a few bright
          // edge pixels, even if an unexpected empty renderer masked the loss.
          rendererTextPresent: bright(renderer) >= (name.includes('narrow') ? 100 : 750),
          compositorTextComplete: coverage ? coverage.passed : null } }
      row.passed = Object.values(row.checks).every(check => check !== false)
      report.phases.push(row)
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
      console.log(JSON.stringify({ mode, name, passed: row.passed, dpi: row.native.dpi,
        rendererBright: row.rendererBrightPixels, composedBright: row.composedBrightPixels,
        coverage: coverage?.rows.map(item => ({ row: item.index, coverage: item.coverage, ratio: item.pixelRatio, passed: item.passed })) ?? null }))
      await sleep(holdMs)
    }
    const text = async narrow => window.webContents.executeJavaScript(`(() => {
      document.querySelector('.overlay-primary').textContent=${JSON.stringify(narrow ? '春' : '青い空を見上げて')};
      document.querySelector('.translation').textContent=${JSON.stringify(narrow ? '春' : '抬头看看蔚蓝的天空')};
      document.querySelector('.romanization').textContent=${JSON.stringify(narrow ? 'haru' : 'aoi sora wo miagete')};
    })()`)
    await capture('baseline', { unshaped: true })
    await text(true); await capture('narrow')
    await text(false); await capture('wide')
    window.setPosition(base.x + 24, base.y + 18, false); await capture('moved-wide')
    await capture('locked-shaped', { ignored: true })
    await text(true); await capture('locked-narrow', { ignored: true })
    await text(false); await capture('unlocked-wide')
    window.setBounds({ x: base.x + 24, y: base.y + 18, width: 704, height: 196 }, false)
    await sleep(150); await capture('resized-wide')
    window.setBounds(base, false); await sleep(150); await capture('restored-wide')
    await capture('recovered-unshaped', { unshaped: true, ignored: true })
    window.destroy()
  }
  underlay.destroy()
  const expectedPhases = strategy === 'both' ? 20 : 10
  report.passed = report.phases.length === expectedPhases && report.phases.every(row => row.passed)
  report.compositorVerified = visible && report.passed && report.phases.every(row => row.coverage?.passed === true)
  report.failedPhases = report.phases.filter(row => !row.passed).map(row => ({ mode: row.mode, name: row.name, checks: row.checks }))
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  clearTimeout(watchdog)
  app.exit(report.passed ? 0 : 1)
}).catch(error => {
  report.error = error instanceof Error ? error.stack : String(error)
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.error(report.error)
  clearTimeout(watchdog)
  app.exit(1)
})
