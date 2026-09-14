import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import type { PlaybackSnapshot } from './spotify'
import type { SpotifyTransitionProfile } from '../src/types'
import { spotifySourcePosition } from '../src/lib/clock'
import { resolveSpotifyTransitionProfile } from './spotify-transition'

type Command = 'play' | 'pause' | 'next' | 'previous'

export interface LocalState {
  title: string
  artist: string
  album: string
  albumArtBase64: string
  positionMs: number
  durationMs: number
  statusName: string
  sampledAtMs: number
}

export interface StartupClockGate {
  trackIdentity: string
  anchorPositionMs: number
  anchorAtMs: number
  statusName: string
  readyAtMs: number
  startedAtMs: number
  correctionDetected: boolean
}

export interface DurationChangeCandidate {
  trackIdentity: string
  durationMs: number
  reportedPositionMs: number
  firstSeenAtMs: number
  count: number
}

export function gateSameTrackDurationChange(
  trackIdentity: string,
  previousDurationMs: number,
  reportedDurationMs: number,
  previousCandidate: DurationChangeCandidate | null,
  now: number,
  authoritative = false,
  reportedPositionMs = Number.POSITIVE_INFINITY
) {
  const meaningful = previousDurationMs > 0 && reportedDurationMs > 0
    && Math.abs(reportedDurationMs - previousDurationMs) > 2500
  if (authoritative || !meaningful) {
    return { durationMs: reportedDurationMs, candidate: null, allowShorterDuration: authoritative }
  }
  const sameCandidate = previousCandidate?.trackIdentity === trackIdentity
    && Math.abs(previousCandidate.durationMs - reportedDurationMs) <= 250
  const candidate: DurationChangeCandidate = sameCandidate
    ? { ...previousCandidate, reportedPositionMs: Math.min(previousCandidate.reportedPositionMs, reportedPositionMs), count: previousCandidate.count + 1 }
    : { trackIdentity, durationMs: reportedDurationMs, reportedPositionMs, firstSeenAtMs: now, count: 1 }
  // At a queue boundary Spotify has been observed publishing the next item's
  // duration under the old title for roughly two seconds. Keep the current
  // duration through that hand-off. A genuine same-track correction remains
  // possible after multiple samples and a bounded 2.8-second confirmation.
  const confirmed = candidate.count >= 2 && now - candidate.firstSeenAtMs >= 2800
  return {
    durationMs: confirmed ? reportedDurationMs : previousDurationMs,
    candidate: confirmed ? null : candidate,
    allowShorterDuration: confirmed
  }
}

/**
 * Spotify sometimes publishes the next queue item's duration and near-zero
 * position under the outgoing title, then emits the replacement title with a
 * temporary zero duration. Carry that quarantined duration across only this
 * tightly bounded boundary shape; a normal same-track correction or stale
 * candidate must never leak into another recording.
 */
export function adoptQueuedTrackDuration(previous: LocalState | null, incoming: LocalState | null, candidate: DurationChangeCandidate | null, now: number) {
  if (!previous || !incoming || !candidate || incoming.durationMs > 0) return incoming
  if (localTrackIdentity(previous) === localTrackIdentity(incoming)) return incoming
  if (candidate.trackIdentity !== localTrackIdentity(previous)) return incoming
  if (!Number.isFinite(candidate.durationMs) || candidate.durationMs < 15_000) return incoming
  const ageMs = now - candidate.firstSeenAtMs
  if (ageMs < 0 || ageMs > 2200) return incoming
  if (candidate.reportedPositionMs > 2500 || incoming.positionMs > 2500) return incoming
  return { ...incoming, durationMs: candidate.durationMs }
}

/**
 * Windows SMTC occasionally exposes libspotifyctl's previous raw position for
 * the first second or two after attaching to an already-playing Spotify
 * session.  The library's smooth clock then legitimately snaps when Spotify
 * republishes an authoritative anchor.  Publishing the stale first value makes
 * lyrics visibly jump by several seconds shortly after app startup.
 *
 * Hold only the first playing sample, and release it shortly after either a
 * large raw-clock correction or a bounded fallback. Paused samples are already
 * exact and therefore need only a tiny coalescing window. The helper is kept
 * pure because its exact implementation is injected into the native Worker.
 */
