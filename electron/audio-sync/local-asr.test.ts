import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { dtwModelPreset, encodePcmWav, LocalAsr } from './local-asr'
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.mocked(spawn).mockReset() })
describe('bounded local ASR PCM encoding', () => {
  it('selects attention-head presets only for recognized model architectures', () => {
    expect(dtwModelPreset('C:/models/ggml-large-v3-turbo-q5_0.bin')).toBe('large.v3.turbo')
    expect(dtwModelPreset('C:/models/ggml-large-v3.bin')).toBe('large.v3')
    expect(dtwModelPreset('C:/models/ggml-base.en-q8_0.bin')).toBe('base.en')
    expect(dtwModelPreset('C:/models/ggml-medium.bin')).toBe('medium')
    expect(dtwModelPreset('C:/models/ggml-large-v3.en.bin')).toBeUndefined()
    expect(dtwModelPreset('C:/models/unrecognized.bin')).toBeUndefined()
  })
  it('rejects broken captures before looking for a model or starting a process', async () => {
    const recognizer = new LocalAsr('not-used/config.json', 'not-used/temp')
    const gaps = new Float32Array(192000); gaps.fill(.2, 0, 32000)
    await expect(recognizer.recognize(gaps, 'ja')).resolves.toEqual([])
    await expect(recognizer.recognize(new Float32Array(192000), 'ja')).resolves.toEqual([])
  })
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
    expect(() => encodePcmWav(new Float32Array(480001))).toThrow()
    const pcm = new Float32Array(192000); pcm[50] = NaN
    expect(() => encodePcmWav(pcm)).toThrow()
  })
  it('allows bounded preceding context internally without changing its 16 kHz timing', () => {
    const wav = encodePcmWav(new Float32Array(384000).fill(.1))
    expect(wav.readUInt32LE(40)).toBe(768000)
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(() => encodePcmWav(new Float32Array(480000))).not.toThrow()
  })
  it('keeps context recognition and a CUDA-to-CPU retry within one 15-second process budget', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'syllable-context-budget-'))
    try {
      const cuda = path.join(folder, 'cuda12/Release/whisper-cli.exe'), cpu = path.join(folder, 'cpu/Release/whisper-cli.exe')
      const model = path.join(folder, 'ggml-base.bin')
      await mkdir(path.dirname(cuda), { recursive: true }); await mkdir(path.dirname(cpu), { recursive: true })
      await Promise.all([writeFile(cuda, ''), writeFile(cpu, ''), writeFile(model, Buffer.alloc(1000000))])
      const recognizer = new LocalAsr(path.join(folder, 'config.json'), path.join(folder, 'temp'))
      await recognizer.configure({ executable: cuda, model })
      vi.useFakeTimers(); vi.setSystemTime(100000)
      let active = 0, peak = 0, firstSpawnAt = 0
      const killedAt: number[] = []
      vi.mocked(spawn).mockImplementation(executable => {
        const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill(): boolean }
        child.stderr = new EventEmitter()
        active++; peak = Math.max(peak, active)
        child.on('close', () => { active-- })
        child.kill = () => { killedAt.push(Date.now()); child.emit('close', null); return true }
        if (String(executable) === cuda) {
          firstSpawnAt = Date.now()
          setTimeout(() => child.emit('close', 1), 14000)
        }
        return child as unknown as ChildProcess
      })
      const result = recognizer.recognize(new Float32Array(384000).fill(.05), 'ja').catch(error => error)
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(14000)
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(1000)
      expect((await result).message).toContain('15 秒预算')
      expect(peak).toBe(1)
      expect(killedAt).toEqual([firstSpawnAt + 15000])
    } finally {
      vi.useRealTimers()
      await rm(folder, { recursive: true, force: true })
    }
  })
})
