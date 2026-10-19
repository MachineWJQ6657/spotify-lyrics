import type { LyricLine } from '../types'

export interface VocalCapture {
  trackId: string
  capturedAtMs: number
  captureDurationMs: number
  sampleRate: number
  language: string
  pcm: Float32Array
  lines: LyricLine[]
}
export interface VocalResult {
  decision: 'locked' | 'confirming' | 'rejected'
  reason: string
  linesMatched: number
  elapsedMs: number
  score: number
  rate: number
  calibration?: { state: 'updated' | 'holding'; positionMs: number; expiresAtMs: number }
}
