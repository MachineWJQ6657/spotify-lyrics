export function captureQuality(pcm: Float32Array, sampleRate = 16000): 'usable' | 'silence' | 'audio-gaps' {
  if (!(pcm instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate < 8000 || pcm.length < sampleRate * 6) return 'audio-gaps'
  const frame = Math.round(sampleRate / 4)
  let active = 0, total = 0, tailActive = 0, tailTotal = 0, energy = 0
  for (let start = 0; start < pcm.length; start += frame) {
    let sum = 0
    const end = Math.min(start + frame, pcm.length)
    for (let index = start; index < end; index++) {
      if (!Number.isFinite(pcm[index])) return 'audio-gaps'
      sum += pcm[index] ** 2
    }
    const heard = sum / (end - start) >= 1e-6
    active += Number(heard); total++; energy += sum
    if (start >= pcm.length - sampleRate * 2) { tailActive += Number(heard); tailTotal++ }
  }
  if (energy / pcm.length < 9e-6) return 'silence'
  // A loud onset must not mask a mostly missing recording or an empty tail.
  // This is signal coverage, NOT vocal detection; accompaniment still needs ASR validation.
  return active / total >= .7 && tailActive / Math.max(1, tailTotal) >= .75 ? 'usable' : 'audio-gaps'
}
