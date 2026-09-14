import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { shell } from 'electron'
import type { TokenSession } from './store'
import { SessionStore } from './store'
import type { SpotifyTransitionProfile } from '../src/types'

const REDIRECT_URI = 'http://127.0.0.1:43821/callback'
const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state'

export interface PlaybackSnapshot {
  track: null | {
    id: string
    name: string
    artist: string
    album: string
    coverUrl: string
    durationMs: number
    isrc?: string
    spotifyId?: string
    sourceDurationMs?: number
  }
  positionMs: number
  observedAtMs: number
  isPlaying: boolean
  deviceName?: string
  sampleId: number
  playbackSource: 'web' | 'local'
  clockDriftMs?: number
  transition?: SpotifyTransitionProfile
  transitionResolved?: boolean
}

export class SpotifyRateLimitError extends Error {
  constructor(public retryAfterMs: number) { super('Spotify 请求过于频繁，已自动降低刷新频率') }
}

export class SpotifyService {
  private session: TokenSession | null = null
  private store = new SessionStore()
  private sampleId = 0

  async restore() { this.session = await this.store.get() }
  isConnected() { return Boolean(this.session) }

  async login(clientId: string): Promise<void> {
    if (!clientId.trim()) throw new Error('请输入 Spotify Client ID')
    const verifier = randomBytes(64).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(18).toString('hex')
    const url = new URL('https://accounts.spotify.com/authorize')
    url.search = new URLSearchParams({
      client_id: clientId.trim(), response_type: 'code', redirect_uri: REDIRECT_URI,
      scope: SCOPES, code_challenge_method: 'S256', code_challenge: challenge, state
    }).toString()

    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const callback = new URL(req.url ?? '/', REDIRECT_URI)
        if (callback.pathname !== '/callback') return
        if (callback.searchParams.get('state') !== state) {
          res.end('Invalid OAuth state. You can close this window.')
          server.close(); reject(new Error('Spotify 授权状态校验失败')); return
        }
        const authCode = callback.searchParams.get('code')
        if (!authCode) {
          res.end('Authorization cancelled. You can close this window.')
          server.close(); reject(new Error('Spotify 授权已取消')); return
        }
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end('<body style="background:#0b0b0d;color:#fff;font:16px system-ui;display:grid;place-items:center;height:100vh"><div><h2>已连接 Syllable</h2><p>现在可以关闭此页面。</p></div></body>')
        server.close(); resolve(authCode)
      })
      server.on('error', reject)
      server.listen(43821, '127.0.0.1', () => void shell.openExternal(url.toString()))
      setTimeout(() => { server.close(); reject(new Error('Spotify 授权超时，请重试')) }, 120_000)
    })

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId.trim(), grant_type: 'authorization_code', code,
        redirect_uri: REDIRECT_URI, code_verifier: verifier
      })
    })
    if (!response.ok) throw new Error(`Spotify 令牌交换失败 (${response.status})`)
    const token = await response.json() as { access_token: string; refresh_token: string; expires_in: number }
    this.session = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, clientId: clientId.trim() }
    await this.store.set(this.session)
  }

  async logout() { this.session = null; await this.store.set(null) }

  private async refresh() {
    if (!this.session) throw new Error('Spotify 尚未连接')
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.session.clientId, grant_type: 'refresh_token', refresh_token: this.session.refreshToken })
    })
    if (!response.ok) throw new Error('Spotify 登录已过期，请重新连接')
    const token = await response.json() as { access_token: string; refresh_token?: string; expires_in: number }
    this.session = { ...this.session, accessToken: token.access_token, refreshToken: token.refresh_token ?? this.session.refreshToken, expiresAt: Date.now() + token.expires_in * 1000 }
    await this.store.set(this.session)
  }

  async getPlayback(): Promise<PlaybackSnapshot | null> {
    if (!this.session) return null
    if (Date.now() > this.session.expiresAt - 60_000) await this.refresh()
    let startedAt = Date.now()
    let response = await fetch('https://api.spotify.com/v1/me/player', { headers: { authorization: `Bearer ${this.session.accessToken}` } })
    if (response.status === 401) {
      await this.refresh()
      // The observation belongs to the successful retry, not the rejected
      // request or the potentially slow token refresh between requests.
      startedAt = Date.now()
      response = await fetch('https://api.spotify.com/v1/me/player', { headers: { authorization: `Bearer ${this.session!.accessToken}` } })
    }
    if (response.status === 204) return { track: null, positionMs: 0, observedAtMs: Date.now(), isPlaying: false, sampleId: ++this.sampleId, playbackSource: 'web' }
    if (response.status === 429) {
      const retryAfterMs = Math.max(2500, Number(response.headers.get('retry-after') ?? 5) * 1000)
      throw new SpotifyRateLimitError(retryAfterMs)
    }
    if (!response.ok) throw new Error(`Spotify 播放状态获取失败 (${response.status})`)
    const receivedAt = Date.now()
    const data = await response.json() as any
    const item = data.item
    return {
      track: item ? {
        id: item.id, name: item.name, artist: item.artists?.map((x: any) => x.name).join(', ') ?? '',
        album: item.album?.name ?? '', coverUrl: item.album?.images?.[0]?.url ?? '', durationMs: item.duration_ms,
        isrc: item.external_ids?.isrc, spotifyId: item.id, sourceDurationMs: item.duration_ms
      } : null,
      positionMs: data.progress_ms ?? 0,
      observedAtMs: Math.round((startedAt + receivedAt) / 2),
      isPlaying: Boolean(data.is_playing), deviceName: data.device?.name,
      sampleId: ++this.sampleId, playbackSource: 'web'
    }
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.session) return null
    if (Date.now() > this.session.expiresAt - 60_000) await this.refresh()
    return this.session.accessToken
  }

  private async playerMutation(path: string, method: 'PUT' | 'POST') {
    if (!this.session) throw new Error('Spotify 尚未连接')
    if (Date.now() > this.session.expiresAt - 60_000) await this.refresh()
    const send = () => fetch(`https://api.spotify.com/v1/me/player/${path}`, {
      method, headers: { authorization: `Bearer ${this.session!.accessToken}` }
    })
    let response = await send()
    // Only a definitive authorization rejection permits replay. Network errors
    // may occur after a skip executed, so they propagate without another send.
    if (response.status === 401) {
      await this.refresh()
      response = await send()
    }
    return response
  }

  async control(command: 'play' | 'pause' | 'next' | 'previous'): Promise<void> {
    const map = {
      play: { method: 'PUT', path: 'play' }, pause: { method: 'PUT', path: 'pause' },
      next: { method: 'POST', path: 'next' }, previous: { method: 'POST', path: 'previous' }
    } as const
    const target = map[command]
    const response = await this.playerMutation(target.path, target.method)
    if (response.status === 403) throw new Error('当前 Spotify 帐号或设备不允许远程控制')
    if (response.status === 404) throw new Error('没有可控制的 Spotify 活动设备')
    if (!response.ok) throw new Error(`Spotify 控制失败 (${response.status})`)
  }

  async seek(positionMs: number): Promise<void> {
    const position = Math.max(0, Math.round(positionMs))
    const response = await this.playerMutation(`seek?position_ms=${position}`, 'PUT')
    if (response.status === 403) throw new Error('当前 Spotify 帐号或设备不允许跳转')
    if (response.status === 404) throw new Error('没有可控制的 Spotify 活动设备')
    if (!response.ok) throw new Error(`Spotify 跳转失败 (${response.status})`)
  }
}

export const spotifyRedirectUri = REDIRECT_URI
