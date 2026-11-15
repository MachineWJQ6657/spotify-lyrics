// Runs the REAL generated worker body and the REAL LocalSpotifyService.handleMessage on a virtual clock.
// Only the native client (libspotifyctl), koffi, timers and Date.now are replaced. Synthetic data only.
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'

export function createWorld(startMs = 1_000_000) {
  let now = startMs
  const realDateNow = Date.now
  Date.now = () => now
  let nextId = 1
  const timers = new Map()
  const setT = (fn, delay = 0) => { const id = nextId++; timers.set(id, { at: now + Math.max(0, delay || 0), fn }); return id }
  const setI = (fn, every) => { const id = nextId++; timers.set(id, { at: now + every, fn, every }); return id }
  const clear = id => { timers.delete(id) }
  const advance = ms => {
    const target = now + ms
    for (;;) {
      let best = null
      for (const [id, timer] of timers) if (timer.at <= target && (!best || timer.at < best.timer.at)) best = { id, timer }
      if (!best) break
      now = Math.max(now, best.timer.at)
      if (best.timer.every) best.timer.at += best.timer.every; else timers.delete(best.id)
      best.timer.fn()
    }
    now = target
  }
  const restore = () => { Date.now = realDateNow }
  return { now: () => now, setT, setI, clear, advance, restore }
}

export async function createRig(world, initialRaw) {
  globalThis.setTimeout = world.setT; globalThis.clearTimeout = world.clear
  const { LocalSpotifyService } = await import('./local-spotify.bundle.mjs')
  const service = new LocalSpotifyService()
  const snapshots = []
  service.listener = snapshot => snapshots.push({ at: world.now(), snapshot: snapshot ? structuredClone(snapshot) : null })
  service.statusListener = () => {}
  // Never read Spotify's own files from this simulation.
  service.refreshTransitionProfile = async () => {}
  service.spawnWorker()
  const source = globalThis.__workerSources.at(-1)
  const hostWorker = globalThis.__lastWorker
  const port = new EventEmitter()
  const workerMessages = []
  port.postMessage = message => {
    workerMessages.push({ at: world.now(), message: structuredClone(message) })
    hostWorker.emit('message', structuredClone(message))
  }
  globalThis.__toWorker = message => port.emit('message', structuredClone(message))
  let raw = { ...initialRaw }
  let client
  const nativeCalls = []
  class Client extends EventEmitter {
    _handle = { native: true }
    constructor() { super(); client = this }
    start() {}
    latestState() { return raw }
    seekMs(positionMs) { nativeCalls.push(['seek', positionMs, world.now()]); return true }
    play() { nativeCalls.push(['play', world.now()]); return true }
    pause() { nativeCalls.push(['pause', world.now()]); return true }
    next() { nativeCalls.push(['next', world.now()]); return true }
    previous() { nativeCalls.push(['previous', world.now()]); return true }
    close() {}
  }
  runInNewContext(source, {
    require: name => {
      if (name === 'node:worker_threads') return { parentPort: port, workerData: { modulePath: 'native-client', koffiPath: 'native-koffi' } }
      if (name === 'node:perf_hooks') return { performance: { now: () => world.now() } }
      if (name === 'native-client') return { SpotifyClient: Client }
      if (name === 'native-koffi') return { load: () => ({ func: () => Object.assign(() => true, { async: (_h, done) => done(null) }) }) }
      if (name === 'node:path') return { join: (...parts) => parts.join('/'), dirname: value => value.split('/').slice(0, -1).join('/') || '.' }
      throw new Error('unexpected dependency ' + name)
    }, Date, Buffer, setTimeout: world.setT, clearTimeout: world.clear, setInterval: world.setI, clearInterval: world.clear,
  })
  const emit = patch => { raw = { ...raw, ...patch }; client.emit('stateChanged', raw) }
  return { service, snapshots, workerMessages, emit, nativeCalls, setRaw: patch => { raw = { ...raw, ...patch } } }
}

export const fmt = value => typeof value === 'number' ? Math.round(value) : value
