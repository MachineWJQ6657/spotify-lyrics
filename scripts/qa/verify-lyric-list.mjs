// Checks the main window's lyric list on the ISOLATED test instance, without
// touching the player: the lyric clock is moved through the debugger-only hook
// `window.__syllablePlaybackQa` (src/lib/listen-controller.ts).
//
//   bash scripts/qa/launch-test-instance.sh
//   node scripts/qa/verify-lyric-list.mjs
//   bash scripts/qa/quit-test-instance.sh
//
// A song with timed lyrics must be on screen (Spotify may be paused). Checked:
// - a new line scrolls into place smoothly (several intermediate positions),
//   and ends centred;
// - a right-click opens the row menu and leaves the list following the song;
// - Esc closes the find bar when the focus is not in its input;
// - lyric text can be selected, the rest of the window cannot.
// Nothing here clicks a lyric row with the left button (that would seek the
// player) or a copy item (that would overwrite the clipboard).
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const target = targets.find(item => item.type === 'page' && item.url.endsWith('index.html'))
if (!target) { console.error('main window not found'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id
  const onMessage = event => {
    const message = JSON.parse(event.data)
    if (message.id !== requestId) return
    ws.removeEventListener('message', onMessage)
    message.error ? reject(new Error(message.error.message)) : resolve(message.result)
  }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({ id: requestId, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
  return result.result.value
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const key = async (name, code, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code, modifiers, windowsVirtualKeyCode: name === 'Escape' ? 27 : name === 'f' ? 70 : 0 })
}
const failures = []
const check = (label, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` | ${detail}` : ''}`); if (!ok) failures.push(label) }

await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__syllableQa = true' })
await send('Page.reload')
for (let attempt = 0; attempt < 40; attempt++) {
  await wait(500)
  if (await evaluate('Boolean(window.__syllablePlaybackQa) && document.querySelectorAll(".lyric-group").length > 4').catch(() => false)) break
}
// Real playback must not move the clock under the checks (the user may be listening).
await evaluate('window.__syllablePlaybackHold = true')
const starts = JSON.parse(await evaluate('JSON.stringify(window.__syllablePlaybackQa?.lineStarts() ?? [])'))
if (starts.length < 6) { console.error('no timed lyrics on screen'); process.exit(1) }

// 1. A line change scrolls smoothly. Start inside line k, 700 ms before line k + 1.
const k = Math.min(starts.length - 2, Math.max(2, Math.floor(starts.length / 2)))
await evaluate(`window.__syllablePlaybackQa.position(${starts[k] + 50}, false)`)
await wait(900)
const before = JSON.parse(await evaluate('JSON.stringify({ top: Math.round(document.querySelector(".lyrics-viewport").scrollTop), active: Number(document.querySelector(".lyric-group.active")?.dataset.lineIndex) })'))
await evaluate(`window.__syllablePlaybackQa.position(${starts[k + 1] - 700}, true)`)
const samples = JSON.parse(await evaluate(`new Promise(resolve => {
  const viewport = document.querySelector('.lyrics-viewport'); const seen = []; const t0 = performance.now()
  const tick = () => {
    const top = Math.round(viewport.scrollTop)
    if (!seen.length || seen[seen.length - 1][1] !== top) seen.push([Math.round(performance.now() - t0), top, Number(document.querySelector('.lyric-group.active')?.dataset.lineIndex)])
    if (performance.now() - t0 < 2600) requestAnimationFrame(tick); else resolve(JSON.stringify(seen))
  }
  tick()
})`))
await evaluate(`window.__syllablePlaybackQa.position(${starts[k + 1] + 50}, false)`)
const last = samples[samples.length - 1]
const moved = samples.filter(sample => sample[1] !== before.top)
check('the clock hook moves the active line', last[2] === before.active + 1, `line ${before.active} -> ${last[2]}`)
check('a new line scrolls smoothly', moved.length >= 4, `${moved.length} positions from ${before.top} to ${last[1]}`)
const centred = JSON.parse(await evaluate(`(() => { const viewport = document.querySelector('.lyrics-viewport'); const row = document.querySelector('.lyric-group.active')
  const target = Math.max(0, row.offsetTop + row.offsetHeight / 2 - viewport.clientHeight * .44); return JSON.stringify({ top: Math.round(viewport.scrollTop), target: Math.round(target) }) })()`))
check('and ends centred on the sung line', Math.abs(centred.top - centred.target) <= 2, JSON.stringify(centred))

// 2. Right-click a row: the menu opens, the list keeps following.
const point = JSON.parse(await evaluate(`(() => { const row = document.querySelector('.lyric-group.active') ?? document.querySelector('.lyric-group'); const box = row.getBoundingClientRect(); return JSON.stringify({ x: Math.round(box.left + 40), y: Math.round(box.top + box.height / 2) }) })()`))
for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'right', clickCount: 1 })
await wait(300)
check('a right-click opens the row menu', await evaluate('Boolean(document.querySelector(".lyric-menu"))'))
check('and the list keeps following the song', await evaluate('!document.querySelector(".lyrics-follow-button")'))
await key('Escape', 'Escape')
await wait(200)
check('Esc closes the menu', await evaluate('!document.querySelector(".lyric-menu")'))

// 3. Esc closes the find bar when the focus has left its input.
await key('f', 'KeyF', 2)
await wait(300)
check('Ctrl+F opens the find bar', await evaluate('Boolean(document.querySelector(".lyrics-find"))'))
await evaluate('document.querySelector(".lyrics-viewport").focus()')
await key('Escape', 'Escape')
await wait(200)
check('Esc closes it with the focus in the list', await evaluate('!document.querySelector(".lyrics-find")'))

// 4. Selection.
const select = JSON.parse(await evaluate('JSON.stringify({ lyric: getComputedStyle(document.querySelector(".lyrics-viewport .lyric-primary")).userSelect, body: getComputedStyle(document.body).userSelect })'))
check('lyric text can be selected, the window chrome cannot', select.lyric === 'text' && select.body === 'none', JSON.stringify(select))

await evaluate('window.__syllablePlaybackHold = false')
ws.close()
console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'lyric list checks passed')
process.exit(failures.length ? 1 : 0)
