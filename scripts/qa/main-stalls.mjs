// What the test instance's MAIN process was doing each time its thread was
// busy without a break (launch it with
// `bash scripts/qa/launch-test-instance.sh --inspect=9339`). A CPU profile is
// taken for the given time; every stretch of samples with no idle sample in it
// that lasts at least `minMs` is printed with the functions it spent its time
// in and the deepest stack seen.
//   node scripts/qa/main-stalls.mjs [seconds=60] [minMs=25] [inspector port=9339]
const seconds = Number(process.argv[2] ?? 60)
const minMs = Number(process.argv[3] ?? 25)
const port = Number(process.argv[4] ?? 9339)
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
await send('Profiler.setSamplingInterval', { interval: 1000 })
const startedAt = Date.now()
await send('Profiler.start')
await new Promise(resolve => setTimeout(resolve, seconds * 1000))
const { profile } = await send('Profiler.stop')
ws.close()

const nodes = new Map(profile.nodes.map(node => [node.id, node]))
const parent = new Map()
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
const label = node => {
  const frame = node.callFrame
  const file = (frame.url || '').replace(/^.*[\\/]/, '')
  return `${frame.functionName || '(anonymous)'}${file ? ` ${file}:${frame.lineNumber + 1}` : ''}`
}
const stackOf = nodeId => {
  const out = []
  for (let at = nodeId; at !== undefined; at = parent.get(at)) out.push(label(nodes.get(at)))
  return out
}
const isIdle = nodeId => nodes.get(nodeId).callFrame.functionName === '(idle)'

const stretches = []
let open = null, clock = profile.startTime
for (let index = 0; index < profile.samples.length; index++) {
  clock += profile.timeDeltas[index] ?? 0
  const nodeId = profile.samples[index]
  // The sample stands for the time until the next one.
  const span = profile.timeDeltas[index + 1] ?? 0
  if (isIdle(nodeId)) { if (open) { stretches.push(open); open = null }; continue }
  open ??= { startUs: clock, us: 0, self: new Map(), deepest: [] }
  open.us += span
  const stack = stackOf(nodeId)
  open.self.set(stack[0], (open.self.get(stack[0]) ?? 0) + span)
  // The first frame of our own code on the stack names what the work was for.
  const own = stack.find(frame => /main\.js|chunks|local-spotify|lyrics-provider/.test(frame))
  if (own) open.self.set(`  via ${own}`, (open.self.get(`  via ${own}`) ?? 0) + span)
  if (stack.length > open.deepest.length) open.deepest = stack
}
if (open) stretches.push(open)

const long = stretches.filter(stretch => stretch.us >= minMs * 1000).sort((a, b) => b.us - a.us)
const stamp = us => new Date(startedAt + (us - profile.startTime) / 1000).toISOString().slice(11, 23)
console.log(`${seconds} s profiled; ${long.length} stretch(es) of ${minMs} ms or more without an idle sample, ${Math.round(long.reduce((sum, stretch) => sum + stretch.us, 0) / 1000)} ms together`)
for (const stretch of long.slice(0, 8)) {
  console.log(`\n== ${Math.round(stretch.us / 1000)} ms at ${stamp(stretch.startUs)}Z`)
  for (const [key, value] of [...stretch.self].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`${String(Math.round(value / 1000)).padStart(5)} ms  ${key}`)
  console.log('   deepest stack: ' + stretch.deepest.slice(0, 14).join(' < '))
}
