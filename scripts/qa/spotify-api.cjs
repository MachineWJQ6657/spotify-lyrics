// Minimal Spotify Web API helper for automated QA (official API, PKCE, no secret).
// The token stays in <repo>/.qa-scratch (git-ignored), or where SYLLABLE_QA_TOKEN points.
//   node spotify-api.cjs login --client-id=XXXX      (prints the consent URL, waits for callback)
//   node spotify-api.cjs player                      (GET /me/player summary)
//   node spotify-api.cjs play --context=spotify:playlist:ID [--offset=0] [--position=0]
//   node spotify-api.cjs devices
const crypto = require('node:crypto')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const REDIRECT_URI = 'http://127.0.0.1:43821/callback'
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing'
const TOKEN_FILE = process.env.SYLLABLE_QA_TOKEN || path.join(__dirname, '..', '..', '.qa-scratch', 'spotify-qa-token.json')
const arg = (name, fallback) => {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const base64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const saveToken = token => fs.writeFileSync(TOKEN_FILE, JSON.stringify(token), { mode: 0o600 })

async function login() {
  const clientId = arg('client-id', '')
  if (!clientId) throw new Error('--client-id is required')
  const verifier = base64url(crypto.randomBytes(48))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  const state = base64url(crypto.randomBytes(16))
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state
  })
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const query = new URL(request.url, REDIRECT_URI).searchParams
      if (!request.url.startsWith('/callback')) { response.writeHead(404).end(); return }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      if (query.get('state') !== state || !query.get('code')) {
        response.end('Authorization failed. You can close this tab.')
        server.close(); reject(new Error(query.get('error') || 'state mismatch')); return
      }
      response.end('Syllable QA authorized. You can close this tab.')
      server.close(); resolve(query.get('code'))
    })
    server.listen(43821, '127.0.0.1', () => console.log(`AUTHORIZE_URL ${url}`))
    setTimeout(() => { server.close(); reject(new Error('login timed out')) }, 10 * 60 * 1000)
  })
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier })
  })
  if (!response.ok) throw new Error(`token exchange failed: ${response.status} ${await response.text()}`)
  const token = await response.json()
  saveToken({ clientId, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 })
  console.log('LOGIN_OK scopes:', token.scope)
}

async function accessToken() {
  const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  if (Date.now() < token.expiresAt - 60000) return token.accessToken
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: token.clientId, grant_type: 'refresh_token', refresh_token: token.refreshToken })
  })
  if (!response.ok) throw new Error(`refresh failed: ${response.status} ${await response.text()}`)
  const fresh = await response.json()
  saveToken({ ...token, accessToken: fresh.access_token, refreshToken: fresh.refresh_token ?? token.refreshToken, expiresAt: Date.now() + fresh.expires_in * 1000 })
  return fresh.access_token
}

async function api(method, endpoint, body, extraHeaders) {
  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    method, headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}), ...(extraHeaders ?? {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await response.text()
  let parsed = null; try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text.slice(0, 80) } }
  return { status: response.status, body: parsed }
}

async function main() {
  const command = process.argv[2]
  if (command === 'login') return login()
  if (command === 'get') { const r = await api('GET', process.argv[3], undefined, process.argv[4] ? { 'Accept-Language': process.argv[4] } : undefined); console.log(JSON.stringify(r.body, null, 2)); return }
  if (command === 'devices') { console.log(JSON.stringify((await api('GET', '/me/player/devices')).body, null, 2)); return }
  if (command === 'player') {
    const { status, body } = await api('GET', '/me/player')
    if (status === 204 || !body) { console.log('no active playback'); return }
    console.log(JSON.stringify({ device: body.device?.name, type: body.device?.type, isPlaying: body.is_playing,
      context: body.context?.uri, item: body.item?.uri, title: body.item?.name, artists: body.item?.artists?.map(a => a.name),
      progressMs: body.progress_ms, durationMs: body.item?.duration_ms, shuffle: body.shuffle_state }, null, 2))
    return
  }
  if (command === 'play' || command === 'play-track' || command === 'pause' || command === 'seek' || command === 'resume' || command === 'queue' || command === 'next' || command === 'shuffle' || command === 'volume' || command === 'activate') {
    const devices = (await api('GET', '/me/player/devices')).body?.devices ?? []
    // Always target THIS PC's desktop app; never another account device.
    const wanted = (arg('device', process.env.COMPUTERNAME || '')).toLowerCase()
    const desktop = devices.find(d => d.name.toLowerCase() === wanted)
    if (!desktop) throw new Error(`device "${wanted}" not found among: ${devices.map(d => d.name).join(', ')}`)
    const query = `?device_id=${encodeURIComponent(desktop.id)}`
    if (command === 'volume') { const r = await api('PUT', `/me/player/volume${query}&volume_percent=${Number(arg('percent', '-1'))}`); console.log('volume status', r.status); return }
    // Make this PC the active device without starting playback (no sound).
    if (command === 'activate') { const r = await api('PUT', '/me/player', { device_ids: [desktop.id], play: false }); console.log('activate status', r.status); return }
    if (command === 'seek') {
      const result = await api('PUT', `/me/player/seek${query}&position_ms=${Number(arg('position', '0'))}`)
      console.log('seek status', result.status); return
    }
    if (command === 'resume') { const r = await api('PUT', `/me/player/play${query}`); console.log('resume status', r.status); return }
    if (command === 'next') { const r = await api('POST', `/me/player/next${query}`); console.log('next status', r.status); return }
    if (command === 'shuffle') { const r = await api('PUT', `/me/player/shuffle${query}&state=${arg('state', 'true')}`); console.log('shuffle status', r.status); return }
    if (command === 'queue') { const r = await api('POST', `/me/player/queue${query}&uri=${encodeURIComponent(arg('uri', ''))}`); console.log('queue status', r.status, r.body ? JSON.stringify(r.body) : ''); return }
    if (command === 'pause') {
      const result = await api('PUT', `/me/player/pause${query}`)
      console.log('pause status', result.status); return
    }
    const body = command === 'play-track'
      ? { uris: [arg('uri', '')], position_ms: Number(arg('position', '0')) }
      : { context_uri: arg('context', ''), offset: { position: Number(arg('offset', '0')) }, position_ms: Number(arg('position', '0')) }
    const result = await api('PUT', `/me/player/play${query}`, body)
    console.log('play status', result.status, result.body ? JSON.stringify(result.body) : '', 'device', desktop?.name)
    return
  }
  console.log('commands: login | player | devices | play')
}
main().catch(error => { console.error('ERROR', error.message); process.exit(1) })
