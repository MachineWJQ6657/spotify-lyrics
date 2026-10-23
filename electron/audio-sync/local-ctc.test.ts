import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { execFile, spawn as realSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { LocalCtc, ROMAJI_CTC_MODEL_SHA256, ROMAJI_CTC_ORIGINAL_SHA256, ROMAJI_CTC_VOCAB_SHA256 } from './local-ctc'

const vocabulary = Array.from({ length: 161 }, (_, id) => id === 0 ? '<blank>' : id === 1 ? 'a' : `unused-${id}`)
const files = { python: 'C:\\local\\python.exe', modelDirectory: 'C:\\local\\model', runner: 'C:\\app\\runner.py' }
const pcm = () => new Float32Array(96000).fill(.1)
function line(value: unknown) { return Buffer.from(JSON.stringify(value) + '\n') }
function ready(overrides = {}) {
  return line({ type: 'ready', protocol: 1, modelSha256: ROMAJI_CTC_MODEL_SHA256, originalSha256: ROMAJI_CTC_ORIGINAL_SHA256,
    vocabSha256: ROMAJI_CTC_VOCAB_SHA256, sampleRate: 16000, strideSamples: 320, receptiveFieldSamples: 400,
    blankId: 0, vocabulary, ...overrides })
}
function packet(id = 1, samples = 96000, change?: (body: Buffer, frames: number) => void) {
  const frames = Math.floor((samples - 400) / 320) + 1
  const logits = Buffer.alloc(frames * 161 * 4)
  for (let at = 0; at < logits.length; at += 4) logits.writeFloatLE(-8, at)
  for (let frame = 0; frame < frames; frame++) logits.writeFloatLE(8, frame * 161 * 4)
  const body = Buffer.concat([logits, Buffer.alloc(frames * 4)])
  change?.(body, frames)
  return Buffer.concat([line({ type: 'result', id, samples, frames, width: 161, logitBytes: logits.length, idBytes: frames * 4 }), body])
}
function child(closeOnKill = true) {
  const value = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { if (closeOnKill) value.emit('close', null); return true }) })
  // Read the input only inside assertions; do not echo PCM in test output.
  return value
}
function fixture(closeOnKill = true) {
  const children: ReturnType<typeof child>[] = []
  const spawn = vi.fn(() => { const process = child(closeOnKill); children.push(process); return process as unknown as ChildProcessWithoutNullStreams })
  const discover = vi.fn(async () => files)
  const engine = new LocalCtc({ roots: [], runnerPath: '' }, { spawn, discover })
  return { engine, spawn, discover, children }
}
async function initialized(value: ReturnType<typeof fixture>, signal?: AbortSignal) {
  const result = value.engine.recognize(pcm(), { signal })
  await vi.waitFor(() => expect(value.children.length).toBeGreaterThan(0))
  value.children.at(-1)!.stdout.write(ready())
  await Promise.resolve(); await Promise.resolve()
  return { result }
}
afterEach(() => { vi.useRealTimers() })

