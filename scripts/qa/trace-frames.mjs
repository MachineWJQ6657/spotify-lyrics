// Counts what the ISOLATED test instance draws over a time span: a Chromium
// trace (viz, gpu, cc, toplevel) read back over CDP, summarised by event name
// and process. Frame-producing events show how often each window repaints.
//   node scripts/qa/trace-frames.mjs [seconds=10] [port=9333] [out.json]
import fs from 'node:fs'
const seconds = Number(process.argv[2] ?? 10)
const port = Number(process.argv[3] ?? 9333)
const out = process.argv[4]
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const waiters = new Map()
const events = []
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id && waiters.has(message.id)) { const { resolve, reject } = waiters.get(message.id); waiters.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result) }
  else if (message.method === 'Tracing.tracingComplete') waiters.get('complete')?.resolve(message.params)
})
const send = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; waiters.set(requestId, { resolve, reject }); ws.send(JSON.stringify({ id: requestId, method, params })) })
await send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: ['viz', 'gpu', 'cc', 'toplevel', 'benchmark', 'blink', 'disabled-by-default-devtools.timeline'], recordMode: 'recordContinuously' } })
await new Promise(resolve => setTimeout(resolve, seconds * 1000))
const complete = new Promise(resolve => waiters.set('complete', { resolve }))
await send('Tracing.end')
const { stream } = await complete
let text = ''
for (;;) { const chunk = await send('IO.read', { handle: stream, size: 1 << 20 }); text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data; if (chunk.eof) break }
await send('IO.close', { handle: stream })
ws.close()
const trace = JSON.parse(text)
const list = Array.isArray(trace) ? trace : trace.traceEvents
if (out) fs.writeFileSync(out, JSON.stringify(list))
const names = new Map()
const processNames = new Map()
for (const event of list) {
  if (event.ph === 'M' && event.name === 'process_name') processNames.set(event.pid, event.args?.name)
  if (event.ph !== 'X' && event.ph !== 'B' && event.ph !== 'I' && event.ph !== 'i' && event.ph !== 'n') continue
  const key = `${event.pid}|${event.name}`
  const entry = names.get(key) ?? { count: 0, dur: 0 }
  entry.count += 1; entry.dur += (event.dur ?? 0) / 1000
  names.set(key, entry)
}
const rows = [...names].map(([key, value]) => { const [pid, name] = key.split('|'); return { pid, process: processNames.get(Number(pid)) ?? '?', name, ...value } })
  .filter(row => /Draw|Swap|Frame|Paint|Raster|Commit|Layered|UpdateLayeredWindow|Present|BeginMainFrame|Animat/i.test(row.name))
  .sort((a, b) => b.count - a.count).slice(0, 45)
for (const row of rows) console.log(`${row.process.slice(0, 14).padEnd(14)} ${String(row.pid).padEnd(6)} ${String(row.count).padStart(6)} x ${row.name.slice(0, 60).padEnd(60)} ${row.dur.toFixed(0).padStart(7)} ms (${(row.count / seconds).toFixed(1)}/s)`)
// Bursts of drawn frames (a gap of 60 ms or more starts a new one): with one
// window visible, each burst is one repaint episode, e.g. a lyric line change.
const gpuPid = [...processNames].find(([, name]) => name === 'GPU Process')?.[0]
const draws = list.filter(event => event.pid === gpuPid && event.name === 'Display::DrawAndSwap').map(event => event.ts).sort((a, b) => a - b)
const bursts = []
for (const ts of draws) { const last = bursts[bursts.length - 1]; if (last && ts - last.end < 60000) { last.end = ts; last.frames++ } else bursts.push({ start: ts, end: ts, frames: 1 }) }
console.log(`\ndrawn frames ${draws.length} (${(draws.length / seconds).toFixed(1)}/s) in ${bursts.length} bursts: ` + bursts.map(burst => `${((burst.start - (draws[0] ?? 0)) / 1e6).toFixed(1)}s ${burst.frames}f/${((burst.end - burst.start) / 1000).toFixed(0)}ms`).join('  '))
