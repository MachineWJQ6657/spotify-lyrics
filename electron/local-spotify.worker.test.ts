import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalSpotifyService } from './local-spotify'

const captured = vi.hoisted(() => ({ sources: [] as string[] }))
vi.mock('node:worker_threads', () => ({ Worker: class {
  constructor(source: string) { captured.sources.push(source) }
  on() { return this }
  terminate() { return Promise.resolve(0) }
} }))
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); captured.sources.length = 0 })

// Execute the ACTUAL generated Worker body with only native bindings replaced.
// This catches timer/wiring regressions that a pure deadline helper test cannot.
function workerFixture() {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  const service = new LocalSpotifyService()
  // Bypass only start()'s host-platform gate: native bindings are mocked, so
  // this pure generated-Worker regression is useful on non-Windows CI too.
  ;(service as unknown as { spawnWorker(): void }).spawnWorker()
  expect(captured.sources).toHaveLength(1)
  const port = new EventEmitter() as EventEmitter & { postMessage(message: unknown): void }
  const messages: Array<{ type: string; state?: { title: string; positionMs: number; durationMs: number; nativeBoundaryResetConfirmed?: boolean } }> = []
  port.postMessage = message => { messages.push(message as typeof messages[number]) }
  let raw = { title: '晴る', artist: 'ヨルシカ', album: '晴る', positionMs: 14350, durationMs: 276701, statusName: 'PLAYING' }
  let client!: EventEmitter
  class Client extends EventEmitter {
    constructor() { super(); client = this }
    start() {}
    latestState() { return raw }
  }
  runInNewContext(captured.sources.at(-1)!, {
    require: (name: string) => {
      if (name === 'node:worker_threads') return { parentPort: port, workerData: { modulePath: 'native-client', koffiPath: 'native-koffi' } }
      if (name === 'node:perf_hooks') return { performance: { now: () => Date.now() } }
      if (name === 'native-client') return { SpotifyClient: Client }
      if (name === 'native-koffi') return { load: () => ({ func: () => () => true }) }
      throw new Error(`Unexpected native Worker dependency: ${name}`)
    }, Date, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  })
  vi.advanceTimersByTime(5000)
  const emit = (patch: Partial<typeof raw>) => { raw = { ...raw, ...patch }; client.emit('stateChanged', raw) }
  emit({ positionMs: 19350 })
  messages.length = 0
  return { emit, messages, service }
}

describe('native boundary Worker timer', () => {
  it('releases a persistent zero within250 ms even without another native event, with no added lag', async () => {
    const { emit, messages, service } = workerFixture()
    emit({ positionMs: 0, durationMs: 218000 })
    vi.advanceTimersByTime(249)
    expect(messages.filter(message => message.type === 'state')).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(messages.filter(message => message.type === 'state')).toEqual([{
      type: 'state', state: expect.objectContaining({ title: '晴る', positionMs: 250, durationMs: 218000, nativeBoundaryResetConfirmed: true }),
    }])
    await service.close()
  })

  it('cancels the pending outgoing zero when the replacement title arrives1 ms later', async () => {
    const { emit, messages, service } = workerFixture()
    emit({ positionMs: 0, durationMs: 218000 })
    vi.advanceTimersByTime(1)
    emit({ title: '春ひさぎ', album: '盗作' })
    expect(messages.filter(message => message.type === 'state')[0].state).toMatchObject({ title: '春ひさぎ', positionMs: 0 })
    vi.advanceTimersByTime(250)
    expect(messages.filter(message => message.type === 'state').some(message => message.state?.title === '晴る')).toBe(false)
    await service.close()
  })

  it('never quarantines a real same-duration seek to zero', async () => {
    const { emit, messages, service } = workerFixture()
    emit({ positionMs: 0 })
    expect(messages.filter(message => message.type === 'state')[0].state).toMatchObject({ title: '晴る', positionMs: 0 })
    expect(messages.filter(message => message.type === 'state')[0].state?.nativeBoundaryResetConfirmed).toBeUndefined()
    await service.close()
  })
})
