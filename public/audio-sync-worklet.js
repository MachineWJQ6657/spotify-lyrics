// Fixed-size, 12-second mono blocks. No microphone and no monitor playback.
class SyllableAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(Math.round(sampleRate * 12))
    this.used = 0
  }
  process(inputs) {
    const channels = inputs[0]
    if (!channels?.length) return true
    for (let index = 0; index < channels[0].length; index++) {
      let sum = 0
      for (const channel of channels) sum += channel[index]
      this.buffer[this.used++] = sum / channels.length
      if (this.used === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer, sampleRate, endContextTime: currentTime + (index + 1) / sampleRate }, [this.buffer.buffer])
        this.buffer = new Float32Array(Math.round(sampleRate * 12))
        this.used = 0
      }
    }
    return true
  }
}
registerProcessor('syllable-audio-capture', SyllableAudioCapture)
