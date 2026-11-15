// Live check of the lyric clock on the isolated test instance, with real playback.
//   bash scripts/qa/launch-test-instance.sh
//   node scripts/qa/live-check.mjs [token file] [out.json]
//   node scripts/qa/live-analyse.mjs [out.json]
//   bash scripts/qa/quit-test-instance.sh
// The token file comes from `node scripts/qa/spotify-api.cjs login` (default
// <repo>/.qa-scratch/spotify-qa-token.json, git-ignored). Only this PC's
// Spotify (%COMPUTERNAME%) is ever targeted.
// Reads what the window SHOWS (progress bar width = displayed position, the
// active lyric row, the list's scrollTop) while the player is paused, resumed,
// seeked by clicking a lyric row, and moved to another track. When the player
// was paused before, the volume is 0 during the check, and the track,
// position, paused state and volume are restored at the end.
import fs from 'node:fs'
const TOKEN_FILE = process.argv[2] || process.env.SYLLABLE_QA_TOKEN || '.qa-scratch/spotify-qa-token.json'
const OUT = process.argv[3] ?? '.qa-scratch/live-check.json'
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

// ---- CDP
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const target = targets.find(item => item.type === 'page' && item.url.endsWith('index.html'))
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
const clickAt = async expression => {
  const box = JSON.parse(await evaluate(`(() => { const e = ${expression}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), h: innerHeight }) })()`))
  if (!box || box.y < 0 || box.y > box.h) throw new Error('not clickable: ' + expression + ' ' + JSON.stringify(box))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  const at = Date.now()
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  return at
}
// Every 8 ms: the progress bar (displayed position), the active row and the list's scrollTop.
const SAMPLER = `(() => { if (window.__live) return 'present'
  const L = window.__live = { clock: [], lines: [], scroll: [], snaps: [], dur: 0, track: '' }
  window.syllable.playback.onUpdate(s => { L.dur = s?.track?.durationMs ?? 0; L.track = s?.track?.id ?? ''
    L.snaps.push([Date.now(), (s?.track?.id ?? '').slice(-6), Math.round(s?.positionMs ?? -1), s?.observedAtMs ?? 0, s?.isPlaying ? 1 : 0]) })
  let lastW = '', lastA = -2, lastTop = -1
  setInterval(() => { const now = Date.now()
    const bar = document.querySelector('.progress-track i'); const w = bar ? bar.style.width : ''
    if (w !== lastW) { lastW = w; L.clock.push([now, parseFloat(w), L.dur, L.track.slice(-6)]) }
    const a = document.querySelector('.lyric-group.active'); const ai = a ? Number(a.dataset.lineIndex) : -1
    if (ai !== lastA) { lastA = ai; L.lines.push([now, ai, L.track.slice(-6)]) }
    const v = document.querySelector('.lyrics-viewport'); const top = v ? Math.round(v.scrollTop) : -1
    if (top !== lastTop) { lastTop = top; L.scroll.push([now, top]) }
  }, 8)
  return 'installed' })()`
const lineStarts = async () => JSON.parse(await evaluate('JSON.stringify(window.__syllablePlaybackQa?.lineStarts() ?? [])'))
const lyricRows = () => evaluate('document.querySelectorAll(".lyric-group").length')
const activeIndex = async () => Number(await evaluate('document.querySelector(".lyric-group.active")?.dataset.lineIndex ?? -1'))
const trackShown = () => evaluate('window.__live?.track ?? ""')

