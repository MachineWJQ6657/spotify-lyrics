import type { LyricsDocument } from '../types'
import { listenedLyricsOffset } from './listened-offset'

export type TimingTone = 'neutral' | 'calibrated' | 'listening' | 'experimental'
export interface TimingStatus { label: string; tone: TimingTone; title: string }

/** "0.85 秒" / "7.12 秒": the size of a lyric shift, without sign. */
export function shiftAmount(offsetMs: number) {
  return `${(Math.abs(offsetMs) / 1000).toFixed(2)} 秒`
}

/** Positive offsets delay lyrics (see calibratedPosition). */
export function shiftDirection(offsetMs: number) {
  return offsetMs > 0 ? '延后' : '提前'
}

/**
 * What currently decides when lyric lines appear, as one short label for the
 * lyrics card. Order follows displayedLyricPosition: a session calibration,
 * then an audio anchor, then the per-song offset (manual before listened).
 */
export function timingStatus(input: {
  document: LyricsDocument | null
  sessionCalibrated: boolean
  acousticAnchor: boolean
  listening: boolean
  listenEnabled: boolean
}): TimingStatus {
  const { document } = input
  if (input.sessionCalibrated) return { label: '本次听感校准', tone: 'calibrated', title: '按你点选的句子校准；暂停、跳转或换歌后清除' }
  if (input.acousticAnchor) return { label: 'AUDIO ALIGNMENT · EXPERIMENTAL', tone: 'experimental', title: '声音同步正在按人声定位歌词' }
  const manual = document?.offsetMs ?? 0
  if (manual) return { label: `手动校准 · 歌词${shiftDirection(manual)} ${shiftAmount(manual)}`, tone: 'calibrated', title: '可在右侧「逐曲同步校准」调整或归零' }
  const listened = input.listenEnabled ? listenedLyricsOffset(document) : 0
  if (listened) return { label: `听音校准 · 歌词${shiftDirection(listened)} ${shiftAmount(listened)}`, tone: 'calibrated', title: '已在本机听过这首歌，并整体校正了歌词时间；可在右侧「逐曲同步校准」归零' }
  if (input.listening) return { label: '正在听音校准…', tone: 'listening', title: '正在本机听几段声音，核对歌词是否提前或延后；音频不保存、不上传' }
  return { label: 'SPOTIFY TIMELINE', tone: 'neutral', title: '歌词按 Spotify 播放进度显示' }
}