export function advanceStartupClockGate(previous: StartupClockGate | null, state: Pick<LocalState, 'artist' | 'title' | 'album' | 'positionMs' | 'statusName'>, now: number): StartupClockGate | null {
  if (!state?.title) return previous
  const trackIdentity = `${state.artist || ''}\0${state.title || ''}\0${state.album || ''}`
  const positionMs = Math.max(0, Number(state.positionMs) || 0)
  const playing = state.statusName === 'PLAYING'
  if (!previous || previous.trackIdentity !== trackIdentity || (previous.statusName !== 'PLAYING' && playing)) {
    return {
      trackIdentity,
      anchorPositionMs: positionMs,
      anchorAtMs: now,
      statusName: state.statusName,
      // Live SMTC observations can be ~4.5 s apart. A 3.2 s fallback
      // exposed an uncorrected startup anchor before the next observation.
      readyAtMs: now + (playing ? 5000 : 120),
      startedAtMs: now,
      correctionDetected: false
    }
  }
  if (!playing) {
    return {
      ...previous,
      anchorPositionMs: positionMs,
      anchorAtMs: now,
      statusName: state.statusName,
      readyAtMs: Math.min(previous.readyAtMs, now + 120)
    }
  }
  if (previous.correctionDetected) return { ...previous, statusName: state.statusName }
  const projectedPosition = previous.anchorPositionMs + Math.max(0, now - previous.anchorAtMs)
  if (Math.abs(positionMs - projectedPosition) < 1500) return { ...previous, statusName: state.statusName }
  return {
    ...previous,
    anchorPositionMs: positionMs,
    anchorAtMs: now,
    statusName: state.statusName,
    readyAtMs: Math.min(previous.readyAtMs, now + 180),
    correctionDetected: true
  }
}

interface WorkerMessage {
  type: 'state' | 'closed' | 'response' | 'fatal' | 'status'
  state?: LocalState | null
  requestId?: number
  ok?: boolean
  error?: string
}

const nodeRequire = createRequire(import.meta.url)

export function localTrackIdentity(value: Pick<LocalState, 'artist' | 'title' | 'album'>) {
  return `${value.artist}\0${value.title}\0${value.album}`
}

export function stabilizeLocalState(previous: LocalState | null, next: LocalState | null, allowShorterDuration = false) {
  if (!previous || !next || localTrackIdentity(previous) !== localTrackIdentity(next)) return next
  const previousLivePosition = previous.statusName === 'PLAYING'
    ? previous.positionMs + Math.max(0, next.sampledAtMs - previous.sampledAtMs)
    : previous.positionMs
  return {
    ...next,
    albumArtBase64: next.albumArtBase64 || previous.albumArtBase64,
    durationMs: allowShorterDuration ? next.durationMs : Math.max(previous.durationMs, next.durationMs),
    positionMs: previous.statusName === 'PLAYING' && next.statusName === 'PAUSED' && next.positionMs < previousLivePosition
      ? Math.min(previous.durationMs || Number.MAX_SAFE_INTEGER, previousLivePosition)
      : next.positionMs
  }
}

/** Keeps a real identity through only the bounded empty SMTC skip gap. */
export function retainPendingLocalState(previous: LocalState | null, incoming: LocalState | null, skipPendingTrack: string, now: number, skipPendingUntil: number) {
  if (incoming?.title) return incoming
  if (skipPendingTrack && now < skipPendingUntil) return previous
  return null
}

export function projectTransportState(state: LocalState, command: 'play' | 'pause', now = Date.now()): LocalState {
  const livePosition = state.statusName === 'PLAYING'
    ? state.positionMs + Math.max(0, now - state.sampledAtMs)
    : state.positionMs
  return {
    ...state,
    positionMs: Math.min(state.durationMs || Number.MAX_SAFE_INTEGER, livePosition),
    statusName: command === 'play' ? 'PLAYING' : 'PAUSED',
    sampledAtMs: now
  }
}

