// Checks the "查歌词" page on the ISOLATED test instance: search a song by text,
// open a hit and read its lyrics, go back, open a song of the library, and
// leave and re-enter the page. The player is not touched; the search and the
// lyric lookup are live requests to LRCLIB and NetEase.
//
//   bash scripts/qa/launch-test-instance.sh
//   node scripts/qa/verify-browse.mjs ["query"] [screenshot prefix]
//   bash scripts/qa/quit-test-instance.sh
import fs from 'node:fs'
const query = process.argv[2] || '夜に駆ける YOASOBI'
const shots = process.argv[3]
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
const until = async (expression, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (await evaluate(expression).catch(() => false)) return true; await wait(250) }
  return false
}
const shot = async name => {
  if (!shots) return
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`${shots}-${name}.png`, Buffer.from(data, 'base64'))
}
const failures = []
const check = (label, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` | ${detail}` : ''}`); if (!ok) failures.push(label) }
const nav = label => evaluate(`(() => { const b = [...document.querySelectorAll('.nav-item')].find(e => e.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return Boolean(b) })()`)
const playing = () => evaluate('JSON.stringify([document.querySelector(".player-bar strong")?.textContent, document.querySelector(".progress-row span")?.textContent])')

const before = await playing()
check('the page is in the sidebar', await nav('查歌词'))
await wait(300)
check('it opens with a search box in focus', await evaluate('document.activeElement === document.querySelector(".browse-page input")'))
const savedShown = await evaluate('document.querySelectorAll(".browse-page .browse-row").length')
console.log(`     songs of the library offered: ${savedShown}`)
await shot('1-empty')

// Type and search (a controlled input: set the value the way React sees it).
await evaluate(`(() => { const input = document.querySelector('.browse-page input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await wait(150)
check('typing offers the online search', await evaluate('Boolean(document.querySelector(".browse-hint")) || document.querySelectorAll(".browse-section").length > 0'))
await evaluate('document.querySelector(".browse-page form").requestSubmit()')
const found = await until('[...document.querySelectorAll(".browse-section h2")].some(e => e.textContent.startsWith("搜索结果"))', 20000)
const hits = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.browse-section')].filter(s => s.querySelector('h2')?.textContent.startsWith('搜索结果')).flatMap(s => [...s.querySelectorAll('.browse-row')]).slice(0, 6).map(row => ({ name: row.querySelector('strong')?.textContent, artist: row.querySelector('.library-copy > span')?.textContent, tags: [...row.querySelectorAll('i')].map(i => i.textContent) })))`))
check('the search lists songs', found && hits.length > 0, hits.slice(0, 4).map(hit => `${hit.name} / ${hit.artist} [${hit.tags.join(' ')}]`).join(' ; ') || await evaluate('document.querySelector(".browse-status")?.textContent ?? ""'))
await shot('2-results')
if (!hits.length) { console.log('FAILED: no results'); process.exit(1) }

// Open the first hit.
await evaluate(`(() => { const section = [...document.querySelectorAll('.browse-section')].find(s => s.querySelector('h2')?.textContent.startsWith('搜索结果')); section.querySelector('.browse-row').click(); return true })()`)
check('opening a hit shows the reader', await until('Boolean(document.querySelector(".browse-reader-header"))', 3000))
const ready = await until('document.querySelectorAll(".lyrics-stage-shell.reading .lyric-group").length > 4 || Boolean(document.querySelector(".lyric-card .empty-lyrics:not(:has(.spinner))"))', 30000)
await wait(1500)
const reader = JSON.parse(await evaluate(`(() => { const shell = document.querySelector('.lyrics-stage-shell.reading'); const rows = [...document.querySelectorAll('.lyrics-stage-shell.reading .lyric-group')]
  return JSON.stringify({ title: document.querySelector('.browse-reader-header h1')?.textContent, rows: rows.length, active: document.querySelectorAll('.lyric-group.active').length,
    translated: rows.filter(row => row.querySelector('.lyric-secondary.translation')).length, romaji: rows.filter(row => row.querySelector('.lyric-secondary.romanization')).length,
    opacity: rows[3] ? getComputedStyle(rows[3]).opacity : null, top: shell ? Math.round(shell.querySelector('.lyrics-viewport').scrollTop) : null,
    follow: Boolean(document.querySelector('.lyrics-follow-button')), source: document.querySelector('.browse-reader-header .source-badges span')?.textContent,
    copy: document.querySelector('.browse-reader-header .header-edit')?.textContent, empty: document.querySelector('.lyric-card .empty-lyrics')?.textContent ?? null, first: rows[0]?.querySelector('.lyric-primary')?.textContent }) })()`))
check('the lyrics of the opened song are on screen', ready && reader.rows > 4 && reader.title === hits[0].name, JSON.stringify(reader))
check('as a page to read: from the top, every row alike, nothing sung, nothing to follow', reader.top === 0 && reader.opacity === '1' && reader.active === 0 && !reader.follow)
await shot('3-reader')
check('the playing song is untouched', JSON.parse(await playing())[0] === JSON.parse(before)[0], `${before} -> ${await playing()}`)

// Esc: back to the same results.
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await wait(300)
check('Esc returns to the results', await evaluate(`!document.querySelector('.browse-reader-header') && document.querySelector('.browse-page input')?.value === ${JSON.stringify(query)} && document.querySelectorAll('.browse-row').length >= ${hits.length > 6 ? 6 : hits.length}`))

// The search survives a visit to another page.
await nav('正在播放'); await wait(300); await nav('查歌词'); await wait(300)
check('the search is still there after visiting another page', await evaluate(`document.querySelector('.browse-page input')?.value === ${JSON.stringify(query)} && [...document.querySelectorAll('.browse-section h2')].some(e => e.textContent.startsWith('搜索结果'))`))

// A song of the library, from the library page.
await nav('歌词资料库'); await wait(400)
const libraryButton = await evaluate('(() => { const b = document.querySelector(".library-actions button[title=\\"查看歌词\\"]"); const name = b?.closest("article")?.querySelector("strong")?.textContent; b?.click(); return name ?? "" })()')
if (libraryButton) {
  await wait(500)
  const saved = JSON.parse(await evaluate('JSON.stringify({ title: document.querySelector(".browse-reader-header h1")?.textContent, rows: document.querySelectorAll(".lyrics-stage-shell.reading .lyric-group").length, eyebrow: document.querySelector(".browse-reader-header .eyebrow")?.textContent, nav: document.querySelector(".nav-item.active")?.textContent })'))
  check('a library song opens for reading at once', saved.title === libraryButton && saved.rows > 0 && saved.nav === '查歌词', JSON.stringify(saved))
  await shot('4-library-song')
  await evaluate('document.querySelector(".browse-back").click()')
  await wait(200)
} else console.log('     (the test library is empty: the library button was not checked)')
await nav('正在播放')
ws.close()
console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'browse checks passed')
process.exit(failures.length ? 1 : 0)
