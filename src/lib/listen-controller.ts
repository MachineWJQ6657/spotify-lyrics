import { useAppStore } from '../store/useAppStore'
import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { acousticController } from './acoustic-controller'
import { CaptureTimeline } from './capture-timeline'
import { listenLines, listenTimingKey } from './listened-offset'
import { automaticSourceOf, nextSourceToTry, sourcesVetted } from './lyrics-source'
import { currentSessionCalibration } from './session-calibration'
import type { ListenResult } from '../../electron/audio-sync/lyric-offset-session'

/**
 * Automatic listening calibration: while a Japanese, Chinese or English song with timed lyrics
 * plays and its lyric file has not been measured yet, capture a few 12 s
 * blocks of system output, let the main process locate known lines in them,
 * and store the per-song display offset. Audio stays in memory; capture stops
 * as soon as the song is measured, paused, changed or skipped.
 */

export interface ListenTarget { trackId: string; timingKey: string; language: 'ja' | 'zh' | 'en'; lines: { text: string; startMs: number }[] }

/** Lyric language as the listener names it (main process maps each to a pronunciation source). */
export function listenLanguageOf(language: string | undefined): ListenTarget['language'] | null {
  if (language === 'ja' || language === 'en') return language
  return language?.startsWith('zh') ? 'zh' : null
}

const MAX_SESSION_ATTEMPTS = 2
const MAX_BLOCKS = 12
const attempts = new Map<string, number>()

/** Why the current song should (not) be listened to. Pure; exported for tests. */
export function listenTarget(input: { playback: PlaybackSnapshot | null; lyrics: LyricsDocument | null; enabled: boolean; demoMode: boolean; manualActive: boolean
  /** A lookup for another lyrics source is running: the timeline on screen is about to be replaced. */
  switching?: boolean }):
  { target: ListenTarget } | { reason: string } {
  const { playback, lyrics } = input
  if (!input.enabled) return { reason: 'disabled' }
  if (input.demoMode) return { reason: 'demo' }
  if (input.manualActive) return { reason: 'manual-audio-sync' }
  if (!playback?.isPlaying || !playback.track) return { reason: 'not-playing' }
  if (lyrics?.trackId !== playback.track.id) return { reason: 'no-lyrics' }
  if (input.switching) return { reason: 'source-switching' }
  if (lyrics.offsetMs) return { reason: 'manual-offset' }
  const original = lyrics.untimedOriginal ? undefined : lyrics.tracks.find(track => track.kind === 'original')
  const language = listenLanguageOf(original?.language)
  if (!original || !language) return { reason: 'unsupported-language' }
  const lines = listenLines(original.lines)
  if (lines.length < 8 || lines.length > 400) return { reason: 'too-few-lines' }
  const timingKey = listenTimingKey(original)
  if (!timingKey) return { reason: 'invalid-lines' }
  if (lyrics.listenedOffset?.timingKey === timingKey) return { reason: 'already-measured' }
  // This provider's timeline was already found inconsistent for the song (a
  // lookup may have rebuilt it with a different timing key): do not listen again.
  const shownSource = automaticSourceOf(lyrics)
  if (shownSource && lyrics.sourceTrials?.[shownSource] === 'inconsistent') return { reason: 'source-inconsistent' }
  if ((attempts.get(`${playback.track.id}\0${timingKey}`) ?? 0) >= MAX_SESSION_ATTEMPTS) return { reason: 'attempts-exhausted' }
  return { target: { trackId: playback.track.id, timingKey, language, lines } }
}

let active: { target: ListenTarget; stop: () => Promise<void> } | null = null
let starting = false
// Which song is being listened to right now, for the "listening…" hint.
let listeningTrack: string | null = null
const listeningSubscribers = new Set<() => void>()
function setListeningTrack(trackId: string | null) {
  if (listeningTrack === trackId) return
  listeningTrack = trackId
  listeningSubscribers.forEach(listener => listener())
}
/** Track id whose audio is being captured for calibration, else null. */
export function listeningTrackId() { return listeningTrack }
export function subscribeListening(listener: () => void) {
  listeningSubscribers.add(listener)
  return () => { listeningSubscribers.delete(listener) }
}
let available: boolean | null = null
let unsubscribe: (() => void) | null = null

