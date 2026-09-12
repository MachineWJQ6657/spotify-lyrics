import { app, safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface TokenSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  clientId: string
}

interface StoredData { session?: string }
export interface StoredWindowBounds { x: number; y: number; width: number; height: number }

export class SessionStore {
  private file = path.join(app.getPath('userData'), 'session.json')

  async get(): Promise<TokenSession | null> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as StoredData
      if (!data.session) return null
      const raw = data.session.startsWith('safe:') && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(data.session.slice(5), 'base64'))
        : Buffer.from(data.session.replace(/^plain:/, ''), 'base64').toString('utf8')
      return JSON.parse(raw) as TokenSession
    } catch { return null }
  }

  async set(session: TokenSession | null) {
    await mkdir(path.dirname(this.file), { recursive: true })
    if (!session) return writeFile(this.file, '{}', 'utf8')
    const raw = JSON.stringify(session)
    const encoded = safeStorage.isEncryptionAvailable()
      ? `safe:${safeStorage.encryptString(raw).toString('base64')}`
      : `plain:${Buffer.from(raw).toString('base64')}`
    await writeFile(this.file, JSON.stringify({ session: encoded }), 'utf8')
  }
}

export class WindowBoundsStore {
  private file = path.join(app.getPath('userData'), 'overlay-window.json')

  async get(): Promise<StoredWindowBounds | null> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as StoredWindowBounds
      if (![value.x, value.y, value.width, value.height].every(Number.isFinite)) return null
      return value
    } catch { return null }
  }

  async set(bounds: StoredWindowBounds) {
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(bounds), 'utf8')
  }
}
