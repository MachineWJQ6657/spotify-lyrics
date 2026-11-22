// Read-only watch of what Spotify reports while a song plays: the Web API's
// progress and (release) length next to the media session's position and
// length as the test instance's main process holds them. Never sends a command
// to the player. With Spotify's crossfade on, the media session's length is
// shorter by the crossfade time ("short by 7000").
//
//   bash scripts/qa/launch-test-instance.sh
//   node scripts/qa/fade-watch.mjs [token file] [out.json] [seconds=60]
//
// The token comes from `node scripts/qa/spotify-api.cjs login` (default
// <repo>/.qa-scratch/spotify-qa-token.json).
import fs from 'node:fs'
const TOKEN_FILE = process.argv[2] || process.env.SYLLABLE_QA_TOKEN || '.qa-scratch/spotify-qa-token.json'
const OUT = process.argv[3] || '.qa-scratch/fade-watch.json'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = (...parts) => console.log(parts.join(' '))

async function accessToken() {
  const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  if (Date.now() < token.expiresAt - 300000) return token.accessToken
  const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: token.clientId, grant_type: 'refresh_token', refresh_token: token.refreshToken }) })
  if (!response.ok) throw new Error('refresh failed ' + response.status)
  const fresh = await response.json()
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...token, accessToken: fresh.access_token, refreshToken: fresh.refresh_token ?? token.refreshToken, expiresAt: Date.now() + fresh.expires_in * 1000 }), { mode: 0o600 })
  return fresh.access_token
}
async function api(method, endpoint, body) {
  const authorization = 'Bearer ' + await accessToken()
  const t0 = Date.now()
  const response = await fetch('https://api.spotify.com/v1' + endpoint, { method, headers: { authorization, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  const t1 = Date.now()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
  return { status: response.status, body: parsed, t0, t1 }
}
const player = async () => {
  const r = await api('GET', '/me/player')
  const b = r.body
  return { status: r.status, at: Math.round((r.t0 + r.t1) / 2), rtt: r.t1 - r.t0, playing: b?.is_playing, id: b?.item?.id, uri: b?.item?.uri, name: b?.item?.name,
    progress: b?.progress_ms, duration: b?.item?.duration_ms, context: b?.context?.uri, device: b?.device?.name, volume: b?.device?.volume_percent }
}

const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const target = targets.find(item => item.type === 'page' && item.url.endsWith('index.html'))
if (!target) { console.error('main window not found'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id
  const onMessage = event => { const message = JSON.parse(event.data); if (message.id !== requestId) return; ws.removeEventListener('message', onMessage); message.error ? reject(new Error(message.error.message)) : resolve(message.result) }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({ id: requestId, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
  return result.result.value
}
// What the app's main process holds: the media session's (SMTC) view of the track.
const native = async () => JSON.parse(await evaluate(`window.syllable.playback.current().then(s => JSON.stringify(s ? { at: Date.now(), name: s.track?.name, id: s.track?.id, duration: s.track?.durationMs, source: s.track?.sourceDurationMs ?? null, position: Math.round(s.positionMs + (s.isPlaying ? Date.now() - s.observedAtMs : 0)), playing: s.isPlaying, transition: s.transition ? { output: s.transition.outputDurationMs, overlap: s.transition.overlapMs, fadeIn: s.transition.fadeInStartMs } : null } : null))`))
// Both views at (nearly) one moment.
const both = async label => {
  const a = await player()
  const n = await native()
  const nativeAtApi = n ? n.position - (n.playing ? n.at - a.at : 0) : null
  const row = { label, api: { name: a.name, progress: a.progress, duration: a.duration, playing: a.playing, rtt: a.rtt }, native: n ? { name: n.name, duration: n.duration, source: n.source, position: n.position, transition: n.transition } : null,
    nativeMinusApi: nativeAtApi != null && a.progress != null && n.name === a.name ? Math.round(nativeAtApi - a.progress) : null }
  log(' ', label.padEnd(26), 'api', String(a.progress).padStart(7), '/', a.duration, '| native', String(n?.position).padStart(7), '/', n?.duration, '| native-api', row.nativeMinusApi, '|', (a.name ?? '').slice(0, 16), n && n.name !== a.name ? '(native: ' + (n.name ?? '').slice(0, 14) + ')' : '')
  return row
}
// Passive: never sends a command to the player. Rows on each change and every few seconds.
const seconds = Number(process.argv[4] ?? 60)
const rows = []
const end = Date.now() + seconds * 1000
let lastName = null
let tick = 0
while (Date.now() < end) {
  const a = await player()
  const n = await native()
  const nativeAtApi = n ? n.position - (n.playing ? n.at - a.at : 0) : null
  const same = n && a.name === n.name
  const row = { at: a.at, api: { name: a.name, id: a.id, progress: a.progress, duration: a.duration, playing: a.playing, rtt: a.rtt, context: a.context }, native: n ? { name: n.name, duration: n.duration, source: n.source, position: n.position, playing: n.playing, transition: n.transition } : null, nativeMinusApi: same && a.progress != null ? Math.round(nativeAtApi - a.progress) : null }
  rows.push(row)
  if (a.name !== lastName || tick % 5 === 0) log(new Date(a.at).toISOString().slice(11, 19), 'api', String(a.progress).padStart(7), '/', a.duration, a.playing ? 'P' : 'p', '| native', String(n?.position).padStart(7), '/', n?.duration, 'src', n?.source, '| native-api', row.nativeMinusApi, '| short by', n && same ? a.duration - n.duration : '-', '|', (a.name ?? '').slice(0, 18), same ? '' : '(native: ' + (n?.name ?? '').slice(0, 14) + ')')
  lastName = a.name
  tick += 1
  await wait(1200)
}
fs.writeFileSync(OUT, JSON.stringify({ rows }, null, 1))
ws.close()
process.exit(0)