function currentInput() {
  const store = useAppStore.getState()
  const acoustic = acousticController.snapshot()
  return { playback: store.playback, lyrics: store.lyrics, enabled: store.settings?.listenOffset !== false, demoMode: store.demoMode,
    manualActive: acoustic.running || acoustic.automatic || acoustic.busy,
    // The pending document of a source switch has no provider revision until its lookup answers.
    switching: store.sourceSwitchToken !== null && store.sourceSwitchToken === store.lyricsRetryToken
      && store.sourceSwitchTrackId === store.lyrics?.trackId && store.lyrics?.providerRevision === undefined }
}

async function reconcile() {
  const decision = listenTarget(currentInput())
  if (active) {
    const same = 'target' in decision && decision.target.trackId === active.target.trackId && decision.target.timingKey === active.target.timingKey
    if (!same) await active.stop()
    else return
  }
  if ('reason' in decision) { settleWithoutListening(decision.reason); return }
  // One start at a time. A second call (a store change and "立即重新校准" in
  // the same tick) used to pass this point while the first was still asking
  // for the engine, and both began a session.
  if (starting) { reconcileAgain = true; return }
  starting = true
  let attempted: ListenTarget | null = null
  try {
    if (available === null) {
      try { available = (await window.syllable.audioSync.phonemeStatus()).available } catch { available = false }
    }
    if (!available) return
    // The song, its lyrics or the setting may have changed while the engine was asked.
    const fresh = listenTarget(currentInput())
    if ('target' in fresh && !active) { attempted = fresh.target; await begin(fresh.target) }
  } finally {
    starting = false
    if (reconcileAgain) {
      reconcileAgain = false
      // Repeat the skipped call only when it can do something other than
      // retry, at once, the very session that just failed to start.
      const now = listenTarget(currentInput())
      const retry = !active && attempted !== null && 'target' in now
        && now.target.trackId === attempted.trackId && now.target.timingKey === attempted.timingKey
      if (!retry) void reconcile()
    }
  }
}
let reconcileAgain = false

/** Reasons that mean the timeline on screen can never be measured. */
const UNMEASURABLE = new Set(['unsupported-language', 'too-few-lines', 'invalid-lines', 'attempts-exhausted'])

/**
 * The song is not going to be listened to now. A song whose verdict is known
 * still gets to move on from an inconsistent provider, and a provider that
 * listening switched to but cannot measure is given up.
 */
function settleWithoutListening(reason: string) {
  const trackId = useAppStore.getState().lyrics?.trackId
  if (!trackId) return
  if (reason === 'already-measured' || reason === 'source-inconsistent') {
    adoptEarlierVerdict()
    advanceSource(trackId)
  } else if (UNMEASURABLE.has(reason)) giveUpUnmeasuredTrial(trackId)
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
    if (listeningTrack === target.trackId) setListeningTrack(null)
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
    setListeningTrack(target.trackId)
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
      if (++blocks > MAX_BLOCKS) { failed(); processing = false; await stop(); giveUpUnmeasuredTrial(target.trackId, target.timingKey); return }
      try {
        const result = await window.syllable.audioSync.listen({ trackId: target.trackId, capturedAtMs, captureDurationMs: block.pcm.length / 16,
          sampleRate: 16000, pcm: block.pcm, language: target.language, lines: target.lines })
        if (stopped) return
        if (result.state === 'inconsistent') failed()
        if (result.state === 'decided' || result.state === 'inconsistent') {
          useAppStore.getState().setListenedOffset(target.trackId, {
            timingKey: target.timingKey, state: result.state, offsetMs: result.state === 'decided' ? result.offsetMs ?? 0 : 0,
            measuredDeltaMs: result.measuredDeltaMs, spreadMs: result.spreadMs, lines: result.lines, measuredAt: Date.now() })
          await stop()
          afterVerdict(target.trackId, result.state)
          return
        }
        const unusable = result.reason === 'invalid-input' || result.reason === 'no-lines' || result.reason === 'unsupported-language'
        if (unusable) failed()
        if (unusable || result.reason === 'inactive' || result.reason === 'lyrics-changed') await stop()
        if (unusable) giveUpUnmeasuredTrial(target.trackId, target.timingKey)
      } catch { failed(); await stop(); giveUpUnmeasuredTrial(target.trackId, target.timingKey) }
      finally { processing = false }
    }
    captured.getAudioTracks()[0].onended = () => { void stop() }
  } catch {
    failed()
    await stop()
    giveUpUnmeasuredTrial(target.trackId, target.timingKey)
  }
}

