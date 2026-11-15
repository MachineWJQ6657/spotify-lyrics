// Passive console sweep: click through views, panel, editor and library without touching playback.
const targets = (await (await fetch('http://127.0.0.1:9333/json')).json()).filter(t => t.type === 'page')
const issues = []; let id = 0; const sockets = []
for (const target of targets) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  const label = target.url.split('#')[1] || 'main'
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data)
    if (m.method === 'Runtime.exceptionThrown') issues.push({ page: label, kind: 'exception', text: m.params.exceptionDetails?.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails?.text })
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) issues.push({ page: label, kind: m.params.type, text: m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300) })
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) issues.push({ page: label, kind: `log-${m.params.entry.level}`, text: `${m.params.entry.text}`.slice(0, 300) })
  })
  for (const method of ['Runtime.enable', 'Log.enable']) ws.send(JSON.stringify({ id: ++id, method }))
  sockets.push({ ws, label })
}
const main = sockets.find(s => s.label === 'main').ws
const evaluate = expression => new Promise(resolve => {
  const requestId = ++id
  const onMessage = event => { const m = JSON.parse(event.data); if (m.id !== requestId) return; main.removeEventListener('message', onMessage); resolve(m.result?.result?.value) }
  main.addEventListener('message', onMessage)
  main.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
const nav = label => evaluate(`(() => { const b = [...document.querySelectorAll('.sidebar button')].find(x => x.textContent.includes(${JSON.stringify(label)})); b?.click(); return !!b })()`)
for (const view of ['歌词资料库', '歌词源', '偏好设置', '帮助与诊断', '正在播放']) { await nav(view); await sleep(700); console.log(view, await evaluate('document.querySelector(".titlebar-center").textContent')) }
console.log('collapse', await evaluate(`(() => { document.querySelector('.panel-collapse').click(); return 1 })()`)); await sleep(500)
console.log('rail', await evaluate(`!!document.querySelector('.settings-rail')`))
await evaluate(`document.querySelector('.settings-rail button').click()`); await sleep(500)
console.log('panel back', await evaluate(`!!document.querySelector('.settings-panel')`))
await evaluate(`document.querySelector('.header-edit').click()`); await sleep(900)
console.log('editor', await evaluate(`(() => { const p = document.querySelector('.line-editor-row.playing'); return p ? 'playing row ' + p.dataset.row : 'no playing row' })()`))
await evaluate(`document.querySelector('.lyrics-editor .editor-header button').click()`); await sleep(400)
await nav('歌词资料库'); await sleep(500)
console.log('library', await evaluate(`document.querySelector('.library-toolbar')?.innerText`))
await nav('正在播放'); await sleep(1500)
console.log('issues', JSON.stringify(issues, null, 1))
for (const s of sockets) s.ws.close()