/**
 * Keeps the native Windows SMTC bridge outside Electron's main thread. Koffi's
 * native callbacks may briefly block their owning thread, so letting them run in
 * a Worker guarantees that a broken or slow Spotify session cannot freeze the UI.
 */
export class LocalSpotifyService {
  private worker: Worker | null = null
  private state: LocalState | null = null
  private sampleId = 100_000
  private listener: ((snapshot: PlaybackSnapshot | null) => void) | null = null
  private statusListener: ((message: string) => void) | null = null
  private requests = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private requestId = 0
  private restartTimer: NodeJS.Timeout | null = null
  private transportStatusGuard: { trackIdentity: string; statusName: 'PLAYING' | 'PAUSED'; until: number } | null = null
  private closed = false
  private coverTrackId = ''
  private coverUrl = ''
  private clockDriftMs = 0
  private transitionProfile: SpotifyTransitionProfile | null = null
  private spotifyTrackUri = ''
  private transitionTrackIdentity = ''
  private transitionReadPending = ''
  private transitionLastCheckedAt = 0
  private transitionResolutionStartedAt = 0
  private durationChangeCandidate: DurationChangeCandidate | null = null

  start(listener: (snapshot: PlaybackSnapshot | null) => void, statusListener?: (message: string) => void) {
    if (process.platform !== 'win32') return false
    this.listener = listener
    this.statusListener = statusListener ?? null
    this.closed = false
    this.spawnWorker()
    return true
  }

  hasTrack() { return Boolean(this.state?.title) }

  current(): PlaybackSnapshot | null {
    if (!this.state?.title) return null
    const elapsed = this.state.statusName === 'PLAYING' ? Date.now() - this.state.sampledAtMs : 0
    const positionMs = Math.min(this.state.durationMs || Number.MAX_SAFE_INTEGER, this.state.positionMs + elapsed)
    const stableId = createHash('sha1')
      .update(localTrackIdentity(this.state))
      .digest('hex').slice(0, 20)
    if (this.coverTrackId !== stableId || (!this.coverUrl && this.state.albumArtBase64)) {
      this.coverTrackId = stableId
      this.coverUrl = this.state.albumArtBase64 ? `data:image/png;base64,${this.state.albumArtBase64}` : ''
    }
    return {
      track: {
        id: `local-${stableId}`,
        name: this.state.title,
        artist: this.state.artist,
        album: this.state.album,
        coverUrl: this.coverUrl,
        durationMs: this.state.durationMs,
        spotifyId: this.spotifyTrackUri.split(':').at(-1) || undefined,
        sourceDurationMs: this.transitionProfile?.sourceDurationMs
      },
      positionMs,
      observedAtMs: Date.now(),
      isPlaying: this.state.statusName === 'PLAYING',
      deviceName: 'Spotify Desktop · Windows',
      sampleId: ++this.sampleId,
      playbackSource: 'local',
      clockDriftMs: this.clockDriftMs,
      transition: this.transitionTrackIdentity === localTrackIdentity(this.state) ? this.transitionProfile ?? undefined : undefined,
      transitionResolved: this.transitionTrackIdentity === localTrackIdentity(this.state)
    }
  }

  async control(command: Command) {
    if (!this.worker || !this.state?.title) throw new Error('尚未检测到 Spotify 桌面端媒体会话')
    const projected = command === 'play' || command === 'pause' ? projectTransportState(this.state, command) : null
    if (projected) this.transportStatusGuard = { trackIdentity: localTrackIdentity(projected), statusName: projected.statusName as 'PLAYING' | 'PAUSED', until: Date.now() + 800 }
    try { await this.request({ type: 'control', command }) }
    catch (error) { if (projected) this.transportStatusGuard = null; throw error }
    if (projected && this.state && localTrackIdentity(projected) === localTrackIdentity(this.state)) {
      // stateChanged may arrive before the command response with the old raw
      // SMTC position. Keep the position projected at click time so pausing
      // cannot visibly rewind the lyrics, then let later accurate samples win.
      this.state = {
        ...this.state,
        positionMs: command === 'pause' ? Math.max(projected.positionMs, this.state.positionMs) : this.state.positionMs,
        statusName: projected.statusName,
        sampledAtMs: Date.now()
      }
      this.listener?.(this.current())
    }
  }

