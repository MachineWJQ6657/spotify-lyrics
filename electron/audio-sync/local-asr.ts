import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseWhisperTokens, type HeardToken } from './lyric-aligner'
import { captureQuality } from './capture-quality'

export interface AsrConfig { executable: string; model: string }
export interface AsrStatus { ready: boolean; modelName: string; message: string }

/** whisper.cpp's attention-head presets are model-specific, not file paths. */
export function dtwModelPreset(model: string): string | undefined {
  const name = path.basename(model).toLowerCase()
  const match = /^ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3|large-v3-turbo)(\.en)?(?:-q[\w_]+)?\.bin$/.exec(name)
  if (!match || (match[2] && match[1].startsWith('large'))) return undefined
  return match[1].replaceAll('-', '.') + (match[2] ?? '')
}

/** PCM16 WAV without ffmpeg, network access or arbitrary shell arguments. */
export function encodePcmWav(pcm: Float32Array): Buffer {
  // The IPC still accepts only a fresh 6–15 s capture. Internally a fast
  // recognizer may receive that capture plus real preceding audio context.
  if (!(pcm instanceof Float32Array) || pcm.length < 96000 || pcm.length > 480000) throw new Error('本地识别音频长度必须为 6–30 秒（16 kHz）')
  const buffer = Buffer.alloc(44 + pcm.length * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(pcm.length * 2, 40)
  for (let i = 0; i < pcm.length; i++) {
    if (!Number.isFinite(pcm[i])) throw new Error('录音包含无效采样')
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2)
  }
  return buffer
}

export class LocalAsr {
  private config: AsrConfig | null = null
  private child: ChildProcess | null = null
  private busy = false
  private generation = 0
  constructor(private configFile: string, private tempRoot: string, private searchRoots: string[] = []) {}

  private async valid(config: AsrConfig) {
    if (!config || typeof config.executable !== 'string' || typeof config.model !== 'string'
      || !path.isAbsolute(config.executable) || !path.isAbsolute(config.model)
      || !/^whisper-cli(?:\.exe)?$/i.test(path.basename(config.executable)) || !config.model.endsWith('.bin')) return false
    const [executable, model] = await Promise.all([stat(config.executable), stat(config.model)]).catch(() => [null, null])
    return Boolean(executable?.isFile() && model?.isFile() && model.size >= 1000000 && model.size <= 4_000_000_000)
  }
  async status(): Promise<AsrStatus> {
    if (!this.config) {
      const saved = await readFile(this.configFile, 'utf8').then(JSON.parse).catch(() => null)
      if (await this.valid(saved)) this.config = saved
      else for (const root of this.searchRoots) {
        for (const backend of ['cuda12', 'cpu']) {
          const candidate = { executable: path.join(root, `whisper-1.9.2/${backend}/Release/whisper-cli.exe`), model: path.join(root, 'ggml-large-v3-turbo-q5_0.bin') }
          if (await this.valid(candidate)) { this.config = candidate; break }
        }
        if (this.config) break
      }
    }
    const ready = Boolean(this.config && await this.valid(this.config))
    return { ready, modelName: ready ? path.basename(this.config!.model) : '', message: ready
      ? '本地识别引擎就绪；仅启用时加载模型，停止后释放。' : '未配置识别引擎。选择本地 whisper-cli 和多语言 GGML 模型；不会自动下载或上传声音。' }
  }
  async configure(config: AsrConfig) {
    if (this.busy) throw new Error('请先停止人声对齐')
    if (!await this.valid(config)) throw new Error('需要有效的 whisper-cli 可执行文件和 GGML .bin 模型')
    await mkdir(path.dirname(this.configFile), { recursive: true })
    await writeFile(`${this.configFile}.tmp`, JSON.stringify(config), 'utf8')
    await rename(`${this.configFile}.tmp`, this.configFile)
    this.config = config
    return this.status()
  }
  cancel() { this.generation++; this.child?.kill() }

