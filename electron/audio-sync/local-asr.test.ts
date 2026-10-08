import { describe, expect, it } from 'vitest'
import { encodePcmWav } from './local-asr'
describe('bounded local ASR PCM encoding', () => {
  it('writes a valid mono 16 kHz WAV without ffmpeg or shell interpolation', () => {
    const pcm = new Float32Array(192000); pcm[0] = -.5; pcm[1] = 2
    const wav = encodePcmWav(pcm)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(40)).toBe(384000)
    expect(wav.readInt16LE(44)).toBe(-16383)
    expect(wav.readInt16LE(46)).toBe(32767)
  })
  it('rejects malformed and oversized PCM', () => {
    expect(() => encodePcmWav(new Float32Array(250000))).toThrow()
    const pcm = new Float32Array(192000); pcm[50] = NaN
    expect(() => encodePcmWav(pcm)).toThrow()
  })
})