  async seek(positionMs: number) {
    if (!this.worker || !this.state?.title) throw new Error('尚未检测到 Spotify 桌面端媒体会话')
    await this.request({ type: 'seek', positionMs: Math.max(0, Math.round(positionMs)) })
  }

  async close() {
    this.closed = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const worker = this.worker
    this.worker = null
    this.rejectPending('本地 Spotify 服务已关闭')
    if (worker) await worker.terminate().catch(() => undefined)
    this.state = null
    this.coverTrackId = ''
    this.coverUrl = ''
    this.transitionProfile = null
    this.spotifyTrackUri = ''
    this.transitionTrackIdentity = ''
    this.transitionReadPending = ''
    this.transitionLastCheckedAt = 0
    this.transitionResolutionStartedAt = 0
    this.durationChangeCandidate = null
  }

  private spawnWorker() {
    if (this.closed || this.worker) return
    try {
      const resolvedModulePath = nodeRequire.resolve('libspotifyctl')
      // Native DLL loaders cannot resolve Electron's virtual app.asar path. The
      // package is intentionally unpacked by electron-builder, so point both its
      // JavaScript entry and prebuilt DLL lookup at the physical sibling tree.
      const modulePath = resolvedModulePath.replace(/([\\/])app\.asar\1/, '$1app.asar.unpacked$1')
      const koffiPath = nodeRequire.resolve('koffi').replace(/([\\/])app\.asar\1/, '$1app.asar.unpacked$1')
      const startupClockGateSource = advanceStartupClockGate.toString()
      const retainPendingLocalStateSource = retainPendingLocalState.toString()
      const workerSource = `
        const { parentPort, workerData } = require('node:worker_threads')
        const { SpotifyClient } = require(workerData.modulePath)
        const koffi = require(workerData.koffiPath)
        const user32 = koffi.load('user32.dll')
        const sendNotifyMessage = user32.func('bool __stdcall SendNotifyMessageW(intptr_t hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam)')
        let client = null
        let lastState = null
        let lastSentAt = 0
        let pendingStateTimer = null
        let pendingStateDueAt = 0
        let lastPostedArtTrack = ''
        let lastSkipCommandAt = 0
        let lastSkipCommand = ''
        let skipPendingTrack = ''
        let skipPendingUntil = 0
        let firstStateReadyAt = Date.now() + 600
        let startupClockGate = null
        let startupClockReady = false

        const advanceStartupClockGate = (${startupClockGateSource})
        const retainPendingLocalState = (${retainPendingLocalStateSource})

        const sendMediaCommand = command => sendNotifyMessage(0xFFFF, 0x0319, 0, command << 16)

        const serialize = (state, includeArt) => {
          if (!state || !state.title) return null
          const art = state.albumArt
          return {
            title: state.title || '', artist: state.artist || '', album: state.album || '',
            albumArtBase64: includeArt && art && art.length ? Buffer.from(art).toString('base64') : '',
            positionMs: Number(state.positionMs) || 0,
            durationMs: Number(state.durationMs) || 0,
            statusName: state.statusName || 'UNKNOWN', sampledAtMs: Date.now()
          }
        }
        const publishState = () => {
          if (!lastState) return parentPort.postMessage({ type: 'state', state: null })
          const startupWaitMs = startupClockGate ? Date.now() - startupClockGate.startedAtMs : 0
          if (!startupClockReady && startupClockGate) parentPort.postMessage({
            type: 'status',
            error: 'startup clock settled: corrected=' + startupClockGate.correctionDetected + ' wait=' + Math.max(0, Math.round(startupWaitMs)) + 'ms'
          })
          startupClockReady = true
          startupClockGate = null
          firstStateReadyAt = 0
          pendingStateDueAt = 0
          lastSentAt = Date.now()
          const trackKey = (lastState.artist || '') + '\\0' + (lastState.title || '') + '\\0' + (lastState.album || '')
          const includeArt = trackKey !== lastPostedArtTrack && Boolean(lastState.albumArt && lastState.albumArt.length)
          if (includeArt) lastPostedArtTrack = trackKey
          // State events are intentionally coalesced for up to 900 ms. Stamping
          // an old event position with the later publish time makes every
          // renderer believe that stale position was sampled just now. Read the
          // native smooth clock at the actual publication instant instead.
          const smoothPosition = Number(client && client.positionSmoothMs)
          const publishable = lastState.statusName === 'PLAYING' && Number.isFinite(smoothPosition)
            ? { ...lastState, positionMs: Math.max(0, smoothPosition) }
            : lastState
          lastState = publishable
          parentPort.postMessage({ type: 'state', state: serialize(publishable, includeArt) })
        }
        const scheduleStateAt = dueAt => {
          if (pendingStateTimer && Math.abs(pendingStateDueAt - dueAt) < 2) return
          if (pendingStateTimer) clearTimeout(pendingStateTimer)
          pendingStateDueAt = dueAt
          pendingStateTimer = setTimeout(() => {
            pendingStateTimer = null
            pendingStateDueAt = 0
            publishState()
          }, Math.max(0, dueAt - Date.now()))
        }
        const sendState = (state, immediate = false) => {
          // A queue transition commonly emits an empty SMTC snapshot between
          // two real tracks. Retain the outgoing non-empty identity while a
          // skip transaction is pending so duplicate commands cannot turn the
          // worker's comparison key into an empty string. Outside that bounded
          // transaction, an empty snapshot still correctly clears the session.
          lastState = retainPendingLocalState(lastState, state, skipPendingTrack, Date.now(), skipPendingUntil)
          if (!startupClockReady) {
            const now = Date.now()
            if (lastState && lastState.title) {
              startupClockGate = advanceStartupClockGate(startupClockGate, lastState, now)
              firstStateReadyAt = startupClockGate ? startupClockGate.readyAtMs : firstStateReadyAt
            }
            if (now < firstStateReadyAt) {
              scheduleStateAt(firstStateReadyAt)
              return
            }
          }
          const remaining = 1400 - (Date.now() - lastSentAt)
          if (immediate || remaining <= 0) {
            if (pendingStateTimer) clearTimeout(pendingStateTimer)
            pendingStateTimer = null
            pendingStateDueAt = 0
            publishState()
          } else if (!pendingStateTimer) {
            scheduleStateAt(Date.now() + remaining)
          }
        }
        try {
          client = new SpotifyClient()
          client.on('stateChanged', state => {
            const nextTrackKey = ((state && state.artist) || '') + '\\0' + ((state && state.title) || '') + '\\0' + ((state && state.album) || '')
            // Spotify can publish an empty session between queue items. That
            // gap is not proof that the requested skip completed, so retain
            // the de-duplication guard until a real replacement title arrives.
            if (skipPendingTrack && state && state.title && nextTrackKey !== skipPendingTrack) {
              skipPendingTrack = ''
              skipPendingUntil = 0
            }
            const important = !lastState || !state || state.title !== lastState.title || state.artist !== lastState.artist || state.durationMs !== lastState.durationMs || state.statusName !== lastState.statusName
            sendState(state, important)
          })
          client.on('positionChanged', positionMs => {
            if (lastState) sendState({ ...lastState, positionMs })
          })
          client.on('closed', () => parentPort.postMessage({ type: 'closed' }))
          client.start()
          sendState(client.latestState(), true)
          setInterval(() => {
            try {
              const fresh = client.latestState()
              if (fresh?.title && lastState?.title === fresh.title && lastState?.artist === fresh.artist && fresh.statusName === 'PLAYING') {
                fresh.positionMs = client.positionSmoothMs
              }
              sendState(fresh)
            } catch (_) {}
          }, 1500)
        } catch (error) {
          parentPort.postMessage({ type: 'fatal', error: error && error.message ? error.message : String(error) })
        }
        parentPort.on('message', message => {
          const reply = (ok, error) => parentPort.postMessage({ type: 'response', requestId: message.requestId, ok, error })
          let attemptedSkipTrack = ''
          try {
            if (!client) throw new Error('本地 Spotify 服务尚未启动')
            let ok
            if (message.type === 'seek') ok = client.seekMs(message.positionMs)
            else if (message.command === 'next' || message.command === 'previous') {
              const now = Date.now()
              const currentTrackKey = ((lastState && lastState.artist) || '') + '\\0' + ((lastState && lastState.title) || '') + '\\0' + ((lastState && lastState.album) || '')
              if ((lastSkipCommand === message.command && now - lastSkipCommandAt < 900) || (skipPendingTrack === currentTrackKey && now < skipPendingUntil)) {
                parentPort.postMessage({ type: 'status', error: 'duplicate skip ignored' })
                return reply(true)
              }
              lastSkipCommandAt = now
              lastSkipCommand = message.command
              skipPendingTrack = currentTrackKey
              skipPendingUntil = now + 6000
              attemptedSkipTrack = currentTrackKey
              ok = message.command === 'next' ? client.next() : client.previous()
            }
            else if (message.command === 'play') ok = lastState?.statusName === 'PLAYING' || client.play()
            else {
              const livePosition = Number(client.positionSmoothMs) || Number(lastState?.positionMs) || 0
              ok = lastState?.statusName !== 'PLAYING' || client.pause()
              if (ok && lastState) {
                lastState = { ...lastState, positionMs: livePosition, statusName: 'PAUSED' }
                sendState(lastState, true)
              }
            }
            if (!ok) {
              if (attemptedSkipTrack && skipPendingTrack === attemptedSkipTrack) {
                skipPendingTrack = ''
                skipPendingUntil = 0
                lastSkipCommand = ''
                lastSkipCommandAt = 0
              }
              throw new Error(message.type === 'seek' ? '当前 Spotify 媒体会话不支持跳转' : 'Spotify 桌面端拒绝了这个控制操作')
            }
            parentPort.postMessage({ type: 'status', error: (message.type === 'seek' ? 'seek ' + message.positionMs : 'command ' + message.command) + ' accepted' })
            reply(true)
          } catch (error) {
            if (attemptedSkipTrack && skipPendingTrack === attemptedSkipTrack) {
              skipPendingTrack = ''
              skipPendingUntil = 0
              lastSkipCommand = ''
              lastSkipCommandAt = 0
            }
            reply(false, error && error.message ? error.message : String(error))
          }
        })
      `
      const worker = new Worker(workerSource, { eval: true, workerData: { modulePath, koffiPath } })
      this.worker = worker
      this.statusListener?.(`worker spawned: ${modulePath}`)
      worker.on('message', (message: WorkerMessage) => this.handleMessage(message))
      worker.on('error', error => this.handleWorkerFailure(error.message))
      worker.on('exit', code => {
        if (this.worker === worker) this.handleWorkerFailure(code ? `Worker 异常退出（${code}）` : '')
      })
    } catch (error) {
      this.handleWorkerFailure(error instanceof Error ? error.message : String(error))
    }
  }