describe('bounded optional resident local CTC backend', () => {
  it('does not start a child merely to report local availability', async () => {
    const value = fixture()
    expect(await value.engine.status()).toMatchObject({ available: true, loaded: false, backend: 'romajiasr-ctc' })
    expect(value.spawn).not.toHaveBeenCalled()
    await value.engine.close()
  })
  it('reports a missing backend without downloading or starting any process', async () => {
    const spawn = vi.fn()
    const engine = new LocalCtc({ roots: [], runnerPath: '' }, { spawn, discover: async () => null })
    expect(await engine.status()).toMatchObject({ available: false, loaded: false })
    await expect(engine.recognize(pcm())).rejects.toThrow('不可用')
    expect(spawn).not.toHaveBeenCalled()
    await engine.close()
  })
  it.each([new Float32Array(95999), new Float32Array(240001), new Float32Array(96000).fill(NaN),
    new Float32Array(96000).fill(Infinity), new Float32Array(96000).fill(9)])('rejects invalid input before discovery', async input => {
    const value = fixture()
    await expect(value.engine.recognize(input)).rejects.toThrow('6–15')
    expect(value.discover).not.toHaveBeenCalled(); expect(value.spawn).not.toHaveBeenCalled()
    await value.engine.close()
  })
  it('uses isolated Python, no shell, two CPU threads and hidden owned child; reuses it for the next job', async () => {
    const value = fixture(), first = await initialized(value)
    expect(value.spawn).toHaveBeenCalledWith(files.python, ['-I', '-B', '-u', files.runner, '--model-dir', files.modelDirectory],
      expect.objectContaining({ shell: false, windowsHide: true, env: expect.objectContaining({ OMP_NUM_THREADS: '2', PYTHONNOUSERSITE: '1' }) }))
    value.children[0].stdout.write(packet())
    const result = await first.result
    expect(result.geometry).toEqual({ sampleRate: 16000, sampleCount: 96000, strideSamples: 320, receptiveFieldSamples: 400 })
    expect(result.logits.length).toBe(299 * 161)
    expect(result.predictedIds?.length).toBe(299)
    expect(await value.engine.status()).toMatchObject({ available: true, loaded: true })
    const second = value.engine.recognize(pcm())
    await Promise.resolve(); await Promise.resolve()
    value.children[0].stdout.write(packet(2))
    await expect(second).resolves.toMatchObject({ blankId: 0 })
    expect(value.spawn).toHaveBeenCalledTimes(1)
    await value.engine.close()
    expect(value.children[0].kill).toHaveBeenCalledTimes(1)
  })
  it('snapshots input and parses arbitrarily split headers and unaligned binary chunks', async () => {
    const value = fixture(), input = pcm(), pending = value.engine.recognize(input)
    input[0] = .9
    await vi.waitFor(() => expect(value.children.length).toBe(1))
    const process = value.children[0]
    const r = ready(); process.stdout.write(r.subarray(0, 7)); process.stdout.write(r.subarray(7))
    await Promise.resolve(); await Promise.resolve()
    const sent = process.stdin.read() as Buffer
    const headerEnd = sent.indexOf(10)
    expect(JSON.parse(sent.subarray(0, headerEnd).toString())).toMatchObject({ type: 'recognize', id: 1, samples: 96000, bytes: 384000 })
    expect(sent.readFloatLE(headerEnd + 1)).toBeCloseTo(.1)
    const output = packet()
    for (let at = 0; at < output.length; at += 1007) process.stdout.write(output.subarray(at, at + 1007))
    const result = await pending
    output.fill(0)
    expect(result.logits[0]).toBe(8)
    await value.engine.close()
  })
  it('does not queue a second recording while one recognition is pending', async () => {
    const value = fixture(), current = await initialized(value)
    await expect(value.engine.recognize(pcm())).rejects.toThrow('不会排队')
    value.children[0].stdout.write(packet())
    await current.result; await value.engine.close()
  })
  it.each([{ modelSha256: 'wrong' }, { originalSha256: 'wrong' }, { vocabSha256: 'wrong' },
    { strideSamples: 321 }, { receptiveFieldSamples: 401 }, { vocabulary: ['<blank>', 'a'] }])('rejects unverified model or geometry before sending PCM', async mismatch => {
    const value = fixture(), pending = value.engine.recognize(pcm()).catch(error => error)
    await vi.waitFor(() => expect(value.children.length).toBe(1))
    value.children[0].stdout.write(ready(mismatch))
    expect((await pending).message).toContain('校验失败')
    expect(value.children[0].stdin.read()).toBeNull()
    expect(value.children[0].kill).toHaveBeenCalledOnce()
    await value.engine.close()
  })
  it('rejects nonfinite logits or disagreement with original model IDs', async () => {
    for (const change of [(b: Buffer) => b.writeFloatLE(NaN, 0), (b: Buffer, frames: number) => b.writeInt32LE(1, frames * 161 * 4)]) {
      const value = fixture(), current = await initialized(value)
      const pending = current.result.catch(error => error)
      value.children[0].stdout.write(packet(1, 96000, change))
      expect((await pending).message).toContain('概率帧校验失败')
      await value.engine.close()
    }
  })
  it('rejects foreign job IDs, malformed headers and oversized binary claims', async () => {
    for (const response of [packet(2), Buffer.from('not json\n'), Buffer.alloc(16385, 65),
      line({ type: 'result', id: 1, samples: 96000, frames: 299, width: 161, logitBytes: 1000000000, idBytes: 1196 })]) {
      const value = fixture(), current = await initialized(value), pending = current.result.catch(error => error)
      value.children[0].stdout.write(response)
      expect(await pending).toBeInstanceOf(Error)
      expect(value.children[0].kill).toHaveBeenCalledOnce()
      await value.engine.close()
    }
  })
  it('cancels during discovery without spawning a late process', async () => {
    let finish!: (value: typeof files) => void
    const discover = vi.fn(() => new Promise<typeof files>(resolve => { finish = resolve })), spawn = vi.fn()
    const engine = new LocalCtc({ roots: [], runnerPath: '' }, { discover, spawn })
    const pending = engine.recognize(pcm()).catch(error => error)
    await Promise.resolve(); await Promise.resolve()
    engine.cancel(); finish(files)
    expect((await pending).message).toContain('已取消')
    await Promise.resolve(); expect(spawn).not.toHaveBeenCalled()
    await engine.close()
  })
  it('honors AbortSignal, ignores late results and waits for old process exit before creating another', async () => {
    const value = fixture(false), abort = new AbortController(), current = await initialized(value, abort.signal)
    const cancelled = current.result.catch(error => error)
    abort.abort()
    expect((await cancelled).message).toContain('已取消')
    value.children[0].stdout.write(packet())
    const next = value.engine.recognize(pcm()).catch(error => error)
    await Promise.resolve(); await Promise.resolve()
    expect(value.spawn).toHaveBeenCalledTimes(1)
    value.children[0].emit('close', null)
    await vi.waitFor(() => expect(value.spawn).toHaveBeenCalledTimes(2))
    value.children[1].stdout.write(ready())
    await Promise.resolve(); await Promise.resolve()
    value.children[1].stdout.write(packet(2))
    expect(await next).not.toBeInstanceOf(Error)
    const closing = value.engine.close(); value.children[1].emit('close', null); await closing
  })
  it('includes initialization in the 15s job deadline and releases the timed-out child', async () => {
    vi.useFakeTimers()
    const value = fixture(), pending = value.engine.recognize(pcm()).catch(error => error)
    await vi.waitFor(() => expect(value.children.length).toBe(1))
    await vi.advanceTimersByTimeAsync(15000)
    expect((await pending).message).toContain('15 秒预算')
    expect(value.children[0].kill).toHaveBeenCalledOnce()
    await value.engine.close()
  })
  it('does not hang close forever if an owned process fails to report termination', async () => {
    vi.useFakeTimers()
    const value = fixture(false), current = await initialized(value)
    const cancelled = current.result.catch(error => error)
    const closing = value.engine.close().catch(error => error)
    await cancelled
    await vi.advanceTimersByTimeAsync(2000)
    expect((await closing).message).toContain('关闭预算')
    expect(value.children[0].kill).toHaveBeenCalledOnce()
    value.children[0].emit('close', null)
  })
  it('bounds the reap barrier and never overlaps a child which failed to exit', async () => {
    vi.useFakeTimers()
    const value = fixture(false), current = await initialized(value)
    const cancelled = current.result.catch(error => error)
    value.engine.cancel(); await cancelled
    const next = value.engine.recognize(pcm()).catch(error => error)
    await vi.advanceTimersByTimeAsync(2000)
    expect((await next).message).toContain('不可用')
    expect(value.spawn).toHaveBeenCalledTimes(1)
    // Its eventual close clears ownership and permits exactly one replacement.
    value.children[0].emit('close', null)
    const replacement = value.engine.recognize(pcm()).catch(error => error)
    await vi.waitFor(() => expect(value.spawn).toHaveBeenCalledTimes(2))
    value.children[1].stdout.write(ready())
    await Promise.resolve(); await Promise.resolve()
    value.children[1].stdout.write(packet(3))
    expect(await replacement).not.toBeInstanceOf(Error)
    const closing = value.engine.close(); value.children[1].emit('close', null); await closing
  })
  it('handles a throwing kill without making cancel throw or permitting overlap', async () => {
    vi.useFakeTimers()
    const value = fixture(false), current = await initialized(value)
    const cancelled = current.result.catch(error => error)
    value.children[0].kill.mockImplementation(() => { throw new Error('synthetic kill failure') })
    expect(() => value.engine.cancel()).not.toThrow()
    await cancelled
    const closing = value.engine.close().catch(error => error)
    await vi.advanceTimersByTimeAsync(2000)
    expect((await closing).message).toContain('关闭预算')
    value.children[0].emit('close', null)
  })
  it('unloads after 30s idle but a new job clears the old idle timer', async () => {
    vi.useFakeTimers()
    const value = fixture(), current = await initialized(value)
    value.children[0].stdout.write(packet()); await current.result
    await vi.advanceTimersByTimeAsync(29999)
    expect(value.children[0].kill).not.toHaveBeenCalled()
    const next = value.engine.recognize(pcm())
    await Promise.resolve(); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1)
    expect(value.children[0].kill).not.toHaveBeenCalled()
    value.children[0].stdout.write(packet(2)); await next
    await vi.advanceTimersByTimeAsync(30000)
    expect(value.children[0].kill).toHaveBeenCalledOnce()
    expect((await value.engine.status()).loaded).toBe(false)
    await value.engine.close()
  })
  it('handles process crashes without retaining stale ready state, and close is terminal', async () => {
    const value = fixture(), current = await initialized(value), pending = current.result.catch(error => error)
    value.children[0].emit('close', 1)
    expect((await pending).message).toContain('已退出')
    await value.engine.close()
    expect((await value.engine.status()).available).toBe(false)
    await expect(value.engine.recognize(pcm())).rejects.toThrow('已关闭')
  })
})

