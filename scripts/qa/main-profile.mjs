// CPU profile of the test instance's MAIN process JavaScript (launch it with
// `bash scripts/qa/launch-test-instance.sh --inspect=9339`), summarised by
// self time per function and per file.
//   node scripts/qa/main-profile.mjs [seconds=15] [inspector port=9339]
const seconds = Number(process.argv[2] ?? 15)
const port = Number(process.argv[3] ?? 9339)
const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
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
await send('Profiler.setSamplingInterval', { interval: 500 })
await send('Profiler.start')
await new Promise(resolve => setTimeout(resolve, seconds * 1000))
const { profile } = await send('Profiler.stop')
ws.close()
const total = profile.endTime - profile.startTime
const dt = new Map()
for (let index = 0; index < profile.samples.length; index++) dt.set(profile.samples[index], (dt.get(profile.samples[index]) ?? 0) + (profile.timeDeltas[index + 1] ?? 0))
const byFn = new Map(), byFile = new Map()
for (const node of profile.nodes) {
  const self = dt.get(node.id) ?? 0
  if (!self) continue
  const frame = node.callFrame
  const file = (frame.url || '(native)').replace(/^.*[\/]/, '')
  const key = `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber + 1}`
  byFn.set(key, (byFn.get(key) ?? 0) + self)
  byFile.set(file, (byFile.get(file) ?? 0) + self)
}
const pct = value => (value / total * 100).toFixed(2).padStart(6) + '%'
const busy = [...byFn].filter(([key]) => !/^\(idle\)|^\(program\)/.test(key)).reduce((sum, [, value]) => sum + value, 0)
console.log(`main process JS busy ${pct(busy)} of ${seconds} s (program ${pct(byFn.get('(program) (native):0') ?? 0)})`)
for (const [key, value] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(pct(value), key)
console.log('-- by file')
for (const [key, value] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(pct(value), key)