  private handleMessage(message: WorkerMessage) {
    if (message.type === 'status') {
      if (message.error) this.statusListener?.(message.error)
      return
    }
    if (message.type === 'state') {
      const previous = this.state
      let incoming = message.state ?? null
      const guard = this.transportStatusGuard
      if (incoming && guard) {
        if (localTrackIdentity(incoming) !== guard.trackIdentity || Date.now() >= guard.until) this.transportStatusGuard = null
        else if (incoming.statusName !== guard.statusName) incoming = { ...incoming, statusName: guard.statusName }
      }
      const incomingIdentity = incoming ? localTrackIdentity(incoming) : ''
      let transitionDurationAuthoritative = false
      if (incoming && this.transitionTrackIdentity === incomingIdentity && this.transitionProfile?.outputDurationMs) {
        // Once a Mix recipe is validated, its output duration is authoritative;
        // SMTC sometimes flashes the source duration again near a crossfade.
        incoming = { ...incoming, durationMs: this.transitionProfile.outputDurationMs }
        transitionDurationAuthoritative = true
      }
      if (previous && incoming && localTrackIdentity(previous) === localTrackIdentity(incoming)
        && previous.statusName === 'PLAYING' && incoming.statusName === 'PLAYING') {
        const projected = previous.positionMs + Math.max(0, incoming.sampledAtMs - previous.sampledAtMs)
        const drift = incoming.positionMs - projected
        // Large deltas are seeks, not clock error. Small deltas form a live
        // health signal and let diagnostics verify that coalescing is not
        // gradually moving lyrics away from Spotify.
        if (Math.abs(drift) < 5000) this.clockDriftMs = Math.round(drift)
      } else this.clockDriftMs = 0
      // At a queue boundary SMTC can expose the next item's duration before it
      // replaces the old title (and can also do the reverse). Quarantine a
      // large duration-only change while the projected transport keeps moving;
      // a verified Mix endpoint bypasses the gate immediately.
      let allowShorterDuration = false
      if (previous && incoming && localTrackIdentity(previous) === incomingIdentity) {
        const reportedDurationMs = incoming.durationMs
        const gated = gateSameTrackDurationChange(
          incomingIdentity,
          previous.durationMs,
          reportedDurationMs,
          this.durationChangeCandidate,
          Date.now(),
          transitionDurationAuthoritative,
          incoming.positionMs
        )
        this.durationChangeCandidate = gated.candidate
        allowShorterDuration = gated.allowShorterDuration
        if (gated.durationMs !== reportedDurationMs) {
          const heldPositionMs = previous.statusName === 'PLAYING'
            ? Math.min(previous.durationMs || Number.MAX_SAFE_INTEGER, previous.positionMs + Math.max(0, incoming.sampledAtMs - previous.sampledAtMs))
            : previous.positionMs
          this.statusListener?.(`duration ownership pending: held=${previous.durationMs}ms/${Math.round(heldPositionMs)}ms reported=${reportedDurationMs}ms/${Math.round(incoming.positionMs)}ms`)
          incoming = { ...incoming, durationMs: gated.durationMs, positionMs: heldPositionMs }
        }
      } else {
        const adopted = adoptQueuedTrackDuration(previous, incoming, this.durationChangeCandidate, Date.now())
        if (incoming && adopted && adopted.durationMs !== incoming.durationMs) {
          this.statusListener?.(`queue-boundary duration adopted: ${adopted.durationMs}ms for ${adopted.artist} - ${adopted.title}`)
          incoming = adopted
        }
        this.durationChangeCandidate = null
      }
      const next = stabilizeLocalState(previous, incoming, allowShorterDuration)
      const sameTrack = Boolean(next && previous && localTrackIdentity(next) === localTrackIdentity(previous))
      if (!sameTrack) {
        this.transitionProfile = null
        this.spotifyTrackUri = ''
        this.transitionTrackIdentity = ''
        this.transitionLastCheckedAt = 0
        this.transitionResolutionStartedAt = Date.now()
        this.durationChangeCandidate = null
      }
      this.state = next
      // Keep transition discovery alive while paused. Spotify can publish SMTC
      // before replacing context_player_state_restore; returning early for an
      // unchanged paused sample used to prevent every subsequent retry.
      if (this.state) {
        const unresolved = this.transitionTrackIdentity !== localTrackIdentity(this.state)
        if (unresolved || Date.now() - this.transitionLastCheckedAt >= 5000) void this.refreshTransitionProfile(this.state, !unresolved)
      }
      const unchangedPause = Boolean(previous && next && sameTrack && previous.statusName === 'PAUSED' && next.statusName === 'PAUSED'
        && previous.durationMs === next.durationMs && Math.abs(previous.positionMs - next.positionMs) < 50)
      if (unchangedPause) return
      this.statusListener?.(this.state?.title ? `track: ${this.state.artist} - ${this.state.title} [${this.state.statusName}] ${Math.round(this.state.positionMs)}ms drift=${this.clockDriftMs}ms` : 'worker ready: no track')
      this.listener?.(this.current())
      return
    }
    if (message.type === 'closed') {
      this.state = null
      this.listener?.(null)
      return
    }
    if (message.type === 'fatal') {
      this.handleWorkerFailure(message.error || '本地 Spotify 服务启动失败')
      return
    }
    if (message.type === 'response' && message.requestId != null) {
      const pending = this.requests.get(message.requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      this.requests.delete(message.requestId)
      if (message.ok) pending.resolve()
      else pending.reject(new Error(message.error || 'Spotify 控制操作失败'))
    }
  }

  private async refreshTransitionProfile(state: LocalState, force = false) {
    const identity = localTrackIdentity(state)
    if (this.transitionReadPending === identity || (!force && this.transitionTrackIdentity === identity)) return
    this.transitionReadPending = identity
    this.transitionLastCheckedAt = Date.now()
    const wasResolved = this.transitionTrackIdentity === identity
    const previousProfile = this.transitionProfile
    const previousTrackUri = this.spotifyTrackUri
    let profile: SpotifyTransitionProfile | null = null
    let trackUri = ''
    let matched = false
    try {
      // Spotify replaces its restored context shortly after SMTC announces a
      // new track. Brief retries avoid using the previous track's transition.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const resolved = await resolveSpotifyTransitionProfile(state.title, state.durationMs)
        profile = resolved.profile
        trackUri = resolved.trackUri ?? ''
        matched = resolved.matched
        if (matched) break
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 180))
      }
    } finally {
      if (this.transitionReadPending === identity) this.transitionReadPending = ''
    }
    if (!this.state || localTrackIdentity(this.state) !== identity) return
    // A temporarily absent/lagging restore file is not evidence that a known
    // mix disappeared. Preserve the established clock and recording identity;
    // a positive same-track match with profile:null may still clear automation.
    if (!matched && wasResolved) return
    // Do not declare an ordinary track until Spotify has had a bounded chance
    // to flush its new context. Rendering nothing briefly is preferable to
    // fetching a wrong-duration LRC and visibly replacing it five seconds later.
    if (!matched && Date.now() - this.transitionResolutionStartedAt < 1800) return
    this.transitionTrackIdentity = identity
    this.transitionProfile = profile
    this.spotifyTrackUri = trackUri
    const changed = previousTrackUri !== trackUri || JSON.stringify(previousProfile) !== JSON.stringify(profile)
    if (profile && changed) {
      const speed = profile.speedAutomation.length ? ` speed=${profile.speedAutomation[0].speed.toFixed(5)}→${profile.speedAutomation.at(-1)?.speed.toFixed(5)}` : ''
      const outputEnd = profile.outputDurationMs ?? state.durationMs
      const endCorrection = Math.round(spotifySourcePosition(outputEnd, profile) - outputEnd)
      const spotifyId = trackUri.split(':').at(-1) ?? 'unknown'
      this.statusListener?.(`Spotify Mix timeline: id=${spotifyId} output=${Math.round(outputEnd)}ms cue=${Math.round(profile.cuePointMs)}ms clockCorrection=${endCorrection}ms overlap=${Math.round(profile.overlapMs ?? 0)}ms${speed}`)
    } else if (!matched && !wasResolved) {
      this.statusListener?.('Spotify transition metadata timeout: using the native 1:1 transport timeline')
    }
    // Publish even an ordinary non-mixed resolution. Lyrics may already be
    // fetching from the positive SMTC duration; a later source-duration bucket
    // change then cancels that renderer generation and safely re-keys it.
    if (!wasResolved || changed) this.listener?.(this.current())
  }

  private request(payload: Record<string, unknown>) {
    return new Promise<void>((resolve, reject) => {
      if (!this.worker) return reject(new Error('本地 Spotify 服务未运行'))
      const requestId = ++this.requestId
      const timer = setTimeout(() => {
        this.requests.delete(requestId)
        reject(new Error('Spotify 控制操作超时'))
      }, 2500)
      this.requests.set(requestId, { resolve, reject, timer })
      this.worker.postMessage({ ...payload, requestId })
    })
  }

  private handleWorkerFailure(reason: string) {
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.removeAllListeners()
      void worker.terminate().catch(() => undefined)
    }
    this.state = null
    this.listener?.(null)
    this.rejectPending(reason || '本地 Spotify 服务已断开')
    if (reason) console.warn('Local Spotify worker unavailable:', reason)
    if (reason) this.statusListener?.(`worker failure: ${reason}`)
    this.scheduleRestart()
  }

  private rejectPending(reason: string) {
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.requests.clear()
  }

  private scheduleRestart() {
    if (this.closed || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnWorker()
    }, 3000)
  }
}