/**
 * After a verdict: remember it for the provider on screen, and when that
 * provider's lines disagree with each other, let another provider's timeline
 * be measured instead. An explicit choice in the source menu is never
 * overridden; when every source is inconsistent the automatic choice returns.
 */
export function afterVerdict(trackId: string, state: 'decided' | 'inconsistent') {
  const store = useAppStore.getState()
  const document = store.lyrics
  if (!document || document.trackId !== trackId || document.untimedOriginal) return
  // The user's own lyrics (imported, edited, picked by hand) are not a provider's result.
  const shown = automaticSourceOf(document)
  if (!shown) return
  store.recordSourceTrial(trackId, shown, state === 'decided' ? 'consistent' : 'inconsistent')
  if (state === 'inconsistent') advanceSource(trackId)
}

/**
 * A provider that listening switched to, but that cannot be measured (another
 * language, too few lines, no line could be placed, capture failed), must not
 * stay on screen unverified: it is marked and the chain moves on, ending at
 * the automatic choice. With `timingKey`, only when that timeline is still shown.
 */
export function giveUpUnmeasuredTrial(trackId: string, timingKey?: string) {
  const store = useAppStore.getState()
  const document = store.lyrics
  if (!document || document.trackId !== trackId || document.sourceChosenBy !== 'listening' || !document.sourcePreference) return
  const shown = automaticSourceOf(document)
  if (!shown || shown !== document.sourcePreference || document.sourceTrials?.[shown]) return
  const original = document.tracks.find(track => track.kind === 'original')
  if (timingKey && (!original || listenTimingKey(original) !== timingKey)) return
  store.recordSourceTrial(trackId, shown, 'unmeasurable')
  advanceSource(trackId)
}

// Songs saved before the app recorded which providers have them: asked once per run.
const availabilityAsked = new Set<string>()

/**
 * When the provider on screen was judged inconsistent and the user did not
 * pick it by hand, show the next provider that has timed lyrics and no verdict
 * yet; when none is left, return to the automatic choice. Safe to call again
 * at any time: it never repeats a request and never retries a judged provider.
 * Returns true when it asked for a different timeline.
 */
export function advanceSource(trackId: string): boolean {
  const store = useAppStore.getState()
  const document = store.lyrics
  if (!document || document.trackId !== trackId || document.untimedOriginal) return false
  if (store.playback?.track?.id !== trackId || store.demoMode) return false
  if (document.sourcePreference && document.sourceChosenBy !== 'listening') return false
  // The user is correcting this timeline by ear ("这句现在开始"): do not swap it under them.
  if (currentSessionCalibration(store.sessionCalibration, store.playback, document)) return false
  const shown = automaticSourceOf(document)
  const verdict = shown ? document.sourceTrials?.[shown] : undefined
  if (verdict !== 'inconsistent' && verdict !== 'unmeasurable') return false
  if (!sourcesVetted(document)) {
    // The provider asked for has nothing and the list of who has the song is missing: back to automatic.
    if (document.sourcePreference && document.sourceUnavailable) { store.setLyricsSource(null, 'listening'); return true }
    // Saved before the app recorded which providers have the song and agree
    // with the automatic choice, or the last lookup failed: one lookup finds out.
    if (availabilityAsked.has(trackId)) return false
    availabilityAsked.add(trackId)
    if (availabilityAsked.size > 200) availabilityAsked.delete(availabilityAsked.values().next().value!)
    store.setLyricsSource(document.sourcePreference ?? null, 'listening')
    return true
  }
  const next = nextSourceToTry(document)
  // Already asked for: its lookup is still running.
  if (next && next === document.sourcePreference) return false
  if (next) { store.setLyricsSource(next, 'listening'); return true }
  if (document.sourcePreference) { store.setLyricsSource(null, 'listening'); return true }
  return false
}

