import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseWhisperTokens, type HeardToken } from './lyric-aligner'

export interface AsrConfig { executable: string; model: string }
export interface AsrStatus { ready: boolean; modelName: string; message: string }

/** PCM16 WAV without ffmpeg, network access or arbitrary shell arguments. */
export function encodePcmWav(pcm: Float32Array): Buffer {
  if (!(pcm instanceof Float32Array) || pcm.length < 96000 || pcm.length > 240000) throw new Error('录音长度必须为 6–15 秒（16 kHz）')
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
        const candidate = { executable: path.join(root, 'whisper-1.9.2/cpu/Release/whisper-cli.exe'), model: path.join(root, 'ggml-large-v3-turbo-q5_0.bin') }
        if (await this.valid(candidate)) { this.config = candidate; break }
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
      if (!(await this.status()).ready) throw new Error('请先配置本地识别引擎')
      if (token !== this.generation) throw new Error('识别已取消')
      // Silence never starts a heavyweight model. Non-silent accompaniment is
      // rejected later by lexical matching, not incorrectly labelled speech.
      const rms = Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length)
      if (rms < .003) return []
      await mkdir(this.tempRoot, { recursive: true })
      directory = await mkdtemp(path.join(this.tempRoot, 'syllable-asr-'))
      const input = path.join(directory, 'input.wav'), output = path.join(directory, 'result')
      await writeFile(input, wav)
      if (token !== this.generation) throw new Error('识别已取消')
      const config = this.config!
      await new Promise<void>((resolve, reject) => {
        const child = spawn(config.executable, ['-m', config.model, '-f', input, '-l', language,
          '-t', '4', '-p', '1', '-bs', '5', '-bo', '5', '-nf', '-ojf', '-of', output],
        { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
        this.child = child
        let timedOut = false, stderr = ''
        const timeout = setTimeout(() => { timedOut = true; child.kill() }, 15000)
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
      if (token !== this.generation) throw new Error('识别已取消')
      const resultFile = `${output}.json`
      if ((await stat(resultFile)).size > 2_000_000) throw new Error('识别结果超出安全大小')
      return parseWhisperTokens(JSON.parse(await readFile(resultFile, 'utf8')), pcm.length / 16)
    } finally {
      // Only ever delete a directory created by this exact invocation, under
      // the dedicated temp root. Never a model, user recording or broad path.
      this.child = null
      try { if (directory) await rm(directory, { recursive: true, force: true }) }
      finally { this.busy = false }
    }
  }
}
