import { expect, it } from 'vitest'
import { createReferenceDeduplicatingStorage } from './useAppStore'

// Explicit synthetic serialization benchmark. No system audio, user profile,
// localStorage disk timing, downloads or writes. Timing is NOT a CI assertion.
it.skipIf(process.env.SYLLABLE_STORAGE_BENCH !== '1')('reports whole-library traversal avoided during settings changes', () => {
  let visits = 0
  const library = Object.fromEntries(Array.from({ length: 300 }, (_, song) => [`song-${song}`, {
    trackId: `song-${song}`, tracks: Array.from({ length: 3 }, (_, track) => ({
      id: `track-${track}`, kind: track === 0 ? 'original' : 'translation',
      lines: Array.from({ length: 70 }, (_, line) => ({ startMs: line * 3000,
        get text() { visits++; return 'Synthetic performance fixture line '.repeat(2) } }))
    }))
  }]))
  const bytes = Buffer.byteLength(JSON.stringify({ version: 9, state: { settings: {}, library } }))
  visits = 0
  let previousLength = 0
  const oldStart = performance.now()
  for (let step = 0; step < 100; step++) previousLength = JSON.stringify({ version: 9, state: { settings: { fontSize: step }, library } }).length
  const fullMs = performance.now() - oldStart, fullVisits = visits
  visits = 0
  let saved = ''
  const storage = createReferenceDeduplicatingStorage({ getItem: () => null, removeItem() {},
    setItem: (_name: string, value: string) => { saved = value } } as unknown as Storage)
  const optimizedStart = performance.now()
  for (let step = 0; step < 100; step++) storage.setItem('preferences', { version: 9,
    state: { settings: { fontSize: step }, library } } as unknown as Parameters<typeof storage.setItem>[1])
  const optimizedMs = performance.now() - optimizedStart
  expect(fullVisits).toBe(6_300_000)
  expect(visits).toBe(63_000)
  expect(saved.length).toBe(previousLength)
  expect(JSON.parse(saved).state.settings.fontSize).toBe(99)
  console.info('SYNTHETIC_STORAGE_SERIALIZATION', JSON.stringify({ documents: 300, lines: 63000,
    bytes, changes: 100, fullMs: Math.round(fullMs * 10) / 10, optimizedMs: Math.round(optimizedMs * 10) / 10,
    fullVisits, optimizedVisits: visits, diskLatencyMeasured: false }))
}, 30000)