/** Test hook: forget which songs were asked for their providers. */
export function resetSourceAdvanceForTests() { availabilityAsked.clear() }

/**
 * A song that was judged inconsistent before per-source verdicts existed
 * (0.4.63) has a verdict but no record of which provider it was about, so
 * nothing would ever try another one. While it plays, treat that stored
 * verdict as if it had just been reached for the provider on screen.
 */
export function adoptEarlierVerdict() {
  const document = useAppStore.getState().lyrics
  if (document?.listenedOffset?.state !== 'inconsistent' || document.untimedOriginal) return
  const original = document.tracks.find(track => track.kind === 'original')
  const shown = automaticSourceOf(document)
  // Only the verdict for the timeline on screen, and only once per provider.
  if (!original || !shown || document.sourceTrials?.[shown] || document.listenedOffset.timingKey !== listenTimingKey(original)) return
  afterVerdict(document.trackId, 'inconsistent')
}

/**
 * Why the current song is (not) being listened to. With `assumePlaying` a
 * paused song is judged as if it played, so the reason names what would
 * actually block it (language, too few lines) rather than "not playing".
 */
export function currentListenDecision(assumePlaying = false) {
  const input = currentInput()
  return listenTarget(assumePlaying && input.playback ? { ...input, playback: { ...input.playback, isPlaying: true } } : input)
}

/**
 * "立即重新校准": forget what was measured for the current song (and a manual
 * per-song offset, which would otherwise win) and listen again at once, or as
 * soon as the song plays. Returns false when there is no current song with lyrics.
 */
export function relistenCurrentSong() {
  const store = useAppStore.getState()
  const track = store.playback?.track
  if (!track || store.demoMode || store.lyrics?.trackId !== track.id) return false
  for (const key of [...attempts.keys()]) if (key.startsWith(`${track.id}\0`)) attempts.delete(key)
  if (store.lyrics.offsetMs) store.setLyricsOffset(0)
  store.setListenedOffset(track.id, null)
  store.clearSourceTrials(track.id)
  void reconcile()
  return true
}

declare global {
  interface Window {
    /** Set by a debugger before the page loads. Inert otherwise. */
    __syllableQa?: boolean
    /** Integration checks without audio: reach a verdict for the song on screen and read the source state. */
    __syllableListenQa?: { verdict(state: 'decided' | 'inconsistent'): boolean; state(): unknown }
  }
}

/** What listening would do with a verdict for the timeline on screen, without listening (QA only). */
function simulateVerdict(state: 'decided' | 'inconsistent') {
  const store = useAppStore.getState()
  const document = store.lyrics
  const original = document?.untimedOriginal ? undefined : document?.tracks.find(track => track.kind === 'original')
  const timingKey = original ? listenTimingKey(original) : null
  if (!document || !timingKey || store.playback?.track?.id !== document.trackId) return false
  store.setListenedOffset(document.trackId, { timingKey, state, offsetMs: 0, measuredDeltaMs: 0, lines: 0, measuredAt: Date.now() })
  afterVerdict(document.trackId, state)
  return true
}

function sourceState() {
  const document = useAppStore.getState().lyrics
  return { trackId: document?.trackId, shown: automaticSourceOf(document), preference: document?.sourcePreference ?? null, chosenBy: document?.sourceChosenBy ?? null,
    unavailable: Boolean(document?.sourceUnavailable), trials: document?.sourceTrials ?? null, available: document?.availableSources ?? null,
    listened: document?.listenedOffset?.state ?? null, revision: document?.providerRevision ?? null, decision: currentListenDecision(true) }
}

/** Keep the listener in step with playback, lyrics and settings. */
export function connectListener() {
  unsubscribe?.()
  if (typeof window !== 'undefined' && window.__syllableQa) window.__syllableListenQa = { verdict: simulateVerdict, state: sourceState }
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
