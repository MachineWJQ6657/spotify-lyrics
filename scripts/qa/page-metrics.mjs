// Per-window renderer work of the ISOLATED test instance over a time span:
// Chromium's Performance metrics of each page (task, script, layout and style
// time, layout and style passes). The windows share one renderer process
// (process-per-site), so this is how its CPU splits between them.
//   node scripts/qa/page-metrics.mjs [seconds=20] [port=9333]
const seconds = Number(process.argv[2] ?? 20)
const port = Number(process.argv[3] ?? 9333)
const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(item => item.type === 'page')
const connect = async target => {
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
  return { ws, send, name: target.url.replace(/^.*index\.html/, '') || 'main' }
}
const pages = await Promise.all(targets.map(connect))
const read = async page => Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]))
for (const page of pages) await page.send('Performance.enable', { timeDomain: 'threadTicks' })
const before = await Promise.all(pages.map(read))
await new Promise(resolve => setTimeout(resolve, seconds * 1000))
const after = await Promise.all(pages.map(read))
const ms = value => (value * 1000).toFixed(0).padStart(6)
for (const [index, page] of pages.entries()) {
  const a = before[index], b = after[index]
  const d = name => (b[name] ?? 0) - (a[name] ?? 0)
  console.log(`${page.name.padEnd(18)} task ${ms(d('TaskDuration'))} ms (${(d('TaskDuration') / seconds * 100).toFixed(2)}%)  script ${ms(d('ScriptDuration'))}  layout ${ms(d('LayoutDuration'))} x${d('LayoutCount')}  style ${ms(d('RecalcStyleDuration'))} x${d('RecalcStyleCount')}  nodes ${b.Nodes}  heap ${(b.JSHeapUsedSize / 1048576).toFixed(1)} MB`)
}
for (const page of pages) page.ws.close()
