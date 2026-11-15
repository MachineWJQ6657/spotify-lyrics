// Integration check of listening calibration's source switching, without audio.
// Simulates verdicts for the song on screen through the debugger-only hook
// `window.__syllableListenQa` (src/lib/listen-controller.ts) and watches the real
// lookups replace the timeline: inconsistent -> next provider -> ... -> back to
// the automatic choice, then inconsistent -> decided keeps the new provider.
// The song is restored to the automatic choice at the end.
//
// Run it only against an ISOLATED test profile, never the user's own:
//   bash scripts/qa/launch-test-instance.sh
//   node scripts/verify-source-chain.mjs
//   bash scripts/qa/quit-test-instance.sh
// A song with timed lyrics must be on screen (Spotify may be paused).
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const target = targets.find(t => t.type === 'page' && t.url.endsWith('index.html'))
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
const state = async () => JSON.parse(await evaluate('JSON.stringify(window.__syllableListenQa.state())'))
const brief = s => ({ shown: s.shown, preference: s.preference, chosenBy: s.chosenBy, unavailable: s.unavailable, trials: s.trials, listened: s.listened, revision: s.revision,
  available: s.available?.map(item => `${item.id}:${item.lines}${item.agrees === false ? '(differs)' : item.agrees === true ? '' : '(unvetted)'}`).join(','), decision: s.decision.reason ?? 'target' })
/** Wait until the pending lookup has answered (the document carries a provider revision again). */
const settled = async (label) => {
  for (let i = 0; i < 60; i++) {
    const s = await state()
    if (s.revision != null) { console.log(label, JSON.stringify(brief(s))); return s }
    await wait(500)
  }
  const s = await state()
  console.log(label, 'NOT SETTLED', JSON.stringify(brief(s)))
  return s
}

await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__syllableQa = true' })
await send('Page.reload')
await wait(6000)
if (!(await evaluate('Boolean(window.__syllableListenQa)'))) { console.error('QA hook missing'); process.exit(1) }
const title = await evaluate("document.querySelector('h1')?.textContent")
console.log('song:', title)
let s = await settled('start        ')
const first = s.shown
const badge = async () => evaluate("document.querySelector('.source-badge em')?.textContent")
const results = []
for (let step = 1; step <= 5; step++) {
  const before = await state()
  if (!(await evaluate("window.__syllableListenQa.verdict('inconsistent')"))) { console.log('verdict refused'); break }
  await wait(400)
  s = await settled(`verdict #${step}   `)
  results.push({ step, from: before.shown, to: s.shown, preference: s.preference, badge: await badge() })
  if (!s.preference) break
}
console.log('chain:', JSON.stringify(results))
const note = await evaluate("(async () => { document.querySelector('.source-badge').click(); await new Promise(r => setTimeout(r, 300)); const text = [...document.querySelectorAll('.source-popover-note')].map(e => e.textContent); document.querySelector('.source-badge').click(); return JSON.stringify(text) })()")
console.log('menu notes at the end:', note)
// A consistent verdict on a listening-chosen provider keeps it: run the chain once more from a clean slate.
await evaluate("(async () => { const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '同步'); tab?.click(); await new Promise(r => setTimeout(r, 300)); const again = [...document.querySelectorAll('button')].find(b => b.textContent.includes('重新校准')); again?.click(); return Boolean(again) })()")
await wait(1500)
s = await settled('after reset  ')
if (await evaluate("window.__syllableListenQa.verdict('inconsistent')")) {
  await wait(400)
  s = await settled('inconsistent ')
  if (s.preference && s.shown === s.preference) {
    await evaluate("window.__syllableListenQa.verdict('decided')")
    await wait(600)
    s = await settled('decided      ')
    console.log('kept:', s.preference === s.shown && s.trials?.[s.shown] === 'consistent', 'badge', await badge())
  }
}
// Restore: forget the simulated verdicts and return to the automatic choice.
await evaluate("(async () => { const again = [...document.querySelectorAll('button')].find(b => b.textContent.includes('重新校准')); again?.click(); await new Promise(r => setTimeout(r, 500)); document.querySelector('.source-badge').click(); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('.source-popover > button')].find(b => b.textContent.includes('自动选择'))?.click(); return true })()")
await wait(1500)
s = await settled('restored     ')
console.log('restored to', s.shown, 'first was', first)
ws.close()
