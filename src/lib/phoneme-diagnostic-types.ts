/** A prompt-free acoustic check is NOT an accepted lyric clock. No position,
 * rate, anchor or transcript may cross this diagnostic IPC result. */
export interface PhonemeDiagnosticResult {
  clockApplied: false
  reason: string
  hypothesisDecision?: 'confirming' | 'resolved' | 'rejected'
  hypothesisReason?: string
  groups: number
  candidates: number
  commonRows: number
  coverageComplete: boolean
  coverageReasons: string[]
  elapsedMs: number
  inferenceMs: number
  matchingMs: number
}
