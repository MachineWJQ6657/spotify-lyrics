// Tiny CDP helper for the locally launched Syllable (remote-debugging-port 9333).
//   node cdp.mjs targets
//   node cdp.mjs shot <urlSubstring> <out.png>
//   node cdp.mjs eval <urlSubstring> "<js expression>"
import { writeFileSync } from 'node:fs'
const [cmd, match, arg] = process.argv.slice(2)
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
if (cmd === 'targets') { for (const t of targets) console.log(t.type, t.title, t.url); process.exit(0) }
const target = targets.find(t => t.type === 'page' && (match.startsWith('=') ? t.url.endsWith(match.slice(1)) : t.url.includes(match)))
if (!target) { console.error('no target matching', match); process.exit(1) }
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
if (cmd === 'shot') {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(arg, Buffer.from(data, 'base64'))
  console.log('saved', arg)
} else if (cmd === 'hover' || cmd === 'click') {
  // node cdp.mjs hover <page> x,y [out.png]
  const [x, y] = arg.split(',').map(Number)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  if (cmd === 'click') { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
  const out = process.argv[5]
  if (out) { await new Promise(r => setTimeout(r, 350)); const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(out, Buffer.from(data, 'base64')); console.log('saved', out) }
} else if (cmd === 'key') {
  // node cdp.mjs key <page> " " | ArrowRight
  const key = arg, code = key === ' ' ? 'Space' : key
  const text = key === ' ' ? ' ' : undefined
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, windowsVirtualKeyCode: key === ' ' ? 32 : key === 'ArrowRight' ? 39 : key === 'ArrowLeft' ? 37 : 0 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key === ' ' ? 32 : key === 'ArrowRight' ? 39 : key === 'ArrowLeft' ? 37 : 0 })
  console.log('key', JSON.stringify(key))
} else if (cmd === 'sized') {
  // node cdp.mjs sized <page> WxH out.png  (layout at another viewport size, then restore)
  const [width, height] = arg.split('x').map(Number)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await new Promise(r => setTimeout(r, 700))
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(process.argv[5], Buffer.from(data, 'base64'))
  await send('Emulation.clearDeviceMetricsOverride')
  console.log('saved', process.argv[5])
} else if (cmd === 'wheel' || cmd === 'dblclick') {
  // node cdp.mjs wheel <page> x,y [deltaY] [modifiers]   |   node cdp.mjs dblclick <page> x,y
  const [x, y] = arg.split(',').map(Number)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  if (cmd === 'wheel') await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: Number(process.argv[5] ?? -100), modifiers: Number(process.argv[6] ?? 2) })
  else for (const clickCount of [1, 2]) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount })
  }
  console.log(cmd, 'sent')
} else if (cmd === 'eval') {
  const result = await send('Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true })
  console.log(typeof result.result.value === 'string' ? result.result.value : JSON.stringify(result.result.value ?? result, null, 1))
}
ws.close()
