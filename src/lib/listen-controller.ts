import { useAppStore } from '../store/useAppStore'
import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { acousticController } from './acoustic-controller'
import { CaptureTimeline } from './capture-timeline'
import { listenLines, listenTimingKey } from './listened-offset'
import type { ListenResult } from '../../electron/audio-sync/lyric-offset-session'

/**
 * Automatic listening calibration: while a Japanese song with timed lyrics
 * plays and its lyric file has not been measured yet, capture a few 12 s
 * blocks of system output, let the main process locate known lines in them,
 * and store the per-song display offset. Audio stays in memory; capture stops
 * as soon as the song is measured, paused, changed or skipped.
 */

export interface ListenTarget { trackId: string; timingKey: string; lines: { text: string; startMs: number }[] }

const MAX_SESSION_ATTEMPTS = 2
const MAX_BLOCKS = 12
const attempts = new Map<string, number>()

/** Why the current song should (not) be listened to. Pure; exported for tests. */
export function listenTarget(input: { playback: PlaybackSnapshot | null; lyrics: LyricsDocument | null; enabled: boolean; demoMode: boolean; manualActive: boolean }):
  { target: ListenTarget } | { reason: string } {
  const { playback, lyrics } = input
  if (!input.enabled) return { reason: 'disabled' }
  if (input.demoMode) return { reason: 'demo' }
  if (input.manualActive) return { reason: 'manual-audio-sync' }
  if (!playback?.isPlaying || !playback.track) return { reason: 'not-playing' }
  if (lyrics?.trackId !== playback.track.id) return { reason: 'no-lyrics' }
  if (lyrics.offsetMs) return { reason: 'manual-offset' }
  const original = lyrics.untimedOriginal ? undefined : lyrics.tracks.find(track => track.kind === 'original')
  if (!original || original.language !== 'ja') return { reason: 'unsupported-language' }
  const lines = listenLines(original.lines)
  if (lines.length < 8 || lines.length > 400) return { reason: 'too-few-lines' }
  const timingKey = listenTimingKey(original)
  if (!timingKey) return { reason: 'invalid-lines' }
  if (lyrics.listenedOffset?.timingKey === timingKey) return { reason: 'already-measured' }
  if ((attempts.get(`${playback.track.id}\0${timingKey}`) ?? 0) >= MAX_SESSION_ATTEMPTS) return { reason: 'attempts-exhausted' }
  return { target: { trackId: playback.track.id, timingKey, lines } }
}

let active: { target: ListenTarget; stop: () => Promise<void> } | null = null
let starting = false
let available: boolean | null = null
let unsubscribe: (() => void) | null = null

function currentInput() {
  const store = useAppStore.getState()
  const acoustic = acousticController.snapshot()
  return { playback: store.playback, lyrics: store.lyrics, enabled: store.settings?.listenOffset !== false, demoMode: store.demoMode,
    manualActive: acoustic.running || acoustic.automatic || acoustic.busy }
}

async function reconcile() {
  const decision = listenTarget(currentInput())
  if (active) {
    const same = 'target' in decision && decision.target.trackId === active.target.trackId && decision.target.timingKey === active.target.timingKey
    if (!same) await active.stop()
    else return
  }
  if (!('target' in decision) || starting) return
  if (available === null) {
    try { available = (await window.syllable.audioSync.phonemeStatus()).available } catch { available = false }
  }
  if (!available) return
  starting = true
  try { await begin(decision.target) } finally { starting = false }
}

async function begin(target: ListenTarget) {
  const key = `${target.trackId}\0${target.timingKey}`
  // Pauses and song changes are not failures; only an inconclusive or failed
  // measurement counts, so a broken file is not listened to forever.
  const failed = () => attempts.set(key, (attempts.get(key) ?? 0) + 1)
  let stream: MediaStream | null = null, context: AudioContext | null = null, processor: AudioWorkletNode | null = null
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    if (active?.target === target) active = null
    processor?.disconnect()
    stream?.getTracks().forEach(track => track.stop())
    await context?.close().catch(() => {})
    await window.syllable.audioSync.clear('listen').catch(() => {})
  }
  active = { target, stop }
  // Playback can pause between the decision and this call: not a failure.
  const prepared = await window.syllable.audioSync.prepare('listen').catch(() => false)
  if (!prepared || stopped) { await stop(); return }
  try {
    const captured = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } })
    stream = captured
    captured.getVideoTracks().forEach(track => track.stop())
    if (stopped || !captured.getAudioTracks().length) { await stop(); return }
    const audio = new AudioContext({ sampleRate: 16000 })
    context = audio
    await audio.audioWorklet.addModule(new URL('audio-sync-worklet.js', document.baseURI).href)
    await audio.resume()
    if (stopped) { await stop(); return }
    processor = new AudioWorkletNode(audio, 'syllable-audio-capture')
    audio.createMediaStreamSource(captured).connect(processor)
    processor.connect(audio.destination) // The worklet outputs silence.
    const timeline = new CaptureTimeline()
    let processing = false
    let blocks = 0
    processor.port.onmessage = async event => {
      if (stopped) return
      if (event.data?.type === 'gap') { timeline.reset(); return }
      const block = event.data
      if (processing || !(block?.pcm instanceof Float32Array) || block.sampleRate !== 16000) return
      const capturedAtMs = timeline.timestamp(block.startContextTime, block.endContextTime, audio.currentTime)
      if (capturedAtMs === null) { timeline.reset(); return }
      if (useAppStore.getState().playback?.track?.id !== target.trackId) return
      processing = true
      // Muted output or a song without measurable lines: stop after ~2.5 min.
      if (++blocks > MAX_BLOCKS) { failed(); processing = false; await stop(); return }
      try {
        const result = await window.syllable.audioSync.listen({ trackId: target.trackId, capturedAtMs, captureDurationMs: block.pcm.length / 16,
          sampleRate: 16000, pcm: block.pcm, language: 'ja', lines: target.lines })
        if (stopped) return
        if (result.state === 'inconsistent') failed()
        if (result.state === 'decided' || result.state === 'inconsistent') {
          useAppStore.getState().setListenedOffset(target.trackId, {
            timingKey: target.timingKey, state: result.state, offsetMs: result.state === 'decided' ? result.offsetMs ?? 0 : 0,
            measuredDeltaMs: result.measuredDeltaMs, spreadMs: result.spreadMs, lines: result.lines, measuredAt: Date.now() })
          await stop()
          return
        }
        if (result.reason === 'invalid-input' || result.reason === 'no-lines') failed()
        if (result.reason === 'inactive' || result.reason === 'lyrics-changed' || result.reason === 'invalid-input' || result.reason === 'no-lines') await stop()
      } catch { failed(); await stop() }
      finally { processing = false }
    }
    captured.getAudioTracks()[0].onended = () => { void stop() }
  } catch {
    failed()
    await stop()
  }
}

/** Keep the listener in step with playback, lyrics and settings. */
export function connectListener() {
  unsubscribe?.()
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; void reconcile() })
  }
  const offStore = useAppStore.subscribe((next, previous) => {
    if (next.playback?.track?.id !== previous.playback?.track?.id || next.playback?.isPlaying !== previous.playback?.isPlaying
      || next.lyrics !== previous.lyrics || next.settings?.listenOffset !== previous.settings?.listenOffset || next.demoMode !== previous.demoMode) schedule()
  })
  const offAcoustic = acousticController.subscribe(schedule)
  unsubscribe = () => { offStore(); offAcoustic() }
  schedule()
  return () => { unsubscribe?.(); unsubscribe = null; void active?.stop() }
}

export type { ListenResult }
