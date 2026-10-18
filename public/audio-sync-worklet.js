// Fixed-size, 12-second mono blocks. No microphone and no monitor playback.
class SyllableAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(Math.round(sampleRate * 12))
    this.used = 0
    this.expectedFrame = null
    this.startContextTime = 0
    this.continuityId = 0
    this.missing = false
    this.port.onmessage = event => {
      if (event.data?.type === 'reset') this.resetContinuity(false)
    }
  }
  resetContinuity(notify = true) {
    // Missing render input is elapsed time, not a shorter piece of the song.
    // Discard the partial block instead of joining samples across that gap.
    this.continuityId++
    this.used = 0
    this.expectedFrame = null
    if (notify) this.port.postMessage({ type: 'gap', continuityId: this.continuityId })
  }
  process(inputs) {
    const channels = inputs[0]
    if (!channels?.length || !channels[0].length) {
      if (!this.missing) this.resetContinuity()
      this.missing = true
      return true
    }
    this.missing = false
    if (this.expectedFrame !== null && currentFrame !== this.expectedFrame) this.resetContinuity()
    this.expectedFrame = currentFrame + channels[0].length
    for (let index = 0; index < channels[0].length; index++) {
      if (this.used === 0) this.startContextTime = currentTime + index / sampleRate
      let sum = 0
      for (const channel of channels) sum += channel[index]
      this.buffer[this.used++] = sum / channels.length
      if (this.used === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer, sampleRate, startContextTime: this.startContextTime,
          endContextTime: currentTime + (index + 1) / sampleRate, continuityId: this.continuityId }, [this.buffer.buffer])
        this.buffer = new Float32Array(Math.round(sampleRate * 12))
        this.used = 0
      }
    }
    return true
  }
}
registerProcessor('syllable-audio-capture', SyllableAudioCapture)
