// Checks the overlay's row colours on the ISOLATED test instance: the defaults,
// a colour chosen for one row arriving in the overlay window, the other rows
// staying as they were, and "restore defaults". It works through the settings
// panel (the overlay window only hears of settings changed there) and leaves
// the test profile as it found it: colours restored, panel tab put back.
// Needs a song with lyrics on screen; the player is not touched.
//
//   bash scripts/qa/launch-test-instance.sh
//   node scripts/qa/verify-overlay-colors.mjs [screenshot prefix]
//   bash scripts/qa/quit-test-instance.sh
import fs from 'node:fs'
const shots = process.argv[2]
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const connect = async suffix => {
  const target = targets.find(item => item.type === 'page' && item.url.endsWith(suffix))
  if (!target) { console.error(`window not found: ${suffix}`); process.exit(1) }
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
  const shot = async name => {
    if (!shots) return
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`${shots}-${name}.png`, Buffer.from(data, 'base64'))
  }
  return { evaluate, shot, close: () => ws.close() }
}
const main = await connect('index.html')
const overlay = await connect('#/overlay')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const failures = []
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` | ${JSON.stringify(detail)}`}`); if (!ok) failures.push(name) }

// The colour each overlay row is painted in, by row.
const painted = () => overlay.evaluate(`(() => {
  const color = selector => { const element = document.querySelector(selector); return element ? getComputedStyle(element).color : null }
  return { original: color('.overlay-primary.karaoke-line'), kana: color('.overlay-secondary.kana'), romaji: color('.overlay-secondary.romanization'), translation: color('.overlay-secondary.translation'), next: color('.overlay-secondary.next-line') }
})()`)
// The swatches of the settings panel: colour and code per row, in order.
const swatches = () => main.evaluate(`[...document.querySelectorAll('.color-row')].map(row => [row.querySelector('input').value, row.querySelector('code').textContent])`)
const choose = (index, value) => main.evaluate(`(() => {
  const input = document.querySelectorAll('.color-row input')[${index}]
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
const saved = () => main.evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('syllable-preferences')).state.settings.overlayColors ?? null)`)
const clickPanel = text => main.evaluate(`(() => { const button = [...document.querySelectorAll('.settings-panel button')].find(item => item.textContent.trim() === ${JSON.stringify(text)}); button?.click(); return Boolean(button) })()`)
const rgb = hex => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`
const WHITE = 'rgb(255, 255, 255)', READING = 'rgb(184, 245, 204)'

const tabBefore = await main.evaluate(`document.querySelector('.panel-tabs [aria-selected="true"]')?.textContent.trim() ?? null`)
const overlayTab = await main.evaluate(`[...document.querySelectorAll('.panel-tabs button')][2]?.textContent.trim() ?? null`)
try {
  check('the overlay tab opens', overlayTab ? await clickPanel(overlayTab) : false, overlayTab)
  await wait(400)
  const before = await swatches()
  check('five rows, each with its default colour', JSON.stringify(before) === JSON.stringify([['#ffffff', '#FFFFFF'], ['#b8f5cc', '#B8F5CC'], ['#b8f5cc', '#B8F5CC'], ['#ffffff', '#FFFFFF'], ['#ffffff', '#FFFFFF']]), before)
  check('nothing to restore yet', await main.evaluate(`document.querySelector('.label-action')?.disabled === true`))
  const start = await painted()
  check('the overlay paints the defaults', start.original === WHITE && (start.romaji ?? READING) === READING && (start.kana ?? READING) === READING && (start.translation ?? WHITE) === WHITE && (start.next ?? WHITE) === WHITE, start)
  await main.shot('1-defaults')

  // One row gets a colour: the original.
  await choose(0, '#ffd166'); await wait(700)
  const one = await painted()
  check('the chosen colour reaches the overlay', one.original === rgb('#ffd166'), one)
  check('the other rows keep their colours', one.romaji === start.romaji && one.kana === start.kana && one.translation === start.translation && one.next === start.next, one)
  check('only that row is saved', await saved() === JSON.stringify({ original: '#ffd166' }), await saved())
  check('restore is offered', await main.evaluate(`document.querySelector('.label-action')?.disabled === false`))

  // Every row a colour of its own.
  const palette = ['#ffd166', '#ff9ecd', '#80c8ff', '#c8f08a', '#d0b3ff']
  for (let index = 1; index < palette.length; index += 1) { await choose(index, palette[index]); await wait(250) }
  await wait(500)
  const all = await painted()
  const rows = ['original', 'kana', 'romaji', 'translation', 'next']
  check('each row shown is in its own colour', rows.every((row, index) => all[row] === null || all[row] === rgb(palette[index])), all)
  check('the swatches show the choices', JSON.stringify((await swatches()).map(item => item[0])) === JSON.stringify(palette), await swatches())
  await main.shot('2-chosen'); await overlay.shot('2-overlay-chosen')

  // A row put back on its default colour is forgotten.
  await choose(0, '#ffffff'); await wait(500)
  check('a row back on its default is no longer saved', !JSON.parse(await saved()).original, await saved())
} finally {
  // Always back to the defaults, whatever failed above.
  await main.evaluate(`document.querySelector('.label-action')?.click()`)
  await wait(700)
  const end = await painted()
  check('restore defaults: the overlay is back to its colours', end.original === WHITE && (end.romaji ?? READING) === READING && (end.kana ?? READING) === READING && (end.translation ?? WHITE) === WHITE && (end.next ?? WHITE) === WHITE, end)
  check('restore defaults: nothing is saved', await saved() === 'null', await saved())
  check('restore defaults: nothing left to restore', await main.evaluate(`document.querySelector('.label-action')?.disabled === true`))
  await overlay.shot('3-overlay-restored')
  if (tabBefore) await clickPanel(tabBefore)
  main.close(); overlay.close()
}
console.log(failures.length ? `overlay colour checks FAILED: ${failures.join(', ')}` : 'overlay colour checks passed')
process.exit(failures.length ? 1 : 0)