// Explicit local-only opt-in: never download a model or collect fresh audio in
// the test suite. The input must be an existing 16-bit mono 16kHz WAV recording.
it.runIf(Boolean(process.env.SYLLABLE_CTC_SMOKE_WAV))('smokes the real optional runtime with cached PCM, reuse and cancellation', async () => {
  const wav = await readFile(process.env.SYLLABLE_CTC_SMOKE_WAV!)
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
  let data: Buffer | undefined, validFormat = false
  for (let at = 12; at + 8 <= wav.length;) {
    const length = wav.readUInt32LE(at + 4), next = at + 8 + length
    expect(next).toBeLessThanOrEqual(wav.length)
    const name = wav.toString('ascii', at, at + 4)
    if (name === 'fmt ') {
      expect(length).toBeGreaterThanOrEqual(16)
      validFormat = wav.readUInt16LE(at + 8) === 1 && wav.readUInt16LE(at + 10) === 1
        && wav.readUInt32LE(at + 12) === 16000 && wav.readUInt16LE(at + 22) === 16
    }
    if (name === 'data') data = wav.subarray(at + 8, next)
    at = next + (length & 1)
  }
  expect(validFormat).toBe(true); expect(data).toBeDefined()
  const samples = new Float32Array(data!.length / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = data!.readInt16LE(i * 2) / 32768
  const children: ChildProcessWithoutNullStreams[] = []
  let ownedPids: number[] = []
  const aliveBeforeReplacement: number[] = []
  const engine = new LocalCtc({ roots: [path.resolve('.tools/audio-sync')],
    runnerPath: path.resolve('scripts/audio-sync/romaji-ctc-runner.py') }, {
    spawn: (file, args, options) => {
      if (children.length) for (const pid of ownedPids) {
        try { process.kill(pid, 0); aliveBeforeReplacement.push(pid) } catch { /* verified exited */ }
      }
      const child = realSpawn(file, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] })
      children.push(child); return child
    },
  })
  try {
    expect((await engine.status()).available).toBe(true)
    const coldStarted = performance.now(), cold = await engine.recognize(samples), coldMs = Math.round(performance.now() - coldStarted)
    const hotStarted = performance.now(), hot = await engine.recognize(samples), hotMs = Math.round(performance.now() - hotStarted)
    expect(hot.predictedIds).toEqual(cold.predictedIds)
    expect(children).toHaveLength(1)
    let memory: unknown = undefined
    if (process.platform === 'win32') {
      const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$taskRoot = ${children[0].pid}; $taskChildren = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $taskRoot" | Select-Object -ExpandProperty ProcessId); Get-Process -Id (@($taskRoot) + $taskChildren) | Select-Object Id,WorkingSet64,PrivateMemorySize64,PeakWorkingSet64 | ConvertTo-Json -Compress`],
      { windowsHide: true, timeout: 3000 })
      memory = JSON.parse(result.stdout.trim())
      ownedPids = (Array.isArray(memory) ? memory : [memory]).map(value => (value as { Id: number }).Id)
    }
    const abort = new AbortController(), cancelStarted = performance.now()
    const pending = engine.recognize(samples, { signal: abort.signal }).catch(error => error as Error)
    await new Promise(resolve => setTimeout(resolve, 40)); abort.abort()
    expect((await pending) instanceof Error).toBe(true)
    const cancelMs = Math.round(performance.now() - cancelStarted)
    const restartStarted = performance.now(), restarted = await engine.recognize(samples), restartMs = Math.round(performance.now() - restartStarted)
    expect(restarted.predictedIds).toEqual(cold.predictedIds)
    expect(children).toHaveLength(2)
    expect(aliveBeforeReplacement).toEqual([])
    const closeStarted = performance.now(); await engine.close()
    const closeMs = Math.round(performance.now() - closeStarted)
    expect(children.every(child => child.exitCode !== null || child.signalCode !== null)).toBe(true)
    if (ownedPids.length) {
      const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `@(Get-Process -Id ${ownedPids.join(',')} -ErrorAction SilentlyContinue).Count`], { windowsHide: true, timeout: 3000 })
      expect(Number(result.stdout.trim())).toBe(0)
    }
    console.info('LOCAL_CTC_SMOKE', JSON.stringify({ samples: samples.length, frames: cold.predictedIds!.length,
      coldMs, hotMs, cancelMs, restartMs, closeMs, memory, processesExited: true, noDescendantOverlap: true,
      clockApplied: false }))
  } finally { await engine.close() }
}, 60_000)
