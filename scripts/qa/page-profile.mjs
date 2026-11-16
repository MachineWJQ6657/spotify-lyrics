// CPU profile of one page of the ISOLATED test instance (renderer JavaScript),
// summarised by self time per function and per file.
//   node scripts/qa/page-profile.mjs [page suffix=index.html] [seconds=15] [port=9333]
const suffix = process.argv[2] ?? 'index.html'
const seconds = Number(process.argv[3] ?? 15)
const port = Number(process.argv[4] ?? 9333)
const target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.endsWith(suffix))
if (!target) { console.error('no page ending in', suffix); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id
  const onMessage = event => { const message = JSON.parse(event.data); if (message.id !== requestId) return; ws.removeEventListener('message', onMessage); message.error ? reject(new Error(message.error.message)) : resolve(message.result) }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({ id: requestId, method, params }))
})
await send('Profiler.enable')
await send('Profiler.setSamplingInterval', { interval: 200 })
await send('Profiler.start')
await new Promise(resolve => setTimeout(resolve, seconds * 1000))
const { profile } = await send('Profiler.stop')
ws.close()
const total = profile.endTime - profile.startTime
const self = new Map()
for (let index = 0; index < profile.samples.length; index++) self.set(profile.samples[index], (self.get(profile.samples[index]) ?? 0) + (profile.timeDeltas[index + 1] ?? 0))
const byFn = new Map(), byFile = new Map()
for (const node of profile.nodes) {
  const time = self.get(node.id) ?? 0
  if (!time) continue
  const frame = node.callFrame
  const file = (frame.url || '(native)').replace(/^.*[\/]/, '')
  const key = `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`
  byFn.set(key, (byFn.get(key) ?? 0) + time)
  byFile.set(file, (byFile.get(file) ?? 0) + time)
}
const pct = value => (value / total * 100).toFixed(2).padStart(6) + '%'
const idle = [...byFn].filter(([key]) => /^\(idle\)/.test(key)).reduce((sum, [, value]) => sum + value, 0)
console.log(`busy ${pct(total - idle)} of ${seconds} s`)
for (const [key, value] of [...byFn].sort((a, b) => b[1] - a[1]).filter(([key]) => !/^\(idle\)/.test(key)).slice(0, 25)) console.log(pct(value), key)
console.log('-- by file')
for (const [key, value] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(pct(value), key)