const marks = []
const mark = (name, at = Date.now(), extra = {}) => { marks.push({ name, at, ...extra }); log('  mark', name) }
const notes = []
let original = null
let deviceQuery = ''
let failed = null
try {
  const devices = (await api('GET', '/me/player/devices')).body?.devices ?? []
  const wanted = (process.env.COMPUTERNAME || '').toLowerCase()
  const device = devices.find(d => d.name.toLowerCase() === wanted)
  if (!wanted || !device) throw new Error('this PC is not among the devices')
  deviceQuery = '?device_id=' + encodeURIComponent(device.id)
  let state = await player()
  if (state.status === 204 || !state.id) { await api('PUT', '/me/player', { device_ids: [device.id], play: false }); await wait(1800); state = await player() }
  if (!state.id) throw new Error('no track to play (status ' + state.status + ')')
  if (state.device && state.device.toLowerCase() !== wanted) throw new Error('another device is active')
  original = { ...state, volume: state.volume ?? device.volume_percent }
  log('original:', JSON.stringify({ name: original.name, progress: original.progress, playing: original.playing, volume: original.volume, context: original.context }))
  if (!original.playing) {
    const r = await api('PUT', '/me/player/volume' + deviceQuery + '&volume_percent=0')
    log('volume 0 status', r.status)
  }

  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__syllableQa = true' })
  await send('Page.reload')
  for (let attempt = 0; attempt < 40; attempt++) { await wait(500); if (await evaluate('Boolean(window.__syllablePlaybackQa && window.syllable)').catch(() => false)) break }
  log('sampler', await evaluate(SAMPLER))
  if (!original.playing) {
    const r = await api('PUT', '/me/player/play' + deviceQuery)
    log('resume status', r.status)
    if (r.status >= 400) throw new Error('resume refused: ' + JSON.stringify(r.body))
  }
  for (let attempt = 0; attempt < 50; attempt++) { await wait(500); if (await lyricRows() > 4) break }
  const starts = await lineStarts()
  log('lyric rows', await lyricRows(), 'timed lines', starts.length)
  await wait(2500)

  // 1. Steady playback.
  mark('steady'); await wait(14000)
  marks.push({ name: 'api', at: 0, sample: await player() })
  const centred = await evaluate(`(() => { const viewport = document.querySelector('.lyrics-viewport'); const row = document.querySelector('.lyric-group.active'); if (!viewport || !row) return 'none'
    return JSON.stringify({ top: Math.round(viewport.scrollTop), target: Math.round(Math.max(0, row.offsetTop + row.offsetHeight / 2 - viewport.clientHeight * .44)) }) })()`)
  notes.push('centred after steady playback: ' + centred)

  // 2. Paused from Spotify, then resumed.
  { const r = await api('PUT', '/me/player/pause' + deviceQuery); mark('pause-external', r.t0, { done: r.t1, status: r.status }) }
  await wait(4000)
  marks.push({ name: 'api-paused', at: 0, sample: await player() })
  { const r = await api('PUT', '/me/player/play' + deviceQuery); mark('resume-external', r.t0, { done: r.t1, status: r.status }) }
  await wait(9000)
  marks.push({ name: 'api', at: 0, sample: await player() })

  // 3. A quick pause and play from Spotify.
  { const r = await api('PUT', '/me/player/pause' + deviceQuery); mark('quick-pause-external', r.t0, { done: r.t1, status: r.status }) }
  await wait(250)
  { const r = await api('PUT', '/me/player/play' + deviceQuery); mark('quick-resume-external', r.t0, { done: r.t1, status: r.status }) }
  await wait(9000)
  marks.push({ name: 'api', at: 0, sample: await player() })

  // 4. Syllable's own button: pause, play, and a quick pause and play.
  const button = '.transport-buttons button'
  mark('pause-button', await clickAt(`document.querySelectorAll('${button}')[1]`)); await wait(3500)
  marks.push({ name: 'api-paused', at: 0, sample: await player() })
  mark('play-button', await clickAt(`document.querySelectorAll('${button}')[1]`)); await wait(8000)
  mark('quick-pause-button', await clickAt(`document.querySelectorAll('${button}')[1]`)); await wait(350)
  mark('quick-play-button', await clickAt(`document.querySelectorAll('${button}')[1]`)); await wait(8000)
  marks.push({ name: 'api', at: 0, sample: await player() })

  // 5. A click on a lyric row, then two more clicks on the same row.
  const active = await activeIndex()
  if (active >= 0 && starts.length > active + 3) {
    const row = active + 2
    await evaluate(`document.querySelector('[data-line-index="${row}"]')?.scrollIntoView({ block: 'center' })`)
    await wait(300)
    mark('seek-row', await clickAt(`document.querySelector('[data-line-index="${row}"]')`), { row, start: starts[row] }); await wait(7000)
    marks.push({ name: 'api', at: 0, sample: await player() })
    await evaluate(`document.querySelector('[data-line-index="${row}"]')?.scrollIntoView({ block: 'center' })`)
    await wait(300)
    mark('seek-same-row', await clickAt(`document.querySelector('[data-line-index="${row}"]')`), { row, start: starts[row] }); await wait(3000)
    mark('seek-same-row-again', await clickAt(`document.querySelector('[data-line-index="${row}"]')`), { row, start: starts[row] }); await wait(8000)
    marks.push({ name: 'api', at: 0, sample: await player() })
  } else notes.push('no lyric rows to click (active ' + active + ', lines ' + starts.length + ')')

  // 6. Next track from Syllable's button.
  const before = await trackShown()
  mark('next-button', await clickAt(`document.querySelectorAll('${button}')[2]`))
  for (let attempt = 0; attempt < 40; attempt++) { await wait(250); if (await trackShown() !== before) break }
  mark('track-changed'); await wait(13000)
  marks.push({ name: 'api', at: 0, sample: await player() })

  // 7. The song ends on its own.
  const now = await player()
  if (now.duration) {
    const second = await trackShown()
    const r = await api('PUT', '/me/player/seek' + deviceQuery + '&position_ms=' + Math.max(0, now.duration - 9000))
    mark('seek-near-end', r.t0, { status: r.status })
    for (let attempt = 0; attempt < 100; attempt++) { await wait(250); if (await trackShown() !== second) break }
    mark('track-ended'); await wait(13000)
    marks.push({ name: 'api', at: 0, sample: await player() })
  }
} catch (error) { failed = String(error?.message ?? error); log('FAILED', failed) }

