import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { decodeCtcFrames, type CtcOutput } from './ctc-tokens'

export const ROMAJI_CTC_MODEL_SHA256 = '63077b2673a87dd10038e429e4953679bd60fd80a045ab9e6e6b7aeeaa32c7ab'
export const ROMAJI_CTC_ORIGINAL_SHA256 = '7006ab5216c7ac0c68446c0c062e7e21358f942d7e6acb67ddaef132ef1d9d7f'
export const ROMAJI_CTC_VOCAB_SHA256 = '4e96b35f058685aa1ac63b1c9e1cc386fa75d85ede5d55997fbbac6e7ec932bb'
const DEADLINE_MS = 15_000
const IDLE_MS = 30_000
const STOP_MS = 2_000
const MAX_LINE = 16_384
const MAX_BODY = 500_000

export interface LocalCtcOptions { roots: readonly string[]; runnerPath: string }
export interface LocalCtcStatus {
  available: boolean
  loaded: boolean
  backend: 'romajiasr-ctc'
  message: string
}
export interface LocalCtcFiles { python: string; modelDirectory: string; runner: string }
interface Dependencies {
  discover(): Promise<LocalCtcFiles | null>
  spawn(executable: string, args: readonly string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams
}
interface Ready { vocabulary: string[]; blankId: number }
interface Header { type: 'result'; id: number; samples: number; frames: number; width: number; logitBytes: number; idBytes: number }
interface Active {
  id: number
  samples: number
  resolve(result: CtcOutput): void
  reject(error: Error): void
  timeout: NodeJS.Timeout
  signal?: AbortSignal
  abort?: () => void
  sent: boolean
}

/** A prompt-free acoustic backend, not a lyric matcher or clock. Python/ORT and
 * verified model files are OPTIONAL local prerequisites, never downloaded.
 * Only one job is allowed, and PCM/posteriors stay in memory. An idle resident
 * process is unloaded after 30s; cancel/close also release that owned process. */
export class LocalCtc {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Ready | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private pendingReady: Promise<void> | null = null
  private active: Active | null = null
  private buffer = Buffer.alloc(0)
  private header: Header | null = null
  private idle: NodeJS.Timeout | null = null
  private nextId = 0
  private closed = false
  private stopping: Promise<void> = Promise.resolve()
  private stoppingChild: ChildProcessWithoutNullStreams | null = null
  private readonly dependencies: Dependencies

  constructor(private options: LocalCtcOptions, dependencies: Partial<Dependencies> = {}) {
    this.dependencies = {
      discover: () => this.discover(),
      spawn: (executable, args, config) => spawn(executable, args, { ...config, stdio: ['pipe', 'pipe', 'pipe'] }),
      ...dependencies,
    }
  }

  private async discover(): Promise<LocalCtcFiles | null> {
    if (!path.isAbsolute(this.options.runnerPath)) return null
    const runner = await stat(this.options.runnerPath).catch(() => null)
    if (!runner?.isFile() || runner.size < 100 || runner.size > 100_000) return null
    for (const root of this.options.roots.slice(0, 8)) {
      if (!path.isAbsolute(root)) continue
      const python = path.join(root, 'ctc-runtime', 'Scripts', 'python.exe')
      const modelDirectory = path.join(root, 'romajiasr-v1.0.0', 'unpacked')
      const files = await Promise.all([python, path.join(modelDirectory, 'model.onnx'),
        path.join(modelDirectory, 'model.with-logits.onnx'), path.join(modelDirectory, 'phoneme_vocab.json')]
        .map(file => stat(file).catch(() => null)))
      if (files.every(file => file?.isFile()) && files[0]!.size > 100_000 && files[0]!.size < 100_000_000
        && files[1]!.size === 189_312_907 && files[2]!.size === 189_312_978 && files[3]!.size < 16_384) {
        return { python, modelDirectory, runner: this.options.runnerPath }
      }
    }
    return null
  }

  async status(): Promise<LocalCtcStatus> {
    const available = !this.closed && Boolean(await this.dependencies.discover())
    return { available, loaded: Boolean(this.child && this.ready), backend: 'romajiasr-ctc', message: available
      ? '本地音素引擎文件可用；启用时校验模型并加载，空闲后释放。未验证为歌词起唱真值。'
      : '未发现完整的本地音素运行时；不会下载模型或上传声音。' }
  }