  async recognize(pcm: Float32Array, language: string): Promise<HeardToken[]> {
    if (this.busy) throw new Error('本地识别仍在进行，不会排队积压录音')
    if (!['ja', 'en', 'zh', 'auto'].includes(language)) throw new Error('不支持的识别语言')
    this.busy = true
    const token = this.generation
    let directory: string | undefined
    try {
      const wav = encodePcmWav(pcm)
      const quality = captureQuality(pcm)
      // Missing/quiet signal is a rejected observation, not an engine failure.
      // Keep sampling; a later continuous phrase may recover without a restart.
      if (quality !== 'usable') return []
      if (!(await this.status()).ready) throw new Error('请先配置本地识别引擎')
      if (token !== this.generation) throw new Error('识别已取消')
      // Silence never starts a heavyweight model. Non-silent accompaniment is
      // rejected later by lexical matching, not incorrectly labelled speech.
      await mkdir(this.tempRoot, { recursive: true })
      directory = await mkdtemp(path.join(this.tempRoot, 'syllable-asr-'))
      const input = path.join(directory, 'input.wav'), output = path.join(directory, 'result')
      await writeFile(input, wav)
      if (token !== this.generation) throw new Error('识别已取消')
      const config = this.config!
      const dtw = dtwModelPreset(config.model)
      const deadline = Date.now() + 15000
      const run = (executable: string) => new Promise<void>((resolve, reject) => {
        if (deadline - Date.now() < 500 || token !== this.generation) { reject(new Error('识别预算已用尽或任务已取消')); return }
        const child = spawn(executable, ['-m', config.model, '-f', input, '-l', language,
          '-t', '4', '-p', '1', '-bs', '5', '-bo', '5', '-nf', '-nfa',
          ...(dtw ? ['-dtw', dtw] : []), '-ojf', '-of', output],
        { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
        this.child = child
        let timedOut = false, stderr = ''
        const timeout = setTimeout(() => { timedOut = true; child.kill() }, Math.max(1, deadline - Date.now()))
        child.stderr?.on('data', data => { stderr = (stderr + data.toString()).slice(-2000) })
        child.on('error', error => { clearTimeout(timeout); reject(new Error(`无法启动识别引擎：${error.message}`)) })
        child.on('close', code => {
          clearTimeout(timeout)
          if (token !== this.generation) reject(new Error('识别已取消'))
          else if (timedOut) reject(new Error('本地识别超过 15 秒预算，已释放模型；可配置更快的多语言模型或 GPU 版引擎'))
          else if (code !== 0) reject(new Error(`本地识别失败（${code}）：${stderr.slice(-400)}`))
          else resolve()
        })
      })
      try { await run(config.executable) }
      catch (error) {
        // A bundled CUDA runtime may be present on a machine without a usable
        // device. Fall back once, within the SAME budget and only after exit.
        const cpuExecutable = config.executable.replace(/([\\/])cuda12([\\/])Release([\\/])/i, '$1cpu$2Release$3')
        const fallback = { ...config, executable: cpuExecutable }
        if (token !== this.generation || deadline - Date.now() < 500 || cpuExecutable === config.executable || !await this.valid(fallback)) throw error
        this.config = fallback
        await run(cpuExecutable)
      }
      if (token !== this.generation) throw new Error('识别已取消')
      const resultFile = `${output}.json`
      if ((await stat(resultFile)).size > 2_000_000) throw new Error('识别结果超出安全大小')
      return parseWhisperTokens(JSON.parse(await readFile(resultFile, 'utf8')), pcm.length / 16,
        dtw ? { timing: 'dtw' } : undefined)
    } finally {
      // Only ever delete a directory created by this exact invocation, under
      // the dedicated temp root. Never a model, user recording or broad path.
      this.child = null
      try { if (directory) await rm(directory, { recursive: true, force: true }) }
      finally { this.busy = false }
    }
  }
}