// ---- Restore: the original track, position, paused state and volume.
try {
  if (original && deviceQuery) {
    let state = await player()
    if (!original.playing) {
      if (state.playing) await api('PUT', '/me/player/pause' + deviceQuery)
      if (state.id !== original.id) {
        const r = original.context ? await api('PUT', '/me/player/play' + deviceQuery, { context_uri: original.context, offset: { uri: original.uri }, position_ms: original.progress }) : { status: 0 }
        if (r.status >= 200 && r.status < 300) { await wait(700); await api('PUT', '/me/player/pause' + deviceQuery) }
        else for (let attempt = 0; attempt < 4; attempt++) {
          await api('PUT', '/me/player/seek' + deviceQuery + '&position_ms=0'); await wait(300)
          await api('POST', '/me/player/previous' + deviceQuery); await wait(900)
          await api('PUT', '/me/player/pause' + deviceQuery); await wait(300)
          if ((await player()).id === original.id) break
        }
      }
      await wait(400)
      await api('PUT', '/me/player/seek' + deviceQuery + '&position_ms=' + original.progress)
      await wait(600)
      state = await player()
      if (state.playing) { await api('PUT', '/me/player/pause' + deviceQuery); await wait(400); state = await player() }
      const r = await api('PUT', '/me/player/volume' + deviceQuery + '&volume_percent=' + original.volume)
      log('restored:', JSON.stringify({ name: state.name, same: state.id === original.id, progress: state.progress, playing: state.playing, volumeStatus: r.status, volume: original.volume }))
    } else log('the player was playing before the check: left as it is')
  }
} catch (error) { log('RESTORE FAILED', String(error?.message ?? error)) }

const live = JSON.parse(await evaluate('JSON.stringify(window.__live ?? null)').catch(() => 'null'))
fs.writeFileSync(OUT, JSON.stringify({ failed, original, marks, notes, live }))
log('written', OUT, 'clock samples', live?.clock?.length ?? 0, 'line changes', live?.lines?.length ?? 0, 'scroll samples', live?.scroll?.length ?? 0)
process.exit(failed ? 1 : 0)