  private fail(message: string) {
    this.dispose(new Error(message))
  }

  private dispose(error: Error, alreadyExited = false) {
    const child = this.child
    this.child = null; this.ready = null; this.buffer = Buffer.alloc(0); this.header = null
    this.readyReject?.(error); this.readyResolve = null; this.readyReject = null; this.pendingReady = null
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const active = this.active
    this.active = null
    if (active) {
      clearTimeout(active.timeout)
      if (active.abort) active.signal?.removeEventListener('abort', active.abort)
      active.reject(error)
    }
    // Only kill the process this instance created, never a process-name sweep.
    if (child && !alreadyExited) {
      this.stoppingChild = child
      this.stopping = new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, STOP_MS)
        child.once('close', () => {
          clearTimeout(timeout)
          if (this.stoppingChild === child) this.stoppingChild = null
          resolve()
        })
        // A failed kill must not leave callers waiting forever, nor permit a
        // second resident model to overlap the still-owned process.
        try { child.kill() } catch { /* bounded barrier below still applies */ }
      })
    }
  }

  cancel() { this.dispose(new Error('本地音素识别已取消')) }
  async close() {
    this.closed = true; this.cancel()
    await this.stopping
    if (this.stoppingChild) throw new Error('本地音素进程未在关闭预算内退出')
  }

  private async ensureReady() {
    if (this.closed) throw new Error('本地音素引擎已关闭')
    if (this.ready && this.child) return
    if (this.pendingReady) return this.pendingReady
    const owner = this.active
    await this.stopping
    if (!owner || this.active !== owner || this.closed) throw new Error('本地音素识别已取消')
    if (this.stoppingChild) throw new Error('上一个本地音素进程未退出，不会叠加加载模型')
    const files = await this.dependencies.discover()
    if (!owner || this.active !== owner || this.closed) throw new Error('本地音素识别已取消')
    if (!files) throw new Error('未发现完整的本地音素运行时')
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.dependencies.spawn(files.python, ['-I', '-B', '-u', files.runner, '--model-dir', files.modelDirectory],
        { windowsHide: true, shell: false, env: { ...process.env, PYTHONNOUSERSITE: '1', OMP_NUM_THREADS: '2' } })
    } catch { throw new Error('无法启动本地音素运行时') }
    this.child = child
    this.pendingReady = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
    child.stdout.on('data', chunk => { if (this.child === child) this.receive(Buffer.from(chunk)) })
    // Drain bounded diagnostics without retaining possible third-party output.
    child.stderr.on('data', () => {})
    child.stdin.on('error', () => { if (this.child === child) this.fail('本地音素输入流异常') })
    child.on('error', () => { if (this.child === child) this.fail('无法启动本地音素运行时') })
    child.on('close', () => { if (this.child === child) this.dispose(new Error('本地音素进程已退出'), true) })
    return this.pendingReady
  }

  private receive(chunk: Buffer) {
    if (!chunk.length || chunk.length > MAX_BODY + MAX_LINE || this.buffer.length + chunk.length > MAX_BODY + MAX_LINE) {
      this.fail('本地音素输出超出协议限制'); return
    }
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.child) {
      if (!this.header) {
        const newline = this.buffer.indexOf(10)
        if (newline < 0) { if (this.buffer.length > MAX_LINE) this.fail('本地音素输出头过长'); return }
        if (newline > MAX_LINE) { this.fail('本地音素输出头过长'); return }
        let value: Record<string, unknown>
        try { value = JSON.parse(this.buffer.subarray(0, newline).toString('utf8')) }
        catch { this.fail('本地音素输出头无效'); return }
        this.buffer = this.buffer.subarray(newline + 1)
        if (!value || typeof value !== 'object' || Array.isArray(value)) { this.fail('本地音素协议无效'); return }
        if (value.type === 'ready') {
          if (this.ready || !this.readyResolve || value.protocol !== 1 || value.modelSha256 !== ROMAJI_CTC_MODEL_SHA256
            || value.originalSha256 !== ROMAJI_CTC_ORIGINAL_SHA256 || value.vocabSha256 !== ROMAJI_CTC_VOCAB_SHA256
            || value.sampleRate !== 16000 || value.strideSamples !== 320 || value.receptiveFieldSamples !== 400
            || value.blankId !== 0 || !Array.isArray(value.vocabulary) || value.vocabulary.length !== 161
            || [...value.vocabulary].some(phone => typeof phone !== 'string' || !phone || phone.length > 32)
            || new Set(value.vocabulary).size !== 161) { this.fail('本地音素模型或时间坐标校验失败'); return }
          this.ready = { vocabulary: [...value.vocabulary], blankId: 0 }
          this.readyResolve(); this.readyResolve = null; this.readyReject = null; this.pendingReady = null
          continue
        }
        if (!this.active || !this.active.sent || !this.ready || value.type !== 'result' || value.id !== this.active.id
          || value.samples !== this.active.samples || value.width !== 161
          || value.frames !== Math.floor((this.active.samples - 400) / 320) + 1
          || value.logitBytes !== (value.frames as number) * 161 * 4 || value.idBytes !== (value.frames as number) * 4) {
          this.fail('本地音素任务或输出尺寸校验失败'); return
        }
        this.header = value as unknown as Header
      }
      const header = this.header
      const bytes = header.logitBytes + header.idBytes
      if (bytes > MAX_BODY) { this.fail('本地音素结果过大'); return }
      if (this.buffer.length < bytes) return
      const payload = this.buffer.subarray(0, bytes)
      this.buffer = this.buffer.subarray(bytes); this.header = null
      // Buffer slices need not be aligned. Copy to independent typed-array
      // storage so a later chunk/job cannot mutate a previous result.
      const logits = new Float32Array(header.logitBytes / 4), predictedIds = new Int32Array(header.idBytes / 4)
      for (let i = 0; i < logits.length; i++) logits[i] = payload.readFloatLE(i * 4)
      for (let i = 0; i < predictedIds.length; i++) predictedIds[i] = payload.readInt32LE(header.logitBytes + i * 4)
      const result: CtcOutput = { geometry: { sampleRate: 16000, sampleCount: header.samples, strideSamples: 320, receptiveFieldSamples: 400 },
        vocabulary: [...this.ready!.vocabulary], blankId: this.ready!.blankId, logits, predictedIds }
      const decoded = decodeCtcFrames(result)
      if (decoded.reason === 'invalid-input' || decoded.reason === 'unsupported-label' || this.buffer.length) {
        this.fail('本地音素概率帧校验失败'); return
      }
      const active = this.active!
      this.active = null; clearTimeout(active.timeout)
      if (active.abort) active.signal?.removeEventListener('abort', active.abort)
      this.idle = setTimeout(() => this.dispose(new Error('本地音素引擎已空闲释放')), IDLE_MS)
      this.idle.unref?.()
      active.resolve(result)
      return
    }
  }

  recognize(pcm: Float32Array, options: { signal?: AbortSignal } = {}): Promise<CtcOutput> {
    if (this.closed) return Promise.reject(new Error('本地音素引擎已关闭'))
    if (this.active) return Promise.reject(new Error('本地音素识别仍在进行，不会排队积压录音'))
    if (!(pcm instanceof Float32Array) || pcm.length < 96000 || pcm.length > 240000
      || !pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 8)) return Promise.reject(new Error('需要有限的 6–15 秒 16kHz 单声道 PCM'))
    if (options.signal?.aborted) return Promise.reject(new Error('本地音素识别已取消'))
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const input = Buffer.alloc(pcm.length * 4)
    for (let i = 0; i < pcm.length; i++) input.writeFloatLE(pcm[i], i * 4)
    return new Promise<CtcOutput>((resolve, reject) => {
      const id = ++this.nextId
      const timeout = setTimeout(() => this.fail('本地音素识别超过 15 秒预算，已释放模型'), DEADLINE_MS)
      const active: Active = { id, samples: pcm.length, resolve, reject, timeout, signal: options.signal, sent: false }
      this.active = active
      if (options.signal) {
        active.abort = () => { if (this.active === active) this.cancel() }
        options.signal.addEventListener('abort', active.abort, { once: true })
      }
      void this.ensureReady().then(() => {
        if (this.active !== active || !this.child || !this.ready) return
        active.sent = true
        const header = Buffer.from(JSON.stringify({ type: 'recognize', id, samples: pcm.length, bytes: input.length }) + '\n')
        this.child.stdin.write(Buffer.concat([header, input]))
      }).catch(() => { if (this.active === active) this.fail('本地音素运行时不可用或校验失败') })
    })
  }
}
